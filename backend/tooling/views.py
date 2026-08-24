import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from rest_framework import filters, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from .models import (
    FlexDie,
    FlexDieRequest,
    FinishedInventory,
    JobTicket,
    Mag,
    PerfBlade,
    PerfBladeSetup,
    PerfCylinder,
    Press,
    PrintPlate,
    PrintStation,
    RawMaterialInventory,
    Supplier,
    ToolingHistory,
    ToolingLocation,
    ToolingRecipe,
    ToolingRecipeOption,
    ToolingRecipeTool,
)
from .serializers import (
    FlexDieSerializer,
    FlexDieRequestSerializer,
    FinishedInventorySerializer,
    JobTicketSerializer,
    MagSerializer,
    PerfBladeSerializer,
    PerfBladeSetupSerializer,
    PerfCylinderSerializer,
    PressSerializer,
    PrintPlateSerializer,
    PrintStationSerializer,
    RawMaterialInventorySerializer,
    SupplierSerializer,
    ToolingHistorySerializer,
    ToolingLocationSerializer,
    ToolingRecipeOptionSerializer,
    ToolingRecipeSerializer,
    ToolingRecipeToolSerializer,
)
from users.auth import request_user_has_resource_access, resource_access_denied_response
from production.file_responses import private_file_response
from production.upload_security import validate_upload
from .zpl import flex_die_folder_label_zpl


class BaseToolingViewSet(viewsets.ModelViewSet):
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]


class SupplierViewSet(BaseToolingViewSet):
    queryset = Supplier.objects.all().order_by("name")
    serializer_class = SupplierSerializer
    search_fields = ["name", "tags", "email", "phone", "city", "state", "zip_code", "notes"]
    ordering_fields = ["name", "tags", "city", "state", "is_active"]

    def get_queryset(self):
        qs = super().get_queryset()
        tags = self.request.query_params.get("tags")
        if tags:
            for tag in [value.strip() for value in tags.split(",") if value.strip()]:
                qs = qs.filter(tags__icontains=tag)
        return qs


class ToolingLocationViewSet(BaseToolingViewSet):
    queryset = (
        ToolingLocation.objects.select_related("parent", "supplier")
        .all()
        .order_by("name", "code")
    )
    serializer_class = ToolingLocationSerializer
    search_fields = ["name", "code", "location_type", "inventory_scope", "notes", "supplier__name", "parent__name"]
    ordering_fields = ["name", "code", "location_type", "inventory_scope", "is_active"]

    def get_queryset(self):
        qs = super().get_queryset()
        inventory_scope = self.request.query_params.get("inventory_scope")
        if inventory_scope:
            scopes = [value.strip() for value in inventory_scope.split(",") if value.strip()]
            qs = qs.filter(inventory_scope__in=scopes)
        return qs

    def filter_queryset(self, queryset):
        search = str(self.request.query_params.get("search") or "").strip()
        if not search:
            return super().filter_queryset(queryset)

        terms = [term for term in re.split(r"[\s>/]+", search) if term]
        for term in terms:
            queryset = queryset.filter(
                Q(name__icontains=term)
                | Q(code__icontains=term)
                | Q(location_type__icontains=term)
                | Q(inventory_scope__icontains=term)
                | Q(notes__icontains=term)
                | Q(supplier__name__icontains=term)
                | Q(parent__name__icontains=term)
                | Q(parent__code__icontains=term)
                | Q(parent__parent__name__icontains=term)
                | Q(parent__parent__code__icontains=term)
                | Q(parent__parent__parent__name__icontains=term)
                | Q(parent__parent__parent__code__icontains=term)
            )
        return filters.OrderingFilter().filter_queryset(self.request, queryset.distinct(), self)


class PressViewSet(BaseToolingViewSet):
    queryset = Press.objects.select_related("location").all().order_by("name")
    serializer_class = PressSerializer
    search_fields = ["name", "notes", "location__name", "location__code", "printer_ip", "printer_queue_key"]
    ordering_fields = ["name", "color_count", "die_station_count", "max_web_width_inches", "printer_ip", "printer_queue_key", "is_active"]


class MagViewSet(BaseToolingViewSet):
    queryset = (
        Mag.objects.select_related("supplier", "current_location")
        .prefetch_related("compatible_presses")
        .all()
        .order_by("name")
    )
    serializer_class = MagSerializer
    search_fields = ["name", "notes", "supplier__name", "current_location__name", "status"]
    ordering_fields = ["name", "status", "tooth_count", "repeat_inches"]


class FlexDieViewSet(BaseToolingViewSet):
    serializer_class = FlexDieSerializer
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    tooling_kind = "flex_die"
    search_fields = [
        "name",
        "original_serial_number",
        "serial_numbers",
        "face_type",
        "liner_type",
        "shape_type",
        "cutting_type",
        "supplier__name",
        "last_quote_supplier__name",
        "status",
        "procurement_notes",
    ]
    ordering_fields = [
        "name",
        "status",
        "label_width_inches",
        "label_length_inches",
        "repeat_inches",
        "gear",
        "number_across",
        "number_around",
    ]

    def get_queryset(self):
        qs = (
            FlexDie.objects.select_related("supplier", "current_location")
            .prefetch_related("compatible_mags")
            .filter(tooling_kind=self.tooling_kind)
            .order_by("name")
        )

        params = self.request.query_params

        width = params.get("width")
        length = params.get("length")
        across = params.get("across")
        around = params.get("around")
        gear = params.get("gear")
        face_type = params.get("face_type")
        liner_type = params.get("liner_type")
        shape_type = params.get("shape_type")
        cutting_type = params.get("cutting_type")

        if width:
            qs = qs.filter(label_width_inches=width)

        if length:
            qs = qs.filter(label_length_inches=length)

        if across:
            qs = qs.filter(number_across=across)

        if around:
            qs = qs.filter(number_around=around)

        if gear:
            qs = qs.filter(gear=gear)

        if face_type:
            qs = qs.filter(face_type__icontains=face_type)

        if liner_type:
            qs = qs.filter(liner_type__icontains=liner_type)

        if shape_type:
            qs = qs.filter(shape_type=shape_type)

        if cutting_type:
            qs = qs.filter(cutting_type=cutting_type)

        return qs

    def perform_create(self, serializer):
        serializer.save(tooling_kind=self.tooling_kind)

    def create_history(self, die, event_type, summary, request, notes=""):
        actor = (
            str(request.data.get("performed_by", "")).strip()
            or str(request.data.get("requested_by", "")).strip()
            or str(request.data.get("received_by", "")).strip()
            or "system"
        )
        return ToolingHistory.objects.create(
            tooling_type="flex_die",
            flex_die=die,
            event_type=event_type,
            performed_by=actor,
            summary=summary[:200],
            notes=notes,
        )

    @action(detail=True, methods=["post", "delete"], url_path="dieline-image")
    def dieline_image(self, request, pk=None):
        die = self.get_object()

        if request.method == "DELETE":
            current_file = die.dieline_image
            if current_file:
                current_file.delete(save=False)
            die.dieline_image = None
            die.dieline_image_name = ""
            die.save(update_fields=["dieline_image", "dieline_image_name"])
            return Response(self.get_serializer(die).data)

        upload = request.FILES.get("image")
        if not upload:
            return Response({"image": ["Choose a dieline image to upload."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            upload = validate_upload(upload, allow_images=True, field="image")
        except serializers.ValidationError as error:
            return Response(error.detail, status=status.HTTP_400_BAD_REQUEST)

        current_file = die.dieline_image
        if current_file:
            current_file.delete(save=False)
        die.dieline_image = upload
        die.dieline_image_name = str(request.data.get("name") or upload.name).strip()
        die.save(update_fields=["dieline_image", "dieline_image_name"])
        return Response(self.get_serializer(die).data)

    @action(detail=True, methods=["get"], url_path="dieline-image-preview")
    def dieline_image_preview(self, request, pk=None):
        die = self.get_object()
        required_key = "rotary-dies" if self.tooling_kind == "rotary_die" else "flex-dies"
        if not request_user_has_resource_access(request, required_key):
            return resource_access_denied_response(request, "You do not have access to this dieline image.")
        if not die.dieline_image:
            return Response({"error": "No dieline image uploaded."}, status=status.HTTP_404_NOT_FOUND)
        return private_file_response(
            die.dieline_image,
            display_name=die.dieline_image_name,
            fallback_name="dieline-image",
        )

    @action(detail=True, methods=["post"], url_path="print-folder-label")
    def print_folder_label(self, request, pk=None):
        from production.views import (
            FIREBASE_PRINT_QUEUE_BASE,
            FIREBASE_PRINT_QUEUE_NAME,
            FIREBASE_PRINT_QUEUE_ROOT,
            _firebase_post_json,
            _firebase_safe_key,
            _positive_int,
            _print_text,
        )

        die = self.get_object()
        required_key = "rotary-dies" if self.tooling_kind == "rotary_die" else "flex-dies"
        if not request_user_has_resource_access(request, required_key):
            return resource_access_denied_response(request, "You do not have access to print this tooling label.")

        press_id = request.data.get("press")
        press = Press.objects.filter(pk=press_id).first() if press_id else None
        if not press:
            return Response({"press": ["Select the printer for this flex die folder label."]}, status=status.HTTP_400_BAD_REQUEST)

        printer_ip = _print_text(request.data, "printer_ip", press.printer_ip)
        if not printer_ip:
            return Response(
                {"printer": [f"Add a printer IP for {press.name} before printing this flex die folder label."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        frontend_base = _print_text(request.data, "frontend_url", settings.FRONTEND_PUBLIC_URL).rstrip("/")
        if urlparse(frontend_base).hostname in {"localhost", "127.0.0.1"}:
            frontend_base = settings.FRONTEND_PUBLIC_URL.rstrip("/")
        scan_url = f"{frontend_base}/?{urlencode({'flexDieId': die.pk})}"
        speed = _print_text(request.data, "speed", press.printer_speed or "5")
        darkness = _print_text(request.data, "darkness", press.printer_darkness or "20")
        copies = _positive_int(request.data.get("copies"), 1)
        zpl = flex_die_folder_label_zpl(die, scan_url, darkness=darkness, speed=speed, copies=copies)
        queue_key = _firebase_safe_key(press.printer_queue_key or press.name or printer_ip)
        label_type = "FLEX_DIE_FOLDER_LABEL_2_5X5"
        firebase_type = "SKID_LABEL_3X3"
        payload = {
            # The ESP32 print server already recognizes this as a raw-ZPL job type.
            "TYPE": firebase_type,
            "Label Type": label_type,
            "Print Format": "ZPL",
            "Printer": printer_ip,
            "Printer Port": _positive_int(request.data.get("printer_port") or press.printer_port, 9100),
            "SPEED": speed,
            "DARKNESS": darkness,
            "Total Ship Stock": copies,
            "Scan URL": scan_url,
            "Flex Die ID": die.pk,
            "Flex Die Number": die.name,
            "Label Size": "2.5x5",
            "Label Width Inches": "2.5",
            "Label Length Inches": "5",
            "Tooling Kind": die.tooling_kind,
            "Queue Key": queue_key,
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
            return Response(
                {"detail": "Firebase rejected the flex die folder label print job.", "firebase_status": error.code},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except URLError as error:
            return Response(
                {"detail": "Could not reach Firebase to queue the flex die folder label.", "error": str(error.reason)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        firebase_key = str(firebase_payload.get("name") or "")
        self.create_history(
            die,
            "label_printed",
            f"{payload.get('Queued By') or 'system'} queued a 2.5 x 5 folder label for {die.name}.",
            request,
            notes=f"Printer: {press.name} / {printer_ip}. Scan URL: {scan_url}",
        )
        return Response(
            {
                "ok": True,
                "labelType": label_type,
                "firebaseType": firebase_type,
                "queueKey": queue_key,
                "firebaseKey": firebase_key,
                "firebaseStatus": firebase_status,
                "firebasePath": (
                    f"/{FIREBASE_PRINT_QUEUE_ROOT}/{FIREBASE_PRINT_QUEUE_NAME}/{firebase_key}"
                    if firebase_key
                    else f"/{FIREBASE_PRINT_QUEUE_ROOT}/{FIREBASE_PRINT_QUEUE_NAME}"
                ),
                "printerIp": printer_ip,
                "printerPort": payload["Printer Port"],
                "printerSpeed": speed,
                "printerDarkness": darkness,
                "copies": copies,
                "scanUrl": scan_url,
                "labelSize": "2.5x5",
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="request-reorder")
    def request_reorder(self, request, pk=None):
        die = self.get_object()
        note = str(request.data.get("notes", "") or "").strip()
        actor = str(request.data.get("requested_by", "") or request.data.get("performed_by", "") or "system").strip()
        if die.active_die_count < 1:
            die.status = "needs_ordered"
            die.save(update_fields=["status"])
        self.create_history(
            die,
            "die_reorder_requested",
            f"{actor} requested a replacement die for {die.name}.",
            request,
            notes=note,
        )
        FlexDieRequest.objects.create(
            flex_die=die,
            status="requested",
            requested_by=actor,
            request_notes=note,
        )
        return Response(self.get_serializer(die).data)

    @action(detail=True, methods=["post"], url_path="mark-ordered")
    def mark_ordered(self, request, pk=None):
        die = self.get_object()
        note = str(request.data.get("notes", "") or "").strip()
        actor = str(request.data.get("performed_by", "") or "system").strip()
        die.status = "ordered"
        die.save(update_fields=["status"])
        self.create_history(
            die,
            "die_ordered",
            f"{actor} marked {die.name} ordered.",
            request,
            notes=note,
        )
        return Response(self.get_serializer(die).data)

    @action(detail=True, methods=["post"], url_path="receive-die")
    def receive_die(self, request, pk=None):
        die = self.get_object()
        serial = str(request.data.get("serial_number", "") or "").strip()
        note = str(request.data.get("notes", "") or "").strip()
        quantity = request.data.get("quantity", 1)
        try:
            quantity = max(1, int(quantity))
        except (TypeError, ValueError):
            return Response({"quantity": ["Enter a valid whole number."]}, status=status.HTTP_400_BAD_REQUEST)

        serials = [line.strip() for line in (die.serial_numbers or "").splitlines() if line.strip()]
        if serial and serial not in serials:
            serials.append(serial)
        die.serial_numbers = "\n".join(serials)
        die.active_die_count = die.active_die_count + quantity
        die.status = "in_stock"
        die.save(update_fields=["serial_numbers", "active_die_count", "status", "web_width_inches"])
        self.create_history(
            die,
            "die_received",
            f"{request.data.get('received_by') or request.data.get('performed_by') or 'system'} received {quantity} die for {die.name}.",
            request,
            notes="\n".join([part for part in [f"Serial: {serial}" if serial else "", note] if part]),
        )
        return Response(self.get_serializer(die).data)

    @action(detail=True, methods=["post"], url_path="adjust-count")
    def adjust_count(self, request, pk=None):
        die = self.get_object()
        value = request.data.get("active_die_count")
        try:
            next_count = int(value)
        except (TypeError, ValueError):
            return Response({"active_die_count": ["Enter a valid whole number."]}, status=status.HTTP_400_BAD_REQUEST)
        if next_count < 0:
            return Response({"active_die_count": ["Count cannot be negative."]}, status=status.HTTP_400_BAD_REQUEST)

        note = str(request.data.get("notes", "") or "").strip()
        previous = die.active_die_count
        die.active_die_count = next_count
        die.save(update_fields=["active_die_count", "status", "web_width_inches"])
        self.create_history(
            die,
            "die_count_adjusted",
            f"{request.data.get('performed_by') or 'system'} adjusted {die.name} count from {previous} to {next_count}.",
            request,
            notes=note,
        )
        return Response(self.get_serializer(die).data)


class FlexDieRequestViewSet(BaseToolingViewSet):
    serializer_class = FlexDieRequestSerializer
    search_fields = [
        "flex_die__name",
        "flex_die__supplier__name",
        "flex_die__current_location__name",
        "requested_by",
        "request_notes",
        "ordered_notes",
        "received_notes",
        "closed_reason",
        "status",
    ]
    ordering_fields = ["created_at", "updated_at", "status", "flex_die__name"]

    def get_queryset(self):
        qs = (
            FlexDieRequest.objects.select_related(
                "flex_die",
                "flex_die__supplier",
                "flex_die__current_location",
            )
            .all()
            .order_by("-updated_at", "-created_at")
        )
        flex_die = self.request.query_params.get("flex_die")
        if flex_die:
            qs = qs.filter(flex_die_id=flex_die)

        status_filter = str(self.request.query_params.get("status") or "").strip()
        if status_filter:
            qs = qs.filter(status__in=[value.strip() for value in status_filter.split(",") if value.strip()])

        open_filter = str(self.request.query_params.get("open") or "").strip().lower()
        if open_filter in {"1", "true", "yes"}:
            qs = qs.filter(status__in=["requested", "ordered"])
        elif open_filter in {"0", "false", "no"}:
            qs = qs.exclude(status__in=["requested", "ordered"])

        return qs

    def create_history(self, flex_die_request, event_type, summary, request, notes=""):
        return ToolingHistory.objects.create(
            tooling_type="flex_die",
            flex_die=flex_die_request.flex_die,
            event_type=event_type,
            performed_by=str(request.data.get("performed_by", "") or "").strip() or "system",
            summary=summary[:200],
            notes=notes,
        )

    @action(detail=True, methods=["post"], url_path="mark-ordered")
    def mark_ordered(self, request, pk=None):
        flex_die_request = self.get_object()
        if flex_die_request.status not in {"requested", "ordered"}:
            return Response({"detail": "Only open flex die requests can be marked ordered."}, status=status.HTTP_400_BAD_REQUEST)

        actor = str(request.data.get("performed_by", "") or "").strip() or "system"
        note = str(request.data.get("notes", "") or "").strip()
        flex_die_request.status = "ordered"
        flex_die_request.ordered_by = actor
        flex_die_request.ordered_notes = note
        flex_die_request.ordered_at = timezone.now()
        flex_die_request.save(update_fields=["status", "ordered_by", "ordered_notes", "ordered_at", "updated_at"])

        die = flex_die_request.flex_die
        die.status = "ordered"
        die.save(update_fields=["status"])
        self.create_history(
            flex_die_request,
            "die_ordered",
            f"{actor} marked request #{flex_die_request.pk} for {die.name} ordered.",
            request,
            notes=note,
        )
        return Response(self.get_serializer(flex_die_request).data)

    @action(detail=True, methods=["post"], url_path="receive")
    def receive(self, request, pk=None):
        flex_die_request = self.get_object()
        if flex_die_request.status not in {"requested", "ordered"}:
            return Response({"detail": "Only open flex die requests can be received."}, status=status.HTTP_400_BAD_REQUEST)

        quantity = request.data.get("quantity", 1)
        try:
            quantity = max(1, int(quantity))
        except (TypeError, ValueError):
            return Response({"quantity": ["Enter a valid whole number."]}, status=status.HTTP_400_BAD_REQUEST)

        actor = str(request.data.get("received_by", "") or request.data.get("performed_by", "") or "").strip() or "system"
        serial = str(request.data.get("serial_number", "") or "").strip()
        note = str(request.data.get("notes", "") or "").strip()

        flex_die_request.status = "received"
        flex_die_request.received_by = actor
        flex_die_request.received_notes = note
        flex_die_request.received_serial_number = serial
        flex_die_request.received_quantity = quantity
        flex_die_request.received_at = timezone.now()
        flex_die_request.save(update_fields=[
            "status",
            "received_by",
            "received_notes",
            "received_serial_number",
            "received_quantity",
            "received_at",
            "updated_at",
        ])

        die = flex_die_request.flex_die
        serials = [line.strip() for line in (die.serial_numbers or "").splitlines() if line.strip()]
        if serial and serial not in serials:
            serials.append(serial)
        die.serial_numbers = "\n".join(serials)
        die.active_die_count = die.active_die_count + quantity
        die.status = "in_stock"
        die.save(update_fields=["serial_numbers", "active_die_count", "status", "web_width_inches"])
        self.create_history(
            flex_die_request,
            "die_received",
            f"{actor} received {quantity} die for request #{flex_die_request.pk} / {die.name}.",
            request,
            notes="\n".join([part for part in [f"Serial: {serial}" if serial else "", note] if part]),
        )
        return Response(self.get_serializer(flex_die_request).data)

    @action(detail=True, methods=["post"], url_path="close-without-order")
    def close_without_order(self, request, pk=None):
        flex_die_request = self.get_object()
        if flex_die_request.status not in {"requested", "ordered"}:
            return Response({"detail": "This flex die request is already closed."}, status=status.HTTP_400_BAD_REQUEST)

        actor = str(request.data.get("performed_by", "") or "").strip() or "system"
        reason = str(request.data.get("reason", "") or request.data.get("notes", "") or "").strip()
        if not reason:
            return Response({"reason": ["Enter why this request is being closed without ordering."]}, status=status.HTTP_400_BAD_REQUEST)

        flex_die_request.status = "closed_without_order"
        flex_die_request.closed_by = actor
        flex_die_request.closed_reason = reason
        flex_die_request.closed_at = timezone.now()
        flex_die_request.save(update_fields=["status", "closed_by", "closed_reason", "closed_at", "updated_at"])
        self.create_history(
            flex_die_request,
            "die_request_closed",
            f"{actor} closed request #{flex_die_request.pk} for {flex_die_request.flex_die.name} without ordering.",
            request,
            notes=reason,
        )
        return Response(self.get_serializer(flex_die_request).data)


class RotaryDieViewSet(FlexDieViewSet):
    tooling_kind = "rotary_die"


class PerfCylinderViewSet(BaseToolingViewSet):
    queryset = (
        PerfCylinder.objects.select_related("supplier", "current_location")
        .prefetch_related("compatible_presses")
        .all()
        .order_by("name")
    )
    serializer_class = PerfCylinderSerializer
    search_fields = ["name", "notes", "supplier__name", "status"]
    ordering_fields = ["name", "status", "gear_tooth_count", "cylinder_width_inches"]


class PerfBladeSetupViewSet(BaseToolingViewSet):
    queryset = (
        PerfBladeSetup.objects.select_related("perf_cylinder", "perf_cylinder__current_location")
        .prefetch_related("blades")
        .all()
        .order_by("perf_cylinder__name", "name")
    )
    serializer_class = PerfBladeSetupSerializer
    search_fields = ["name", "notes", "perf_cylinder__name"]
    ordering_fields = ["name", "blade_count", "standard_repeat_inches", "is_active"]


class PerfBladeViewSet(BaseToolingViewSet):
    queryset = PerfBlade.objects.select_related("setup", "setup__perf_cylinder").all().order_by("setup__name", "blade_number")
    serializer_class = PerfBladeSerializer
    search_fields = ["setup__name", "setup__perf_cylinder__name", "notes", "blade_type"]
    ordering_fields = ["blade_number", "blade_type", "position_inches", "offset_inches", "is_active"]


class ToolingRecipeViewSet(BaseToolingViewSet):
    queryset = ToolingRecipe.objects.all().order_by("name")
    serializer_class = ToolingRecipeSerializer
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    search_fields = ["name", "face_type", "liner_type", "shape_type", "notes"]
    ordering_fields = ["name", "label_width_inches", "label_length_inches", "repeat_inches", "tpi", "is_active"]

    @action(detail=True, methods=["post", "delete"], url_path="layout-file")
    def layout_file(self, request, pk=None):
        recipe = self.get_object()

        if request.method == "DELETE":
            current_file = recipe.layout_file
            if current_file:
                current_file.delete(save=False)
            recipe.layout_file = None
            recipe.layout_file_name = ""
            recipe.save(update_fields=["layout_file", "layout_file_name"])
            return Response(self.get_serializer(recipe).data)

        upload = request.FILES.get("image") or request.FILES.get("file")
        if not upload:
            return Response({"file": ["Choose a layout image or PDF to upload."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            upload = validate_upload(upload, allow_images=True, allow_pdf=True, field="file")
        except serializers.ValidationError as error:
            return Response(error.detail, status=status.HTTP_400_BAD_REQUEST)

        current_file = recipe.layout_file
        if current_file:
            current_file.delete(save=False)
        recipe.layout_file = upload
        recipe.layout_file_name = str(request.data.get("name") or upload.name).strip()
        recipe.save(update_fields=["layout_file", "layout_file_name"])
        return Response(self.get_serializer(recipe).data)

    @action(detail=True, methods=["get"], url_path="layout-file-preview")
    def layout_file_preview(self, request, pk=None):
        recipe = self.get_object()
        if not request_user_has_resource_access(request, "recipes"):
            return resource_access_denied_response(request, "You do not have access to this layout file.")
        if not recipe.layout_file:
            return Response({"error": "No layout file uploaded."}, status=status.HTTP_404_NOT_FOUND)

        return private_file_response(
            recipe.layout_file,
            display_name=recipe.layout_file_name,
            fallback_name="layout-file",
        )


class PrintPlateViewSet(BaseToolingViewSet):
    serializer_class = PrintPlateSerializer
    search_fields = [
        "plate_number",
        "customer_plate_number",
        "serial_number",
        "description",
        "recipe__name",
        "stations__pms_color",
    ]
    ordering_fields = ["plate_number", "customer_plate_number", "number_around", "number_across", "is_active", "updated_at"]

    def get_queryset(self):
        qs = (
            PrintPlate.objects.select_related("recipe")
            .prefetch_related("stations")
            .all()
            .order_by("recipe__name", "plate_number")
        )
        recipe = self.request.query_params.get("recipe")
        if recipe:
            qs = qs.filter(recipe_id=recipe)
        return qs


class PrintStationViewSet(BaseToolingViewSet):
    serializer_class = PrintStationSerializer
    search_fields = [
        "print_plate__plate_number",
        "print_plate__customer_plate_number",
        "print_plate__recipe__name",
        "station_plate_number",
        "anilox_gear_number",
        "pms_color",
        "color_type",
        "notes",
    ]
    ordering_fields = ["station_number", "pms_color", "color_type", "is_active", "updated_at"]

    def get_queryset(self):
        qs = (
            PrintStation.objects.select_related("print_plate", "print_plate__recipe")
            .all()
            .order_by("print_plate__recipe__name", "print_plate__plate_number", "station_number")
        )
        print_plate = self.request.query_params.get("print_plate")
        recipe = self.request.query_params.get("recipe")
        if print_plate:
            qs = qs.filter(print_plate_id=print_plate)
        if recipe:
            qs = qs.filter(print_plate__recipe_id=recipe)
        return qs


class ToolingRecipeOptionViewSet(BaseToolingViewSet):
    queryset = (
    ToolingRecipeOption.objects
    .select_related(
        "recipe",
        "press",
        "press__location",
    )
    .prefetch_related(
        "tools__mag",
        "tools__mag__current_location",
        "tools__flex_die",
        "tools__flex_die__current_location",
        "tools__perf_cylinder",
        "tools__perf_cylinder__current_location",
        "tools__perf_blade_setup",
        "tools__perf_blade_setup__blades",
        "tools__perf_blade_setup__perf_cylinder",
        "tools__perf_blade_setup__perf_cylinder__current_location",
    )
    .all()
    .order_by("recipe__name", "press__name", "-is_preferred", "name")
)

    serializer_class = ToolingRecipeOptionSerializer

    search_fields = [
        "name",
        "recipe__name",
        "press__name",
        "setup_notes",
        "operator_notes",
        "tools__mag__name",
        "tools__flex_die__name",
        "tools__flex_die__original_serial_number",
        "tools__flex_die__serial_numbers",
        "tools__perf_cylinder__name",
        "tools__perf_blade_setup__name",
    ]

    ordering_fields = [
        "name",
        "estimated_setup_minutes",
        "is_preferred",
        "is_approved",
        "is_active",
        "recipe__name",
        "press__name",
    ]

    def get_queryset(self):
        qs = super().get_queryset()
        recipe = self.request.query_params.get("recipe")
        press = self.request.query_params.get("press")
        is_active = self.request.query_params.get("is_active")
        if recipe:
            qs = qs.filter(recipe_id=recipe)
        if press:
            qs = qs.filter(press_id=press)
        if is_active in {"true", "false"}:
            qs = qs.filter(is_active=(is_active == "true"))
        return qs

class ToolingRecipeToolViewSet(BaseToolingViewSet):
    serializer_class = ToolingRecipeToolSerializer
    search_fields = [
        "recipe_option__name",
        "recipe_option__recipe__name",
        "recipe_option__press__name",
        "manual_description",
        "notes",
        "mag__name",
        "flex_die__name",
        "perf_cylinder__name",
        "perf_blade_setup__name",
    ]
    ordering_fields = ["station_number", "tool_type", "is_required"]

    def get_queryset(self):
        qs = (
            ToolingRecipeTool.objects.select_related(
                "recipe_option",
                "recipe_option__recipe",
                "recipe_option__press",
                "mag",
                "flex_die",
                "perf_cylinder",
                "perf_blade_setup",
                "perf_blade_setup__perf_cylinder",
                "perf_blade_setup__perf_cylinder__current_location",
            )
            .prefetch_related("perf_blade_setup__blades")
            .all()
            .order_by("recipe_option__recipe__name", "recipe_option__name", "station_number", "tool_type")
        )
        params = self.request.query_params
        recipe_option = params.get("recipe_option")
        flex_die = params.get("flex_die")
        mag = params.get("mag")
        perf_cylinder = params.get("perf_cylinder")
        perf_blade_setup = params.get("perf_blade_setup")
        if recipe_option:
            qs = qs.filter(recipe_option_id=recipe_option)
        if flex_die:
            qs = qs.filter(flex_die_id=flex_die)
        if mag:
            qs = qs.filter(mag_id=mag)
        if perf_cylinder:
            qs = qs.filter(perf_cylinder_id=perf_cylinder)
        if perf_blade_setup:
            qs = qs.filter(perf_blade_setup_id=perf_blade_setup)
        return qs


class ToolingHistoryViewSet(BaseToolingViewSet):
    serializer_class = ToolingHistorySerializer
    search_fields = [
        "summary",
        "notes",
        "performed_by",
        "mag__name",
        "flex_die__name",
        "perf_cylinder__name",
        "press__name",
        "supplier__name",
    ]
    ordering_fields = ["event_date", "event_type", "performed_by", "tooling_type"]

    def get_queryset(self):
        qs = (
            ToolingHistory.objects.select_related(
                "mag",
                "flex_die",
                "perf_cylinder",
                "from_location",
                "to_location",
                "press",
                "supplier",
            )
            .all()
            .order_by("-event_date")
        )
        flex_die = self.request.query_params.get("flex_die")
        mag = self.request.query_params.get("mag")
        perf_cylinder = self.request.query_params.get("perf_cylinder")
        if flex_die:
            qs = qs.filter(flex_die_id=flex_die)
        if mag:
            qs = qs.filter(mag_id=mag)
        if perf_cylinder:
            qs = qs.filter(perf_cylinder_id=perf_cylinder)
        return qs


class RawMaterialInventoryViewSet(BaseToolingViewSet):
    queryset = (
        RawMaterialInventory.objects.select_related("supplier", "location")
        .all()
        .order_by("material_type", "name", "serial_number")
    )
    serializer_class = RawMaterialInventorySerializer
    search_fields = [
        "name",
        "serial_number",
        "lot_number",
        "material_type",
        "face_type",
        "liner_type",
        "adhesive_type",
        "silicone_type",
        "status",
        "supplier__name",
        "location__name",
        "notes",
    ]
    ordering_fields = [
        "material_type",
        "name",
        "serial_number",
        "width_inches",
        "length_feet",
        "quantity",
        "status",
        "received_date",
    ]


class JobTicketViewSet(BaseToolingViewSet):
    queryset = (
        JobTicket.objects.select_related(
            "recipe",
            "recipe_option",
            "press",
            "face_material",
            "liner_material",
            "adhesive_material",
            "silicone_material",
        )
        .all()
        .order_by("-scheduled_date", "ticket_number")
    )
    serializer_class = JobTicketSerializer
    search_fields = [
        "ticket_number",
        "customer_name",
        "product_name",
        "status",
        "priority",
        "recipe__name",
        "recipe_option__name",
        "press__name",
        "face_material__name",
        "face_material__serial_number",
        "liner_material__name",
        "liner_material__serial_number",
        "finishing_type",
        "finishing_notes",
        "operator",
        "suboperator",
        "production_notes",
    ]
    ordering_fields = [
        "ticket_number",
        "customer_name",
        "product_name",
        "status",
        "priority",
        "due_date",
        "scheduled_date",
        "requested_quantity",
        "produced_quantity",
    ]


class FinishedInventoryViewSet(BaseToolingViewSet):
    queryset = (
        FinishedInventory.objects.select_related(
            "job_ticket",
            "recipe",
            "recipe_option",
            "location",
        )
        .all()
        .order_by("-run_date", "name")
    )
    serializer_class = FinishedInventorySerializer
    search_fields = [
        "name",
        "sku",
        "status",
        "job_ticket__ticket_number",
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
