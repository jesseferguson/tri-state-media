import logging
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import DecimalField, ExpressionWrapper, F, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import filters, serializers, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from materials.models import MaterialUsage
from tooling.models import ToolingLocation

from .models import (
    BoxInventory,
    BoxSpec,
    CompanyRole,
    CompanyUser,
    CoreInventory,
    CoreSpec,
    Customer,
    CustomerOrder,
    CustomerOrderEvent,
    FinishedInventory,
    JobTicketEvent,
    JobTicket,
    JobTicketUsage,
    LiveFootageArchive,
    Message,
    MessageThread,
    ProductionSchedule,
    QuoteCostRate,
    QuoteFinishedMaterial,
    QuoteRawMaterial,
    QuoteRecord,
)
from .serializers import (
    BoxInventorySerializer,
    BoxSpecSerializer,
    CompanyRoleSerializer,
    CompanyUserSerializer,
    CoreInventorySerializer,
    CoreSpecSerializer,
    CustomerSerializer,
    CustomerOrderEventSerializer,
    CustomerOrderSerializer,
    FinishedInventorySerializer,
    JobTicketEventSerializer,
    JobTicketSerializer,
    JobTicketUsageSerializer,
    LiveFootageArchiveSerializer,
    MessageSerializer,
    MessageThreadSerializer,
    ProductionScheduleSerializer,
    QuoteCostRateSerializer,
    QuoteFinishedMaterialSerializer,
    QuoteRawMaterialSerializer,
    QuoteRecordSerializer,
)


logger = logging.getLogger(__name__)


JOB_TICKET_CHANGE_FIELDS = [
    ("customer", "Customer"),
    ("customer_name", "Customer Name Override"),
    ("job_name", "Job Number"),
    ("product_code", "TSM ID"),
    ("description", "Description"),
    ("box_item_number", "Legacy Box Item #"),
    ("material_master_type", "Material Type"),
    ("material_spec", "Legacy Finished Raw Material"),
    ("label_width_inches", "Label Width"),
    ("label_length_inches", "Label Length"),
    ("repeat_inches", "Label Repeat"),
    ("cutting_type", "Label Cutting Type"),
    ("face_type", "Face Type"),
    ("liner_type", "Liner Type"),
    ("recipe", "Label Layout"),
    ("requested_quantity", "Requested Quantity"),
    ("finishing_type", "Finishing"),
    ("unit_type", "Unit Type"),
    ("labels_per_unit", "Labels / Unit"),
    ("units_per_carton", "Labels / Carton"),
    ("box", "Box"),
    ("core", "Core"),
    ("core_size_inches", "Core Size"),
    ("wind_direction", "Wind Direction"),
    ("fanfold_gear", "Fanfold Gear"),
    ("labels_per_fold", "Labels / Fold"),
    ("ribbon", "Ribbon"),
    ("laminate", "Laminate"),
    ("bagged", "Bagged"),
    ("finishing_notes", "Finishing Notes"),
    ("carton_label_part_number", "Carton Label Part Number"),
    ("carton_label_description_a", "Carton Label Description A"),
    ("carton_label_description_b", "Carton Label Description B"),
    ("carton_label_description_c", "Carton Label Description C"),
    ("carton_label_finishing_1", "Carton Label Finishing 1"),
    ("carton_label_finishing_2", "Carton Label Finishing 2"),
    ("job_notes", "Job Notes"),
]


def short_summary(value):
    text = str(value or "")
    return text if len(text) <= 255 else f"{text[:252]}..."


def ticket_compare_value(ticket, field_name):
    field = ticket._meta.get_field(field_name)
    if getattr(field, "many_to_one", False):
        return getattr(ticket, f"{field_name}_id")
    return getattr(ticket, field_name)


def ticket_display_value(ticket, field_name):
    field = ticket._meta.get_field(field_name)
    if getattr(field, "many_to_one", False):
        related = getattr(ticket, field_name)
        return str(related) if related else ""

    value = getattr(ticket, field_name)
    if value in [None, ""]:
        return ""
    if field.choices:
        return str(getattr(ticket, f"get_{field_name}_display")())
    return str(value)


def ticket_change_details(previous, current):
    changes = []
    for field_name, label in JOB_TICKET_CHANGE_FIELDS:
        if ticket_compare_value(previous, field_name) == ticket_compare_value(current, field_name):
            continue
        changes.append({
            "field": field_name,
            "label": label,
            "from": ticket_display_value(previous, field_name),
            "to": ticket_display_value(current, field_name),
        })
    return changes


def json_safe_value(value):
    if value in [None, ""]:
        return None if value is None else ""
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def pending_compare_value(field, value):
    if getattr(field, "many_to_one", False):
        return value.pk if value else None
    return value


def pending_display_value(field, value):
    if getattr(field, "many_to_one", False):
        return str(value) if value else ""
    if value in [None, ""]:
        return ""
    if field.choices:
        return str(dict(field.flatchoices).get(value, value))
    return str(value)


def pending_payload_value(field, value):
    if getattr(field, "many_to_one", False):
        return value.pk if value else None
    return json_safe_value(value)


def pending_ticket_change_details(ticket, validated_data):
    changes = []
    payload = {}
    for field_name, label in JOB_TICKET_CHANGE_FIELDS:
        if field_name not in validated_data:
            continue
        field = ticket._meta.get_field(field_name)
        value = validated_data[field_name]
        if ticket_compare_value(ticket, field_name) == pending_compare_value(field, value):
            continue
        payload[field_name] = pending_payload_value(field, value)
        changes.append({
            "field": field_name,
            "label": label,
            "from": ticket_display_value(ticket, field_name),
            "to": pending_display_value(field, value),
        })
    return changes, payload


def ticket_has_pending_changes(ticket):
    if not ticket:
        return False
    return JobTicketEvent.objects.filter(
        job_ticket=ticket,
        event_type="updated",
        details__approval__status="pending",
    ).exists()


def set_ticket_field_value(ticket, field_name, value):
    field = ticket._meta.get_field(field_name)
    if getattr(field, "many_to_one", False):
        setattr(ticket, f"{field_name}_id", value or None)
        return
    setattr(ticket, field_name, value)


def apply_pending_ticket_payload(ticket, payload):
    for field_name, value in (payload or {}).items():
        try:
            ticket._meta.get_field(field_name)
        except Exception:
            continue
        set_ticket_field_value(ticket, field_name, value)
    ticket.save()


def image_public_url(storage_name):
    if not storage_name:
        return ""
    try:
        return default_storage.url(storage_name)
    except Exception:
        return ""


def apply_pending_artwork(ticket, artwork):
    slot = artwork.get("slot")
    if slot not in {"general", "spec", "finishing"}:
        return
    image_field = f"{slot}_image"
    name_field = f"{slot}_image_name"
    description_field = f"{slot}_image_description"
    next_artwork = artwork.get("next") or {}
    action_value = artwork.get("action")

    if action_value == "deleted":
        setattr(ticket, image_field, None)
        setattr(ticket, name_field, "")
        setattr(ticket, description_field, "")
        if slot == "general":
            ticket.external_image_url = ""
            ticket.external_image_source = ""
    else:
        storage_name = next_artwork.get("storage_name")
        if storage_name:
            setattr(ticket, image_field, storage_name)
        setattr(ticket, name_field, str(next_artwork.get("name") or "").strip())
        setattr(ticket, description_field, str(next_artwork.get("description") or "").strip())
        if slot == "general" and storage_name:
            ticket.external_image_url = ""
            ticket.external_image_source = "New System"

    update_fields = [image_field, name_field, description_field, "updated_at"]
    if slot == "general":
        update_fields += ["external_image_url", "external_image_source"]
    ticket.save(update_fields=update_fields)


class BaseProductionViewSet(viewsets.ModelViewSet):
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    parser_classes = [JSONParser, FormParser, MultiPartParser]


class CustomerViewSet(BaseProductionViewSet):
    queryset = Customer.objects.all().order_by("name")
    serializer_class = CustomerSerializer
    search_fields = [
        "name",
        "customer_code",
        "contact_name",
        "phone",
        "email",
        "address_line_1",
        "address_line_2",
        "address_line_3",
        "city",
        "state",
        "postal_code",
        "country",
        "notes",
    ]
    ordering_fields = ["name", "customer_code", "is_active"]


class CompanyRoleViewSet(BaseProductionViewSet):
    queryset = CompanyRole.objects.all().order_by("name")
    serializer_class = CompanyRoleSerializer
    search_fields = ["name", "description"]
    ordering_fields = ["name", "created_at"]


class CompanyUserViewSet(BaseProductionViewSet):
    queryset = CompanyUser.objects.select_related("role").all().order_by("name", "username")
    serializer_class = CompanyUserSerializer
    search_fields = ["name", "username", "role__name", "quote_company"]
    ordering_fields = ["name", "username", "quote_company", "active", "created_at"]


class MessageThreadViewSet(BaseProductionViewSet):
    serializer_class = MessageThreadSerializer
    search_fields = ["title", "participant_names", "context_label", "created_by_name"]
    ordering_fields = ["updated_at", "created_at", "title"]

    def get_queryset(self):
        qs = MessageThread.objects.prefetch_related("messages").all().order_by("-updated_at", "-id")
        viewer = str(self.request.query_params.get("viewer") or "").strip()
        if viewer:
            ids = [
                thread.id
                for thread in qs
                if viewer in [str(item) for item in (thread.participant_user_ids or [])]
            ]
            qs = MessageThread.objects.prefetch_related("messages").filter(id__in=ids).order_by("-updated_at", "-id")
        return qs

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        thread = self.get_object()
        viewer = str(request.data.get("viewer") or request.data.get("viewer_id") or "").strip()
        if not viewer:
            return Response({"viewer": ["Viewer is required."]}, status=status.HTTP_400_BAD_REQUEST)
        for message in thread.messages.all():
            read_by = [str(item) for item in (message.read_by_user_ids or [])]
            if viewer not in read_by:
                read_by.append(viewer)
                message.read_by_user_ids = read_by
                message.save(update_fields=["read_by_user_ids"])
        return Response(self.get_serializer(thread).data)


class MessageViewSet(BaseProductionViewSet):
    serializer_class = MessageSerializer
    search_fields = ["body", "sender_name", "thread__title", "thread__context_label"]
    ordering_fields = ["created_at", "sender_name"]

    def get_queryset(self):
        qs = Message.objects.select_related("thread").all().order_by("created_at", "id")
        thread = self.request.query_params.get("thread")
        if thread:
            qs = qs.filter(thread_id=thread)
        return qs

    def perform_create(self, serializer):
        message = serializer.save()
        read_by = [str(item) for item in (message.read_by_user_ids or [])]
        sender = str(message.sender_user_id or "").strip()
        if sender and sender not in read_by:
            read_by.append(sender)
            message.read_by_user_ids = read_by
            message.save(update_fields=["read_by_user_ids"])
        message.thread.updated_at = timezone.now()
        message.thread.save(update_fields=["updated_at"])


class QuoteRawMaterialViewSet(BaseProductionViewSet):
    queryset = QuoteRawMaterial.objects.all().order_by("component_type", "name")
    serializer_class = QuoteRawMaterialSerializer
    lookup_field = "external_id"
    search_fields = ["name", "component_type", "notes"]
    ordering_fields = ["name", "component_type", "msi_cost", "updated_at"]


class QuoteCostRateViewSet(BaseProductionViewSet):
    queryset = QuoteCostRate.objects.all().order_by("label")
    serializer_class = QuoteCostRateSerializer
    search_fields = ["key", "label", "notes"]
    ordering_fields = ["key", "label", "msi_cost", "updated_at"]


class QuoteFinishedMaterialViewSet(BaseProductionViewSet):
    queryset = QuoteFinishedMaterial.objects.select_related("material_master_type").all().order_by("name")
    serializer_class = QuoteFinishedMaterialSerializer
    lookup_field = "external_id"
    search_fields = ["name", "material_master_type__code", "material_master_type__name", "source_type", "notes"]
    ordering_fields = ["name", "material_master_type__code", "source_type", "updated_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        master_type = self.request.query_params.get("master_type")
        if master_type:
            qs = qs.filter(material_master_type_id=master_type)
        return qs


class QuoteRecordViewSet(BaseProductionViewSet):
    queryset = QuoteRecord.objects.select_related("customer", "job_ticket").all().order_by("-created_at", "-id")
    serializer_class = QuoteRecordSerializer
    lookup_field = "external_id"
    search_fields = [
        "quote_number",
        "customer_name",
        "customer__name",
        "customer__customer_code",
        "job_name",
        "product_code",
        "description",
        "prepared_by_name",
        "prepared_by_role",
        "approval_status",
        "approval_by_name",
        "workflow_status",
        "processed_by_name",
        "last_edited_by_name",
        "quote_company",
        "material_name",
        "notes",
    ]
    ordering_fields = ["created_at", "quote_number", "customer_name", "prepared_by_name", "approval_status", "approval_at", "workflow_status", "processed_at", "last_edited_at", "quote_company", "material_name"]

    def get_queryset(self):
        qs = super().get_queryset()
        approval_status = self.request.query_params.get("approval_status")
        if approval_status:
            qs = qs.filter(approval_status=approval_status)
        workflow_status = self.request.query_params.get("workflow_status")
        if workflow_status:
            qs = qs.filter(workflow_status=workflow_status)
        customer = self.request.query_params.get("customer")
        if customer:
            customer_value = str(customer).strip()
            customer_obj = Customer.objects.filter(pk=customer_value).first() if customer_value.isdigit() else None
            customer_filter = Q(customer_id=customer_value) if customer_value.isdigit() else Q(customer_name__iexact=customer_value)
            if customer_obj:
                customer_filter |= Q(customer_name__iexact=customer_obj.name)
                if customer_obj.customer_code:
                    customer_filter |= Q(customer__customer_code__iexact=customer_obj.customer_code)
            qs = qs.filter(customer_filter)
        return qs


@api_view(["POST"])
def company_sign_in(request):
    username = str(request.data.get("username", "")).strip().lower()
    password = str(request.data.get("password", ""))
    try:
        user = CompanyUser.objects.select_related("role").get(username__iexact=username)
    except CompanyUser.DoesNotExist:
        return Response({"error": "Username or password is not correct."}, status=status.HTTP_400_BAD_REQUEST)

    if not user.check_password(password):
        return Response({"error": "Username or password is not correct."}, status=status.HTTP_400_BAD_REQUEST)
    if not user.active:
        return Response({"error": "This user is inactive. Ask an admin to reactivate the account."}, status=status.HTTP_400_BAD_REQUEST)

    return Response({
        "user": CompanyUserSerializer(user).data,
        "users": CompanyUserSerializer(CompanyUser.objects.select_related("role").all(), many=True).data,
        "roles": CompanyRoleSerializer(CompanyRole.objects.all(), many=True).data,
    })


class BoxSpecViewSet(BaseProductionViewSet):
    queryset = BoxSpec.objects.all().order_by("supplier", "name", "item_number")
    serializer_class = BoxSpecSerializer
    search_fields = ["name", "item_number", "supplier", "notes"]
    ordering_fields = ["name", "item_number", "supplier", "width_inches", "length_inches", "height_inches", "is_active"]


class BoxInventoryViewSet(BaseProductionViewSet):
    queryset = (
        BoxInventory.objects.select_related("box", "location")
        .all()
        .order_by("box__name", "lot_number")
    )
    serializer_class = BoxInventorySerializer
    search_fields = ["box__name", "box__item_number", "box__supplier", "lot_number", "status", "location__name", "notes"]
    ordering_fields = ["box__name", "lot_number", "quantity", "status", "received_date"]


class CoreSpecViewSet(BaseProductionViewSet):
    queryset = CoreSpec.objects.all().order_by("supplier", "core_size_inches", "name", "item_number")
    serializer_class = CoreSpecSerializer
    search_fields = ["name", "item_number", "supplier", "core_size_inches", "notes"]
    ordering_fields = ["name", "item_number", "supplier", "core_size_inches", "is_active"]


class CoreInventoryViewSet(BaseProductionViewSet):
    queryset = (
        CoreInventory.objects.select_related("core", "location")
        .all()
        .order_by("core__core_size_inches", "core__name", "lot_number")
    )
    serializer_class = CoreInventorySerializer
    search_fields = ["core__name", "core__item_number", "core__supplier", "lot_number", "status", "location__name", "notes"]
    ordering_fields = ["core__core_size_inches", "core__name", "lot_number", "quantity", "status", "received_date"]


class JobTicketViewSet(BaseProductionViewSet):
    serializer_class = JobTicketSerializer
    search_fields = [
        "ticket_number",
        "customer_name",
        "customer__name",
        "customer__customer_code",
        "job_name",
        "product_code",
        "description",
        "recipe__name",
        "material_spec__code",
        "material_spec__name",
        "material_spec__company",
        "material_spec__material_family",
        "material_spec__master_type__code",
        "material_spec__master_type__name",
        "material_master_type__code",
        "material_master_type__name",
        "box__name",
        "box_item_number",
        "box__item_number",
        "box__supplier",
        "core__name",
        "core__item_number",
        "core__supplier",
        "fanfold_gear",
        "general_image_name",
        "general_image_description",
        "spec_image_name",
        "spec_image_description",
        "finishing_image_name",
        "finishing_image_description",
        "finishing_type",
        "cutting_type",
        "unit_type",
        "ribbon",
        "laminate",
        "bagged",
        "carton_label_part_number",
        "carton_label_description_a",
        "carton_label_description_b",
        "carton_label_description_c",
        "carton_label_finishing_1",
        "carton_label_finishing_2",
        "finishing_notes",
        "job_notes",
    ]
    ordering_fields = [
        "ticket_number",
        "customer_name",
        "job_name",
        "label_width_inches",
        "label_length_inches",
        "repeat_inches",
        "requested_quantity",
        "recent_usage_90d",
        "finished_on_hand_quantity",
    ]

    image_slots = {"general", "spec", "finishing"}

    def history_actor(self):
        actor = str(
            self.request.data.get("performed_by")
            or self.request.data.get("last_updated_by")
            or ""
        ).strip()
        user = getattr(self.request, "user", None)
        if not actor and user and user.is_authenticated:
            actor = user.get_full_name() or user.get_username()
        return actor or "system"

    def create_ticket_event(self, ticket, event_type, summary, actor, changes=None, extra_details=None):
        details = {"changes": changes or []}
        if extra_details:
            details.update(extra_details)
        if changes and event_type == "updated":
            details.setdefault("approval", {
                "status": "pending",
                "requested_by": actor or "system",
                "requested_at": timezone.now().isoformat(),
            })
        JobTicketEvent.objects.create(
            job_ticket=ticket,
            event_type=event_type,
            summary=short_summary(summary),
            performed_by=actor or "system",
            details=details,
        )

    def perform_create(self, serializer):
        actor = self.history_actor()
        ticket = serializer.save()
        self.create_ticket_event(
            ticket,
            "created",
            f"{actor} created the job ticket.",
            actor,
        )

    def perform_update(self, serializer):
        previous = JobTicket.objects.select_related(
            "customer",
            "recipe",
            "material_spec",
            "material_spec__master_type",
            "material_master_type",
            "box",
            "core",
        ).get(pk=serializer.instance.pk)
        actor = self.history_actor()
        changes, pending_payload = pending_ticket_change_details(previous, serializer.validated_data)
        if not changes:
            return

        labels = [change["label"] for change in changes]
        self.create_ticket_event(
            previous,
            "updated",
            f"{actor} requested {', '.join(labels[:4])}{'...' if len(labels) > 4 else ''}.",
            actor,
            changes=changes,
            extra_details={
                "pending_payload": pending_payload,
                "pending_action": "job_ticket_update",
            },
        )

    def get_queryset(self):
        recent_usage_start = timezone.now() - timedelta(days=90)
        recent_run_start = timezone.localdate() - timedelta(days=90)
        decimal_zero = Value(0, output_field=DecimalField(max_digits=14, decimal_places=3))
        usage_total = (
            JobTicketUsage.objects
            .filter(job_ticket=OuterRef("pk"), used_at__gte=recent_usage_start)
            .values("job_ticket")
            .annotate(total=Sum("quantity"))
            .values("total")
        )
        shipped_total = (
            FinishedInventory.objects
            .filter(job_ticket=OuterRef("pk"), status="shipped", run_date__gte=recent_run_start)
            .values("job_ticket")
            .annotate(total=Sum("quantity"))
            .values("total")
        )
        sent_finished_total = (
            MaterialUsage.objects
            .filter(
                finished_inventory__job_ticket=OuterRef("pk"),
                usage_type__in=["shipped", "manual", "checkout"],
                used_date__gte=recent_run_start,
            )
            .values("finished_inventory__job_ticket")
            .annotate(total=Sum("quantity"))
            .values("total")
        )
        on_hand_total = (
            FinishedInventory.objects
            .filter(job_ticket=OuterRef("pk"), status__in=["available", "allocated", "on_hold"])
            .values("job_ticket")
            .annotate(total=Sum("quantity"))
            .values("total")
        )
        qs = (
            JobTicket.objects.select_related(
                "customer",
                "recipe",
                "material_spec",
                "material_spec__master_type",
                "material_master_type",
                "box",
                "core",
            )
            .annotate(
                imported_usage_90d=Coalesce(Subquery(usage_total, output_field=DecimalField(max_digits=14, decimal_places=3)), decimal_zero),
                shipped_status_usage_90d=Coalesce(Subquery(shipped_total, output_field=DecimalField(max_digits=14, decimal_places=3)), decimal_zero),
                sent_finished_usage_90d=Coalesce(Subquery(sent_finished_total, output_field=DecimalField(max_digits=14, decimal_places=3)), decimal_zero),
                finished_on_hand_quantity=Coalesce(Subquery(on_hand_total, output_field=DecimalField(max_digits=14, decimal_places=3)), decimal_zero),
            )
            .annotate(
                shipped_usage_90d=ExpressionWrapper(
                    F("shipped_status_usage_90d") + F("sent_finished_usage_90d"),
                    output_field=DecimalField(max_digits=14, decimal_places=3),
                )
            )
            .annotate(
                recent_usage_90d=ExpressionWrapper(
                    F("imported_usage_90d") + F("shipped_usage_90d"),
                    output_field=DecimalField(max_digits=14, decimal_places=3),
                )
            )
            .order_by("-recent_usage_90d", "ticket_number")
        )
        customer = self.request.query_params.get("customer")
        if customer:
            qs = qs.filter(customer_id=customer)
        return qs

    @action(detail=True, methods=["post", "delete"], url_path=r"images/(?P<slot>general|spec|finishing)")
    def images(self, request, pk=None, slot=None):
        ticket = self.get_object()
        if slot not in self.image_slots:
            return Response({"error": "Unknown image slot."}, status=status.HTTP_400_BAD_REQUEST)

        image_field = f"{slot}_image"
        name_field = f"{slot}_image_name"
        description_field = f"{slot}_image_description"
        slot_label = {
            "general": "General Image",
            "spec": "Spec Image",
            "finishing": "Finishing Image",
        }.get(slot, slot.title())
        actor = self.history_actor()
        changes = []
        previous_file = getattr(ticket, image_field)
        previous_storage_name = previous_file.name if previous_file else ""
        previous_file_name = previous_file.name.split("/")[-1] if previous_file else ""
        previous_name = getattr(ticket, name_field, "")
        previous_description = getattr(ticket, description_field, "")
        previous_url = image_public_url(previous_storage_name)
        if slot == "general" and not previous_url:
            previous_url = ticket.external_image_url or ""
        previous_artwork = {
            "storage_name": previous_storage_name,
            "file_name": previous_file_name,
            "url": previous_url,
            "name": previous_name or (ticket.external_image_source if slot == "general" and previous_url else ""),
            "description": previous_description,
        }
        change_description = str(request.data.get("change_description") or "").strip()

        if request.method == "DELETE":
            if previous_file_name or previous_name or previous_description or previous_url:
                changes.append({"field": image_field, "label": slot_label, "from": previous_name or previous_file_name, "to": ""})
                if change_description:
                    changes.append({"field": f"{slot}_artwork_change_note", "label": f"{slot_label} Change Note", "from": "", "to": change_description})
                self.create_ticket_event(
                    ticket,
                    "updated",
                    f"{actor} requested removal of {slot_label}.",
                    actor,
                    changes=changes,
                    extra_details={
                        "image_slot": slot,
                        "action": "deleted",
                        "pending_action": "artwork_update",
                        "pending_artwork": {
                            "slot": slot,
                            "action": "deleted",
                            "previous": previous_artwork,
                            "next": {},
                            "change_description": change_description,
                        },
                    },
                )
            return Response(self.get_serializer(ticket).data)

        upload = request.FILES.get("image")
        pending_storage_name = ""
        if upload:
            try:
                pending_storage_name = default_storage.save(job_ticket_image_upload_path(ticket, upload.name), upload)
            except Exception as error:
                logger.exception("Could not save pending job ticket image to storage.")
                return Response({"error": f"Could not save pending image: {error}"}, status=status.HTTP_502_BAD_GATEWAY)
            changes.append({"field": image_field, "label": slot_label, "from": previous_name or previous_file_name, "to": upload.name})

        new_name = str(request.data.get("name") or (upload.name if upload else previous_name) or "").strip()
        new_description = str(request.data.get("description") if "description" in request.data else previous_description or "").strip()
        if previous_name != new_name:
            changes.append({"field": name_field, "label": f"{slot_label} Name", "from": previous_name, "to": new_name})
        if previous_description != new_description:
            changes.append({"field": description_field, "label": f"{slot_label} Description", "from": previous_description, "to": new_description})
        if change_description:
            changes.append({"field": f"{slot}_artwork_change_note", "label": f"{slot_label} Change Note", "from": "", "to": change_description})
        if changes:
            self.create_ticket_event(
                ticket,
                "updated",
                f"{actor} requested {slot_label} update.",
                actor,
                changes=changes,
                extra_details={
                    "image_slot": slot,
                    "action": "uploaded" if upload else "updated",
                    "pending_action": "artwork_update",
                    "pending_artwork": {
                        "slot": slot,
                        "action": "uploaded" if upload else "updated",
                        "previous": previous_artwork,
                        "next": {
                            "storage_name": pending_storage_name or previous_storage_name,
                            "file_name": upload.name if upload else previous_file_name,
                            "url": image_public_url(pending_storage_name or previous_storage_name),
                            "name": new_name,
                            "description": new_description,
                        },
                        "change_description": change_description,
                    },
                },
            )
        return Response(self.get_serializer(ticket).data)


class JobTicketEventViewSet(BaseProductionViewSet):
    serializer_class = JobTicketEventSerializer
    search_fields = [
        "event_type",
        "summary",
        "performed_by",
        "job_ticket__ticket_number",
        "job_ticket__job_name",
        "job_ticket__product_code",
    ]
    ordering_fields = ["created_at", "event_type", "performed_by"]

    def get_queryset(self):
        qs = (
            JobTicketEvent.objects.select_related("job_ticket")
            .all()
            .order_by("-created_at", "-id")
        )
        job_ticket = self.request.query_params.get("job_ticket")
        if job_ticket:
            qs = qs.filter(job_ticket_id=job_ticket)
        return qs

    def update_approval(self, request, status_value):
        event = self.get_object()
        details = dict(event.details or {})
        approval = dict(details.get("approval") or {})
        actor = str(request.data.get("performed_by") or request.data.get("approval_by") or "").strip() or "system"
        if status_value == "approved":
            pending_action = details.get("pending_action")
            if pending_action == "job_ticket_update":
                payload = dict(details.get("pending_payload") or {})
                overrides = request.data.get("pending_payload") or request.data.get("payload") or {}
                if isinstance(overrides, dict):
                    payload.update(overrides)
                    details["manager_adjusted_payload"] = overrides
                apply_pending_ticket_payload(event.job_ticket, payload)
                details["applied_payload"] = payload
            elif pending_action == "artwork_update":
                apply_pending_artwork(event.job_ticket, details.get("pending_artwork") or {})

        approval.update({
            "status": status_value,
            "reviewed_by": actor,
            "reviewed_at": timezone.now().isoformat(),
            "note": str(request.data.get("note") or "").strip(),
        })
        details["approval"] = approval
        event.details = details
        event.save(update_fields=["details"])
        return Response(self.get_serializer(event).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self.update_approval(request, "approved")

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self.update_approval(request, "rejected")

    @action(detail=True, methods=["post"])
    def retract(self, request, pk=None):
        return self.update_approval(request, "retracted")


class JobTicketUsageViewSet(BaseProductionViewSet):
    serializer_class = JobTicketUsageSerializer
    search_fields = [
        "job_ticket__ticket_number",
        "job_ticket__job_name",
        "job_ticket__product_code",
        "legacy_job_ticket_id",
        "source",
        "notes",
    ]
    ordering_fields = ["used_at", "quantity", "source", "created_at"]

    def get_queryset(self):
        qs = (
            JobTicketUsage.objects.select_related("job_ticket")
            .all()
            .order_by("-used_at", "-id")
        )
        job_ticket = self.request.query_params.get("job_ticket")
        legacy_job_ticket_id = self.request.query_params.get("legacy_job_ticket_id")
        if job_ticket:
            qs = qs.filter(job_ticket_id=job_ticket)
        if legacy_job_ticket_id:
            qs = qs.filter(legacy_job_ticket_id__iexact=legacy_job_ticket_id)
        return qs


class ProductionScheduleViewSet(BaseProductionViewSet):
    queryset = (
        ProductionSchedule.objects.select_related(
            "job_ticket",
            "customer",
            "job_ticket__customer",
            "job_ticket__material_spec",
            "job_ticket__material_spec__master_type",
            "job_ticket__material_master_type",
            "job_ticket__recipe",
            "job_ticket__box",
            "job_ticket__core",
            "material_inventory",
            "press",
        )
        .all()
        .order_by("scheduled_date", "priority", "job_ticket__ticket_number")
    )
    serializer_class = ProductionScheduleSerializer
    search_fields = [
        "job_ticket__ticket_number",
        "job_ticket__customer_name",
        "customer__name",
        "customer__customer_code",
        "job_ticket__customer__name",
        "job_ticket__job_name",
        "job_ticket__box_item_number",
        "job_ticket__box__item_number",
        "job_ticket__core__name",
        "job_ticket__core__item_number",
        "customer_po",
        "status",
        "priority",
        "material_inventory__name",
        "material_inventory__serial_number",
        "press__name",
        "operator",
        "scheduled_by",
        "last_updated_by",
        "notes",
        "footage_report",
    ]
    ordering_fields = [
        "scheduled_date",
        "due_date",
        "priority",
        "status",
        "quantity_to_ship",
        "quantity_to_stock",
        "material_width_inches",
        "order_date",
        "press__name",
        "press_sequence",
        "operator",
    ]

    def perform_create(self, serializer):
        ticket = serializer.validated_data.get("job_ticket")
        if ticket_has_pending_changes(ticket):
            raise serializers.ValidationError({
                "job_ticket": "This job ticket has a pending change request. Approve, reject, or retract the change before scheduling."
            })
        serializer.save()

    @action(detail=True, methods=["post"], url_path="remove-from-schedule")
    def remove_from_schedule(self, request, pk=None):
        schedule = self.get_object()
        reason = str(request.data.get("reason", "")).strip()
        if not reason:
            return Response({"reason": ["A reason is required to remove a scheduled job."]}, status=status.HTTP_400_BAD_REQUEST)

        actor = str(request.data.get("performed_by", "")).strip() or schedule.last_updated_by or schedule.scheduled_by or "system"
        schedule._delete_reason = reason
        schedule._delete_actor = actor
        schedule.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerOrderViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = (
        CustomerOrder.objects.select_related("schedule_entry", "job_ticket", "customer")
        .all()
        .order_by("-order_date", "-scheduled_date", "customer_name", "job_name")
    )
    serializer_class = CustomerOrderSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        "order_number",
        "customer_name",
        "customer__name",
        "customer_po",
        "job_name",
        "product_code",
        "job_ticket__ticket_number",
        "status",
        "operator_note",
    ]
    ordering_fields = [
        "order_number",
        "order_date",
        "scheduled_date",
        "due_date",
        "priority",
        "status",
        "customer_name",
        "job_name",
    ]

    def get_queryset(self):
        qs = super().get_queryset()
        job_ticket = self.request.query_params.get("job_ticket")
        customer = self.request.query_params.get("customer")
        order_number = self.request.query_params.get("order_number")
        if job_ticket:
            qs = qs.filter(job_ticket_id=job_ticket)
        if customer:
            qs = qs.filter(customer_id=customer)
        if order_number:
            qs = qs.filter(order_number__iexact=str(order_number).strip())
        return qs

    @action(detail=False, methods=["get"], url_path="lookup")
    def lookup(self, request):
        order_number = str(request.query_params.get("order_number") or request.query_params.get("q") or "").strip()
        if not order_number:
            return Response({"order_number": ["Scan or enter an order number."]}, status=status.HTTP_400_BAD_REQUEST)
        order = self.get_queryset().filter(order_number__iexact=order_number).first()
        if not order:
            return Response({"detail": "Order not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(order).data)


class CustomerOrderEventViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = (
        CustomerOrderEvent.objects.select_related("order", "order__job_ticket", "order__customer")
        .all()
        .order_by("-created_at")
    )
    serializer_class = CustomerOrderEventSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        "order__order_number",
        "event_type",
        "summary",
        "performed_by",
        "order__customer_name",
        "order__job_name",
        "order__job_ticket__ticket_number",
    ]
    ordering_fields = ["created_at", "event_type", "performed_by"]

    def get_queryset(self):
        qs = super().get_queryset()
        order = self.request.query_params.get("order")
        job_ticket = self.request.query_params.get("job_ticket")
        order_number = self.request.query_params.get("order_number")
        if order:
            qs = qs.filter(order_id=order)
        if job_ticket:
            qs = qs.filter(order__job_ticket_id=job_ticket)
        if order_number:
            qs = qs.filter(order__order_number__iexact=str(order_number).strip())
        return qs


class LiveFootageArchiveViewSet(BaseProductionViewSet):
    queryset = LiveFootageArchive.objects.all().order_by("-shift_date")
    serializer_class = LiveFootageArchiveSerializer
    search_fields = ["notes"]
    ordering_fields = ["shift_date", "total_footage", "saved_at", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        year = self.request.query_params.get("year")
        date_from = parse_date(str(self.request.query_params.get("date_from") or ""))
        date_to = parse_date(str(self.request.query_params.get("date_to") or ""))
        if year:
            try:
                qs = qs.filter(shift_date__year=int(year))
            except (TypeError, ValueError):
                pass
        if date_from:
            qs = qs.filter(shift_date__gte=date_from)
        if date_to:
            qs = qs.filter(shift_date__lte=date_to)
        return qs

    def parse_archive_datetime(self, value):
        parsed = parse_datetime(str(value or ""))
        if parsed and timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
        return parsed

    @action(detail=False, methods=["post"], url_path="archive-shift")
    def archive_shift(self, request):
        shift_date = parse_date(str(request.data.get("shift_date") or ""))
        if not shift_date:
            return Response({"shift_date": ["Enter the shift date."]}, status=status.HTTP_400_BAD_REQUEST)

        try:
            total_footage = Decimal(str(request.data.get("total_footage") or "0"))
            goal_footage = Decimal(str(request.data.get("goal_footage") or "400000"))
        except (InvalidOperation, ValueError):
            return Response({"total_footage": ["Enter valid footage totals."]}, status=status.HTTP_400_BAD_REQUEST)

        if total_footage <= 0:
            return Response({"total_footage": ["Total footage must be greater than zero."]}, status=status.HTTP_400_BAD_REQUEST)

        shift_start = self.parse_archive_datetime(request.data.get("shift_start"))
        shift_end = self.parse_archive_datetime(request.data.get("shift_end"))
        if not shift_start or not shift_end:
            return Response({"shift_start": ["Shift start and end are required."]}, status=status.HTTP_400_BAD_REQUEST)

        press_totals = request.data.get("press_totals") or []
        if not isinstance(press_totals, list):
            return Response({"press_totals": ["Press totals must be a list."]}, status=status.HTTP_400_BAD_REQUEST)

        defaults = {
            "shift_start": shift_start,
            "shift_end": shift_end,
            "total_footage": total_footage,
            "goal_footage": goal_footage,
            "press_totals": press_totals,
            "notes": str(request.data.get("notes") or "").strip(),
        }

        archive, created = LiveFootageArchive.objects.get_or_create(shift_date=shift_date, defaults=defaults)
        if not created:
            if total_footage >= Decimal(archive.total_footage or 0):
                for field, value in defaults.items():
                    setattr(archive, field, value)
                archive.save()

        serializer = self.get_serializer(archive)
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class FinishedInventoryViewSet(BaseProductionViewSet):
    serializer_class = FinishedInventorySerializer
    search_fields = [
        "name",
        "sku",
        "order_number",
        "customer_order__order_number",
        "status",
        "job_ticket__ticket_number",
        "material_inventory__name",
        "material_inventory__serial_number",
        "recipe__name",
        "recipe_option__name",
        "face_type",
        "liner_type",
        "liner_serial_number",
        "face_serial_number",
        "operator",
        "suboperator",
        "location__name",
        "notes",
    ]
    ordering_fields = [
        "name",
        "sku",
        "status",
        "material_width_inches",
        "material_length_feet",
        "quantity",
        "run_date",
        "operator",
    ]

    def get_queryset(self):
        qs = (
            FinishedInventory.objects.select_related(
                "job_ticket",
                "customer_order",
                "material_inventory",
                "recipe",
                "recipe_option",
                "location",
            )
            .all()
            .order_by("-run_date", "name")
        )
        job_ticket = self.request.query_params.get("job_ticket")
        customer_order = self.request.query_params.get("customer_order")
        order_number = self.request.query_params.get("order_number")
        status_value = self.request.query_params.get("status")
        tsm_id = self.request.query_params.get("tsm_id") or self.request.query_params.get("product_code") or self.request.query_params.get("ticket_number")
        if job_ticket:
            qs = qs.filter(job_ticket_id=job_ticket)
        if customer_order:
            qs = qs.filter(customer_order_id=customer_order)
        if order_number:
            qs = qs.filter(Q(order_number__iexact=str(order_number).strip()) | Q(customer_order__order_number__iexact=str(order_number).strip()))
        if tsm_id:
            tsm_id = str(tsm_id).strip()
            qs = qs.filter(
                Q(job_ticket__ticket_number__iexact=tsm_id) |
                Q(job_ticket__product_code__iexact=tsm_id) |
                Q(notes__icontains=f"Imported TSM ID: {tsm_id}") |
                Q(notes__icontains=f"Legacy TSM ID: {tsm_id}") |
                Q(sku__iexact=tsm_id) |
                Q(name__icontains=tsm_id)
            )
        if status_value:
            qs = qs.filter(status=status_value)
        return qs

    @action(detail=False, methods=["post"], url_path="receive-order")
    def receive_order(self, request):
        order_number = str(request.data.get("order_number") or "").strip()
        job_ticket_id = request.data.get("job_ticket")
        ticket_lookup = str(request.data.get("ticket_lookup") or request.data.get("product_code") or "").strip()
        raw_quantity = request.data.get("quantity")
        location_value = str(request.data.get("location") or request.data.get("location_name") or "").strip()

        if raw_quantity in ["", None]:
            return Response({"quantity": ["Enter the finished inventory quantity."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            quantity = Decimal(str(raw_quantity))
        except (InvalidOperation, ValueError):
            return Response({"quantity": ["Enter a valid quantity."]}, status=status.HTTP_400_BAD_REQUEST)
        if quantity <= 0:
            return Response({"quantity": ["Quantity must be greater than zero."]}, status=status.HTTP_400_BAD_REQUEST)

        order = None
        job_ticket = None
        if order_number:
            order = CustomerOrder.objects.select_related("job_ticket", "job_ticket__recipe").filter(order_number__iexact=order_number).first()
            if not order:
                return Response({"order_number": ["Order number was not found."]}, status=status.HTTP_404_NOT_FOUND)
            job_ticket = order.job_ticket
        elif job_ticket_id:
            job_ticket = JobTicket.objects.select_related("recipe").filter(pk=job_ticket_id).first()
        elif ticket_lookup:
            job_ticket = JobTicket.objects.select_related("recipe").filter(
                Q(ticket_number__iexact=ticket_lookup) | Q(product_code__iexact=ticket_lookup)
            ).first()

        if not job_ticket:
            return Response({"job_ticket": ["Scan an order number or select a job ticket."]}, status=status.HTTP_400_BAD_REQUEST)

        location = None
        if location_value:
            location_code = f"FIN-{location_value[:46]}".upper().replace(" ", "-")
            location, _ = ToolingLocation.objects.get_or_create(
                code=location_code,
                parent=None,
                defaults={"name": location_value[:100], "location_type": "unknown"},
            )

        used_date = parse_date(str(request.data.get("run_date") or request.data.get("received_date") or "")) or timezone.localdate()
        received_by = str(request.data.get("received_by") or request.data.get("operator") or "").strip()
        unit = str(request.data.get("unit") or "carton").strip() or "carton"
        if unit not in dict(FinishedInventory.UNIT_CHOICES):
            unit = "carton"

        inventory = FinishedInventory.objects.create(
            name=(request.data.get("name") or job_ticket.job_name or job_ticket.product_code or job_ticket.ticket_number)[:150],
            sku=(request.data.get("sku") or job_ticket.product_code or job_ticket.ticket_number or "")[:80],
            job_ticket=job_ticket,
            customer_order=order,
            order_number=order.order_number if order else order_number,
            recipe=job_ticket.recipe,
            location=location,
            quantity=quantity,
            unit=unit,
            status="available",
            operator=received_by,
            run_date=used_date,
            face_type=job_ticket.face_type,
            liner_type=job_ticket.liner_type,
            notes=str(request.data.get("notes") or "").strip(),
        )

        CustomerOrderEvent.objects.create(
            order=order,
            event_type="finished_inventory_received",
            summary=f"Received {quantity} {unit} into finished inventory at {location_value or 'No location'}.",
            performed_by=received_by or "system",
        ) if order else None

        return Response(self.get_serializer(inventory).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="send-out")
    def send_out(self, request, pk=None):
        inventory = self.get_object()
        raw_quantity = request.data.get("quantity")

        if raw_quantity in ["", None]:
            return Response({"quantity": ["Enter the quantity to send out."]}, status=status.HTTP_400_BAD_REQUEST)

        try:
            quantity = Decimal(str(raw_quantity))
        except (InvalidOperation, ValueError):
            return Response({"quantity": ["Enter a valid quantity."]}, status=status.HTTP_400_BAD_REQUEST)

        if quantity <= 0:
            return Response({"quantity": ["Quantity must be greater than zero."]}, status=status.HTTP_400_BAD_REQUEST)

        available = Decimal(inventory.quantity or 0)
        if quantity > available:
            return Response(
                {"quantity": [f"Only {available} {inventory.unit or 'units'} are available."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        used_date = parse_date(str(request.data.get("used_date") or "")) or timezone.localdate()
        used_by = str(request.data.get("used_by") or "").strip()
        reference = str(request.data.get("reference") or "").strip()
        notes = str(request.data.get("notes") or "").strip()

        if not reference:
            reference = " / ".join(
                part for part in [
                    inventory.job_ticket.ticket_number if inventory.job_ticket else "",
                    inventory.sku or inventory.name,
                    "Finished stock sent out",
                ] if part
            )

        with transaction.atomic():
            MaterialUsage.objects.create(
                finished_inventory=inventory,
                usage_type="shipped",
                quantity=quantity,
                unit=inventory.unit or "each",
                used_date=used_date,
                used_by=used_by,
                reference=reference,
                notes=notes or f"Sent out {quantity} {inventory.unit or 'units'} from finished inventory.",
            )

            inventory.quantity = max(Decimal("0"), available - quantity)
            if inventory.quantity <= 0:
                inventory.status = "shipped"
            elif inventory.status == "shipped":
                inventory.status = "available"
            inventory.save(update_fields=["quantity", "status", "updated_at"])

        return Response(self.get_serializer(inventory).data)
