import re
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
from tooling.models import Press
from production.models import CompanyUser

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


def _workflow_error(error):
    return Response(
        {"detail": error.message, "code": error.code, **error.details},
        status=error.status_code,
    )


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
                label_type="SKID_LABEL_4X3",
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
        if requested_status == "inactive" and rack.skids.filter(status="active").exists():
            return Response(
                {"detail": "Remove active skids before deactivating this rack."},
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
        rows = MaterialMovement.objects.filter(Q(rack=rack) | Q(skid__current_rack=rack)).select_related("roll", "skid", "rack")
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
                label_type="RACK_LABEL_4X3",
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

    def perform_update(self, serializer):
        roll = serializer.instance
        before_location = roll_location(roll)
        before_amount = roll_amount(roll)
        tracked_fields = ["lot_number", "width_inches", "location_id", "status", "notes", "is_active"]
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

    @action(detail=True, methods=["post"], url_path="consume-roll")
    def consume_roll(self, request, pk=None):
        from production.models import JobTicket, ProductionSchedule

        inventory = self.get_object()
        available = Decimal(inventory.length_feet if inventory.length_feet is not None else inventory.quantity or 0)
        if available <= 0:
            return Response({"detail": "This roll has no active footage remaining."}, status=status.HTTP_400_BAD_REQUEST)

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
            buffer_percent = Decimal("3")

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
        rack = skid.current_rack if skid and skid.current_rack_id else None
        before_location = roll_location(inventory)

        with transaction.atomic():
            usage = MaterialUsage.objects.create(
                inventory=inventory,
                material=inventory.material,
                usage_type="finished",
                quantity=buffered_footage,
                unit="lf",
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
            if poor_run or note:
                event_note = f"{timezone.localdate()}: {operator or 'Operator'} / {usage_note}"
                inventory.notes = "\n".join(part for part in [inventory.notes, event_note] if part)
            update_fields = ["status"]
            if remaining <= 0:
                update_fields.append("current_skid")
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
            "run_date": request.data.get("run_date") or timezone.localdate().isoformat(),
            "press": requested_id("press", schedule.press_id),
            "location": request.data.get("location"),
            "log_inventory": False,
            "notes": request.data.get("notes", ""),
        }
        if request.data.get("result_lot_number"):
            payload["result_lot_number"] = request.data["result_lot_number"]

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

        for field in ["width_inches", "weight_lbs", "operator", "operator_notes", "notes"]:
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
        if auto_document and not tag.logged_inventory_id and tag.status != "complete":
            tag.status = "complete"
            tag.log_inventory = True
            tag.run_date = tag.run_date or timezone.localdate()
            tag.save()
            documented_now = True
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
                "roll": self.get_serializer(tag).data,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="delete-roll")
    def delete_roll(self, request, pk=None):
        roll = self.get_object()
        if not roll.source_schedule_id:
            return Response(
                {"detail": "Scheduled material jobs cannot be deleted from the roll history. Delete only a physical roll."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        confirmation = str(request.data.get("confirm_tag_number") or "").strip()
        if confirmation != roll.tag_number:
            return Response(
                {"confirm_tag_number": [f"Enter {roll.tag_number} to confirm permanent deletion."]},
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
