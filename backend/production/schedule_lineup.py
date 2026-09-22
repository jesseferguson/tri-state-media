"""Atomic ordering for a press's combined job-ticket and material-run lineup."""

from copy import copy

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException

from materials.models import CoaterRollTag
from tooling.models import Press
from users.auth import company_user_from_request
from users.models import CompanyUser

from .models import CustomerOrder, CustomerOrderEvent, ProductionSchedule


PRODUCT_LINEUP_STATUSES = ["unscheduled", "scheduled", "ready", "running", "on_hold"]
MATERIAL_LINEUP_STATUSES = ["scheduled", "running", "on_hold"]


class LineupChanged(APIException):
    status_code = 409
    default_detail = {
        "detail": "This press lineup changed while you were arranging it. Refresh the lineup and try again.",
        "code": "lineup_changed",
    }


class LineupItemSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["product", "material"])
    id = serializers.IntegerField(min_value=1)


class ExpectedLineupItemSerializer(LineupItemSerializer):
    press_sequence = serializers.IntegerField(min_value=0, allow_null=True)


class ReorderLineupSerializer(serializers.Serializer):
    press = serializers.PrimaryKeyRelatedField(queryset=Press.objects.all())
    items = LineupItemSerializer(many=True, allow_empty=False, max_length=5000)
    expected_items = ExpectedLineupItemSerializer(many=True, allow_empty=False, max_length=5000)

    def validate(self, attrs):
        for field in ["items", "expected_items"]:
            keys = [(item["kind"], item["id"]) for item in attrs[field]]
            if len(keys) != len(set(keys)):
                raise serializers.ValidationError({field: "Include each scheduled item once."})
        if {(item["kind"], item["id"]) for item in attrs["items"]} != {(item["kind"], item["id"]) for item in attrs["expected_items"]}:
            raise serializers.ValidationError({"items": "The requested and original lineup must contain the same items."})
        return attrs


def verified_lineup_user(request):
    if settings.API_AUTH_REQUIRED or getattr(getattr(request, "user", None), "is_authenticated", False):
        return company_user_from_request(request)
    # Preserve the application's explicitly configured local-development identity mode.
    user_id = str(request.META.get("HTTP_X_COMPANY_USER_ID") or "").strip()
    username = str(request.META.get("HTTP_X_COMPANY_USERNAME") or "").strip()
    if not user_id.isascii() or not user_id.isdigit() or len(user_id) > 19 or int(user_id) > 9223372036854775807:
        return None
    user = CompanyUser.objects.select_related("role").filter(pk=user_id, active=True).first()
    return user if user and (not username or user.username.lower() == username.lower()) else None


def _save_lineup_position(kind, row, sequence, actor, changed_at):
    if kind == "material":
        # Saving a coater tag invokes inventory/consumption hooks. A lineup edit
        # changes only its order and must not run those manufacturing hooks.
        CoaterRollTag.objects.filter(pk=row.pk).update(press_sequence=sequence, updated_at=changed_at)
        return

    previous = copy(row)
    row.press_sequence = sequence
    row.last_updated_by = actor
    row.updated_at = changed_at
    # Sequence changes must not apply dynamic-file hold rules or overwrite fields
    # outside this operation. Keep the existing customer-order and ticket history.
    ProductionSchedule.objects.filter(pk=row.pk).update(
        press_sequence=sequence, last_updated_by=actor, updated_at=changed_at,
    )
    orders = list(CustomerOrder.objects.select_for_update(of=("self",)).filter(schedule_entry=row).order_by("pk"))
    CustomerOrder.objects.filter(pk__in=[order.pk for order in orders]).update(
        press_sequence=sequence, last_updated_by=actor, updated_at=changed_at,
    )
    for order in orders:
        CustomerOrderEvent.objects.create(
            order=order, event_type="schedule_updated", performed_by=actor,
            summary=f"Press lineup order changed to {sequence}.",
        )
    row._log_job_ticket_event(previous=previous)


@transaction.atomic
def reorder_press_lineup(data, *, user):
    # Serialize all reorder requests for this press before taking record locks.
    press = Press.objects.select_for_update().filter(pk=data["press"].pk).first()
    if press is None:
        raise LineupChanged()
    products = list(ProductionSchedule.objects.select_for_update(of=("self",)).select_related("press").filter(
        press=press, status__in=PRODUCT_LINEUP_STATUSES,
    ).order_by("pk"))
    materials = list(CoaterRollTag.objects.select_for_update(of=("self",)).filter(
        press=press, source_schedule__isnull=True, log_inventory=False, status__in=MATERIAL_LINEUP_STATUSES,
    ).order_by("pk"))
    current = {("product", row.pk): row for row in products}
    current.update({("material", row.pk): row for row in materials})
    expected = {(item["kind"], item["id"]): item["press_sequence"] for item in data["expected_items"]}
    if set(current) != set(expected) or any(current[key].press_sequence != sequence for key, sequence in expected.items()):
        raise LineupChanged()

    changed_at = timezone.now()
    actor = (user.name or user.username)[:120]
    changed = 0
    result = []
    for sequence, item in enumerate(data["items"], start=1):
        row = current[(item["kind"], item["id"])]
        if row.press_sequence != sequence:
            _save_lineup_position(item["kind"], row, sequence, actor, changed_at)
            changed += 1
        result.append({**item, "press_sequence": sequence})
    return {"press": press.pk, "items": result, "updated_count": changed}
