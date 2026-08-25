import logging
import json
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, DecimalField, ExpressionWrapper, F, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import filters, serializers, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from materials.models import MaterialUsage, RawMaterialInventory
from materials.serializers import RawMaterialInventorySerializer
from materials.zpl import zpl_copies, zpl_text
from tooling.models import Press, ToolingLocation

from .models import (
    BoxInventory,
    BoxSpec,
    CoreInventory,
    CoreSpec,
    Customer,
    CustomerAddress,
    CustomerContact,
    CustomerInteraction,
    CustomerInteractionHistory,
    CustomerOrder,
    CustomerOrderEvent,
    FinishedInventory,
    JobTicketEvent,
    JobTicket,
    JobTicketUsage,
    LiveFootageArchive,
    LocalLiveFootageReading,
    Message,
    MessageThread,
    ProductionMaterialAssignment,
    ProductionSchedule,
    ProductionShiftReport,
    ProductionShiftSetting,
    QuoteCostRate,
    QuoteFinishedMaterial,
    QuoteRawMaterial,
    QuoteRecord,
)
from .serializers import (
    BoxInventorySerializer,
    BoxSpecSerializer,
    CoreInventorySerializer,
    CoreSpecSerializer,
    CustomerSerializer,
    CustomerInteractionSerializer,
    CustomerOrderEventSerializer,
    CustomerOrderSerializer,
    FinishedInventorySerializer,
    JobTicketEventSerializer,
    JobTicketSerializer,
    JobTicketUsageSerializer,
    LiveFootageArchiveSerializer,
    LocalLiveFootageReadingSerializer,
    MessageSerializer,
    MessageThreadSerializer,
    ProductionMaterialAssignmentSerializer,
    ProductionScheduleSerializer,
    ProductionShiftReportSerializer,
    ProductionShiftSettingSerializer,
    QuoteCostRateSerializer,
    QuoteFinishedMaterialSerializer,
    QuoteRawMaterialSerializer,
    QuoteRecordSerializer,
)
from users.auth import company_user_from_request, request_user_has_resource_access, request_user_is_admin, resource_access_denied_response
from .file_responses import private_file_response
from .upload_security import validate_upload


logger = logging.getLogger(__name__)

FIREBASE_LIVE_FOOTAGE_BASE = "https://realtime2-94ff8-default-rtdb.firebaseio.com"
FIREBASE_ETI_SETTINGS_PATH = "/ETI_DEVICE_SETTINGS.json"
FIREBASE_PRESS_GOAL_SHARES_PATH = "/PRESS_GOAL_SHARES.json"
FIREBASE_PRINT_QUEUE_BASE = settings.FIREBASE_PRINT_QUEUE_BASE
FIREBASE_PRINT_QUEUE_ROOT = settings.FIREBASE_PRINT_QUEUE_ROOT
FIREBASE_PRINT_QUEUE_NAME = settings.FIREBASE_PRINT_QUEUE_NAME
LIVE_FOOTAGE_RELAY_NODES = {
    "18azt": {
        "speed": ("PUT", "/18Aztech_CURRENT_SPEED.json?print=silent"),
        "daily": ("POST", "/18Aztech_SPEED.json?print=silent"),
    },
    "eti": {
        "speed": ("PUT", "/ETI_CURRENT_SPEED.json?print=silent"),
        "daily": ("POST", "/ETI_SPEED.json?print=silent"),
    },
    "17nil": {
        "speed": ("PUT", "/17Nilpeter_CURRENT_SPEED.json?print=silent"),
        "daily": ("POST", "/17Nilpeter_SPEED.json?print=silent"),
    },
}

LOCAL_LIVE_FOOTAGE_PRESSES = {
    "18azt": {"key": "18AZT", "name": "18 Aztech"},
    "eti": {"key": "ETI", "name": "ETI"},
    "slit": {"key": "SLIT", "name": "Slitter"},
    "13nil": {"key": "13NIL", "name": "13 Nilpeter"},
    "17nil": {"key": "17NIL", "name": "17 Nilpeter"},
    "13azt": {"key": "13AZT", "name": "13 Aztech"},
}
PRESS_DASHBOARD_LABEL_PRESSES = {
    "18AZT": "18 Aztech",
    "ETI": "ETI",
    "SLIT": "Slitter",
    "13NIL": "13 Nilpeter",
    "17NIL": "17 Nilpeter",
    "13AZT": "13 Aztech",
}
PLANT_TIME_ZONE = ZoneInfo("America/New_York")
LOCAL_LIVE_FOOTAGE_GOAL = Decimal("400000")
LOCAL_LIVE_FOOTAGE_BUCKET_MINUTES = 10
LOCAL_LIVE_SHIFT_START_HOUR = 5
LOCAL_LIVE_SHIFT_START_MINUTE = 0
LOCAL_LIVE_SHIFT_END_HOUR = 2
LOCAL_LIVE_SHIFT_END_MINUTE = 20


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
    ("carton_label_is_unique", "Unique Carton Label"),
    ("carton_label_format", "Carton Label Format"),
    ("job_notes", "Job Notes"),
]


def _relay_number(value, default=0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _print_text(data, key, default=""):
    value = data.get(key, default)
    if value in [None, ""]:
        return str(default or "")
    return str(value).strip()


def _positive_int(value, default=1):
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return default
    return max(1, parsed)


def _request_bool(value):
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _device_token_allowed(request):
    expected = getattr(settings, "LIVE_FOOTAGE_DEVICE_TOKEN", "")
    if not expected:
        return True
    if request_user_is_admin(request):
        return True
    supplied = (
        request.headers.get("X-Device-Token")
        or request.query_params.get("token")
        or request.data.get("device_token")
    )
    return supplied == expected


ETI_DEVICE_SETTINGS_DEFAULTS = {
    "wheelDiameterInches": 3.0,
    "pulsesPerRevolution": 1,
    "settingsCheckSeconds": 300,
    "speedSendSeconds": 120,
    "footageSendSeconds": 300,
    "resetEnabled": False,
    "resetHour": 3,
    "resetMinute": 0,
    "schemaVersion": 1,
}


def _default_press_goal_shares():
    keys = list(PRESS_DASHBOARD_LABEL_PRESSES.keys())
    if not keys:
        return {}
    equal_share = (Decimal("100") / Decimal(len(keys))).quantize(Decimal("0.01"))
    remaining = Decimal("100")
    shares = {}
    for key in keys[:-1]:
        shares[key] = float(equal_share)
        remaining -= equal_share
    shares[keys[-1]] = float(remaining.quantize(Decimal("0.01")))
    return shares


def _validated_press_goal_shares(data, *, strict=False):
    defaults = _default_press_goal_shares()
    source = data.get("shares") if isinstance(data, dict) and isinstance(data.get("shares"), dict) else data
    source = source if isinstance(source, dict) else {}
    shares = {}
    for key in PRESS_DASHBOARD_LABEL_PRESSES:
        raw = source.get(key, defaults.get(key, 0))
        try:
            value = Decimal(str(raw))
        except (InvalidOperation, TypeError, ValueError):
            if not strict:
                value = Decimal(str(defaults.get(key, 0)))
            else:
                raise serializers.ValidationError({"shares": [f"{PRESS_DASHBOARD_LABEL_PRESSES[key]} needs a valid percentage."]})
        if value < 0 or value > 100:
            if not strict:
                value = Decimal(str(defaults.get(key, 0)))
            else:
                raise serializers.ValidationError({"shares": [f"{PRESS_DASHBOARD_LABEL_PRESSES[key]} must be between 0% and 100%."]})
        shares[key] = float(value.quantize(Decimal("0.01")))

    total = sum(Decimal(str(shares[key])) for key in PRESS_DASHBOARD_LABEL_PRESSES)
    if strict and (total < Decimal("99.95") or total > Decimal("100.05")):
        raise serializers.ValidationError({"shares": [f"Press goal shares must total 100%. Current total is {total}%."]})
    return shares


def _press_goal_share_response(shares, *, exists=True, firebase_status=None, meta=None):
    total = sum(Decimal(str(shares[key])) for key in PRESS_DASHBOARD_LABEL_PRESSES)
    presses = []
    for key, name in PRESS_DASHBOARD_LABEL_PRESSES.items():
        share = Decimal(str(shares.get(key, 0)))
        presses.append({
            "key": key,
            "name": name,
            "sharePercent": float(share),
            "targetFootage": float((LOCAL_LIVE_FOOTAGE_GOAL * share / Decimal("100")).quantize(Decimal("0.01"))),
        })
    return {
        "shares": shares,
        "presses": presses,
        "total": float(total),
        "goalFootage": float(LOCAL_LIVE_FOOTAGE_GOAL),
        "exists": exists,
        "firebase_status": firebase_status,
        **(meta or {}),
    }


def _verified_settings_admin(request):
    return company_user_from_request(request) if request_user_is_admin(request) else None


def _eti_setting_number(data, key, minimum, maximum, integer=False):
    raw = data.get(key)
    try:
        value = int(raw) if integer else float(raw)
    except (TypeError, ValueError):
        raise serializers.ValidationError({key: [f"Enter a number between {minimum} and {maximum}."]})
    if value < minimum or value > maximum:
        raise serializers.ValidationError({key: [f"Enter a value between {minimum} and {maximum}."]})
    return value


def _validated_eti_settings(data):
    return {
        "wheelDiameterInches": _eti_setting_number(data, "wheelDiameterInches", 0.5, 48),
        "pulsesPerRevolution": _eti_setting_number(data, "pulsesPerRevolution", 1, 100, integer=True),
        "settingsCheckSeconds": _eti_setting_number(data, "settingsCheckSeconds", 30, 86400, integer=True),
        "speedSendSeconds": _eti_setting_number(data, "speedSendSeconds", 5, 3600, integer=True),
        "footageSendSeconds": _eti_setting_number(data, "footageSendSeconds", 30, 21600, integer=True),
        "resetEnabled": _request_bool(data.get("resetEnabled")),
        "resetHour": _eti_setting_number(data, "resetHour", 0, 23, integer=True),
        "resetMinute": _eti_setting_number(data, "resetMinute", 0, 59, integer=True),
        "schemaVersion": 1,
    }


def _firebase_safe_key(value, default="default"):
    text = str(value or default or "").strip()
    safe = "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in text)
    safe = "_".join(part for part in safe.split("_") if part)
    return safe or default


def _firebase_post_json(base_url, path_parts, payload, timeout=8):
    clean_base = str(base_url or "").rstrip("/")
    clean_parts = [str(part).strip("/") for part in path_parts if str(part).strip("/")]
    url = f"{clean_base}/{'/'.join(clean_parts)}.json"
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    firebase_request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(firebase_request, timeout=timeout) as response:
        response_body = response.read().decode("utf-8") or "{}"
        try:
            response_payload = json.loads(response_body)
        except json.JSONDecodeError:
            response_payload = {}
        return response.status, response_payload


def _press_dashboard_info(value):
    key = str(value or "").strip().upper()
    if key in PRESS_DASHBOARD_LABEL_PRESSES:
        return key, PRESS_DASHBOARD_LABEL_PRESSES[key]
    return "", ""


def _press_dashboard_label_zpl(press_key, press_name, scan_url, *, darkness="20", speed="5", copies=1):
    return "\n".join([
        "^XA",
        "^CI28",
        "^PW812",
        "^LL609",
        "^LH0,0",
        f"~SD{zpl_text(darkness) or '20'}",
        f"^PR{zpl_text(speed) or '5'}",
        "^FO30,24^A0N,31,31^FDTRI-STATE MEDIA^FS",
        f"^FO30,68^A0N,48,48^FB360,2,0,L^FD{zpl_text(press_name)}^FS",
        "^FO30,170^A0N,26,26^FDOPERATOR FOOTAGE^FS",
        "^FO30,206^GB340,3,3^FS",
        "^FO30,238^A0N,24,24^FB350,3,8,L^FDScan for live FPM, downtime, runtime, and shift footage.^FS",
        "^FO30,355^A0N,24,24^FDDay: 5:00 AM - 4:30 PM^FS",
        "^FO30,390^A0N,24,24^FDNight: 4:30 PM - 2:20 AM^FS",
        "^FO30,425^A0N,23,23^FDHandoff: 4:30 PM^FS",
        f"^FO30,532^A0N,25,25^FD{zpl_text(press_key)}^FS",
        f"^FO425,76^BQN,2,9^FDLA,{zpl_text(scan_url)}^FS",
        "^FO420,520^A0N,25,25^FB360,1,0,C^FDSCAN WITH PHONE^FS",
        f"^PQ{zpl_copies(copies)}",
        "^XZ",
    ])


def _job_ticket_carton_payload(ticket, request_data, press=None):
    saved_template = {
        "dow_carton": "DOWCARTONLABEL",
        "dow_closure": "DOWCLOSURELABEL",
        "customer_label": "CL",
        "bcl": "BCL",
        "abe": "ABE",
        "clopay": "CS",
        "variable_barcode": "BARCODE",
        "camslide": "CAM",
    }.get(ticket.carton_label_format, "Standard") if ticket.carton_label_is_unique else "Standard"
    template = _print_text(request_data, "template", saved_template).upper()
    if template in {"STANDARD", "STD"}:
        template = "Standard"

    labels_per_unit = ticket.labels_per_unit or ""
    labels_per_carton = ticket.units_per_carton or ticket.labels_per_carton or ""
    default_label_a = f"{labels_per_unit} {ticket.unit_type or 'labels'}/unit" if labels_per_unit else ""
    default_label_b = f"{labels_per_carton} {ticket.unit_type or 'labels'}/carton" if labels_per_carton else ""
    part_number = (
        _print_text(request_data, "part_number")
        or ticket.carton_label_part_number
        or ticket.product_code
        or ticket.job_name
        or ticket.ticket_number
        or ""
    )

    payload = {
        "TYPE": template,
        "Printer": _print_text(request_data, "printer_ip", getattr(press, "printer_ip", "")),
        "Printer Port": _positive_int(request_data.get("printer_port") or getattr(press, "printer_port", None), 9100),
        "SPEED": _print_text(request_data, "speed", getattr(press, "printer_speed", "") or "5"),
        "DARKNESS": _print_text(request_data, "darkness", getattr(press, "printer_darkness", "") or "11"),
        "Total Ship Stock": _positive_int(request_data.get("total"), 1),
        "line": part_number,
        "TEXT1": _print_text(request_data, "text1", ticket.carton_label_description_a or ticket.description or ""),
        "TEXT2": _print_text(request_data, "text2", ticket.carton_label_description_b or ""),
        "TEXT3": _print_text(request_data, "text3", ticket.carton_label_description_c or ""),
        "BLACKOUT": _print_text(request_data, "blackout"),
        "labela": _print_text(request_data, "labela", ticket.carton_label_finishing_1 or default_label_a),
        "labelb": _print_text(request_data, "labelb", ticket.carton_label_finishing_2 or default_label_b),
        "Lot Number": _print_text(request_data, "lot_number"),
        "label type": _print_text(request_data, "label_type"),
        "Starting Number": _print_text(request_data, "starting_number"),
        "Ending Number": _print_text(request_data, "ending_number"),
        "refnumber": _print_text(request_data, "ref_number"),
        "PO": _print_text(request_data, "po"),
        "REWORK MESSAGE": _print_text(request_data, "rework_message"),
        "CSH": _print_text(request_data, "clopay_shipping_header"),
        "CSD": _print_text(request_data, "clopay_ship_date"),
        "CSPN": _print_text(request_data, "clopay_part_number"),
        "CSPO": _print_text(request_data, "clopay_po"),
        "CSPOL": _print_text(request_data, "clopay_po_line"),
        "CSQ": _print_text(request_data, "clopay_quantity"),
        "CSUOM": _print_text(request_data, "clopay_uom"),
        "Operator": _print_text(request_data, "operator"),
        "Part Number List Logic": _print_text(request_data, "material_part_number", part_number),
        "Face": _print_text(request_data, "face", ticket.face_type or ""),
        "Liner ": _print_text(request_data, "liner", ticket.liner_type or ""),
        "Liner": _print_text(request_data, "liner", ticket.liner_type or ""),
        "Note": _print_text(request_data, "note"),
        "Adhesive Width ": _print_text(request_data, "adhesive_width"),
        "Adhesive Width": _print_text(request_data, "adhesive_width"),
        "Length": _print_text(request_data, "length"),
        "Adhesive": _print_text(request_data, "adhesive"),
        "ID": _print_text(request_data, "roll_id"),
        "Job Ticket": ticket.ticket_number,
        "TSM ID": ticket.product_code,
        "Customer": ticket.customer.name if ticket.customer else ticket.customer_name,
        "Queued At": timezone.now().isoformat(),
    }
    return {key: value for key, value in payload.items() if value not in [None, ""]}


def _client_ip(request):
    forwarded_for = str(request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
    return forwarded_for or request.META.get("REMOTE_ADDR") or None


def _local_press_info(press):
    raw_key = str(press or "").strip().lower()
    info = LOCAL_LIVE_FOOTAGE_PRESSES.get(raw_key)
    if info:
        return raw_key, info["key"], info["name"]
    display_key = raw_key.upper() if raw_key else "UNKNOWN"
    return raw_key, display_key, display_key


def _local_live_shift_window(now=None):
    current = timezone.localtime(now or timezone.now(), PLANT_TIME_ZONE)
    start = current.replace(hour=LOCAL_LIVE_SHIFT_START_HOUR, minute=LOCAL_LIVE_SHIFT_START_MINUTE, second=0, microsecond=0)
    if current < start:
        start -= timedelta(days=1)
    end = (start + timedelta(days=1)).replace(hour=LOCAL_LIVE_SHIFT_END_HOUR, minute=LOCAL_LIVE_SHIFT_END_MINUTE, second=0, microsecond=0)
    return start, end


def _local_live_chart_payload(shift_rows, known_keys, shift_start, shift_end, now):
    effective_end = min(timezone.localtime(now, PLANT_TIME_ZONE), shift_end)
    bucket_seconds = LOCAL_LIVE_FOOTAGE_BUCKET_MINUTES * 60
    duration_seconds = max(bucket_seconds, int((effective_end - shift_start).total_seconds()))
    bucket_count = max(2, (duration_seconds // bucket_seconds) + 1)
    bucket_times = [shift_start + timedelta(minutes=LOCAL_LIVE_FOOTAGE_BUCKET_MINUTES * index) for index in range(bucket_count)]
    labels = [bucket.strftime("%H:%M") for bucket in bucket_times]
    press_keys = list(known_keys.keys())
    bucket_sums = {key: [0.0 for _ in range(bucket_count)] for key in press_keys}

    for row in shift_rows.filter(kind="footage").order_by("recorded_at"):
        if row.press_key not in bucket_sums:
            bucket_sums[row.press_key] = [0.0 for _ in range(bucket_count)]
            press_keys.append(row.press_key)
        row_time = timezone.localtime(row.recorded_at, PLANT_TIME_ZONE)
        index = int(max(0, (row_time - shift_start).total_seconds()) // bucket_seconds)
        index = min(bucket_count - 1, max(0, index))
        bucket_sums[row.press_key][index] += float(row.footage or 0)

    series = []
    company_points = [0.0 for _ in range(bucket_count)]
    for key in press_keys:
        running = 0.0
        points = []
        for index, value in enumerate(bucket_sums.get(key, [])):
            running += float(value or 0)
            points.append(round(running, 2))
            company_points[index] += running
        series.append({
            "key": key,
            "name": known_keys.get(key, key),
            "points": points,
        })

    return {
        "bucketMinutes": LOCAL_LIVE_FOOTAGE_BUCKET_MINUTES,
        "labels": labels,
        "series": series,
        "companyPoints": [round(value, 2) for value in company_points],
    }


@api_view(["POST", "PUT"])
@permission_classes([AllowAny])
def live_footage_relay(request, press, kind):
    if not _device_token_allowed(request):
        return Response({"detail": "Invalid device token."}, status=status.HTTP_403_FORBIDDEN)
    press_key = str(press or "").strip().lower()
    kind_key = str(kind or "").strip().lower()
    node = LIVE_FOOTAGE_RELAY_NODES.get(press_key, {}).get(kind_key)
    if not node:
        return Response({"detail": "Unknown live footage relay."}, status=status.HTTP_404_NOT_FOUND)

    method, path = node
    if request.method.upper() != method:
        return Response({"detail": f"Use {method} for this relay."}, status=status.HTTP_405_METHOD_NOT_ALLOWED)

    timestamp = int(_relay_number(request.data.get("timestamp"), 0))
    if kind_key == "speed":
        current_speed = int(round(_relay_number(request.data.get("currentSpeed", request.data.get("speed")), 0)))
        if current_speed < 0 or current_speed > 700:
            return Response({"currentSpeed": ["Speed must be between 0 and 700 FPM."]}, status=status.HTTP_400_BAD_REQUEST)
        payload = {"currentSpeed": current_speed, "timestamp": timestamp}
        device_health = request.data.get("device")
        if isinstance(device_health, dict):
            payload["device"] = device_health
    else:
        footage = round(_relay_number(request.data.get("footage"), 0), 1)
        if footage < 0 or footage > 5000:
            return Response({"footage": ["Footage must be between 0 and 5,000 ft."]}, status=status.HTTP_400_BAD_REQUEST)
        payload = {"footage": footage, "timestamp": timestamp}

    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    firebase_request = Request(
        f"{FIREBASE_LIVE_FOOTAGE_BASE}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method=method,
    )

    try:
        with urlopen(firebase_request, timeout=8) as response:
            firebase_status = response.status
    except HTTPError as error:
        return Response(
            {"detail": "Firebase rejected the live footage relay.", "firebase_status": error.code},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    except URLError as error:
        return Response(
            {"detail": "Could not reach Firebase from the live footage relay.", "error": str(error.reason)},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response({"ok": True, "press": press_key, "kind": kind_key, "firebase_status": firebase_status})


@api_view(["GET", "PUT"])
def eti_device_settings(request):
    admin_user = _verified_settings_admin(request)
    if not admin_user:
        return Response(
            {"detail": "Only an active Admin user can manage ETI device settings."},
            status=status.HTTP_403_FORBIDDEN,
        )

    firebase_url = f"{FIREBASE_LIVE_FOOTAGE_BASE}{FIREBASE_ETI_SETTINGS_PATH}"
    if request.method == "GET":
        firebase_request = Request(firebase_url, method="GET")
        try:
            with urlopen(firebase_request, timeout=8) as response:
                response_body = response.read().decode("utf-8") or "null"
                firebase_payload = json.loads(response_body)
                firebase_status = response.status
        except (json.JSONDecodeError, TypeError):
            return Response(
                {"detail": "Firebase returned invalid ETI settings data."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except HTTPError as error:
            return Response(
                {"detail": "Firebase rejected the ETI settings request.", "firebase_status": error.code},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except URLError as error:
            return Response(
                {"detail": "Could not reach Firebase for ETI settings.", "error": str(error.reason)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        exists = isinstance(firebase_payload, dict)
        settings_payload = {
            **ETI_DEVICE_SETTINGS_DEFAULTS,
            **(firebase_payload if exists else {}),
        }
        return Response({
            "settings": settings_payload,
            "exists": exists,
            "firebase_status": firebase_status,
        })

    try:
        settings_payload = _validated_eti_settings(request.data)
    except serializers.ValidationError as error:
        return Response(error.detail, status=status.HTTP_400_BAD_REQUEST)

    firebase_payload = {
        **settings_payload,
        "updatedBy": admin_user.name or admin_user.username,
        "updatedAt": timezone.now().isoformat(),
    }
    body = json.dumps(firebase_payload, separators=(",", ":")).encode("utf-8")
    firebase_request = Request(
        f"{firebase_url}?print=silent",
        data=body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    try:
        with urlopen(firebase_request, timeout=8) as response:
            firebase_status = response.status
    except HTTPError as error:
        return Response(
            {"detail": "Firebase rejected the ETI settings update.", "firebase_status": error.code},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    except URLError as error:
        return Response(
            {"detail": "Could not reach Firebase to save ETI settings.", "error": str(error.reason)},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response({
        "ok": True,
        "settings": firebase_payload,
        "firebase_status": firebase_status,
        "updated_by": admin_user.name or admin_user.username,
    })


@api_view(["GET", "PUT"])
def press_goal_shares(request):
    admin_user = _verified_settings_admin(request)
    if not admin_user:
        return Response(
            {"detail": "Only an active Admin user can manage press goal splits."},
            status=status.HTTP_403_FORBIDDEN,
        )

    firebase_url = f"{FIREBASE_LIVE_FOOTAGE_BASE}{FIREBASE_PRESS_GOAL_SHARES_PATH}"
    if request.method == "GET":
        firebase_request = Request(firebase_url, method="GET")
        try:
            with urlopen(firebase_request, timeout=8) as response:
                response_body = response.read().decode("utf-8") or "null"
                firebase_payload = json.loads(response_body)
                firebase_status = response.status
        except (json.JSONDecodeError, TypeError):
            return Response(
                {"detail": "Firebase returned invalid press goal split data."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except HTTPError as error:
            return Response(
                {"detail": "Firebase rejected the press goal split request.", "firebase_status": error.code},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except URLError as error:
            return Response(
                {"detail": "Could not reach Firebase for press goal splits.", "error": str(error.reason)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        exists = isinstance(firebase_payload, dict)
        shares = _validated_press_goal_shares(firebase_payload if exists else {}, strict=False)
        return Response(_press_goal_share_response(shares, exists=exists, firebase_status=firebase_status))

    try:
        shares = _validated_press_goal_shares(request.data, strict=True)
    except serializers.ValidationError as error:
        return Response(error.detail, status=status.HTTP_400_BAD_REQUEST)

    firebase_payload = {
        "shares": shares,
        "goalFootage": float(LOCAL_LIVE_FOOTAGE_GOAL),
        "schemaVersion": 1,
        "updatedBy": admin_user.name or admin_user.username,
        "updatedAt": timezone.now().isoformat(),
    }
    body = json.dumps(firebase_payload, separators=(",", ":")).encode("utf-8")
    firebase_request = Request(
        f"{firebase_url}?print=silent",
        data=body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    try:
        with urlopen(firebase_request, timeout=8) as response:
            firebase_status = response.status
    except HTTPError as error:
        return Response(
            {"detail": "Firebase rejected the press goal split update.", "firebase_status": error.code},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    except URLError as error:
        return Response(
            {"detail": "Could not reach Firebase to save press goal splits.", "error": str(error.reason)},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    return Response(_press_goal_share_response(
        shares,
        exists=True,
        firebase_status=firebase_status,
        meta={
            "ok": True,
            "updated_by": admin_user.name or admin_user.username,
            "updated_at": firebase_payload["updatedAt"],
        },
    ))


@api_view(["POST"])
def press_dashboard_qr_label(request):
    admin_user = _verified_settings_admin(request)
    if not admin_user:
        return Response(
            {"detail": "Only an active Admin user can print press dashboard QR labels."},
            status=status.HTTP_403_FORBIDDEN,
        )

    press_key, press_name = _press_dashboard_info(request.data.get("dashboard_press_key"))
    if not press_key:
        return Response({"dashboard_press_key": ["Choose a valid press dashboard."]}, status=status.HTTP_400_BAD_REQUEST)

    printer_press = None
    printer_press_id = request.data.get("printer_press")
    if printer_press_id:
        printer_press = Press.objects.filter(pk=printer_press_id).first()
        if not printer_press:
            return Response({"printer_press": ["Selected printer press was not found."]}, status=status.HTTP_400_BAD_REQUEST)

    printer_ip = _print_text(request.data, "printer_ip", getattr(printer_press, "printer_ip", ""))
    if not printer_ip:
        return Response({"printer_ip": ["Enter a printer IP before printing the QR label."]}, status=status.HTTP_400_BAD_REQUEST)

    frontend_base = _print_text(request.data, "frontend_url", settings.FRONTEND_PUBLIC_URL).rstrip("/")
    if not frontend_base or "localhost" in frontend_base or "127.0.0.1" in frontend_base:
        frontend_base = settings.FRONTEND_PUBLIC_URL.rstrip("/")
    scan_url = f"{frontend_base}/?{urlencode({'pressDashboard': press_key})}"
    speed = _print_text(request.data, "speed", getattr(printer_press, "printer_speed", "") or "5")
    darkness = _print_text(request.data, "darkness", getattr(printer_press, "printer_darkness", "") or "20")
    copies = _positive_int(request.data.get("copies"), 1)
    queue_key = _firebase_safe_key(
        getattr(printer_press, "printer_queue_key", "")
        or getattr(printer_press, "name", "")
        or printer_ip
    )
    zpl = _press_dashboard_label_zpl(
        press_key,
        press_name,
        scan_url,
        speed=speed,
        darkness=darkness,
        copies=copies,
    )
    payload = {
        "TYPE": "SKID_LABEL_4X3",
        "Label Purpose": "PRESS_DASHBOARD_QR_4X3",
        "Printer": printer_ip,
        "Printer Port": _positive_int(request.data.get("printer_port") or getattr(printer_press, "printer_port", None), 9100),
        "SPEED": speed,
        "DARKNESS": darkness,
        "Total Ship Stock": copies,
        "Press": press_name,
        "Press Key": press_key,
        "Dashboard URL": scan_url,
        "Queue Key": queue_key,
        "Queued By": _print_text(request.data, "performed_by", admin_user.name or admin_user.username),
        "Queued At": timezone.now().isoformat(),
        "ZPL": zpl,
    }

    try:
        firebase_status, firebase_payload = _firebase_post_json(
            FIREBASE_PRINT_QUEUE_BASE,
            [FIREBASE_PRINT_QUEUE_ROOT, FIREBASE_PRINT_QUEUE_NAME],
            payload,
        )
    except HTTPError as error:
        return Response(
            {"detail": "Firebase rejected the press dashboard QR label.", "firebase_status": error.code},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    except URLError as error:
        return Response(
            {"detail": "Could not reach Firebase to queue the press dashboard QR label.", "error": str(error.reason)},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    firebase_key = str(firebase_payload.get("name") or "")
    return Response({
        "ok": True,
        "press": press_name,
        "pressKey": press_key,
        "dashboardUrl": scan_url,
        "queueKey": queue_key,
        "firebaseKey": firebase_key,
        "firebaseStatus": firebase_status,
        "firebasePath": (
            f"/{FIREBASE_PRINT_QUEUE_ROOT}/{FIREBASE_PRINT_QUEUE_NAME}/{firebase_key}"
            if firebase_key
            else f"/{FIREBASE_PRINT_QUEUE_ROOT}/{FIREBASE_PRINT_QUEUE_NAME}"
        ),
        "printerIp": printer_ip,
        "printerPort": payload.get("Printer Port"),
        "copies": copies,
    }, status=status.HTTP_201_CREATED)


@api_view(["POST", "PUT"])
@permission_classes([AllowAny])
def local_live_footage_relay(request, press, kind):
    if not _device_token_allowed(request):
        return Response({"detail": "Invalid device token."}, status=status.HTTP_403_FORBIDDEN)
    press_slug, press_key, press_name = _local_press_info(press)
    kind_key = str(kind or "").strip().lower()
    if not press_slug:
        return Response({"press": ["Enter a press key."]}, status=status.HTTP_400_BAD_REQUEST)
    if kind_key not in {"speed", "daily", "footage"}:
        return Response({"detail": "Use speed or footage for this local relay."}, status=status.HTTP_404_NOT_FOUND)

    normalized_kind = "footage" if kind_key in {"daily", "footage"} else "speed"
    expected_method = "PUT" if normalized_kind == "speed" else "POST"
    if request.method.upper() != expected_method:
        return Response({"detail": f"Use {expected_method} for this local relay."}, status=status.HTTP_405_METHOD_NOT_ALLOWED)

    timestamp = int(_relay_number(request.data.get("timestamp"), 0))
    payload = {
        "press_key": press_key,
        "press_name": press_name,
        "kind": normalized_kind,
        "device_timestamp": timestamp or None,
        "source_ip": _client_ip(request),
    }

    if normalized_kind == "speed":
        current_speed = int(round(_relay_number(request.data.get("currentSpeed", request.data.get("speed")), 0)))
        if current_speed < 0 or current_speed > 700:
            return Response({"currentSpeed": ["Speed must be between 0 and 700 FPM."]}, status=status.HTTP_400_BAD_REQUEST)
        payload["speed_fpm"] = current_speed
    else:
        try:
            footage = Decimal(str(round(_relay_number(request.data.get("footage"), 0), 2)))
        except (InvalidOperation, ValueError):
            return Response({"footage": ["Enter valid footage."]}, status=status.HTTP_400_BAD_REQUEST)
        if footage < 0 or footage > Decimal("5000"):
            return Response({"footage": ["Footage must be between 0 and 5,000 ft."]}, status=status.HTTP_400_BAD_REQUEST)
        payload["footage"] = footage

    reading = LocalLiveFootageReading.objects.create(**payload)
    return Response({
        "ok": True,
        "saved_to": "local_database",
        "id": reading.id,
        "press": press_key,
        "kind": normalized_kind,
        "recorded_at": reading.recorded_at,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def local_live_footage_snapshot(request):
    now = timezone.now()
    shift_start, shift_end = _local_live_shift_window(now)
    shift_rows = LocalLiveFootageReading.objects.filter(recorded_at__gte=shift_start, recorded_at__lt=shift_end)
    totals = {
        row["press_key"]: Decimal(row["total"] or 0)
        for row in shift_rows.filter(kind="footage").values("press_key").annotate(
            total=Coalesce(Sum("footage"), Value(Decimal("0"), output_field=DecimalField(max_digits=12, decimal_places=2)))
        )
    }
    counts = {
        row["press_key"]: int(row["count"] or 0)
        for row in shift_rows.values("press_key").annotate(count=Count("id"))
    }

    known_keys = {info["key"]: info["name"] for info in LOCAL_LIVE_FOOTAGE_PRESSES.values()}
    for key, name in LocalLiveFootageReading.objects.values_list("press_key", "press_name").distinct():
        if key:
            known_keys.setdefault(key, name or key)
    chart = _local_live_chart_payload(shift_rows, known_keys, shift_start, shift_end, now)

    presses = []
    for press_key, press_name in sorted(known_keys.items(), key=lambda item: item[1]):
        latest_speed = LocalLiveFootageReading.objects.filter(press_key=press_key, kind="speed").order_by("-recorded_at", "-id").first()
        latest_footage = shift_rows.filter(press_key=press_key, kind="footage").order_by("-recorded_at", "-id").first()
        speed_age_seconds = None
        if latest_speed:
            speed_age_seconds = max(0, int((now - latest_speed.recorded_at).total_seconds()))
        presses.append({
            "key": press_key,
            "name": press_name,
            "speed": latest_speed.speed_fpm if latest_speed else 0,
            "speedRecordedAt": latest_speed.recorded_at if latest_speed else None,
            "speedAgeSeconds": speed_age_seconds,
            "speedStale": speed_age_seconds is None or speed_age_seconds > 120,
            "totalFootage": float(totals.get(press_key, Decimal("0"))),
            "lastFootageAt": latest_footage.recorded_at if latest_footage else None,
            "readingCount": counts.get(press_key, 0),
            "sourceIp": latest_speed.source_ip if latest_speed else None,
        })

    recent = LocalLiveFootageReadingSerializer(
        LocalLiveFootageReading.objects.all().order_by("-recorded_at", "-id")[:50],
        many=True,
    ).data

    return Response({
        "serverTime": now,
        "shiftStart": shift_start,
        "shiftEnd": shift_end,
        "shiftDate": shift_start.date(),
        "totalFootage": float(sum(totals.values(), Decimal("0"))),
        "goalFootage": float(LOCAL_LIVE_FOOTAGE_GOAL),
        "chart": chart,
        "presses": presses,
        "recent": recent,
        "readingCount": shift_rows.count(),
        "mode": "local_database_only",
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def local_live_footage_reset_shift(request):
    if not _device_token_allowed(request):
        return Response({"detail": "Invalid device token."}, status=status.HTTP_403_FORBIDDEN)
    shift_start, shift_end = _local_live_shift_window()
    deleted, _ = LocalLiveFootageReading.objects.filter(recorded_at__gte=shift_start, recorded_at__lt=shift_end).delete()
    return Response({
        "ok": True,
        "deleted": deleted,
        "shiftStart": shift_start,
        "shiftEnd": shift_end,
    })


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
    queryset = Customer.objects.prefetch_related("contacts", "addresses").all().order_by("name")
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
        "account_owner",
        "crm_stage",
        "website",
        "notes",
    ]
    ordering_fields = ["name", "customer_code", "is_active", "crm_stage", "account_owner", "next_follow_up", "last_contacted_at"]


class CustomerInteractionViewSet(BaseProductionViewSet):
    queryset = (
        CustomerInteraction.objects.select_related("customer", "customer_order", "job_ticket", "quote", "customer_contact", "customer_address")
        .prefetch_related("related_job_tickets", "related_quotes", "history_entries")
        .all()
        .order_by("-pinned", "-occurred_at", "-id")
    )
    serializer_class = CustomerInteractionSerializer
    search_fields = [
        "customer__name",
        "customer__customer_code",
        "subject",
        "body",
        "email_subject",
        "email_from",
        "email_to",
        "created_by",
        "customer_order__order_number",
        "job_ticket__ticket_number",
        "job_ticket__job_name",
        "related_job_tickets__ticket_number",
        "related_job_tickets__job_name",
        "quote__quote_number",
        "related_quotes__quote_number",
        "contact_first_name",
        "contact_last_name",
        "contact_role",
        "contact_email",
        "contact_phone",
        "contact_company",
        "address_line_1",
        "city",
        "state",
        "postal_code",
    ]
    ordering_fields = ["occurred_at", "follow_up_date", "created_at", "updated_at", "status", "interaction_type", "pinned"]

    def get_queryset(self):
        qs = super().get_queryset()
        customer = self.request.query_params.get("customer")
        customer_order = self.request.query_params.get("customer_order")
        job_ticket = self.request.query_params.get("job_ticket")
        quote = self.request.query_params.get("quote")
        interaction_type = self.request.query_params.get("interaction_type")
        status_value = self.request.query_params.get("status")
        open_only = self.request.query_params.get("open")
        if customer:
            qs = qs.filter(customer_id=customer)
        if customer_order:
            qs = qs.filter(customer_order_id=customer_order)
        if job_ticket:
            qs = qs.filter(Q(job_ticket_id=job_ticket) | Q(related_job_tickets__id=job_ticket))
        if quote:
            quote_value = str(quote).strip()
            quote_filter = Q(quote__external_id=quote_value) | Q(related_quotes__external_id=quote_value)
            if quote_value.isdigit():
                quote_filter |= Q(quote_id=quote_value) | Q(related_quotes__id=quote_value)
            qs = qs.filter(quote_filter)
        if interaction_type:
            qs = qs.filter(interaction_type=interaction_type)
        if status_value:
            qs = qs.filter(status=status_value)
        if str(open_only).lower() in {"1", "true", "yes"}:
            qs = qs.exclude(status="closed")
        return qs.distinct()

    def history_actor(self, serializer):
        request_data = getattr(self.request, "data", {}) or {}
        request_user = company_user_from_request(self.request)
        return (
            request_data.get("updated_by")
            or request_data.get("created_by")
            or getattr(request_user, "name", "")
            or getattr(request_user, "username", "")
            or "system"
        )

    def history_summary(self, default):
        request_data = getattr(self.request, "data", {}) or {}
        return str(request_data.get("action_summary") or request_data.get("actionSummary") or default).strip()

    def clean_text(self, value):
        return str(value or "").strip()

    def split_name(self, value):
        parts = self.clean_text(value).split()
        return {
            "first_name": parts[0] if parts else "",
            "last_name": " ".join(parts[1:]) if len(parts) > 1 else "",
        }

    def customer_primary_contact_payload(self, customer):
        name = self.split_name(customer.contact_name)
        return {
            **name,
            "role": "",
            "email": self.clean_text(customer.email),
            "phone": self.clean_text(customer.phone),
            "company": self.clean_text(customer.name),
        }

    def has_contact_identity(self, payload):
        return any(payload.get(field) for field in ["first_name", "last_name", "email", "phone"])

    def interaction_contact_payload(self, interaction):
        selected = interaction.customer_contact
        payload = {
            "first_name": self.clean_text(interaction.contact_first_name),
            "last_name": self.clean_text(interaction.contact_last_name),
            "role": self.clean_text(interaction.contact_role),
            "email": self.clean_text(interaction.contact_email or interaction.email_to),
            "phone": self.clean_text(interaction.contact_phone),
            "company": self.clean_text(interaction.contact_company or interaction.customer.name),
        }
        if any(payload.values()):
            return payload
        if selected:
            return {
                "first_name": selected.first_name,
                "last_name": selected.last_name,
                "role": selected.role,
                "email": selected.email,
                "phone": selected.phone,
                "company": selected.company,
            }
        return self.customer_primary_contact_payload(interaction.customer)

    def ensure_primary_contact(self, customer):
        existing_primary = customer.contacts.filter(is_primary=True).first()
        if existing_primary:
            return existing_primary
        payload = self.customer_primary_contact_payload(customer)
        if not self.has_contact_identity(payload):
            return None
        contact = self.find_matching_contact(customer, payload)
        if contact:
            if not contact.is_primary:
                contact.is_primary = True
                contact.save(update_fields=["is_primary", "updated_at"])
            return contact
        return CustomerContact.objects.create(customer=customer, is_primary=True, **payload)

    def find_matching_contact(self, customer, payload):
        email = payload.get("email")
        phone = payload.get("phone")
        first_name = payload.get("first_name")
        last_name = payload.get("last_name")
        if email:
            match = customer.contacts.filter(email__iexact=email).first()
            if match:
                return match
        if phone:
            match = customer.contacts.filter(phone__iexact=phone).first()
            if match:
                return match
        if first_name or last_name:
            match = customer.contacts.filter(first_name__iexact=first_name, last_name__iexact=last_name).first()
            if match:
                return match
        return None

    def fill_contact_blanks(self, contact, payload):
        changed = []
        for field in ["first_name", "last_name", "role", "email", "phone", "company"]:
            if payload.get(field) and not getattr(contact, field):
                setattr(contact, field, payload[field])
                changed.append(field)
        if changed:
            contact.save(update_fields=[*changed, "updated_at"])

    def fill_customer_primary_contact_blanks(self, customer, contact):
        updates = {}
        contact_name = " ".join([contact.first_name, contact.last_name]).strip()
        if contact_name and not customer.contact_name:
            updates["contact_name"] = contact_name
        if contact.email and not customer.email:
            updates["email"] = contact.email
        if contact.phone and not customer.phone:
            updates["phone"] = contact.phone
        if updates:
            Customer.objects.filter(pk=customer.pk).update(**updates)
            for field, value in updates.items():
                setattr(customer, field, value)

    def customer_primary_address_payload(self, customer):
        return {
            "label": "Primary",
            "address_line_1": self.clean_text(customer.address_line_1),
            "address_line_2": self.clean_text(customer.address_line_2),
            "address_line_3": self.clean_text(customer.address_line_3),
            "city": self.clean_text(customer.city),
            "state": self.clean_text(customer.state),
            "postal_code": self.clean_text(customer.postal_code),
            "country": self.clean_text(customer.country),
        }

    def interaction_address_payload(self, interaction):
        selected = interaction.customer_address
        payload = {
            "label": self.clean_text(interaction.address_label),
            "address_line_1": self.clean_text(interaction.address_line_1),
            "address_line_2": self.clean_text(interaction.address_line_2),
            "address_line_3": self.clean_text(interaction.address_line_3),
            "city": self.clean_text(interaction.city),
            "state": self.clean_text(interaction.state),
            "postal_code": self.clean_text(interaction.postal_code),
            "country": self.clean_text(interaction.country),
        }
        if any(value for key, value in payload.items() if key != "label"):
            return payload
        if selected:
            return {
                "label": selected.label,
                "address_line_1": selected.address_line_1,
                "address_line_2": selected.address_line_2,
                "address_line_3": selected.address_line_3,
                "city": selected.city,
                "state": selected.state,
                "postal_code": selected.postal_code,
                "country": selected.country,
            }
        return self.customer_primary_address_payload(interaction.customer)

    def ensure_primary_address(self, customer):
        existing_primary = customer.addresses.filter(is_primary=True).first()
        if existing_primary:
            return existing_primary
        payload = self.customer_primary_address_payload(customer)
        if not any(value for key, value in payload.items() if key != "label"):
            return None
        address = self.find_matching_address(customer, payload)
        if address:
            if not address.is_primary:
                address.is_primary = True
                address.save(update_fields=["is_primary", "updated_at"])
            return address
        return CustomerAddress.objects.create(customer=customer, is_primary=True, **payload)

    def address_key(self, address_or_payload):
        getter = address_or_payload.get if isinstance(address_or_payload, dict) else lambda key: getattr(address_or_payload, key)
        fields = ["address_line_1", "address_line_2", "address_line_3", "city", "state", "postal_code", "country"]
        return tuple(self.clean_text(getter(field)).lower() for field in fields)

    def find_matching_address(self, customer, payload):
        payload_key = self.address_key(payload)
        if not any(payload_key):
            return None
        for address in customer.addresses.all():
            if self.address_key(address) == payload_key:
                return address
        return None

    def fill_address_blanks(self, address, payload):
        changed = []
        for field in ["label", "address_line_1", "address_line_2", "address_line_3", "city", "state", "postal_code", "country"]:
            if payload.get(field) and not getattr(address, field):
                setattr(address, field, payload[field])
                changed.append(field)
        if changed:
            address.save(update_fields=[*changed, "updated_at"])

    def fill_customer_primary_address_blanks(self, customer, address):
        updates = {}
        for field in ["address_line_1", "address_line_2", "address_line_3", "city", "state", "postal_code", "country"]:
            if getattr(address, field) and not getattr(customer, field):
                updates[field] = getattr(address, field)
        if updates:
            Customer.objects.filter(pk=customer.pk).update(**updates)
            for field, value in updates.items():
                setattr(customer, field, value)

    def sync_customer_records(self, interaction):
        customer = interaction.customer
        if not customer:
            return interaction

        self.ensure_primary_contact(customer)
        contact_payload = self.interaction_contact_payload(interaction)
        contact = interaction.customer_contact
        if contact and contact.customer_id != customer.pk:
            contact = None
        if not contact and self.has_contact_identity(contact_payload):
            contact = self.find_matching_contact(customer, contact_payload)
        if not contact and self.has_contact_identity(contact_payload):
            contact = CustomerContact.objects.create(
                customer=customer,
                is_primary=not customer.contacts.filter(is_primary=True).exists(),
                created_from_interaction=interaction,
                **contact_payload,
            )
        if contact:
            self.fill_contact_blanks(contact, contact_payload)
            self.fill_customer_primary_contact_blanks(customer, contact)
            if interaction.customer_contact_id != contact.pk:
                CustomerInteraction.objects.filter(pk=interaction.pk).update(customer_contact=contact)
                interaction.customer_contact = contact
                interaction.customer_contact_id = contact.pk

        self.ensure_primary_address(customer)
        address_payload = self.interaction_address_payload(interaction)
        address = interaction.customer_address
        if address and address.customer_id != customer.pk:
            address = None
        if not address and any(value for key, value in address_payload.items() if key != "label"):
            address = self.find_matching_address(customer, address_payload)
        if not address and any(value for key, value in address_payload.items() if key != "label"):
            address = CustomerAddress.objects.create(
                customer=customer,
                is_primary=not customer.addresses.filter(is_primary=True).exists(),
                created_from_interaction=interaction,
                **address_payload,
            )
        if address:
            self.fill_address_blanks(address, address_payload)
            self.fill_customer_primary_address_blanks(customer, address)
            if interaction.customer_address_id != address.pk:
                CustomerInteraction.objects.filter(pk=interaction.pk).update(customer_address=address)
                interaction.customer_address = address
                interaction.customer_address_id = address.pk
        return interaction

    def interaction_snapshot(self, interaction):
        date_value = lambda value: value.isoformat() if value else ""
        return {
            "subject": interaction.subject,
            "status": interaction.status,
            "interaction_type": interaction.interaction_type,
            "follow_up_date": date_value(interaction.follow_up_date),
            "occurred_at": date_value(interaction.occurred_at),
            "pinned": interaction.pinned,
            "customer_contact": interaction.customer_contact_id,
            "customer_address": interaction.customer_address_id,
            "contact_matches_customer": interaction.contact_matches_customer,
            "contact_first_name": interaction.contact_first_name,
            "contact_last_name": interaction.contact_last_name,
            "contact_role": interaction.contact_role,
            "contact_email": interaction.contact_email,
            "contact_phone": interaction.contact_phone,
            "contact_company": interaction.contact_company,
            "address_matches_customer": interaction.address_matches_customer,
            "address_label": interaction.address_label,
            "address_line_1": interaction.address_line_1,
            "address_line_2": interaction.address_line_2,
            "address_line_3": interaction.address_line_3,
            "city": interaction.city,
            "state": interaction.state,
            "postal_code": interaction.postal_code,
            "country": interaction.country,
            "body": interaction.body,
            "job_ticket": interaction.job_ticket_id,
            "quote": interaction.quote_id,
            "related_job_tickets": list(interaction.related_job_tickets.values_list("id", flat=True)),
            "related_quotes": list(interaction.related_quotes.values_list("external_id", flat=True)),
        }

    def snapshot_changes(self, before, after):
        return {
            key: {"from": before.get(key), "to": after.get(key)}
            for key in after
            if before.get(key) != after.get(key)
        }

    def perform_create(self, serializer):
        interaction = self.sync_customer_records(serializer.save())
        CustomerInteractionHistory.objects.create(
            interaction=interaction,
            action="created",
            summary=self.history_summary("created follow-up"),
            performed_by=self.history_actor(serializer),
        )

    def perform_update(self, serializer):
        before = self.interaction_snapshot(serializer.instance)
        interaction = self.sync_customer_records(serializer.save())
        after = self.interaction_snapshot(interaction)
        CustomerInteractionHistory.objects.create(
            interaction=interaction,
            action="updated",
            summary=self.history_summary("updated follow-up"),
            performed_by=self.history_actor(serializer),
            changes=self.snapshot_changes(before, after),
        )


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

    @action(detail=True, methods=["post"], url_path="queue-print-label")
    def queue_print_label(self, request, pk=None):
        ticket = self.get_object()
        press = None
        press_id = request.data.get("press")
        if press_id:
            press = Press.objects.filter(pk=press_id).first()
            if not press:
                return Response({"press": ["Selected press was not found."]}, status=status.HTTP_400_BAD_REQUEST)

        payload = _job_ticket_carton_payload(ticket, request.data, press)
        printer_ip = str(payload.get("Printer") or "").strip()
        if not printer_ip:
            return Response({"printer": ["Select a press with a printer IP, or enter a printer IP before queueing."]}, status=status.HTTP_400_BAD_REQUEST)

        queue_key = _firebase_safe_key(
            request.data.get("queue_key")
            or getattr(press, "printer_queue_key", "")
            or getattr(press, "name", "")
            or printer_ip
        )
        payload["Queue Key"] = queue_key
        payload["Queued By"] = self.history_actor()

        try:
            firebase_status, firebase_payload = _firebase_post_json(
                FIREBASE_PRINT_QUEUE_BASE,
                [FIREBASE_PRINT_QUEUE_ROOT, FIREBASE_PRINT_QUEUE_NAME],
                payload,
            )
        except HTTPError as error:
            return Response(
                {"detail": "Firebase rejected the print job.", "firebase_status": error.code},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except URLError as error:
            return Response(
                {"detail": "Could not reach Firebase to queue the print job.", "error": str(error.reason)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        printer_settings_saved = False
        if press and _request_bool(request.data.get("save_printer_settings")):
            press.printer_ip = printer_ip
            press.printer_port = payload.get("Printer Port") or 9100
            press.printer_speed = str(payload.get("SPEED") or "5")
            press.printer_darkness = str(payload.get("DARKNESS") or "11")
            press.save(update_fields=["printer_ip", "printer_port", "printer_speed", "printer_darkness"])
            printer_settings_saved = True

        firebase_key = str(firebase_payload.get("name") or "")
        self.create_ticket_event(
            ticket,
            "print_queued",
            f"{payload.get('Queued By') or 'system'} queued a {payload.get('TYPE', 'label')} label for {queue_key}.",
            payload.get("Queued By"),
            extra_details={
                "queue_key": queue_key,
                "firebase_key": firebase_key,
                "template": payload.get("TYPE"),
                "printer_ip": printer_ip,
                "printer_port": payload.get("Printer Port"),
                "source": "job_ticket_print_label",
            },
        )
        return Response({
            "ok": True,
            "queueKey": queue_key,
            "firebaseKey": firebase_key,
            "firebaseStatus": firebase_status,
            "firebasePath": (
                f"/{FIREBASE_PRINT_QUEUE_ROOT}/{FIREBASE_PRINT_QUEUE_NAME}/{firebase_key}"
                if firebase_key
                else f"/{FIREBASE_PRINT_QUEUE_ROOT}/{FIREBASE_PRINT_QUEUE_NAME}"
            ),
            "printerIp": printer_ip,
            "printerPort": payload.get("Printer Port"),
            "printerSettingsSaved": printer_settings_saved,
            "template": payload.get("TYPE"),
        }, status=status.HTTP_201_CREATED)

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
        previous_artwork = {
            "storage_name": previous_storage_name,
            "file_name": previous_file_name,
            "url": "",
            "name": previous_name,
            "description": previous_description,
        }
        change_description = str(request.data.get("change_description") or "").strip()

        if request.method == "DELETE":
            if previous_file_name or previous_name or previous_description or (slot == "general" and ticket.external_image_url):
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
                upload = validate_upload(upload, allow_images=True, field="image")
            except serializers.ValidationError as error:
                return Response(error.detail, status=status.HTTP_400_BAD_REQUEST)
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
                            "url": "",
                            "name": new_name,
                            "description": new_description,
                        },
                        "change_description": change_description,
                    },
                },
            )
        return Response(self.get_serializer(ticket).data)

    @action(detail=True, methods=["get"], url_path=r"images/(?P<slot>general|spec|finishing)/preview")
    def image_preview(self, request, pk=None, slot=None):
        ticket = self.get_object()
        if slot not in self.image_slots:
            return Response({"error": "Unknown image slot."}, status=status.HTTP_400_BAD_REQUEST)
        if not request_user_has_resource_access(request, "job-ticket-images"):
            return resource_access_denied_response(request, "You do not have access to job ticket images.")

        image = getattr(ticket, f"{slot}_image")
        if not image:
            return Response({"error": "No image uploaded for this slot."}, status=status.HTTP_404_NOT_FOUND)

        return private_file_response(
            image,
            display_name=getattr(ticket, f"{slot}_image_name", ""),
            fallback_name=f"{slot}-image",
        )


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
        .prefetch_related("shift_reports", "material_assignments")
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


class ProductionMaterialAssignmentViewSet(BaseProductionViewSet):
    serializer_class = ProductionMaterialAssignmentSerializer
    search_fields = [
        "inventory__serial_number",
        "inventory__lot_number",
        "inventory__source_roll_tag__tag_number",
        "inventory__material__name",
        "inventory__material__code",
        "inventory__supplier__name",
        "carton_lot_code",
        "assigned_by",
        "quality_note",
        "notes",
        "production_schedule__job_ticket__ticket_number",
        "production_schedule__job_ticket__job_name",
    ]
    ordering_fields = ["assigned_at", "ended_at", "status", "source_type"]

    def get_queryset(self):
        usage_total = (
            MaterialUsage.objects.filter(
                production_schedule_id=OuterRef("production_schedule_id"),
                inventory_id=OuterRef("inventory_id"),
                usage_type__in=["finished", "scrap"],
            )
            .values("production_schedule_id", "inventory_id")
            .annotate(total=Sum("quantity"))
            .values("total")[:1]
        )
        queryset = (
            ProductionMaterialAssignment.objects.select_related(
                "production_schedule",
                "production_schedule__job_ticket",
                "inventory",
                "inventory__material",
                "inventory__material__master_type",
                "inventory__supplier",
                "inventory__location",
                "inventory__source_roll_tag",
            )
            .annotate(
                used_footage_total=Coalesce(
                    Subquery(usage_total),
                    Value(Decimal("0"), output_field=DecimalField(max_digits=12, decimal_places=3)),
                )
            )
            .all()
            .order_by("-assigned_at", "-id")
        )
        schedule = self.request.query_params.get("production_schedule")
        inventory = self.request.query_params.get("inventory")
        assignment_status = self.request.query_params.get("status")
        if schedule:
            queryset = queryset.filter(production_schedule_id=schedule)
        if inventory:
            queryset = queryset.filter(inventory_id=inventory)
        if assignment_status:
            queryset = queryset.filter(status=assignment_status)
        return queryset

    def perform_create(self, serializer):
        schedule = serializer.validated_data["production_schedule"]
        inventory = serializer.validated_data["inventory"]
        existing = ProductionMaterialAssignment.objects.filter(
            production_schedule=schedule,
            inventory=inventory,
            status="active",
        ).first()
        if existing:
            raise serializers.ValidationError({"inventory": "This roll is already active on this scheduled order."})
        assignment = serializer.save()
        if schedule.status in ["unscheduled", "scheduled", "ready"]:
            schedule.status = "running"
            schedule.last_updated_by = assignment.assigned_by or schedule.last_updated_by
            schedule.save()

    @action(detail=False, methods=["get"], url_path="scan-roll")
    def scan_roll(self, request):
        schedule_id = request.query_params.get("production_schedule")
        scan = str(request.query_params.get("scan") or "").strip()
        if not schedule_id or not scan:
            return Response(
                {"detail": "A scheduled order and scanned roll code are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        schedule = ProductionSchedule.objects.select_related(
            "job_ticket",
            "job_ticket__material_spec",
            "job_ticket__material_master_type",
        ).filter(pk=schedule_id).first()
        if not schedule:
            return Response({"detail": "Scheduled order not found."}, status=status.HTTP_404_NOT_FOUND)

        inventory = RawMaterialInventory.objects.select_related(
            "material",
            "material__master_type",
            "supplier",
            "location",
            "source_roll_tag",
        ).filter(
            Q(serial_number__iexact=scan)
            | Q(lot_number__iexact=scan)
            | Q(source_roll_tag__tag_number__iexact=scan)
        ).first()
        if not inventory:
            return Response({"detail": "No roll matched that barcode or lot number."}, status=status.HTTP_404_NOT_FOUND)

        required_master = schedule.job_ticket.material_master_type_id or (
            schedule.job_ticket.material_spec.master_type_id
            if schedule.job_ticket.material_spec_id and schedule.job_ticket.material_spec
            else None
        )
        actual_master = inventory.material.master_type_id if inventory.material_id and inventory.material else None
        if required_master and actual_master != required_master:
            return Response(
                {
                    "detail": "That roll is not compatible with this job.",
                    "required_material": schedule.job_ticket.material_master_type.code
                    if schedule.job_ticket.material_master_type_id
                    else schedule.job_ticket.material_spec.master_type.code,
                    "scanned_material": inventory.material.master_type.code if actual_master else "",
                },
                status=status.HTTP_409_CONFLICT,
            )
        if not inventory.source_roll_tag_id:
            return Response(
                {"detail": "This is purchased material. Select it from the Purchased Roll list and enter the 5-digit carton lot number."},
                status=status.HTTP_409_CONFLICT,
            )
        if not inventory.is_active or inventory.status in ["depleted", "scrapped", "on_hold"]:
            return Response({"detail": "This roll is not active production inventory."}, status=status.HTTP_409_CONFLICT)

        existing = ProductionMaterialAssignment.objects.filter(
            production_schedule=schedule,
            inventory=inventory,
            status="active",
        ).first()
        return Response({
            "inventory": RawMaterialInventorySerializer(inventory).data,
            "already_assigned": ProductionMaterialAssignmentSerializer(existing).data if existing else None,
        })

    @action(detail=True, methods=["post"], url_path="record-usage")
    def record_usage(self, request, pk=None):
        try:
            with transaction.atomic():
                assignment = (
                    ProductionMaterialAssignment.objects.select_for_update()
                    .select_related("production_schedule", "production_schedule__job_ticket", "inventory")
                    .get(pk=pk)
                )
                inventory = RawMaterialInventory.objects.select_for_update().get(pk=assignment.inventory_id)
                if assignment.status != "active":
                    return Response({"detail": "This roll assignment is no longer active."}, status=status.HTTP_409_CONFLICT)

                available = Decimal(inventory.length_feet if inventory.length_feet is not None else inventory.quantity or 0)
                mode = str(request.data.get("mode") or "partial").strip().lower()
                mark_bad = bool(request.data.get("mark_bad") or request.data.get("poor_run"))
                close_roll = bool(request.data.get("close_roll"))
                note = str(request.data.get("notes") or "").strip()
                if mark_bad and not note:
                    return Response({"notes": ["Describe what made the roll unrunnable."]}, status=status.HTTP_400_BAD_REQUEST)

                if mode == "full":
                    entered = available
                    deducted = available
                else:
                    try:
                        entered = Decimal(str(request.data.get("footage_used") or "0"))
                    except (InvalidOperation, ValueError):
                        return Response({"footage_used": ["Enter valid footage."]}, status=status.HTTP_400_BAD_REQUEST)
                    if entered <= 0:
                        return Response({"footage_used": ["Footage used must be greater than zero."]}, status=status.HTTP_400_BAD_REQUEST)
                    deducted = min(available, (entered * Decimal("1.03")).quantize(Decimal("0.001")))

                if available <= 0:
                    return Response({"detail": "This roll has no footage remaining."}, status=status.HTTP_409_CONFLICT)
                if entered > available:
                    return Response(
                        {"footage_used": [f"Only {available} ft remain on this roll."]},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                usage = MaterialUsage.objects.create(
                    inventory=inventory,
                    material=inventory.material,
                    usage_type="finished",
                    quantity=deducted,
                    unit="lf",
                    used_by=str(request.data.get("used_by") or assignment.assigned_by or "").strip(),
                    reference=f"Schedule {assignment.production_schedule_id} / assignment {assignment.id}",
                    job_ticket=assignment.production_schedule.job_ticket,
                    production_schedule=assignment.production_schedule,
                    notes=note,
                )
                inventory.refresh_from_db()
                remaining = Decimal(inventory.length_feet if inventory.length_feet is not None else inventory.quantity or 0)

                if mark_bad:
                    inventory.status = "on_hold"
                    inventory.save(update_fields=["status"])
                    MaterialUsage.objects.create(
                        inventory=inventory,
                        material=inventory.material,
                        usage_type="qc_issue",
                        quantity=0,
                        unit="lf",
                        used_by=usage.used_by,
                        reference=f"Schedule {assignment.production_schedule_id} / assignment {assignment.id}",
                        job_ticket=assignment.production_schedule.job_ticket,
                        production_schedule=assignment.production_schedule,
                        notes=note,
                    )
                    assignment.status = "rejected"
                    assignment.quality_note = note
                    assignment.ended_at = timezone.now()
                elif mode == "full" or remaining <= 0 or close_roll:
                    assignment.status = "complete"
                    assignment.ended_at = timezone.now()
                assignment.save()

                return Response({
                    "assignment": self.get_serializer(assignment).data,
                    "usage_id": usage.id,
                    "entered_footage": entered,
                    "buffer_footage": max(Decimal("0"), deducted - entered),
                    "deducted_footage": deducted,
                    "remaining_footage": remaining,
                    "inventory_status": inventory.status,
                })
        except ProductionMaterialAssignment.DoesNotExist:
            return Response({"detail": "Material assignment not found."}, status=status.HTTP_404_NOT_FOUND)


def sync_schedule_report_progress(schedule):
    if not schedule:
        return
    totals = schedule.shift_reports.aggregate(good=Sum("good_footage"))
    schedule.actual_footage = totals["good"] or Decimal("0")
    latest = schedule.shift_reports.order_by("-shift_end", "-id").first()
    if latest:
        schedule.status = "complete" if latest.outcome == "job_complete" else "running"
        schedule.operator = latest.operator or schedule.operator
        schedule.last_updated_by = latest.created_by or latest.operator or schedule.last_updated_by
    schedule.save()


class ProductionShiftReportViewSet(BaseProductionViewSet):
    serializer_class = ProductionShiftReportSerializer
    search_fields = [
        "operator",
        "created_by",
        "notes",
        "press__name",
        "job_ticket__ticket_number",
        "job_ticket__job_name",
        "production_schedule__customer__name",
        "production_schedule__customer_po",
        "coater_schedule__tag_number",
        "coater_schedule__name",
        "coater_schedule__result_lot_number",
        "coater_schedule__scheduled_material__name",
        "coater_schedule__produced_material__name",
    ]
    ordering_fields = [
        "report_date",
        "shift_start",
        "shift_end",
        "operator",
        "press__name",
        "total_footage",
        "good_footage",
        "material_footage",
    ]

    def get_queryset(self):
        queryset = ProductionShiftReport.objects.select_related(
            "production_schedule",
            "production_schedule__customer",
            "coater_schedule",
            "coater_schedule__scheduled_material",
            "coater_schedule__produced_material",
            "job_ticket",
            "job_ticket__customer",
            "press",
        ).all()
        date_from = parse_date(str(self.request.query_params.get("date_from") or ""))
        date_to = parse_date(str(self.request.query_params.get("date_to") or ""))
        schedule = self.request.query_params.get("production_schedule")
        coater_schedule = self.request.query_params.get("coater_schedule")
        operator = str(self.request.query_params.get("operator") or "").strip()
        press = self.request.query_params.get("press")
        if date_from:
            queryset = queryset.filter(report_date__gte=date_from)
        if date_to:
            queryset = queryset.filter(report_date__lte=date_to)
        if schedule:
            queryset = queryset.filter(production_schedule_id=schedule)
        if coater_schedule:
            queryset = queryset.filter(coater_schedule_id=coater_schedule)
        if operator:
            queryset = queryset.filter(operator__iexact=operator)
        if press:
            queryset = queryset.filter(press_id=press)
        return queryset.order_by("-report_date", "-shift_end", "-id")

    def perform_create(self, serializer):
        report = serializer.save()
        if report.production_schedule_id:
            sync_schedule_report_progress(report.production_schedule)

    def perform_update(self, serializer):
        previous_schedule_id = serializer.instance.production_schedule_id
        report = serializer.save()
        if previous_schedule_id != report.production_schedule_id:
            previous = ProductionSchedule.objects.filter(pk=previous_schedule_id).first()
            if previous:
                sync_schedule_report_progress(previous)
        if report.production_schedule_id:
            sync_schedule_report_progress(report.production_schedule)

    def perform_destroy(self, instance):
        schedule = instance.production_schedule
        instance.delete()
        if schedule:
            sync_schedule_report_progress(schedule)


class ProductionShiftSettingViewSet(BaseProductionViewSet):
    serializer_class = ProductionShiftSettingSerializer
    queryset = ProductionShiftSetting.objects.all()
    search_fields = ["name", "updated_by"]
    ordering_fields = ["name", "updated_at"]

    def list(self, request, *args, **kwargs):
        if not ProductionShiftSetting.objects.exists():
            ProductionShiftSetting.objects.create()
        return super().list(request, *args, **kwargs)


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


class LocalLiveFootageReadingViewSet(BaseProductionViewSet):
    queryset = LocalLiveFootageReading.objects.all().order_by("-recorded_at", "-id")
    serializer_class = LocalLiveFootageReadingSerializer
    search_fields = ["press_key", "press_name", "kind", "source_ip"]
    ordering_fields = ["recorded_at", "press_key", "kind", "speed_fpm", "footage", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        press = str(self.request.query_params.get("press") or "").strip()
        kind = str(self.request.query_params.get("kind") or "").strip()
        shift_start, shift_end = _local_live_shift_window()
        if press:
            qs = qs.filter(Q(press_key__iexact=press) | Q(press_name__iexact=press))
        if kind:
            qs = qs.filter(kind__iexact=kind)
        if self.request.query_params.get("current_shift"):
            qs = qs.filter(recorded_at__gte=shift_start, recorded_at__lt=shift_end)
        return qs


class FinishedInventoryViewSet(BaseProductionViewSet):
    serializer_class = FinishedInventorySerializer
    inactive_statuses = ["shipped", "scrapped", "moved"]
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

    def finished_item_key(self, inventory):
        if inventory.job_ticket_id:
            item_id = f"job:{inventory.job_ticket_id}"
        elif inventory.sku:
            item_id = f"sku:{str(inventory.sku).strip().lower()}"
        else:
            item_id = f"name:{str(inventory.name).strip().lower()}"
        return (
            item_id,
            str(inventory.unit or "").strip().lower(),
            str(inventory.face_type or "").strip().lower(),
            str(inventory.liner_type or "").strip().lower(),
            str(inventory.recipe_id or ""),
            str(inventory.recipe_option_id or ""),
        )

    def matching_finished_items(self, inventory, location):
        qs = (
            FinishedInventory.objects.select_for_update()
            .filter(location=location, quantity__gt=0, unit=inventory.unit)
            .exclude(pk=inventory.pk)
            .exclude(status__in=self.inactive_statuses)
            .order_by("-run_date", "name", "id")
        )
        if inventory.job_ticket_id:
            qs = qs.filter(job_ticket_id=inventory.job_ticket_id)
        elif inventory.sku:
            qs = qs.filter(sku__iexact=str(inventory.sku).strip())
        else:
            qs = qs.filter(name__iexact=str(inventory.name).strip())

        if inventory.face_type:
            qs = qs.filter(face_type__iexact=str(inventory.face_type).strip())
        else:
            qs = qs.filter(face_type="")
        if inventory.liner_type:
            qs = qs.filter(liner_type__iexact=str(inventory.liner_type).strip())
        else:
            qs = qs.filter(liner_type="")
        if inventory.recipe_id:
            qs = qs.filter(recipe_id=inventory.recipe_id)
        else:
            qs = qs.filter(recipe__isnull=True)
        if inventory.recipe_option_id:
            qs = qs.filter(recipe_option_id=inventory.recipe_option_id)
        else:
            qs = qs.filter(recipe_option__isnull=True)
        return qs

    def location_is_mixed(self, location):
        rows = FinishedInventory.objects.filter(location=location, quantity__gt=0).exclude(status__in=self.inactive_statuses)
        keys = {self.finished_item_key(row) for row in rows}
        return len(keys) > 1

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

    @action(detail=True, methods=["post"], url_path="move-item")
    def move_item(self, request, pk=None):
        inventory = self.get_object()
        raw_quantity = request.data.get("quantity")
        location_id = request.data.get("location") or request.data.get("location_id")

        if raw_quantity in ["", None]:
            return Response({"quantity": ["Enter the quantity to move."]}, status=status.HTTP_400_BAD_REQUEST)
        if not location_id:
            return Response({"location": ["Choose the destination location."]}, status=status.HTTP_400_BAD_REQUEST)

        try:
            quantity = Decimal(str(raw_quantity))
        except (InvalidOperation, ValueError):
            return Response({"quantity": ["Enter a valid quantity."]}, status=status.HTTP_400_BAD_REQUEST)

        if quantity <= 0:
            return Response({"quantity": ["Quantity must be greater than zero."]}, status=status.HTTP_400_BAD_REQUEST)

        location = ToolingLocation.objects.filter(pk=location_id).first()
        if not location:
            return Response({"location": ["Destination location was not found."]}, status=status.HTTP_404_NOT_FOUND)
        if location.inventory_scope == "raw_material":
            return Response({"location": ["Choose a Finished Product or Shared location."]}, status=status.HTTP_400_BAD_REQUEST)

        moved_date = parse_date(str(request.data.get("moved_date") or request.data.get("move_date") or "")) or timezone.localdate()
        moved_by = str(request.data.get("moved_by") or request.data.get("used_by") or "").strip()
        notes = str(request.data.get("notes") or "").strip()
        destination_label = location.full_path()
        source_label = inventory.location.full_path() if inventory.location_id else "No location"

        with transaction.atomic():
            inventory = (
                FinishedInventory.objects.select_for_update()
                .select_related("job_ticket", "customer_order", "material_inventory", "recipe", "recipe_option", "location")
                .get(pk=inventory.pk)
            )
            available = Decimal(inventory.quantity or 0)
            if inventory.status in self.inactive_statuses or available <= 0:
                return Response({"detail": "This finished item is not available to move."}, status=status.HTTP_409_CONFLICT)
            if quantity > available:
                return Response(
                    {"quantity": [f"Only {available} {inventory.unit or 'units'} are available."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            target = self.matching_finished_items(inventory, location).first()
            if not target and inventory.location_id == location.id:
                return Response({"location": ["This item is already in that location."]}, status=status.HTTP_400_BAD_REQUEST)

            remaining = max(Decimal("0"), available - quantity)
            created_destination = False
            merged = False

            if target:
                target.quantity = Decimal(target.quantity or 0) + quantity
                if target.status == "moved":
                    target.status = "available"
                target._skip_material_usage_sync = True
                target.save(update_fields=["quantity", "status", "updated_at"])
                destination = target
                merged = True
            elif remaining == 0:
                inventory.location = location
                if inventory.status == "moved":
                    inventory.status = "available"
                inventory._skip_material_usage_sync = True
                inventory.save(update_fields=["location", "status", "updated_at"])
                destination = inventory
            else:
                destination = FinishedInventory(
                    name=inventory.name,
                    sku=inventory.sku,
                    job_ticket=inventory.job_ticket,
                    customer_order=inventory.customer_order,
                    order_number=inventory.order_number,
                    material_inventory=inventory.material_inventory,
                    recipe=inventory.recipe,
                    recipe_option=inventory.recipe_option,
                    location=location,
                    material_width_inches=inventory.material_width_inches,
                    material_length_feet=inventory.material_length_feet,
                    face_type=inventory.face_type,
                    liner_type=inventory.liner_type,
                    liner_serial_number=inventory.liner_serial_number,
                    face_serial_number=inventory.face_serial_number,
                    quantity=quantity,
                    unit=inventory.unit,
                    status=inventory.status,
                    operator=inventory.operator,
                    suboperator=inventory.suboperator,
                    run_date=inventory.run_date,
                    notes=inventory.notes,
                )
                destination._skip_material_usage_sync = True
                destination.save()
                created_destination = True

            if destination.pk != inventory.pk:
                inventory.quantity = remaining
                if remaining <= 0:
                    inventory.status = "moved"
                elif inventory.status == "moved":
                    inventory.status = "available"
                inventory._skip_material_usage_sync = True
                inventory.save(update_fields=["quantity", "status", "updated_at"])

            MaterialUsage.objects.create(
                finished_inventory=destination,
                usage_type="adjustment",
                quantity=quantity,
                unit=inventory.unit or "each",
                used_date=moved_date,
                used_by=moved_by,
                reference=f"Moved from {source_label}",
                notes=notes or f"Moved {quantity} {inventory.unit or 'units'} from {source_label} to {destination_label}.",
            )

        source = (
            FinishedInventory.objects.select_related("job_ticket", "customer_order", "material_inventory", "recipe", "recipe_option", "location")
            .filter(pk=inventory.pk)
            .first()
        )
        destination = (
            FinishedInventory.objects.select_related("job_ticket", "customer_order", "material_inventory", "recipe", "recipe_option", "location")
            .get(pk=destination.pk)
        )
        mixed = self.location_is_mixed(location)
        if merged:
            completed = f"{inventory.name} moved to {destination_label} and added to the matching item."
        elif mixed:
            completed = f"{inventory.name} moved to {destination_label}. This location is now a mixed skid."
        else:
            completed = f"{inventory.name} moved to {destination_label}."

        return Response({
            "source": self.get_serializer(source).data if source else None,
            "destination": self.get_serializer(destination).data,
            "merged": merged,
            "created_destination": created_destination,
            "mixed": mixed,
            "completed": completed,
        })
