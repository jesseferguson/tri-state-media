import re
from datetime import timedelta
from decimal import Decimal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse

from django.conf import settings
from django.db import transaction
from django.db.models import DecimalField, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from users.auth import company_user_from_request
from users.models import CompanyUser
from tooling.models import Press

from .models import (
    CoaterRollTag,
    MaterialMasterType,
    MaterialMovement,
    MaterialRack,
    MaterialSkid,
    MaterialSpec,
    MaterialSupplierOption,
    MaterialUsage,
    RawMaterialInventory,
)
from .serializers import (
    CoaterRollTagSerializer,
    MaterialMasterTypeSerializer,
    MaterialMovementSerializer,
    MaterialRackSerializer,
    MaterialSkidSerializer,
    MaterialSpecSerializer,
    MaterialSupplierOptionSerializer,
    MaterialUsageSerializer,
    RawMaterialInventorySerializer,
)
from .services import (
    MaterialWorkflowError,
    actor_context,
    add_roll_to_skid,
    add_skid_to_rack,
    movement,
    remove_roll_from_skid,
    remove_skid_from_rack,
    resolve_rack_scan,
    roll_amount,
    roll_location,
    skid_location,
    use_roll_from_skid,
)
from .zpl import rack_label_zpl, skid_label_zpl


def _verified_company_user(request, *, admin_only=False):
    user = company_user_from_request(request)
    if user:
        if admin_only and str(getattr(user.role, "name", "")).lower() != "admin":
            return None
        return user

    if settings.API_AUTH_REQUIRED:
        return None

    user_id = str(request.META.get("HTTP_X_COMPANY_USER_ID") or "").strip()
    username = str(request.META.get("HTTP_X_COMPANY_USERNAME") or "").strip()
    queryset = CompanyUser.objects.select_related("role").filter(active=True)
    if admin_only:
        queryset = queryset.filter(role__name__iexact="Admin")
    if user_id.isdigit():
        queryset = queryset.filter(pk=int(user_id))
    elif username:
        queryset = queryset.filter(username__iexact=username)
    else:
        return None
    user = queryset.first()
    if user and username and user.username.lower() != username.lower():
        return None
    return user


def _request_actor(request, user=None):
    actor = actor_context(request)
    if user:
        actor["actor_name"] = user.name or user.username
        actor["actor_user_id"] = str(user.pk)
    return actor


def _can_delete_material_roll(user):
    if not user:
        return False
    role_name = re.sub(r"[^a-z0-9]+", "", str(getattr(user.role, "name", "") or "").lower())
    return (
        "admin" in role_name
        or "manager" in role_name
        or ("material" in role_name and "hand" in role_name)
    )


def _delete_physical_roll(inventory):
    from production.models import ProductionMaterialAssignment

    roll_tag = (
        CoaterRollTag.objects.filter(
            Q(inventory_entries=inventory) | Q(logged_inventory=inventory)
        )
        .distinct()
        .first()
    )
    inventory_ids = {inventory.pk}
    if roll_tag:
        inventory_ids.update(
            RawMaterialInventory.objects.filter(
                Q(source_roll_tag=roll_tag) | Q(pk=roll_tag.logged_inventory_id)
            ).values_list("id", flat=True)
        )

    usage_query = Q(inventory_id__in=inventory_ids)
    if roll_tag:
        usage_query |= Q(coater_roll_tag=roll_tag)

    usage_count = MaterialUsage.objects.filter(usage_query).count()
    assignment_count = ProductionMaterialAssignment.objects.filter(inventory_id__in=inventory_ids).count()
    inventory_count = len(inventory_ids)
    roll_reference = inventory.serial_number or inventory.lot_number or f"Roll {inventory.pk}"
    tag_number = roll_tag.tag_number if roll_tag and roll_tag.source_schedule_id else ""

    with transaction.atomic():
        MaterialUsage.objects.filter(usage_query).delete()
        ProductionMaterialAssignment.objects.filter(inventory_id__in=inventory_ids).delete()
        RawMaterialInventory.objects.filter(id__in=inventory_ids).delete()
        if roll_tag and roll_tag.source_schedule_id:
            roll_tag.delete()

    return {
        "rollReference": roll_reference,
        "tagNumber": tag_number,
        "deletedInventoryCount": inventory_count,
        "deletedUsageCount": usage_count,
        "deletedAssignmentCount": assignment_count,
    }


def _workflow_error(error):
    return Response(
        {"detail": error.message, "code": error.code, **error.details},
        status=error.status_code,
    )


PRODUCTION_FLOOR_LOCATION = "Wilmington Ohio > Plant Floor"


def _floor_destination(value):
    destination = str(value or "").strip()
    return destination[:150] if destination else PRODUCTION_FLOOR_LOCATION


def _storage_print_job(request, *, label_type, scan_url, zpl):
    from production.views import (
        FIREBASE_PRINT_QUEUE_BASE,
        FIREBASE_PRINT_QUEUE_NAME,
        FIREBASE_PRINT_QUEUE_ROOT,
        _firebase_post_json,
        _positive_int,
        _print_text,
    )

    press_id = request.data.get("press")
    press = Press.objects.filter(pk=press_id).first() if press_id else None
    if not press:
        raise MaterialWorkflowError("Select a printer.", code="printer_required")
    printer_ip = _print_text(request.data, "printer_ip", press.printer_ip)
    if not printer_ip:
        raise MaterialWorkflowError(
            f"Add a printer IP for {press.name} before printing.",
            code="printer_ip_required",
        )
    payload = {
        "TYPE": label_type,
        "Printer": printer_ip,
        "Printer Port": _positive_int(request.data.get("printer_port") or press.printer_port, 9100),
        "SPEED": _print_text(request.data, "speed", press.printer_speed or "5"),
        "DARKNESS": _print_text(request.data, "darkness", press.printer_darkness or "20"),
        "Total Ship Stock": _positive_int(request.data.get("copies"), 1),
        "Scan URL": scan_url,
        "ZPL": zpl,
        "Queued By": _print_text(request.data, "performed_by"),
        "Queued At": timezone.now().isoformat(),
    }
    try:
        firebase_status, firebase_payload = _firebase_post_json(
            FIREBASE_PRINT_QUEUE_BASE,
            [FIREBASE_PRINT_QUEUE_ROOT, FIREBASE_PRINT_QUEUE_NAME],
            payload,
        )
    except HTTPError as error:
        raise MaterialWorkflowError(
            "Firebase rejected the label print job.",
            code="firebase_rejected",
            status_code=status.HTTP_502_BAD_GATEWAY,
            details={"firebase_status": error.code},
        )
    except URLError as error:
        raise MaterialWorkflowError(
            "Could not reach Firebase to queue the label.",
            code="firebase_unavailable",
            status_code=status.HTTP_502_BAD_GATEWAY,
            details={"error": str(error.reason)},
        )
    return {
        "firebaseKey": str(firebase_payload.get("name") or ""),
        "firebaseStatus": firebase_status,
        "printerIp": printer_ip,
        "printerPort": payload["Printer Port"],
        "printerSpeed": payload["SPEED"],
        "printerDarkness": payload["DARKNESS"],
        "copies": payload["Total Ship Stock"],
        "scanUrl": scan_url,
    }


class BaseMaterialsViewSet(viewsets.ModelViewSet):
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]


class MaterialMovementViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MaterialMovementSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        "action_type",
        "roll_reference",
        "skid_reference",
        "rack_reference",
        "actor_name",
        "from_location",
        "to_location",
        "notes",
    ]
    ordering_fields = ["created_at", "action_type", "actor_name"]

    def get_queryset(self):
        queryset = MaterialMovement.objects.select_related("roll", "skid", "rack").all()
        for query_key, model_field in [
            ("roll", "roll_id"),
            ("skid", "skid_id"),
            ("rack", "rack_id"),
            ("action_type", "action_type"),
            ("scan_session_id", "scan_session_id"),
        ]:
            value = self.request.query_params.get(query_key)
            if value:
                queryset = queryset.filter(**{model_field: value})
        return queryset


class MaterialSkidViewSet(BaseMaterialsViewSet):
    serializer_class = MaterialSkidSerializer
    search_fields = [
        "skid_number",
        "status",
        "current_rack__rack_code",
        "other_location",
        "notes",
        "created_by",
        "rolls__serial_number",
        "rolls__lot_number",
    ]
    ordering_fields = ["skid_number", "status", "created_at", "updated_at"]

    def get_queryset(self):
        return (
            MaterialSkid.objects.select_related("current_rack", "current_rack__location")
            .prefetch_related(
                "movement_history",
                "rolls",
                "rolls__material",
                "rolls__material__master_type",
                "rolls__supplier",
                "rolls__location",
                "rolls__source_roll_tag",
                "rolls__current_skid",
                "rolls__current_skid__current_rack",
                "rolls__current_skid__current_rack__location",
            )
            .all()
            .distinct()
        )

    def create(self, request, *args, **kwargs):
        user = _verified_company_user(request, admin_only=True)
        if not user:
            return Response({"detail": "Only an Admin can create skids."}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            skid = serializer.save(created_by=user.name or user.username)
            movement(
                action_type="skid_created",
                skid=skid,
                from_location="",
                to_location="Plant Floor",
                notes="Skid created.",
                source="manual",
                **_request_actor(request, user),
            )
        return Response(self.get_serializer(skid).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        user = _verified_company_user(request, admin_only=True)
        if not user:
            return Response({"detail": "Only an Admin can edit skids."}, status=status.HTTP_403_FORBIDDEN)
        skid = self.get_object()
        requested_status = request.data.get("status", skid.status)
        if requested_status != "active" and (
            skid.current_rack_id
            or skid.rolls.filter(is_active=True).exclude(status__in=["depleted", "scrapped"]).exists()
        ):
            return Response(
                {"detail": "Move the skid out of its rack and remove active rolls before deactivating or retiring it."},
                status=status.HTTP_409_CONFLICT,
            )
        before_location = skid_location(skid)
        before_values = {
            "status": skid.status,
            "current_rack": skid.current_rack_id,
            "other_location": skid.other_location,
            "notes": skid.notes,
        }
        partial = kwargs.pop("partial", False)
        serializer = self.get_serializer(skid, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            skid = serializer.save()
            changed = ["current_rack"] if before_values["current_rack"] != skid.current_rack_id else []
            changed.extend(
                key for key in ["status", "other_location", "notes"]
                if before_values[key] != getattr(skid, key)
            )
            movement(
                action_type="manual_edit",
                skid=skid,
                rack=skid.current_rack,
                from_location=before_location,
                to_location=skid_location(skid),
                notes=f"Updated skid fields: {', '.join(dict.fromkeys(changed)) or 'details'}.",
                source="manual",
                **_request_actor(request, user),
            )
        return Response(self.get_serializer(skid).data)

    def destroy(self, request, *args, **kwargs):
        return Response(
            {"detail": "Skids are retained for history. Set the status to Inactive or Retired instead."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=False, methods=["get"], url_path=r"scan/(?P<token>[^/.]+)")
    def scan(self, request, token=None):
        skid = self.get_queryset().filter(qr_token=token).first()
        if not skid:
            return Response({"detail": "Scan not recognized."}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(skid).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        skid = self.get_object()
        rows = skid.movement_history.select_related("roll", "rack").all()
        return Response(MaterialMovementSerializer(rows, many=True).data)

    @action(detail=True, methods=["post"], url_path="add-roll")
    def add_roll(self, request, pk=None):
        user = _verified_company_user(request)
        if not user:
            return Response({"detail": "Sign in as an active user to move material."}, status=status.HTTP_403_FORBIDDEN)
        try:
            roll, skid = add_roll_to_skid(
                skid_id=pk,
                scan_value=request.data.get("scan_value") or request.data.get("roll"),
                actor=_request_actor(request, user),
                allow_move=str(request.data.get("confirm_move") or "").lower() in {"1", "true", "yes"},
                source="scan",
            )
        except MaterialWorkflowError as error:
            return _workflow_error(error)
        return Response({
            "ok": True,
            "completed": f"Completed: Roll {roll.serial_number or roll.lot_number} added to {skid.skid_number}",
            "roll": RawMaterialInventorySerializer(roll).data,
            "skid": self.get_serializer(self.get_queryset().get(pk=skid.pk)).data,
        })

    @action(detail=True, methods=["post"], url_path="remove-roll")
    def remove_roll(self, request, pk=None):
        user = _verified_company_user(request)
        if not user:
            return Response({"detail": "Sign in as an active user to move material."}, status=status.HTTP_403_FORBIDDEN)
        try:
            roll, skid = remove_roll_from_skid(
                skid_id=pk,
                roll_value=request.data.get("scan_value") or request.data.get("roll"),
                actor=_request_actor(request, user),
                source="scan",
            )
        except MaterialWorkflowError as error:
            return _workflow_error(error)
        return Response({
            "ok": True,
            "completed": f"Completed: Roll {roll.serial_number or roll.lot_number} removed from {skid.skid_number}",
            "roll": RawMaterialInventorySerializer(roll).data,
            "skid": self.get_serializer(self.get_queryset().get(pk=skid.pk)).data,
        })

    @action(detail=True, methods=["post"], url_path="use-roll")
    def use_roll(self, request, pk=None):
        user = _verified_company_user(request)
        if not user:
            return Response({"detail": "Sign in as an active user to use material."}, status=status.HTTP_403_FORBIDDEN)
        try:
            roll, usage, skid = use_roll_from_skid(
                skid_id=pk,
                roll_value=request.data.get("scan_value") or request.data.get("roll"),
                actor=_request_actor(request, user),
                use_all=str(request.data.get("use_all") or "").lower() in {"1", "true", "yes"},
                amount_used=request.data.get("amount_used"),
                notes=str(request.data.get("notes") or "").strip(),
                source="scan",
            )
        except MaterialWorkflowError as error:
            return _workflow_error(error)
        remaining = roll_amount(roll)
        return Response({
            "ok": True,
            "completed": (
                f"Completed: Roll {roll.serial_number or roll.lot_number} fully used"
                if remaining <= 0
                else f"Completed: {usage.quantity} ft used from {roll.serial_number or roll.lot_number}; {remaining} ft remaining"
            ),
            "roll": RawMaterialInventorySerializer(roll).data,
            "usage": MaterialUsageSerializer(usage).data,
            "skid": self.get_serializer(self.get_queryset().get(pk=skid.pk)).data,
        })

    @action(detail=True, methods=["post"], url_path="move-to-rack")
    def move_to_rack(self, request, pk=None):
        user = _verified_company_user(request)
        if not user:
            return Response({"detail": "Sign in as an active user to move skids."}, status=status.HTTP_403_FORBIDDEN)
        try:
            rack = resolve_rack_scan(request.data.get("scan_value") or request.data.get("rack"), for_update=False)
            skid, rack = add_skid_to_rack(
                rack_id=rack.id,
                skid_value=str(self.get_object().qr_token),
                actor=_request_actor(request, user),
                allow_move=str(request.data.get("confirm_move") or "").lower() in {"1", "true", "yes"},
                source="scan",
            )
        except MaterialWorkflowError as error:
            return _workflow_error(error)
        return Response({
            "ok": True,
            "completed": f"Completed: {skid.skid_number} moved to {rack.rack_code}",
            "skid": self.get_serializer(self.get_queryset().get(pk=skid.pk)).data,
            "rack": MaterialRackSerializer(rack).data,
        })

    @action(detail=True, methods=["post"], url_path="move-to-floor")
    def move_to_floor(self, request, pk=None):
        user = _verified_company_user(request)
        if not user:
            return Response({"detail": "Sign in as an active user to move skids."}, status=status.HTTP_403_FORBIDDEN)
        skid = self.get_object()
        if skid.status != "active":
            return Response(
                {"detail": f"{skid.skid_number} is not active."},
                status=status.HTTP_409_CONFLICT,
            )
        floor_location = _floor_destination(request.data.get("floor_location") or request.data.get("other_location"))
        current_floor = skid.other_location or PRODUCTION_FLOOR_LOCATION
        if not skid.current_rack_id and current_floor == floor_location:
            return Response({
                "ok": True,
                "completed": f"{skid.skid_number} is already on {floor_location}.",
                "skid": self.get_serializer(skid).data,
            })
        before_location = skid_location(skid)
        rack = skid.current_rack
        with transaction.atomic():
            skid.current_rack = None
            skid.other_location = floor_location
            skid.save(update_fields=["current_rack", "other_location", "updated_at"])
            movement(
                action_type="skid_removed_from_rack" if rack else "manual_edit",
                skid=skid,
                rack=rack,
                from_location=before_location,
                to_location=floor_location,
                notes=f"{skid.skid_number} moved to {floor_location}.",
                source="manual",
                **_request_actor(request, user),
            )
        return Response({
            "ok": True,
            "completed": f"Completed: {skid.skid_number} moved to {floor_location}",
            "skid": self.get_serializer(self.get_queryset().get(pk=skid.pk)).data,
        })

    @action(detail=True, methods=["post"], url_path="print-label")
    def print_label(self, request, pk=None):
        user = _verified_company_user(request, admin_only=True)
        if not user:
            return Response({"detail": "Only an Admin can print or reprint skid labels."}, status=status.HTTP_403_FORBIDDEN)
        skid = self.get_object()
        frontend_base = str(request.data.get("frontend_url") or settings.FRONTEND_PUBLIC_URL).rstrip("/")
        if urlparse(frontend_base).hostname in {"localhost", "127.0.0.1"}:
            frontend_base = settings.FRONTEND_PUBLIC_URL
        scan_url = f"{frontend_base}/?skidToken={skid.qr_token}"
        press = Press.objects.filter(pk=request.data.get("press")).first()
        zpl = skid_label_zpl(
            skid,
            scan_url,
            darkness=request.data.get("darkness") or getattr(press, "printer_darkness", "") or "20",
            speed=request.data.get("speed") or getattr(press, "printer_speed", "") or "5",
            copies=request.data.get("copies") or 1,
        )
        try:
            result = _storage_print_job(
                request,
                label_type="SKID_LABEL_3X3",
                scan_url=scan_url,
                zpl=zpl,
            )
        except MaterialWorkflowError as error:
            return _workflow_error(error)
        already_printed = MaterialMovement.objects.filter(
            skid=skid,
            action_type__in=["label_printed", "label_reprinted"],
        ).exists()
        movement(
            action_type="label_reprinted" if already_printed else "label_printed",
            skid=skid,
            rack=skid.current_rack,
            from_location=skid_location(skid),
            to_location=skid_location(skid),
            notes="Skid label queued for reprint." if already_printed else "Skid label queued for printing.",
            source="manual",
            **_request_actor(request, user),
        )
        return Response({"ok": True, "reprint": already_printed, **result}, status=status.HTTP_201_CREATED)


class MaterialRackViewSet(BaseMaterialsViewSet):
    serializer_class = MaterialRackSerializer
    search_fields = [
        "rack_code",
        "location__name",
        "location__code",
        "aisle",
        "bay",
        "level",
        "position",
        "status",
        "notes",
        "skids__skid_number",
        "loose_rolls__serial_number",
        "loose_rolls__lot_number",
        "loose_rolls__material__name",
    ]
    ordering_fields = ["rack_code", "location__name", "aisle", "bay", "level", "position", "status", "created_at"]

    def get_queryset(self):
        return (
            MaterialRack.objects.select_related("location").prefetch_related(
                "movement_history",
                "skids",
                "skids__movement_history",
                "skids__rolls",
                "skids__rolls__material",
                "skids__rolls__material__master_type",
                "skids__rolls__supplier",
                "skids__rolls__location",
                "skids__rolls__source_roll_tag",
                "skids__rolls__current_skid",
                "skids__rolls__current_skid__current_rack",
                "skids__rolls__current_skid__current_rack__location",
                "loose_rolls",
                "loose_rolls__material",
                "loose_rolls__material__master_type",
                "loose_rolls__supplier",
                "loose_rolls__location",
                "loose_rolls__source_roll_tag",
                "loose_rolls__direct_rack",
                "loose_rolls__direct_rack__location",
            )
            .all()
            .distinct()
        )

    def create(self, request, *args, **kwargs):
        user = _verified_company_user(request, admin_only=True)
        if not user:
            return Response({"detail": "Only an Admin can create racks."}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            rack = serializer.save(created_by=user.name or user.username)
            movement(
                action_type="rack_created",
                rack=rack,
                from_location="",
                to_location=f"Rack {rack.rack_code}",
                notes="Rack created.",
                source="manual",
                **_request_actor(request, user),
            )
        return Response(self.get_serializer(rack).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        user = _verified_company_user(request, admin_only=True)
        if not user:
            return Response({"detail": "Only an Admin can edit racks."}, status=status.HTTP_403_FORBIDDEN)
        rack = self.get_object()
        requested_status = request.data.get("status", rack.status)
        if requested_status == "inactive" and (
            rack.skids.filter(status="active").exists()
            or rack.loose_rolls.filter(is_active=True).exclude(status__in=["depleted", "scrapped"]).exists()
        ):
            return Response(
                {"detail": "Remove active skids and loose material before deactivating this rack."},
                status=status.HTTP_409_CONFLICT,
            )
        before_detail = rack.storage_location_display
        before_values = {
            key: getattr(rack, key)
            for key in ["rack_code", "location_id", "aisle", "bay", "level", "position", "status", "notes"]
        }
        partial = kwargs.pop("partial", False)
        serializer = self.get_serializer(rack, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            rack = serializer.save()
            changed = [key for key, old_value in before_values.items() if old_value != getattr(rack, key)]
            movement(
                action_type="manual_edit",
                rack=rack,
                from_location=before_detail or rack.rack_code,
                to_location=rack.storage_location_display,
                notes=f"Updated rack fields: {', '.join(changed) or 'details'}.",
                source="manual",
                **_request_actor(request, user),
            )
        return Response(self.get_serializer(rack).data)

    def destroy(self, request, *args, **kwargs):
        return Response(
            {"detail": "Racks are retained for history. Set the status to Inactive instead."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=False, methods=["get"], url_path=r"scan/(?P<token>[^/.]+)")
    def scan(self, request, token=None):
        rack = self.get_queryset().filter(qr_token=token).first()
        if not rack:
            return Response({"detail": "Scan not recognized."}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(rack).data)

    @action(detail=True, methods=["get"])
    def history(self, request, pk=None):
        rack = self.get_object()
        rows = MaterialMovement.objects.filter(
            Q(rack=rack) | Q(skid__current_rack=rack) | Q(roll__direct_rack=rack)
        ).select_related("roll", "skid", "rack")
        return Response(MaterialMovementSerializer(rows.distinct(), many=True).data)

    @action(detail=True, methods=["post"], url_path="add-skid")
    def add_skid(self, request, pk=None):
        user = _verified_company_user(request)
        if not user:
            return Response({"detail": "Sign in as an active user to move skids."}, status=status.HTTP_403_FORBIDDEN)
        try:
            skid, rack = add_skid_to_rack(
                rack_id=pk,
                skid_value=request.data.get("scan_value") or request.data.get("skid"),
                actor=_request_actor(request, user),
                allow_move=str(request.data.get("confirm_move") or "").lower() in {"1", "true", "yes"},
                source="scan",
            )
        except MaterialWorkflowError as error:
            return _workflow_error(error)
        return Response({
            "ok": True,
            "completed": f"Completed: {skid.skid_number} moved to {rack.rack_code}",
            "skid": MaterialSkidSerializer(skid).data,
            "rack": self.get_serializer(self.get_queryset().get(pk=rack.pk)).data,
        })

    @action(detail=True, methods=["post"], url_path="remove-skid")
    def remove_skid(self, request, pk=None):
        user = _verified_company_user(request)
        if not user:
            return Response({"detail": "Sign in as an active user to move skids."}, status=status.HTTP_403_FORBIDDEN)
        try:
            skid, rack = remove_skid_from_rack(
                rack_id=pk,
                skid_value=request.data.get("scan_value") or request.data.get("skid"),
                actor=_request_actor(request, user),
                source="scan",
            )
        except MaterialWorkflowError as error:
            return _workflow_error(error)
        return Response({
            "ok": True,
            "completed": f"Completed: {skid.skid_number} moved to Plant Floor",
            "skid": MaterialSkidSerializer(skid).data,
            "rack": self.get_serializer(self.get_queryset().get(pk=rack.pk)).data,
        })

    @action(detail=True, methods=["post"], url_path="print-label")
    def print_label(self, request, pk=None):
        user = _verified_company_user(request, admin_only=True)
        if not user:
            return Response({"detail": "Only an Admin can print or reprint rack labels."}, status=status.HTTP_403_FORBIDDEN)
        rack = self.get_object()
        frontend_base = str(request.data.get("frontend_url") or settings.FRONTEND_PUBLIC_URL).rstrip("/")
        if urlparse(frontend_base).hostname in {"localhost", "127.0.0.1"}:
            frontend_base = settings.FRONTEND_PUBLIC_URL
        scan_url = f"{frontend_base}/?rackToken={rack.qr_token}"
        press = Press.objects.filter(pk=request.data.get("press")).first()
        zpl = rack_label_zpl(
            rack,
            scan_url,
            darkness=request.data.get("darkness") or getattr(press, "printer_darkness", "") or "20",
            speed=request.data.get("speed") or getattr(press, "printer_speed", "") or "5",
            copies=request.data.get("copies") or 1,
        )
        try:
            result = _storage_print_job(
                request,
                label_type="RACK_LABEL_3X3",
                scan_url=scan_url,
                zpl=zpl,
            )
        except MaterialWorkflowError as error:
            return _workflow_error(error)
        already_printed = MaterialMovement.objects.filter(
            rack=rack,
            action_type__in=["label_printed", "label_reprinted"],
        ).exists()
        movement(
            action_type="label_reprinted" if already_printed else "label_printed",
            rack=rack,
            from_location=f"Rack {rack.rack_code}",
            to_location=f"Rack {rack.rack_code}",
            notes="Rack label queued for reprint." if already_printed else "Rack label queued for printing.",
            source="manual",
            **_request_actor(request, user),
        )
        return Response({"ok": True, "reprint": already_printed, **result}, status=status.HTTP_201_CREATED)


class MaterialMasterTypeViewSet(BaseMaterialsViewSet):
    queryset = MaterialMasterType.objects.all().order_by("code", "name")
    serializer_class = MaterialMasterTypeSerializer
    search_fields = ["code", "name", "description"]
    ordering_fields = ["code", "name", "is_active", "updated_at"]


class MaterialSpecViewSet(BaseMaterialsViewSet):
    serializer_class = MaterialSpecSerializer
    search_fields = [
        "material_type",
        "code",
        "name",
        "company",
        "material_family",
        "master_type__code",
        "master_type__name",
        "color",
        "supplier__name",
        "face_material__name",
        "face_material__code",
        "liner_material__name",
        "liner_material__code",
        "adhesive_material__name",
        "adhesive_material__code",
        "silicone_material__name",
        "silicone_material__code",
        "coating_material__name",
        "coating_material__code",
        "allowed_face_materials__name",
        "allowed_face_materials__code",
        "allowed_liner_materials__name",
        "allowed_liner_materials__code",
        "allowed_adhesive_materials__name",
        "allowed_adhesive_materials__code",
        "allowed_silicone_materials__name",
        "allowed_silicone_materials__code",
        "allowed_coating_materials__name",
        "allowed_coating_materials__code",
        "scheduled_by",
        "coater_cut_plan",
        "operator_notes",
        "notes",
    ]
    ordering_fields = [
        "material_type",
        "code",
        "name",
        "company",
        "master_type__code",
        "liner_pounds",
        "gsm",
        "is_active",
    ]

    def get_queryset(self):
        footage_value = Coalesce(
            "inventory__length_feet",
            "inventory__quantity",
            output_field=DecimalField(max_digits=12, decimal_places=3),
        )
        qs = (
            MaterialSpec.objects.select_related(
                "supplier",
                "master_type",
                "face_material",
                "liner_material",
                "adhesive_material",
                "silicone_material",
                "coating_material",
            )
            .prefetch_related(
                "allowed_face_materials",
                "allowed_liner_materials",
                "allowed_adhesive_materials",
                "allowed_silicone_materials",
                "allowed_coating_materials",
            )
            .annotate(
                inventory_total_feet=Coalesce(
                    Sum(
                        footage_value,
                        filter=Q(inventory__is_active=True)
                        & ~Q(inventory__status__in=["depleted", "scrapped", "in_use"]),
                    ),
                    Decimal("0"),
                    output_field=DecimalField(max_digits=14, decimal_places=2),
                )
            )
            .all()
            .order_by("material_type", "company", "name")
        )
        material_type = self.request.query_params.get("material_type")
        master_type = self.request.query_params.get("master_type")
        if material_type:
            material_types = [value.strip() for value in material_type.split(",") if value.strip()]
            qs = qs.filter(material_type__in=material_types)
        if master_type:
            qs = qs.filter(master_type_id=master_type)
        return qs


class MaterialSupplierOptionViewSet(BaseMaterialsViewSet):
    serializer_class = MaterialSupplierOptionSerializer
    search_fields = [
        "material__name",
        "material__code",
        "material__material_type",
        "material__master_type__code",
        "material__master_type__name",
        "supplier__name",
        "supplier_name",
        "option_name",
        "supplier_item_number",
        "notes",
    ]
    ordering_fields = [
        "material__material_type",
        "material__name",
        "supplier_name",
        "option_name",
        "width_inches",
        "length_feet",
        "is_active",
    ]

    def get_queryset(self):
        qs = MaterialSupplierOption.objects.select_related("material", "material__master_type", "supplier").all()
        material = self.request.query_params.get("material")
        material_type = self.request.query_params.get("material_type")
        master_type = self.request.query_params.get("master_type")
        if material:
            qs = qs.filter(material_id=material)
        if material_type:
            qs = qs.filter(material__material_type=material_type)
        if master_type:
            qs = qs.filter(material__master_type_id=master_type)
        return qs


class RawMaterialInventoryViewSet(BaseMaterialsViewSet):
    serializer_class = RawMaterialInventorySerializer
    search_fields = [
        "material_type",
        "name",
        "code",
        "serial_number",
        "lot_number",
        "material__code",
        "material__name",
        "material__master_type__code",
        "material__master_type__name",
        "supplier__name",
        "location__name",
        "current_skid__skid_number",
        "current_skid__current_rack__rack_code",
        "current_skid__current_rack__location__name",
        "direct_rack__rack_code",
        "direct_rack__location__name",
        "inventory_origin",
        "status",
        "notes",
    ]
    ordering_fields = [
        "material_type",
        "name",
        "code",
        "serial_number",
        "width_inches",
        "length_feet",
        "weight_lbs",
        "quantity",
        "status",
        "received_date",
    ]

    def get_queryset(self):
        qs = (
            RawMaterialInventory.objects.select_related(
                "material",
                "material__master_type",
                "supplier",
                "location",
                "source_roll_tag",
                "current_skid",
                "current_skid__current_rack",
                "current_skid__current_rack__location",
                "direct_rack",
                "direct_rack__location",
            )
            .all()
            .order_by("material_type", "name", "serial_number")
        )
        material_type = self.request.query_params.get("material_type")
        material = self.request.query_params.get("material")
        master_type = self.request.query_params.get("master_type")
        if material_type:
            qs = qs.filter(material_type=material_type)
        if material:
            qs = qs.filter(material_id=material)
        if master_type:
            qs = qs.filter(material__master_type_id=master_type)
        return qs

    @action(detail=False, methods=["post"], url_path="intake")
    def intake(self, request):
        user = _verified_company_user(request)
        if not user:
            return Response(
                {"detail": "Sign in as an active user to add material inventory."},
                status=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data.copy()
        material_id = payload.get("material")
        create_material = payload.get("create_material")
        if not material_id and create_material:
            material_type = str(create_material.get("material_type") or "").strip()
            if material_type not in dict(MaterialSpec.MATERIAL_TYPE_CHOICES):
                return Response(
                    {"create_material": {"material_type": ["Choose a valid material category."]}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            name = str(create_material.get("name") or "").strip()
            company = str(create_material.get("company") or "").strip()
            master_type_id = create_material.get("master_type")
            master_type = MaterialMasterType.objects.filter(pk=master_type_id).first() if master_type_id else None
            master_type_code = str(create_material.get("master_type_code") or "").strip().upper()
            if material_type == "coated_stock" and not master_type and master_type_code:
                master_type, _ = MaterialMasterType.objects.get_or_create(
                    code=master_type_code,
                    defaults={"name": master_type_code},
                )
            if material_type == "coated_stock" and not master_type:
                return Response(
                    {"create_material": {"master_type": ["Select the finished material type, such as PMDT."]}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not name:
                name = master_type.code if master_type else ""
            if not name:
                return Response(
                    {"create_material": {"name": ["Enter the material name or type."]}},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            lookup = {
                "material_type": material_type,
                "name__iexact": name,
                "company__iexact": company,
            }
            if master_type:
                lookup["master_type"] = master_type
            if create_material.get("liner_material"):
                lookup["liner_material_id"] = create_material.get("liner_material")
            if create_material.get("adhesive_material"):
                lookup["adhesive_material_id"] = create_material.get("adhesive_material")
            material = MaterialSpec.objects.filter(**lookup).first()
            if not material:
                material = MaterialSpec.objects.create(
                    material_type=material_type,
                    name=name,
                    company=company,
                    material_family=str(create_material.get("material_family") or name).strip(),
                    master_type=master_type,
                    supplier_id=create_material.get("supplier") or None,
                    liner_material_id=create_material.get("liner_material") or None,
                    adhesive_material_id=create_material.get("adhesive_material") or None,
                    code=str(create_material.get("code") or "").strip(),
                    notes=str(create_material.get("notes") or "").strip(),
                )
            material_id = material.pk

        material = MaterialSpec.objects.filter(pk=material_id, is_active=True).first() if material_id else None
        if not material:
            return Response({"material": ["Select or create a material."]}, status=status.HTTP_400_BAD_REQUEST)

        direct_rack_id = payload.get("direct_rack")
        direct_rack = MaterialRack.objects.filter(pk=direct_rack_id, status="active").first() if direct_rack_id else None
        if direct_rack_id and not direct_rack:
            return Response({"direct_rack": ["Select an active rack."]}, status=status.HTTP_400_BAD_REQUEST)

        amount = payload.get("length_feet") if str(payload.get("unit") or "lf") == "lf" else payload.get("quantity")
        try:
            amount_value = Decimal(str(amount))
        except Exception:
            amount_value = Decimal("-1")
        if amount_value <= 0:
            field = "length_feet" if str(payload.get("unit") or "lf") == "lf" else "quantity"
            return Response({field: ["Enter an amount greater than zero."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            roll_count = int(payload.get("roll_count") or 1)
        except (TypeError, ValueError):
            roll_count = 0
        if roll_count < 1 or roll_count > 500:
            return Response({"roll_count": ["Enter between 1 and 500 physical rolls or containers."]}, status=status.HTTP_400_BAD_REQUEST)

        inventory_payload = {
            "material": material.pk,
            "supplier": payload.get("supplier") or material.supplier_id,
            "lot_number": str(payload.get("lot_number") or "").strip(),
            "width_inches": payload.get("width_inches") or None,
            "length_feet": payload.get("length_feet") if str(payload.get("unit") or "lf") == "lf" else None,
            "quantity": amount_value,
            "weight_lbs": payload.get("weight_lbs") or None,
            "unit": str(payload.get("unit") or "lf"),
            "status": "available",
            "inventory_origin": str(payload.get("inventory_origin") or "legacy"),
            "received_date": payload.get("received_date") or timezone.localdate(),
            "direct_rack": direct_rack.pk if direct_rack else None,
            "location": None if direct_rack else (payload.get("location") or None),
            "notes": str(payload.get("notes") or "").strip(),
            "is_active": True,
        }
        with transaction.atomic():
            created = []
            for _index in range(roll_count):
                serializer = self.get_serializer(data=inventory_payload)
                serializer.is_valid(raise_exception=True)
                inventory = serializer.save()
                inventory.movement_history.filter(action_type="roll_registered").update(
                    actor_name=user.name or user.username,
                    actor_user_id=str(user.pk),
                    source="manual",
                    notes=f"Material added through manual intake ({inventory.get_inventory_origin_display()}).",
                )
                created.append(inventory)
        response_data = dict(self.get_serializer(created[0]).data)
        response_data["created_count"] = len(created)
        response_data["created_inventory"] = self.get_serializer(created, many=True).data
        response_data["total_received"] = amount_value * roll_count
        return Response(response_data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        roll = serializer.instance
        before_location = roll_location(roll)
        before_amount = roll_amount(roll)
        tracked_fields = ["lot_number", "width_inches", "location_id", "direct_rack_id", "status", "notes", "is_active"]
        before_values = {field: getattr(roll, field) for field in tracked_fields}
        roll = serializer.save()
        changed = [field.replace("_id", "") for field, value in before_values.items() if value != getattr(roll, field)]
        if changed:
            movement(
                action_type="manual_edit",
                roll=roll,
                skid=roll.current_skid,
                rack=roll.current_skid.current_rack if roll.current_skid_id else None,
                from_location=before_location,
                to_location=roll_location(roll),
                quantity_before=before_amount,
                quantity_after=roll_amount(roll),
                notes=f"Updated roll fields: {', '.join(changed)}.",
                source="manual",
                **_request_actor(self.request, _verified_company_user(self.request)),
            )

    def destroy(self, request, *args, **kwargs):
        return Response(
            {"detail": "Use Remove from Inventory and confirm the deletion from the roll screen."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=True, methods=["post"], url_path="remove-from-inventory")
    def remove_from_inventory(self, request, pk=None):
        user = _verified_company_user(request)
        if not _can_delete_material_roll(user):
            return Response(
                {"detail": "Only an Admin, Manager, or Material Handler can remove a roll from inventory."},
                status=status.HTTP_403_FORBIDDEN,
            )
        confirmed = str(request.data.get("confirm_delete") or "").strip().lower() in {"1", "true", "yes"}
        if not confirmed:
            return Response(
                {"confirm_delete": ["Choose Yes to confirm permanent removal from inventory."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        inventory = self.get_object()
        result = _delete_physical_roll(inventory)
        return Response({"ok": True, **result})

    @action(detail=True, methods=["post"], url_path="consume-roll")
    def consume_roll(self, request, pk=None):
        from production.models import JobTicket, ProductionSchedule

        inventory = self.get_object()
        available = Decimal(inventory.length_feet if inventory.length_feet is not None else inventory.quantity or 0)
        unit = inventory.unit or "lf"
        if available <= 0:
            return Response({"detail": "This inventory item has no active amount remaining."}, status=status.HTTP_400_BAD_REQUEST)

        mode = str(request.data.get("mode") or "partial").strip().lower()
        if mode not in ["full", "partial"]:
            return Response({"mode": ["Choose full or partial roll usage."]}, status=status.HTTP_400_BAD_REQUEST)

        entered_footage = available
        buffer_percent = Decimal("0")
        if mode == "partial":
            try:
                entered_footage = Decimal(str(request.data.get("used_feet", "")))
            except Exception:
                return Response({"used_feet": ["Enter the footage used."]}, status=status.HTTP_400_BAD_REQUEST)
            if entered_footage <= 0:
                return Response({"used_feet": ["Footage used must be greater than zero."]}, status=status.HTTP_400_BAD_REQUEST)
            if entered_footage > available:
                return Response(
                    {"used_feet": [f"Only {available} ft remains on this roll."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            buffer_percent = Decimal("3") if unit == "lf" else Decimal("0")

        buffered_footage = min(available, (entered_footage * (Decimal("1") + buffer_percent / Decimal("100"))).quantize(Decimal("0.001")))
        buffer_footage = max(Decimal("0"), buffered_footage - entered_footage)
        schedule_id = request.data.get("production_schedule")
        job_ticket_id = request.data.get("job_ticket")
        schedule = ProductionSchedule.objects.select_related("job_ticket").filter(pk=schedule_id).first() if schedule_id else None
        job_ticket = JobTicket.objects.filter(pk=job_ticket_id).first() if job_ticket_id else None
        if schedule and not job_ticket:
            job_ticket = schedule.job_ticket
        if schedule_id and not schedule:
            return Response({"production_schedule": ["Select a valid scheduled job."]}, status=status.HTTP_400_BAD_REQUEST)
        if job_ticket_id and not job_ticket:
            return Response({"job_ticket": ["Select a valid job ticket."]}, status=status.HTTP_400_BAD_REQUEST)

        operator = str(request.data.get("used_by") or "").strip()
        note = str(request.data.get("notes") or "").strip()
        poor_run = bool(request.data.get("poor_run"))
        reference = (
            getattr(job_ticket, "ticket_number", "")
            or (f"Schedule {schedule.pk}" if schedule else "")
            or "Material handling"
        )
        usage_note = " / ".join(
            part for part in [
                "Full roll consumed" if mode == "full" else f"Operator entered {entered_footage} ft + {buffer_footage} ft safety buffer",
                "Poor run" if poor_run else "",
                note,
            ]
            if part
        )
        skid = inventory.current_skid
        rack = skid.current_rack if skid and skid.current_rack_id else inventory.direct_rack
        before_location = roll_location(inventory)

        with transaction.atomic():
            usage = MaterialUsage.objects.create(
                inventory=inventory,
                material=inventory.material,
                usage_type="finished" if inventory.material_type == "coated_stock" else "manual",
                quantity=buffered_footage,
                unit=unit,
                used_date=timezone.localdate(),
                used_by=operator,
                reference=reference,
                job_ticket=job_ticket,
                production_schedule=schedule,
                notes=usage_note,
            )
            inventory.refresh_from_db()
            remaining = Decimal(inventory.length_feet or inventory.quantity or 0)
            inventory.status = "depleted" if remaining <= 0 else "available"
            if remaining <= 0:
                inventory.current_skid = None
                inventory.direct_rack = None
            if poor_run or note:
                event_note = f"{timezone.localdate()}: {operator or 'Operator'} / {usage_note}"
                inventory.notes = "\n".join(part for part in [inventory.notes, event_note] if part)
            update_fields = ["status"]
            if remaining <= 0:
                update_fields.extend(["current_skid", "direct_rack"])
            if poor_run or note:
                update_fields.append("notes")
            inventory.save(update_fields=update_fields)
            movement(
                action_type="roll_fully_used" if remaining <= 0 else "roll_partially_used",
                roll=inventory,
                skid=skid,
                rack=rack,
                from_location=before_location,
                to_location="Used / Consumed" if remaining <= 0 else roll_location(inventory),
                quantity_before=available,
                quantity_after=remaining,
                amount_used=buffered_footage,
                notes=usage_note,
                source="manual",
                **_request_actor(request, _verified_company_user(request)),
            )

        return Response(
            {
                "inventory": self.get_serializer(inventory).data,
                "usage": MaterialUsageSerializer(usage).data,
                "enteredFootage": entered_footage,
                "bufferFootage": buffer_footage,
                "deductedFootage": buffered_footage,
                "remainingFootage": inventory.length_feet if inventory.length_feet is not None else inventory.quantity,
            }
        )

    @action(detail=True, methods=["post"], url_path="check-out")
    def check_out(self, request, pk=None):
        inventory = self.get_object()
        used_for = request.data.get("used_for") or request.data.get("reference") or "Coordinator checkout"
        used_by = request.data.get("used_by", "")
        notes = request.data.get("notes", "")
        qc_issue = bool(request.data.get("qc_issue"))
        qc_notes = request.data.get("qc_notes", "")
        quantity = inventory.length_feet if inventory.unit == "lf" and inventory.length_feet is not None else inventory.quantity

        with transaction.atomic():
            MaterialUsage.objects.create(
                inventory=inventory,
                material=inventory.material,
                usage_type="checkout",
                quantity=quantity or 0,
                unit=inventory.unit or "lf",
                used_date=timezone.localdate(),
                used_by=used_by,
                reference=used_for,
                notes=notes or f"Full roll taken out: {quantity or 0} {inventory.unit or 'lf'}.",
            )

            inventory.refresh_from_db()
            inventory.status = "on_hold" if qc_issue else "in_use"
            if qc_issue and qc_notes:
                inventory.notes = "\n".join([part for part in [inventory.notes, f"QC: {qc_notes}"] if part])
            inventory.save(update_fields=["status", "notes"] if qc_issue and qc_notes else ["status"])

            if qc_issue:
                MaterialUsage.objects.create(
                    inventory=inventory,
                    material=inventory.material,
                    usage_type="qc_issue",
                    quantity=0,
                    unit=inventory.unit or "lf",
                    used_date=timezone.localdate(),
                    used_by=used_by,
                    reference=used_for,
                    notes=qc_notes or notes,
                )

        return Response(self.get_serializer(inventory).data)

    @action(detail=True, methods=["post"], url_path="return-roll")
    def return_roll(self, request, pk=None):
        inventory = self.get_object()
        used_by = request.data.get("used_by", "")
        notes = request.data.get("notes", "")
        remaining = request.data.get("remaining_quantity")
        location_id = request.data.get("location")
        qc_issue = bool(request.data.get("qc_issue"))
        qc_notes = request.data.get("qc_notes", "")

        if remaining in ["", None]:
            return Response({"remaining_quantity": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)

        try:
            remaining = Decimal(str(remaining))
        except Exception:
            return Response({"remaining_quantity": ["Enter a valid number."]}, status=status.HTTP_400_BAD_REQUEST)

        if remaining < 0:
            return Response({"remaining_quantity": ["Remaining quantity cannot be negative."]}, status=status.HTTP_400_BAD_REQUEST)

        latest_checkout = inventory.usage_records.filter(usage_type="checkout").order_by("-used_date", "-created_at").first()
        reference = latest_checkout.reference if latest_checkout else "Coordinator return"
        checked_out = Decimal(latest_checkout.quantity if latest_checkout else 0)
        consumed = max(Decimal("0"), checked_out - remaining)

        with transaction.atomic():
            if consumed > 0:
                MaterialUsage.objects.create(
                    inventory=inventory,
                    material=inventory.material,
                    usage_type="manual",
                    quantity=consumed,
                    unit=inventory.unit or "lf",
                    used_date=timezone.localdate(),
                    used_by=used_by,
                    reference=reference,
                    notes=notes or f"Returned with {remaining} {inventory.unit or 'lf'} remaining.",
                )

            inventory.quantity = remaining
            if inventory.unit == "lf" and inventory.length_feet is not None:
                inventory.length_feet = remaining
            if location_id not in ["", None]:
                inventory.location_id = location_id
            inventory.status = "on_hold" if qc_issue else ("depleted" if remaining <= 0 else "available")
            if qc_issue and qc_notes:
                inventory.notes = "\n".join([part for part in [inventory.notes, f"QC: {qc_notes}"] if part])
            inventory.save()

            MaterialUsage.objects.create(
                inventory=inventory,
                material=inventory.material,
                usage_type="returned",
                quantity=0,
                unit=inventory.unit or "lf",
                used_date=timezone.localdate(),
                used_by=used_by,
                reference=reference,
                notes=notes or f"Returned with {remaining} {inventory.unit or 'lf'} remaining.",
            )

            if qc_issue:
                MaterialUsage.objects.create(
                    inventory=inventory,
                    material=inventory.material,
                    usage_type="qc_issue",
                    quantity=0,
                    unit=inventory.unit or "lf",
                    used_date=timezone.localdate(),
                    used_by=used_by,
                    reference=reference,
                    notes=qc_notes or notes,
                )

        return Response(self.get_serializer(inventory).data)


class MaterialUsageViewSet(BaseMaterialsViewSet):
    serializer_class = MaterialUsageSerializer
    search_fields = [
        "usage_type",
        "inventory__name",
        "inventory__serial_number",
        "inventory__lot_number",
        "material__code",
        "material__name",
        "material__material_type",
        "coater_roll_tag__tag_number",
        "finished_inventory__name",
        "finished_inventory__sku",
        "job_ticket__ticket_number",
        "job_ticket__job_name",
        "production_schedule__id",
        "used_by",
        "reference",
        "notes",
    ]
    ordering_fields = [
        "used_date",
        "usage_type",
        "quantity",
        "unit",
        "created_at",
    ]

    def get_queryset(self):
        qs = (
            MaterialUsage.objects.select_related(
                "inventory",
                "material",
                "coater_roll_tag",
                "job_ticket",
                "production_schedule",
                "finished_inventory",
                "finished_inventory__job_ticket",
                "finished_inventory__location",
            )
            .all()
            .order_by("-used_date", "-created_at")
        )
        material = self.request.query_params.get("material")
        inventory = self.request.query_params.get("inventory")
        finished_inventory = self.request.query_params.get("finished_inventory")
        finished_inventory_job_ticket = self.request.query_params.get("finished_inventory_job_ticket")
        finished_inventory_tsm_id = self.request.query_params.get("finished_inventory_tsm_id")
        job_ticket = self.request.query_params.get("job_ticket")
        production_schedule = self.request.query_params.get("production_schedule")
        if material:
            qs = qs.filter(material_id=material)
        if inventory:
            qs = qs.filter(inventory_id=inventory)
        if finished_inventory:
            qs = qs.filter(finished_inventory_id=finished_inventory)
        if finished_inventory_job_ticket:
            qs = qs.filter(finished_inventory__job_ticket_id=finished_inventory_job_ticket)
        if finished_inventory_tsm_id:
            tsm_id = str(finished_inventory_tsm_id).strip()
            qs = qs.filter(
                Q(finished_inventory__job_ticket__ticket_number__iexact=tsm_id) |
                Q(finished_inventory__job_ticket__product_code__iexact=tsm_id) |
                Q(finished_inventory__notes__icontains=f"Imported TSM ID: {tsm_id}") |
                Q(finished_inventory__sku__iexact=tsm_id)
            )
        if job_ticket:
            qs = qs.filter(job_ticket_id=job_ticket)
        if production_schedule:
            qs = qs.filter(production_schedule_id=production_schedule)
        return qs


class CoaterRollTagViewSet(BaseMaterialsViewSet):
    queryset = (
        CoaterRollTag.objects.select_related(
            "scheduled_material",
            "scheduled_material__master_type",
            "liner",
            "liner__master_type",
            "face",
            "face__master_type",
            "adhesive",
            "adhesive__master_type",
            "silicone",
            "coating",
            "liner_inventory",
            "face_inventory",
            "adhesive_inventory",
            "silicone_inventory",
            "coating_inventory",
            "liner_supplier_option__supplier",
            "face_supplier_option__supplier",
            "adhesive_supplier_option__supplier",
            "silicone_supplier_option__supplier",
            "coating_supplier_option__supplier",
            "produced_material",
            "produced_material__master_type",
            "source_schedule",
            "press",
            "location",
            "logged_inventory",
        )
        .all()
        .prefetch_related("produced_rolls", "source_schedule__produced_rolls")
        .order_by("-run_date", "tag_number")
    )
    serializer_class = CoaterRollTagSerializer
    search_fields = [
        "tag_number",
        "name",
        "status",
        "print_status",
        "scheduled_by",
        "cut_description",
        "operator_notes",
        "operator",
        "suboperator",
        "result_code",
        "result_serial_number",
        "result_lot_number",
        "liner__name",
        "liner__code",
        "face__name",
        "face__code",
        "adhesive__name",
        "silicone__name",
        "coating__name",
        "liner_supplier_option__supplier_name",
        "face_supplier_option__supplier_name",
        "adhesive_supplier_option__supplier_name",
        "silicone_supplier_option__supplier_name",
        "coating_supplier_option__supplier_name",
        "produced_material__name",
        "press__name",
        "notes",
    ]
    ordering_fields = [
        "tag_number",
        "name",
        "status",
        "print_status",
        "run_date",
        "press_sequence",
        "width_inches",
        "length_feet",
        "weight_lbs",
        "press__name",
        "operator",
    ]

    def get_queryset(self):
        qs = super().get_queryset()
        material_id = self.request.query_params.get("material")
        source_schedule = self.request.query_params.get("source_schedule")
        if material_id:
            qs = qs.filter(Q(scheduled_material_id=material_id) | Q(produced_material_id=material_id))
        if source_schedule:
            qs = qs.filter(source_schedule_id=source_schedule)
        return qs

    @action(detail=True, methods=["post"], url_path="create-roll")
    def create_roll(self, request, pk=None):
        schedule = self.get_object()
        if schedule.source_schedule_id or schedule.log_inventory:
            return Response(
                {"detail": "New rolls must be created from a coater schedule."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if schedule.status not in ["scheduled", "running", "on_hold"]:
            return Response(
                {"detail": "Reopen this schedule before creating another roll."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result_lot_number = str(request.data.get("result_lot_number") or "").strip()
        if not result_lot_number:
            return Response({"result_lot_number": ["Enter the lot number for this roll."]}, status=status.HTTP_400_BAD_REQUEST)

        def requested_id(key, fallback):
            value = request.data.get(key)
            return value if value not in [None, ""] else fallback

        liner_id = requested_id("liner", schedule.liner_id)
        adhesive_id = requested_id("adhesive", schedule.adhesive_id)
        liner = MaterialSpec.objects.filter(pk=liner_id).select_related("master_type").first()
        adhesive = MaterialSpec.objects.filter(pk=adhesive_id).select_related("master_type").first()
        payload = {
            "name": schedule.name,
            "status": "tag_printed",
            "print_status": "not_printed",
            "scheduled_by": schedule.scheduled_by,
            "cut_description": schedule.cut_description,
            "operator_notes": request.data.get("operator_notes", schedule.operator_notes),
            "scheduled_material": schedule.scheduled_material_id,
            "source_schedule": schedule.pk,
            "liner": liner_id,
            "face": requested_id("face", schedule.face_id),
            "adhesive": adhesive_id,
            "silicone": requested_id("silicone", schedule.silicone_id),
            "coating": requested_id("coating", schedule.coating_id),
            "liner_supplier_option": request.data.get("liner_supplier_option"),
            "face_supplier_option": request.data.get("face_supplier_option"),
            "adhesive_supplier_option": request.data.get("adhesive_supplier_option"),
            "silicone_supplier_option": request.data.get("silicone_supplier_option"),
            "coating_supplier_option": request.data.get("coating_supplier_option"),
            "produced_material": schedule.produced_material_id or schedule.scheduled_material_id,
            "result_code": self.roll_part_number(schedule.scheduled_material or schedule.produced_material, liner, adhesive),
            "width_inches": request.data.get("width_inches"),
            "length_feet": request.data.get("length_feet"),
            "weight_lbs": request.data.get("weight_lbs"),
            "operator": request.data.get("operator", ""),
            "suboperator": request.data.get("suboperator", ""),
            "run_date": request.data.get("run_date") or timezone.localdate().isoformat(),
            "press": requested_id("press", schedule.press_id),
            "location": request.data.get("location"),
            "log_inventory": False,
            "notes": request.data.get("notes", ""),
            "result_lot_number": result_lot_number,
        }

        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            roll = serializer.save()
            if schedule.status != "running":
                schedule.status = "running"
                schedule.save(update_fields=["status", "updated_at"])

        return Response(self.get_serializer(roll).data, status=status.HTTP_201_CREATED)

    @staticmethod
    def part_token(material):
        if not material:
            return ""
        value = getattr(getattr(material, "master_type", None), "code", "") or material.material_family
        if not value and material.material_type == "coated_stock":
            value = re.split(r"[-/]", str(material.name or material.code or ""), maxsplit=1)[0]
        value = value or material.name or material.code
        return re.sub(r"[^A-Za-z0-9]+", "", str(value or "").upper())

    @classmethod
    def roll_part_number(cls, material, liner, adhesive):
        return "-".join(
            token for token in [
                cls.part_token(material),
                cls.part_token(liner),
                cls.part_token(adhesive),
            ]
            if token
        )

    @action(detail=True, methods=["post"], url_path="document-roll")
    def document_roll(self, request, pk=None):
        roll = self.get_object()
        if not roll.source_schedule_id:
            return Response(
                {"detail": "Select a printed roll tag from a coater schedule."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if roll.logged_inventory_id or roll.status == "complete":
            return Response(
                {"detail": "This master roll has already been documented."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            footage = Decimal(str(request.data.get("length_feet", "")))
        except Exception:
            return Response({"length_feet": ["Enter the actual master roll footage."]}, status=status.HTTP_400_BAD_REQUEST)
        if footage <= 0:
            return Response({"length_feet": ["Footage must be greater than zero."]}, status=status.HTTP_400_BAD_REQUEST)

        for field in ["width_inches", "weight_lbs", "operator", "suboperator", "operator_notes", "notes"]:
            if field in request.data:
                setattr(roll, field, request.data.get(field))
        if "location" in request.data:
            roll.location_id = request.data.get("location") or None
        if request.data.get("result_lot_number"):
            roll.result_lot_number = str(request.data["result_lot_number"]).strip()
        roll.length_feet = footage
        roll.run_date = request.data.get("run_date") or timezone.localdate()
        roll.status = "complete"
        roll.log_inventory = True
        roll.save()
        return Response(self.get_serializer(roll).data)

    @staticmethod
    def component_print_text(material, inventory=None, supplier_option=None):
        component_type = material.material_family or material.name or material.code if material else ""
        company_name = ""
        part_number = ""
        if supplier_option:
            company_name = supplier_option.supplier_name or (supplier_option.supplier.name if supplier_option.supplier else "")
            part_number = supplier_option.supplier_item_number
        elif inventory:
            company_name = inventory.supplier.name if inventory.supplier else ""
            part_number = inventory.code or inventory.serial_number
        return " - ".join(str(part).strip() for part in [component_type, company_name, part_number] if str(part).strip())

    @staticmethod
    def print_measurement(value, suffix=""):
        if value is None:
            return ""
        text = format(Decimal(value).normalize(), "f")
        return f"{text}{suffix}"

    @action(detail=True, methods=["post"], url_path="queue-print-label")
    def queue_print_label(self, request, pk=None):
        from production.views import (
            FIREBASE_PRINT_QUEUE_BASE,
            FIREBASE_PRINT_QUEUE_NAME,
            FIREBASE_PRINT_QUEUE_ROOT,
            _firebase_post_json,
            _firebase_safe_key,
            _positive_int,
            _print_text,
            _request_bool,
        )

        tag = self.get_object()
        auto_document = _request_bool(request.data.get("auto_document")) and bool(tag.source_schedule_id)
        if auto_document and not tag.logged_inventory_id and tag.status != "complete":
            if not tag.width_inches or Decimal(tag.width_inches) <= 0:
                return Response(
                    {"width_inches": ["Enter the finished roll width before printing."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not tag.length_feet or Decimal(tag.length_feet) <= 0:
                return Response(
                    {"length_feet": ["Enter the actual roll length before printing."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        press_id = request.data.get("press") or tag.press_id
        press = Press.objects.filter(pk=press_id).first() if press_id else None
        if not press:
            return Response({"press": ["Select the press printer for this roll tag."]}, status=status.HTTP_400_BAD_REQUEST)

        printer_ip = _print_text(request.data, "printer_ip", press.printer_ip)
        if not printer_ip:
            return Response(
                {"printer": [f"Add a printer IP for {press.name} before printing this roll tag."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        face_text = self.component_print_text(tag.face, tag.face_inventory, tag.face_supplier_option)
        liner_text = self.component_print_text(tag.liner, tag.liner_inventory, tag.liner_supplier_option)
        adhesive_text = self.component_print_text(tag.adhesive, tag.adhesive_inventory, tag.adhesive_supplier_option)
        silicone_text = self.component_print_text(tag.silicone, tag.silicone_inventory, tag.silicone_supplier_option)
        coating_text = self.component_print_text(tag.coating, tag.coating_inventory, tag.coating_supplier_option)
        manufacturing_note = " / ".join(
            part for part in [
                f"Silicone: {silicone_text}" if silicone_text else "",
                f"Coating: {coating_text}" if coating_text else "",
                tag.cut_description,
            ]
            if part
        )
        material = tag.produced_material or tag.scheduled_material
        part_number = self.roll_part_number(material, tag.liner, tag.adhesive) or tag.result_code or getattr(material, "code", "") or tag.name
        if tag.result_code != part_number:
            tag.result_code = part_number
            tag.save(update_fields=["result_code", "updated_at"])
        queue_key = _firebase_safe_key(press.printer_queue_key or press.name or printer_ip)
        frontend_base = _print_text(request.data, "frontend_url", settings.FRONTEND_PUBLIC_URL).rstrip("/")
        if urlparse(frontend_base).hostname in {"localhost", "127.0.0.1"}:
            frontend_base = settings.FRONTEND_PUBLIC_URL
        roll_tag_url = f"{frontend_base}/?{urlencode({
            'rollTagId': tag.pk,
            'lot': tag.result_lot_number or '',
        })}"
        width_text = self.print_measurement(tag.width_inches, '"')
        payload = {
            "TYPE": "COATER",
            "Printer": printer_ip,
            "Printer Port": _positive_int(request.data.get("printer_port") or press.printer_port, 9100),
            "SPEED": _print_text(request.data, "speed", press.printer_speed or "5"),
            "DARKNESS": _print_text(request.data, "darkness", press.printer_darkness or "11"),
            "Total Ship Stock": _positive_int(request.data.get("copies"), 1),
            "Operator": _print_text(request.data, "operator", tag.operator),
            "Secondary Operator": _print_text(request.data, "suboperator", tag.suboperator),
            "Part Number List Logic": part_number,
            "Face": face_text,
            "Liner ": liner_text,
            "Liner": liner_text,
            "Adhesive": adhesive_text,
            "Silicone": silicone_text,
            "Coating": coating_text,
            "Width": width_text,
            "Adhesive Width ": width_text,
            "Adhesive Width": width_text,
            "Length": self.print_measurement(tag.length_feet, " ft"),
            "Lot Number": tag.result_lot_number,
            "Note": manufacturing_note,
            "ID": tag.result_serial_number or tag.tag_number,
            "Roll Tag URL": roll_tag_url,
            "Roll Tag": tag.tag_number,
            "Schedule ID": tag.source_schedule.tag_number if tag.source_schedule_id else tag.tag_number,
            "Queue Key": queue_key,
            "Queued By": _print_text(request.data, "performed_by", tag.operator),
            "Queued At": timezone.now().isoformat(),
        }
        payload = {key: value for key, value in payload.items() if value not in [None, ""]}

        try:
            firebase_status, firebase_payload = _firebase_post_json(
                FIREBASE_PRINT_QUEUE_BASE,
                [FIREBASE_PRINT_QUEUE_ROOT, FIREBASE_PRINT_QUEUE_NAME],
                payload,
            )
        except HTTPError as error:
            return Response(
                {"detail": "Firebase rejected the roll-tag print job.", "firebase_status": error.code},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except URLError as error:
            return Response(
                {"detail": "Could not reach Firebase to queue the roll tag.", "error": str(error.reason)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        tag.print_status = "queued"
        documented_now = False
        footage_report = None
        if auto_document and not tag.logged_inventory_id and tag.status != "complete":
            tag.status = "complete"
            tag.log_inventory = True
            tag.run_date = tag.run_date or timezone.localdate()
            tag.suboperator = _print_text(request.data, "suboperator", tag.suboperator)
            tag.save()
            documented_now = True
            from production.models import ProductionShiftReport

            shift_end = timezone.now()
            shift_start = shift_end - timedelta(minutes=1)
            schedule_ref = tag.source_schedule.tag_number if tag.source_schedule_id else tag.tag_number
            footage_report = ProductionShiftReport.objects.create(
                coater_schedule=tag.source_schedule,
                press=press,
                operator=payload.get("Operator") or tag.operator,
                suboperator=tag.suboperator,
                report_date=tag.run_date or timezone.localdate(),
                shift_start=shift_start,
                shift_end=shift_end,
                total_footage=tag.length_feet or 0,
                good_footage=tag.length_feet or 0,
                material_footage=tag.length_feet or 0,
                outcome="end_shift",
                notes=" / ".join(
                    part for part in [
                        f"Coater schedule {schedule_ref}",
                        f"Roll {tag.tag_number}",
                        f"Lot {tag.result_lot_number}" if tag.result_lot_number else "",
                        f"Secondary operator {tag.suboperator}" if tag.suboperator else "",
                    ]
                    if part
                ),
                created_by=payload.get("Queued By") or tag.operator,
            )
        else:
            tag.save(update_fields=["print_status", "updated_at"])
        printer_settings_saved = False
        if _request_bool(request.data.get("save_printer_settings")):
            press.printer_ip = printer_ip
            press.printer_port = payload.get("Printer Port") or 9100
            press.printer_speed = str(payload.get("SPEED") or "5")
            press.printer_darkness = str(payload.get("DARKNESS") or "11")
            press.save(update_fields=["printer_ip", "printer_port", "printer_speed", "printer_darkness"])
            printer_settings_saved = True

        firebase_key = str(firebase_payload.get("name") or "")
        return Response(
            {
                "ok": True,
                "tagNumber": tag.tag_number,
                "queueKey": queue_key,
                "firebaseKey": firebase_key,
                "firebaseStatus": firebase_status,
                "printerIp": printer_ip,
                "printerPort": payload.get("Printer Port"),
                "printerSpeed": payload.get("SPEED"),
                "printerDarkness": payload.get("DARKNESS"),
                "printerSettingsSaved": printer_settings_saved,
                "copies": payload.get("Total Ship Stock"),
                "rollTagUrl": roll_tag_url,
                "documented": documented_now,
                "footageReportId": footage_report.pk if footage_report else None,
                "roll": self.get_serializer(tag).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="delete-roll")
    def delete_roll(self, request, pk=None):
        user = _verified_company_user(request)
        if not _can_delete_material_roll(user):
            return Response(
                {"detail": "Only an Admin, Manager, or Material Handler can permanently delete a roll."},
                status=status.HTTP_403_FORBIDDEN,
            )
        roll = self.get_object()
        if not roll.source_schedule_id:
            return Response(
                {"detail": "Scheduled material jobs cannot be deleted from the roll history. Delete only a physical roll."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        confirmed = str(request.data.get("confirm_delete") or "").strip().lower() in {"1", "true", "yes"}
        if not confirmed:
            return Response(
                {"confirm_delete": ["Choose Yes to confirm permanent deletion."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from production.models import ProductionMaterialAssignment

        inventory_ids = set(
            RawMaterialInventory.objects.filter(
                Q(source_roll_tag=roll) | Q(pk=roll.logged_inventory_id)
            ).values_list("id", flat=True)
        )
        with transaction.atomic():
            MaterialUsage.objects.filter(
                Q(coater_roll_tag=roll) | Q(inventory_id__in=inventory_ids)
            ).delete()
            ProductionMaterialAssignment.objects.filter(inventory_id__in=inventory_ids).delete()
            RawMaterialInventory.objects.filter(id__in=inventory_ids).delete()
            tag_number = roll.tag_number
            roll.delete()

        return Response(
            {
                "ok": True,
                "tagNumber": tag_number,
                "deletedInventoryCount": len(inventory_ids),
            }
        )
