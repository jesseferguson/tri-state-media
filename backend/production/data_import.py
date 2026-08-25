import csv
import io
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from materials.models import (
    MaterialMasterType,
    MaterialSpec,
    MaterialUsage,
    RawMaterialInventory as MaterialInventory,
)
from tooling.models import FlexDie, PrintPlate, PrintStation, Supplier, ToolingHistory, ToolingLocation, ToolingRecipe

from .models import (
    BoxSpec,
    CoreSpec,
    Customer,
    CustomerOrder,
    CustomerOrderEvent,
    FinishedInventory,
    JobTicket,
    JobTicketEvent,
    JobTicketUsage,
    ProductionSchedule,
    QuoteRecord,
)
from users.auth import request_user_is_admin

MAX_IMPORT_MESSAGES = 250


def admin_required_response(request):
    if settings.API_AUTH_REQUIRED and not request_user_is_admin(request):
        return Response({"detail": "Only an active Admin user can import or flush data."}, status=status.HTTP_403_FORBIDDEN)
    return None


JOB_TICKET_COLUMNS = [
    "row_id",
    "ticket_number",
    "tsm_id",
    "customer_name",
    "customer_code",
    "job_number",
    "description",
    "image_url",
    "label_width",
    "label_length",
    "repeat",
    "gap",
    "cutting_type",
    "face_type",
    "liner_type",
    "master_type_code",
    "finished_material_code",
    "recipe_name",
    "finishing_type",
    "unit_type",
    "labels_per_unit",
    "units_per_carton",
    "box_item_number",
    "box_link",
    "core_link",
    "core_size",
    "wind",
    "fanfold_gear",
    "labels_per_fold",
    "ribbon",
    "laminate",
    "bagged",
    "carton_label_part_number",
    "carton_label_description_a",
    "carton_label_description_b",
    "carton_label_description_c",
    "carton_label_finishing_1",
    "carton_label_finishing_2",
    "job_notes",
]

FLEX_DIE_COLUMNS = [
    "row_id",
    "name",
    "original_serial_number",
    "serial_numbers",
    "label_width",
    "label_length",
    "repeat",
    "gap_across",
    "gap_around",
    "gear",
    "number_across",
    "number_around",
    "face_type",
    "liner_type",
    "shape_type",
    "cutting_type",
    "active_die_count",
    "target_die_count",
    "status",
    "supplier_name",
    "location_code",
    "location_name",
    "manual_web_width",
    "web_width",
    "tooling_kind",
    "last_order_price",
    "last_quote_price",
    "last_quote_supplier",
    "last_ordered_date",
    "procurement_notes",
]

INVENTORY_COLUMNS = [
    "row_id",
    "serial_number",
    "lot_number",
    "name",
    "material_code",
    "material_type",
    "master_type_code",
    "width_inches",
    "length_feet",
    "weight_lbs",
    "quantity",
    "unit",
    "status",
    "received_date",
    "supplier_name",
    "location_code",
    "location_name",
    "notes",
]

USAGE_COLUMNS = [
    "row_id",
    "inventory_serial",
    "inventory_lot",
    "material_code",
    "usage_type",
    "quantity",
    "unit",
    "used_date",
    "used_by",
    "reference",
    "notes",
]

JOB_TICKET_USAGE_COLUMNS = [
    "date",
    "job_ticket_id",
    "quantity",
    "source",
    "notes",
]

FINISHED_INVENTORY_COLUMNS = [
    "row_id",
    "tsm_id",
    "part_number",
    "location",
    "quantity",
    "unit",
    "status",
    "run_date",
    "notes",
]

PRINT_PLATE_COLUMNS = [
    "row_id",
    "recipe_name",
    "plate_number",
    "customer_plate_number",
    "serial_number",
    "description",
    "number_around",
    "number_across",
    "notes",
    "is_active",
]

PRINT_STATION_COLUMNS = [
    "row_id",
    "recipe_name",
    "plate_number",
    "station_number",
    "station_plate_number",
    "print_cylinder_tooth_count",
    "anilox_gear_number",
    "pms_color",
    "color_type",
    "notes",
    "is_active",
]

IMPORT_TEMPLATES = {
    "job_tickets": {
        "label": "Job Tickets",
        "description": "Imports production job tickets. Old Glide Items exports are supported for matching fields; old-only columns are ignored. The legacy row_id is preserved in notes and can be used as a fallback ticket number.",
        "columns": JOB_TICKET_COLUMNS,
        "sample": {
            "row_id": "12345",
            "ticket_number": "1-000-001",
            "tsm_id": "1-000-001",
            "customer_name": "Tri-State Media",
            "customer_code": "TRI",
            "job_number": "MAR-PMDT-225-75-R-NP",
            "description": "Product description",
            "image_url": "https://example.com/glide-image.pdf",
            "label_width": "4",
            "label_length": "6.5",
            "repeat": "6.625",
            "gap": "0.125",
            "cutting_type": "to_liner",
            "face_type": "paper",
            "liner_type": "40",
            "master_type_code": "PM",
            "finished_material_code": "PM",
            "recipe_name": "4x6.5 PM",
            "finishing_type": "rolls",
            "unit_type": "label",
            "labels_per_unit": "3600",
            "units_per_carton": "3600",
            "box_item_number": "",
            "box_link": "",
            "core_link": "",
            "core_size": "3",
            "wind": "1",
            "fanfold_gear": "",
            "labels_per_fold": "",
            "ribbon": "no_ribbon",
            "laminate": "no_laminate",
            "bagged": "not_bagged",
            "carton_label_part_number": "",
            "carton_label_description_a": "",
            "carton_label_description_b": "",
            "carton_label_description_c": "",
            "carton_label_finishing_1": "",
            "carton_label_finishing_2": "",
            "job_notes": "Imported from old system",
        },
    },
    "flex_dies": {
        "label": "Flex / Rotary Dies",
        "description": "Imports flex die jackets/folders. You can upload the old Glide tooling export directly; the name/number is used as the shelf identifier, and rows starting RD import as Rotary Dies.",
        "columns": FLEX_DIE_COLUMNS,
        "sample": {
            "row_id": "FDROW-1",
            "name": "FD-13-1-1",
            "original_serial_number": "OSN-1001",
            "serial_numbers": "A1001;A1002",
            "label_width": "3",
            "label_length": "3",
            "repeat": "3.125",
            "gap_across": "0.125",
            "gap_around": "0.125",
            "gear": "81",
            "number_across": "2",
            "number_around": "1",
            "face_type": "paper",
            "liner_type": "40",
            "shape_type": "rcr",
            "cutting_type": "to_liner",
            "active_die_count": "2",
            "target_die_count": "4",
            "status": "in_stock",
            "supplier_name": "",
            "location_code": "FD-13",
            "location_name": "13 inch die cabinet",
            "manual_web_width": "false",
            "web_width": "",
            "tooling_kind": "flex_die",
            "last_order_price": "",
            "last_quote_price": "",
            "last_quote_supplier": "",
            "last_ordered_date": "",
            "procurement_notes": "",
        },
    },
    "inventory": {
        "label": "Raw Inventory",
        "description": "Imports raw/coated stock inventory rolls. The material_code should match a material data type when possible.",
        "columns": INVENTORY_COLUMNS,
        "sample": {
            "row_id": "INV-1",
            "serial_number": "CS-000001",
            "lot_number": "LOT-55",
            "name": "PM coated stock",
            "material_code": "PM",
            "material_type": "coated_stock",
            "master_type_code": "PM",
            "width_inches": "8.75",
            "length_feet": "5000",
            "weight_lbs": "",
            "quantity": "5000",
            "unit": "lf",
            "status": "available",
            "received_date": "2026-05-20",
            "supplier_name": "",
            "location_code": "WH-A1",
            "location_name": "Warehouse A1",
            "notes": "",
        },
    },
    "inventory_usage": {
        "label": "Inventory Usage",
        "description": "Imports roll usage history. Existing matching usage rows are updated instead of duplicated.",
        "columns": USAGE_COLUMNS,
        "sample": {
            "row_id": "USE-1",
            "inventory_serial": "CS-000001",
            "inventory_lot": "",
            "material_code": "PM",
            "usage_type": "manual",
            "quantity": "250",
            "unit": "lf",
            "used_date": "2026-05-20",
            "used_by": "Admin",
            "reference": "Job 1-000-001",
            "notes": "Imported usage",
        },
    },
    "job_ticket_usage": {
        "label": "Job Ticket Usage",
        "description": "Imports the simple old-system usage chart format: date, job_ticket_id, and quantity.",
        "columns": JOB_TICKET_USAGE_COLUMNS,
        "sample": {
            "date": "7/18/2024, 9:13:29 AM",
            "job_ticket_id": "lhg-ZBBjRoaq0h6T41yWpQ",
            "quantity": "1",
            "source": "Glide",
            "notes": "Imported usage",
        },
    },
    "finished_inventory": {
        "label": "Finished Inventory",
        "description": "Imports old-system carton/finished stock into Finished Inventory. TSM ID is matched to job tickets when possible.",
        "columns": FINISHED_INVENTORY_COLUMNS,
        "sample": {
            "row_id": "ZI79BWYOQkiqaVGINz1rfQ",
            "tsm_id": "ABE-000-023",
            "part_number": "ABE-LKD-10042",
            "location": "A-1-9",
            "quantity": "23",
            "unit": "carton",
            "status": "available",
            "run_date": "",
            "notes": "Imported carton stock",
        },
    },
    "print_plates": {
        "label": "Print Plates",
        "description": "Imports print plates linked to a label layout by recipe_name.",
        "columns": PRINT_PLATE_COLUMNS,
        "sample": {
            "row_id": "PLATE-1",
            "recipe_name": "4 x 6.5 Poly Standard Rolls",
            "plate_number": "PP-1001",
            "customer_plate_number": "CUST-44",
            "serial_number": "SN-7788",
            "description": "Black plate",
            "number_around": "1",
            "number_across": "3",
            "notes": "",
            "is_active": "true",
        },
    },
    "print_stations": {
        "label": "Print Stations",
        "description": "Imports print stations for an existing print plate. Use recipe_name + plate_number to find the plate.",
        "columns": PRINT_STATION_COLUMNS,
        "sample": {
            "row_id": "STATION-1",
            "recipe_name": "4 x 6.5 Poly Standard Rolls",
            "plate_number": "PP-1001",
            "station_number": "1",
            "station_plate_number": "PP-1001-A",
            "print_cylinder_tooth_count": "106",
            "anilox_gear_number": "900",
            "pms_color": "PMS 186",
            "color_type": "spot",
            "notes": "",
            "is_active": "true",
        },
    },
}


def sample_csv(columns, sample):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerow({column: sample.get(column, "") for column in columns})
    return stream.getvalue()


def normalize_key(key):
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", str(key or "").strip().lower())).strip("_")


def is_blank_import_value(value):
    if value in ("", None):
        return True
    return normalize_key(value) in {"empty", "null", "none", "na", "n_a"}


def normalize_row(row):
    return {normalize_key(key): str(value or "").strip() for key, value in row.items()}


def unique_normalized_headers(headers):
    counts = {}
    normalized_headers = []
    for index, header in enumerate(headers, start=1):
        base = normalize_key(header) or f"column_{index}"
        counts[base] = counts.get(base, 0) + 1
        normalized_headers.append(base if counts[base] == 1 else f"{base}_{counts[base]}")
    return normalized_headers


def normalize_row_values(headers, values):
    row = {}
    for index, key in enumerate(headers):
        value = values[index] if index < len(values) else ""
        row[key] = str(value or "").strip()
    return row


def first(row, *keys, default=""):
    for key in keys:
        value = row.get(normalize_key(key), "")
        if not is_blank_import_value(value):
            return str(value).strip()
    return default


def decimal_or_none(value):
    if is_blank_import_value(value):
        return None
    text = str(value).strip()
    if is_legacy_date_value(text):
        return None
    candidates = [text.replace(",", "")]
    if ":" in text:
        match = re.search(r"[-+]?\d[\d,]*(?:\.\d+)?", text.split(":", 1)[1])
        if match:
            candidates.append(match.group(0).replace(",", ""))
    leading = re.match(r"\s*([-+]?\d[\d,]*(?:\.\d+)?)", text)
    if leading:
        candidates.append(leading.group(1).replace(",", ""))
    for candidate in candidates:
        candidate = str(candidate or "").strip().strip("\"'")
        if not candidate:
            continue
        try:
            return Decimal(candidate)
        except (InvalidOperation, ValueError):
            continue
    return None


def legacy_date_number(value, mode="year"):
    match = re.match(r"^(\d{3,4})-(\d{2})-(\d{2})T", str(value or "").strip())
    if not match:
        return None
    year = int(match.group(1))
    month = int(match.group(2))
    if mode == "month_when_2001" and year == 2001:
        return Decimal(month)
    if mode == "year":
        return Decimal(year)
    return None


def decimal_or_none_with_legacy_date(value, mode="year"):
    date_number = legacy_date_number(value, mode)
    if date_number is not None:
        return date_number
    return decimal_or_none(value)


def int_or_none(value, mode=""):
    number = decimal_or_none_with_legacy_date(value, mode) if mode else decimal_or_none(value)
    if number is None:
        return None
    try:
        return int(number)
    except (TypeError, ValueError):
        return None


def core_size_or_none(value):
    number = decimal_or_none_with_legacy_date(value, "month_when_2001")
    if number is None or number <= 0 or abs(number) >= Decimal("1000"):
        return None
    return number


def bool_value(value, default=False):
    if is_blank_import_value(value):
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "manual"}


def date_value(value):
    if not value:
        return None
    parsed = parse_date(str(value).strip())
    return parsed


def datetime_value(value):
    text = str(value or "").strip()
    if not text:
        return None
    parsed = parse_datetime(text)
    if parsed is None:
        for fmt in ("%m/%d/%Y, %I:%M:%S %p", "%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y"):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
    if parsed is None:
        parsed_date = parse_date(text)
        if parsed_date:
            parsed = datetime.combine(parsed_date, datetime.min.time())
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def clean_code(value):
    text = str(value or "").strip()
    if "/" in text:
        text = text.split("/", 1)[0].strip()
    return text


def clean_legacy_meta_search_value(value):
    return re.sub(r"\.+$", "", str(value or "").strip()).strip()


def is_legacy_date_value(value):
    return bool(re.match(r"^\d{3,4}-\d{2}-\d{2}T", str(value or "").strip()))


def import_identifier(value):
    text = str(value or "").strip()
    return "" if is_legacy_date_value(text) else text


def int_lookup_value(value):
    text = str(value or "").strip()
    return int(text) if text.isdigit() else None


def append_legacy_note(existing_note, row_id):
    note = str(existing_note or "").strip()
    row_id = str(row_id or "").strip()
    if not row_id:
        return note
    legacy = f"Legacy Row ID: {row_id}"
    if legacy in note:
        return note
    return "\n".join([part for part in [note, legacy] if part])


def mark_imported_note(existing_note, row_id="", source="Glide"):
    note = append_legacy_note(existing_note, row_id)
    marker = f"Source: {source}"
    if marker.lower() in note.lower():
        return note
    return "\n".join([part for part in [note, marker] if part])


def legacy_row_id_from_note(note):
    match = re.search(r"^Legacy Row ID:\s*(.+?)\s*$", str(note or ""), flags=re.IGNORECASE | re.MULTILINE)
    return match.group(1).strip() if match else ""


def choice_value(value, choices, default):
    text = str(value or "").strip()
    if not text:
        return default
    normalized = normalize_key(text)
    for key, label in choices:
        key_normalized = normalize_key(key)
        label_normalized = normalize_key(label)
        matches = {
            key_normalized,
            label_normalized,
            key_normalized.rstrip("s"),
            label_normalized.rstrip("s"),
        }
        if normalized in matches:
            return key
    return default


def tooling_status_value(value, choices, default="in_stock"):
    normalized = normalize_key(value)
    if not normalized:
        return default
    if "production" in normalized or normalized in {"running", "in_use"}:
        return "in_use"
    if "house" in normalized or "david" in normalized or normalized in {"stock", "available", "active"}:
        return "in_stock"
    if "ordered" in normalized:
        return "ordered"
    if "repair" in normalized:
        return "needs_repair"
    if "retool" in normalized:
        return "out_for_retool"
    if "retired" in normalized or "delete" in normalized or "inactive" in normalized:
        return "retired"
    if "missing" in normalized:
        return "missing"
    return choice_value(value, choices, default)


def legacy_tooling_location(value):
    text = str(value or "").strip()
    normalized = normalize_key(text)
    if not text:
        return ""
    if "house" in normalized or "david" in normalized:
        return text
    return ""


def flex_cutting_type_value(value):
    normalized = normalize_key(value)
    if "multi" in normalized:
        return "multilevel"
    if "metal" in normalized:
        return "metal_to_metal"
    if "score" in normalized:
        return "score"
    if "liner" in normalized:
        return "to_liner"
    return choice_value(value, FlexDie.CUTTING_TYPE_CHOICES, "to_liner")


def die_tooling_kind_value(row):
    shelf_name = first(row, "name", "number", "tool_number", "die_number")
    shelf_prefix = str(shelf_name or "").strip().upper()
    if shelf_prefix.startswith("FD"):
        return "flex_die"
    if shelf_prefix.startswith("RD"):
        return "rotary_die"

    explicit = normalize_key(first(row, "tooling_kind", "tool_type", "die_type", "type"))
    if explicit in {"rotary", "rotary_die", "semi_rotary", "solid_rotary", "solid_rotary_die"}:
        return "rotary_die"
    if explicit in {"flex", "flex_die", "flexible_die"}:
        return "flex_die"

    if bool_value(first(row, "semi_rotary"), default=False):
        return "rotary_die"

    number = shelf_name
    description = first(row, "description", "notes")
    combined = f"{number} {description}".lower()
    if re.search(r"\bfd[-_\s]?\d+r[-_\s]", combined) or "semi rotary" in combined or "rotary die" in combined:
        return "rotary_die"
    return "flex_die"


def job_unit_type_value(value):
    normalized = normalize_key(value)
    if normalized in {"tag", "tags"}:
        return "tag"
    if normalized in {"label", "labels"}:
        return "label"
    return choice_value(value, JobTicket.UNIT_TYPE_CHOICES, "label")


def job_finishing_type_value(value):
    text = str(value or "").strip()
    normalized = normalize_key(value)
    if not normalized:
        return "rolls"
    if normalized in {"fanfold", "fan_fold", "fanfod"} or "fanfold" in normalized or "fandold" in normalized:
        return "fanfold"
    if re.search(r"(^|[-_\s])f($|[-_\s])", text, flags=re.IGNORECASE):
        return "fanfold"
    if "sheet" in normalized:
        return "sheeted"
    if re.search(r"(^|[-_\s])r($|[-_\s])", text, flags=re.IGNORECASE):
        return "rolls"
    if "roll" in normalized:
        return "rolls"
    return choice_value(value, JobTicket.FINISHING_TYPE_CHOICES, "rolls")


def wind_direction_value(value):
    text = str(value or "").strip()
    if not text:
        return ""
    date_number = legacy_date_number(text, "month_when_2001")
    if date_number is not None and 1 <= int(date_number) <= 8:
        return str(int(date_number))
    normalized = normalize_key(text)
    if normalized in {"none", "not_set", "na", "n_a", "no", "0"}:
        return ""
    if normalized in {str(number) for number in range(1, 9)}:
        return normalized
    number = decimal_or_none(text)
    if number is not None and number == number.to_integral_value() and 1 <= int(number) <= 8:
        return str(int(number))
    match = re.search(r"\b(?:wind|w)\s*([1-8])\b", text, flags=re.IGNORECASE)
    return match.group(1) if match else ""


def yes_no_choice_value(value, choices, yes_key, default):
    normalized = normalize_key(value)
    if normalized in {"0", "false", "no", "n", "none", "not_bagged", "no_bag", "no_bags"} or normalized.startswith("no_"):
        return default
    if yes_key == "bagged" and "bagged" in normalized:
        return yes_key
    if normalized in {"1", "true", "yes", "y"}:
        return yes_key
    return choice_value(value, choices, default)


def read_csv_rows(request):
    upload = request.FILES.get("file")
    if not upload:
        raise ValueError("Attach a CSV file named file.")

    text = upload.read().decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text))
    try:
        headers = next(reader)
    except StopIteration:
        raise ValueError("CSV file needs a header row.")
    if not headers:
        raise ValueError("CSV file needs a header row.")

    normalized_headers = unique_normalized_headers(headers)
    return [
        (index, normalize_row_values(normalized_headers, row))
        for index, row in enumerate(reader, start=2)
        if any(str(value or "").strip() for value in row)
    ]


def import_result():
    return {
        "created": 0,
        "updated": 0,
        "skipped": 0,
        "errors": [],
        "warnings": [],
        "error_count": 0,
        "warning_count": 0,
    }


def add_error(result, line_number, message):
    result["skipped"] += 1
    result["error_count"] += 1
    if len(result["errors"]) < MAX_IMPORT_MESSAGES:
        result["errors"].append({"line": line_number, "message": message})


def add_warning(result, line_number, message):
    result["warning_count"] += 1
    if len(result["warnings"]) < MAX_IMPORT_MESSAGES:
        result["warnings"].append({"line": line_number, "message": message})


def find_or_create_customer(name, code=""):
    name = str(name or "").strip()
    code = str(code or "").strip()
    if not name:
        return None
    customer = Customer.objects.filter(name__iexact=name).first()
    if customer:
        if code and not customer.customer_code:
            customer.customer_code = code
            customer.save(update_fields=["customer_code"])
        return customer
    return Customer.objects.create(name=name, customer_code=code)


def find_or_create_supplier(name):
    name = str(name or "").strip()
    if not name:
        return None
    supplier = Supplier.objects.filter(name__iexact=name).first()
    if supplier:
        return supplier
    return Supplier.objects.create(name=name)


def unique_location_code(base):
    base = clean_code(base) or "LOC"
    base = slugify(base).upper() or "LOC"
    code = base
    index = 2
    while ToolingLocation.objects.filter(code__iexact=code).exists():
        code = f"{base}-{index}"
        index += 1
    return code


def find_or_create_location(code="", name=""):
    code = clean_code(code)
    name = str(name or "").strip()
    if code:
        location = ToolingLocation.objects.filter(code__iexact=code).first()
        if location:
            return location
    if name:
        location = ToolingLocation.objects.filter(name__iexact=name).first()
        if location:
            return location
    if not code and not name:
        return None
    return ToolingLocation.objects.create(
        code=unique_location_code(code or name),
        name=name or code,
        location_type="position",
    )


def find_or_create_master_type(code="", name=""):
    code = clean_code(code)
    name = str(name or code or "").strip()
    if not code:
        return None
    master = MaterialMasterType.objects.filter(Q(code__iexact=code) | Q(name__iexact=code)).first()
    if master:
        return master
    return MaterialMasterType.objects.create(code=code, name=name or code)


def find_material_spec(code="", name="", material_type="", master_type=None):
    code = clean_code(code)
    name = str(name or "").strip()
    qs = MaterialSpec.objects.all()
    if material_type:
        valid_types = {key for key, _label in MaterialSpec.MATERIAL_TYPE_CHOICES}
        if material_type in valid_types:
            qs = qs.filter(material_type=material_type)
    if code:
        material = qs.filter(Q(code__iexact=code) | Q(name__iexact=code)).first()
        if material:
            return material
    if name:
        material = qs.filter(name__iexact=name).first()
        if material:
            return material
    if master_type:
        return qs.filter(master_type=master_type).first()
    return None


def find_recipe(name):
    name = str(name or "").strip()
    if not name:
        return None
    return ToolingRecipe.objects.filter(name__iexact=name).first()


def find_box(item_number="", name="", link=""):
    item_number = str(item_number or "").strip()
    name = str(name or "").strip()
    link = str(link or "").strip()
    pk = int_lookup_value(link)
    if pk is not None:
        box = BoxSpec.objects.filter(pk=pk).first()
        if box:
            return box
    if link:
        box = BoxSpec.objects.filter(Q(external_id__iexact=link) | Q(item_number__iexact=link) | Q(name__iexact=link)).first()
        if box:
            return box
    if item_number:
        box = BoxSpec.objects.filter(item_number__iexact=item_number).first()
        if box:
            return box
    if name:
        return BoxSpec.objects.filter(name__iexact=name).first()
    if link or item_number:
        return BoxSpec.objects.create(
            external_id=link,
            item_number=item_number,
            name=name or item_number or link,
        )
    return None


def find_core(link="", item_number="", name="", core_size=""):
    link = str(link or "").strip()
    item_number = str(item_number or "").strip()
    name = str(name or "").strip()
    size = core_size_or_none(core_size)
    pk = int_lookup_value(link)
    if pk is not None:
        core = CoreSpec.objects.filter(pk=pk).first()
        if core:
            return core
    if link:
        core = CoreSpec.objects.filter(Q(external_id__iexact=link) | Q(item_number__iexact=link) | Q(name__iexact=link)).first()
        if core:
            return core
    if item_number:
        core = CoreSpec.objects.filter(item_number__iexact=item_number).first()
        if core:
            return core
    if name:
        core = CoreSpec.objects.filter(name__iexact=name).first()
        if core:
            return core
    if size is not None:
        core = CoreSpec.objects.filter(core_size_inches=size).first()
        if core:
            return core
    if link or item_number or name or size is not None:
        return CoreSpec.objects.create(
            external_id=link,
            item_number=item_number,
            name=name or item_number or (f'{size}" Core' if size is not None else link),
            core_size_inches=size,
        )
    return None


def find_job_ticket_by_legacy_id(value):
    text = str(value or "").strip()
    if not text:
        return None
    return JobTicket.objects.filter(
        Q(legacy_row_id__iexact=text) |
        Q(ticket_number__iexact=text) |
        Q(product_code__iexact=text) |
        Q(job_notes__icontains=f"Legacy Row ID: {text}")
    ).first()


def ticket_lookup_key(value):
    return str(value or "").strip().lower()


def job_ticket_lookup_map(values):
    keys = {ticket_lookup_key(value) for value in values if ticket_lookup_key(value)}
    if not keys:
        return {}

    tickets = JobTicket.objects.filter(
        Q(legacy_row_id__in=values) |
        Q(ticket_number__in=values) |
        Q(product_code__in=values)
    )
    lookup = {}
    for ticket in tickets:
        for value in [ticket.legacy_row_id, ticket.ticket_number, ticket.product_code]:
            key = ticket_lookup_key(value)
            if key and key in keys and key not in lookup:
                lookup[key] = ticket

    missing = keys.difference(lookup)
    if missing:
        note_query = Q()
        for value in list(missing)[:500]:
            note_query |= Q(job_notes__icontains=f"Legacy Row ID: {value}")
        if note_query:
            for ticket in JobTicket.objects.filter(note_query):
                note_text = str(ticket.job_notes or "").lower()
                for value in list(missing):
                    if f"legacy row id: {value}" in note_text:
                        lookup[value] = ticket
                        missing.discard(value)
    return lookup


def serial_number_text(value):
    values = [
        part.strip()
        for part in re.split(r"[\n\r;|,]+", str(value or ""))
        if part.strip()
    ]
    return "\n".join(values)


def save_model(obj, defaults, result):
    for field, value in defaults.items():
        setattr(obj, field, value)
    created = obj.pk is None
    obj.save()
    result["created" if created else "updated"] += 1
    return obj


def import_job_tickets(rows):
    result = import_result()
    for line_number, row in rows:
        legacy_part_number = clean_legacy_meta_search_value(first(row, "Ticket Information / Part Number Meta Search"))
        imported_product_code = import_identifier(first(row, "tsm_id", "product_code"))
        ticket_number = import_identifier(first(row, "ticket_number")) or legacy_part_number or imported_product_code or first(row, "row_id")
        row_id = first(row, "row_id")
        if not ticket_number:
            add_error(result, line_number, "Missing ticket_number, tsm_id, or row_id.")
            continue

        customer_name = first(row, "customer_name", "customer")
        customer = find_or_create_customer(customer_name, first(row, "customer_code"))
        master_type = find_or_create_master_type(
            first(row, "master_type_code", "material_master_type", "material_type_code"),
            first(row, "master_type_name"),
        )
        material_spec = find_material_spec(
            first(row, "finished_material_code", "material_code", "material_spec_code", "Ticket Information / Material ID"),
            first(row, "finished_material_name", "material_name", "Ticket Information / Material ID"),
            "coated_stock",
            master_type,
        )
        recipe = find_recipe(first(row, "recipe_name", "recipe", "Label Configuration / key", "Label Configuration / ID"))
        box_item_number = first(row, "box_item_number", "box_code")
        box = find_box(box_item_number, first(row, "box_name"), first(row, "box_link", "box_id"))
        core_size_raw = first(row, "core_size", "core_size_inches")
        core_size = core_size_or_none(core_size_raw)
        parsed_core_size = decimal_or_none(core_size_raw)
        if core_size_raw and parsed_core_size is not None and core_size is None:
            add_warning(result, line_number, f"Ignored invalid core_size value {core_size_raw}.")
        core = find_core(
            first(row, "core_link", "core_id"),
            first(row, "core_item_number", "core_code"),
            first(row, "core_name"),
            core_size,
        )

        label_length = decimal_or_none(first(row, "label_length", "label_length_inches", "length", "Label Configuration / Length"))
        repeat = decimal_or_none(first(row, "repeat", "repeat_inches"))
        gap = decimal_or_none(first(row, "gap", "gap_around", "gap_around_inches", "Label Configuration / Column Space", "column_space", "col_space"))
        if repeat is None and label_length is not None and gap is not None:
            repeat = label_length + gap
        labels_per_unit = int_or_none(first(row, "labels_per_unit", "labels_per_roll", "tags_per_roll", "tags_per_unit", "lpu"), mode="year")
        units_per_carton = int_or_none(first(
            row,
            "units_per_carton",
            "units_in_carton",
            "tags_per_carton",
            "labels_per_carton",
            "labels_per_unit_2",
            "lpc",
            "unit_per_carton",
            "numbers_per_carton",
            "labels_in_box",
            "number_of_labels_in_box",
        ), mode="year")
        finishing_type = job_finishing_type_value(first(row, "finishing_type", "finishing", default=ticket_number))
        wind_raw = first(row, "wind", "wind_direction")
        wind_direction = wind_direction_value(wind_raw)
        if wind_raw and not wind_direction and normalize_key(wind_raw) not in {"none", "not_set", "na", "n_a", "no", "0"}:
            add_warning(result, line_number, f"Ignored invalid wind value {wind_raw}.")

        existing = JobTicket.objects.filter(ticket_number=ticket_number).first()
        notes = mark_imported_note(first(row, "job_notes", "job_note", "notes"), row_id)
        image_url = first(row, "image_url", "glide_image_url", "external_image_url")
        defaults = {
            "customer": customer,
            "legacy_row_id": row_id,
            "customer_name": customer.name if customer else customer_name,
            "job_name": first(row, "job_number", "job_name", "part_number") or legacy_part_number or ticket_number,
            "product_code": imported_product_code or ticket_number,
            "description": first(row, "description", "job_description", "product_description", "Ticket Information / Description", "desc"),
            "box_item_number": box_item_number,
            "label_width_inches": decimal_or_none(first(row, "label_width", "label_width_inches", "width", "Label Configuration / Width")),
            "label_length_inches": label_length,
            "repeat_inches": repeat,
            "cutting_type": choice_value(first(row, "cutting_type"), JobTicket.CUTTING_TYPE_CHOICES, "to_liner"),
            "face_type": first(row, "face_type", "face", "Label Configuration / Face", "Cutting Face Type"),
            "liner_type": first(row, "liner_type", "liner", "Label Configuration / Liner"),
            "material_master_type": master_type or (material_spec.master_type if material_spec else None),
            "material_spec": material_spec,
            "recipe": recipe,
            "requested_quantity": decimal_or_none(first(row, "requested_quantity", "quantity")) or Decimal("0"),
            "finishing_type": finishing_type,
            "unit_type": job_unit_type_value(first(row, "unit_type", "unit", "product_unit")),
            "labels_per_unit": labels_per_unit,
            "units_per_carton": units_per_carton,
            "labels_per_carton": units_per_carton,
            "box": box,
            "core": core,
            "core_size_inches": core_size,
            "wind_direction": wind_direction,
            "fanfold_gear": int_or_none(first(row, "fanfold_gear", "fold_gear"), mode="year"),
            "labels_per_fold": int_or_none(first(row, "labels_per_fold", "tags_per_fold", "units_per_fold", "Finishing / Labels per Fold"), mode="year"),
            "ribbon": yes_no_choice_value(first(row, "ribbon", "ribbon_type", "Ticket Information / Ribbon"), JobTicket.RIBBON_CHOICES, "ribbon", "no_ribbon"),
            "laminate": yes_no_choice_value(first(row, "laminate", "laminate_type"), JobTicket.LAMINATE_CHOICES, "laminate", "no_laminate"),
            "bagged": yes_no_choice_value(first(row, "bagged", "bag", "bagging", "is_bagged"), JobTicket.BAGGED_CHOICES, "bagged", "not_bagged"),
            "carton_label_part_number": first(row, "carton_label_part_number", "carton_label_partnumber"),
            "carton_label_description_a": first(row, "carton_label_description_a", "carton_label_descr_a", "carton_label_descra"),
            "carton_label_description_b": first(row, "carton_label_description_b", "carton_label_descr_b", "carton_label_descrb"),
            "carton_label_description_c": first(row, "carton_label_description_c", "carton_label_descr_c", "carton_label_descrc"),
            "carton_label_finishing_1": first(row, "carton_label_finishing_1", "carton_finishing_1"),
            "carton_label_finishing_2": first(row, "carton_label_finishing_2", "carton_finishing_2"),
            "finishing_notes": first(row, "finishing_notes"),
            "job_notes": notes,
        }
        if not (existing and existing.general_image):
            defaults["external_image_url"] = image_url
            defaults["external_image_source"] = "Glide" if image_url else ""
        ticket = existing or JobTicket(ticket_number=ticket_number)
        save_model(ticket, defaults, result)
    return result


def import_flex_dies(rows):
    result = import_result()
    for line_number, row in rows:
        name = first(row, "name", "number", "tool_number", "die_number")
        if not name:
            result["skipped"] += 1
            add_warning(result, line_number, "Skipped die tooling row with no shelf name/number. Legacy row_id was not used as the die name.")
            continue

        tooling_kind = die_tooling_kind_value(row)
        label_width = decimal_or_none(first(row, "label_width", "label_width_inches", "width", "size_across", "sizeacross"))
        label_length = decimal_or_none(first(row, "label_length", "label_length_inches", "length", "size_around", "sizearound"))
        repeat = decimal_or_none(first(row, "repeat", "repeat_inches", "label_repeat", "labelrepeat"))
        gap_around = decimal_or_none(first(row, "gap_around", "gap", "gap_around_inches", "colspace", "col_space"))
        if repeat is None and label_length is not None and gap_around is not None:
            repeat = label_length + gap_around
        if repeat is None and label_length is not None:
            repeat = label_length
        if label_width is None or label_length is None or repeat is None:
            result["skipped"] += 1
            add_warning(result, line_number, "Skipped incomplete die tooling row with missing width, length, or repeat.")
            continue

        serials = serial_number_text(first(row, "serial_numbers", "serial_number", "serialnumber"))
        quantity = int_or_none(first(row, "active_die_count", "quantity"))
        active_count = quantity
        if active_count is None:
            active_count = len([line for line in serials.splitlines() if line.strip()]) or 1

        active_flag = bool_value(first(row, "active"), default=True)
        status = tooling_status_value(first(row, "status", "tooling_status"), FlexDie.STATUS_CHOICES, "in_stock")
        if not active_flag:
            status = "retired"
            if quantity is None:
                active_count = 0

        web_width = decimal_or_none(first(row, "web_width", "web_width_inches"))
        manual_web_width = bool_value(first(row, "manual_web_width"), default=web_width is not None)
        tooling_status = first(row, "tooling_status")
        notes = "\n".join(
            part
            for part in [
                first(row, "notes"),
                first(row, "description"),
                first(row, "description_list_to_text", "descriptionlisttotext"),
                f"Label Specs: {first(row, 'label_specs')}" if first(row, "label_specs") else "",
                f"Cut Layout: {first(row, 'cut_layout')}" if first(row, "cut_layout") else "",
                f"Version: {first(row, 'version')}" if first(row, "version") else "",
                f"Legacy FD Image: {first(row, 'fd_image')}" if first(row, "fd_image") else "",
                f"Press Type: {first(row, 'press_type')}" if first(row, "press_type") else "",
                "Semi Rotary: Yes" if bool_value(first(row, "semi_rotary"), default=False) else "",
                "13 Semi Rotary compatible: Yes" if bool_value(first(row, "13_semi_rotary"), default=False) else "",
                "Built in perf: Yes" if bool_value(first(row, "built_in_perf"), default=False) else "",
                "Built in internal perf: Yes" if bool_value(first(row, "built_in_internal_perf"), default=False) else "",
                f"Tooling History / Action: {first(row, 'tooling_history_action')}" if first(row, "tooling_history_action") else "",
                f"Tooling History / Note: {first(row, 'tooling_history_note')}" if first(row, "tooling_history_note") else "",
            ]
            if part
        )
        current_location_name = first(row, "location_name", "location") or legacy_tooling_location(tooling_status)
        existing = FlexDie.objects.filter(name__iexact=name).first()
        defaults = {
            "tooling_kind": tooling_kind,
            "supplier": find_or_create_supplier(first(row, "supplier_name", "supplier", "manufacturer")),
            "current_location": find_or_create_location(first(row, "location_code"), current_location_name),
            "status": status,
            "label_width_inches": label_width,
            "label_length_inches": label_length,
            "repeat_inches": repeat,
            "face_type": first(row, "face_type", "face", "face_stock", "facestock"),
            "liner_type": first(row, "liner_type", "liner", "liner_caliper", "linercaliper"),
            "shape_type": choice_value(first(row, "shape_type", "shape"), FlexDie.SHAPE_TYPE_CHOICES, "rcr"),
            "cutting_type": flex_cutting_type_value(first(row, "cutting_type", "cut_position", "cutposition")),
            "gear": int_or_none(first(row, "gear", "gear_tooth_count", "gear_teeth", "gearteeth")),
            "number_across": int_or_none(first(row, "number_across", "across", "no_across", "noacross")) or 1,
            "number_around": int_or_none(first(row, "number_around", "around", "no_around", "noaround")) or 1,
            "corner_radius_inches": decimal_or_none(first(row, "corner_radius", "corner_radius_inches", "cornerradius")),
            "gap_across_inches": decimal_or_none(first(row, "gap_across", "gap", "gap_across_inches", "colspace", "col_space")),
            "gap_around_inches": gap_around,
            "manual_web_width": manual_web_width,
            "web_width_inches": web_width,
            "original_serial_number": first(row, "original_serial_number", "original_serial", "serial_number", "serialnumber"),
            "serial_numbers": serials,
            "active_die_count": active_count,
            "target_die_count": int_or_none(first(row, "target_die_count")) or active_count or 1,
            "last_order_price": decimal_or_none(first(row, "last_order_price", "order_price", "purchase_price", "price", "cost")),
            "last_quote_price": decimal_or_none(first(row, "last_quote_price", "quote_price", "quoted_price")),
            "last_quote_supplier": find_or_create_supplier(first(row, "last_quote_supplier", "quote_supplier", "quoted_supplier")),
            "last_ordered_date": date_value(first(row, "last_ordered_date", "ordered_date")),
            "procurement_notes": first(row, "procurement_notes", "reorder_notes", "quote_notes"),
            "notes": mark_imported_note(notes, first(row, "row_id"), "Glide Tooling"),
        }
        die = existing or FlexDie(name=name)
        save_model(die, defaults, result)
        if tooling_kind == "rotary_die":
            add_warning(result, line_number, f"{name} was imported as a Rotary Die, not a Flex Die.")
    return result


def import_inventory(rows):
    result = import_result()
    valid_material_types = {key for key, _label in MaterialSpec.MATERIAL_TYPE_CHOICES}
    for line_number, row in rows:
        serial = first(row, "serial_number", "serial", "row_id")
        lot_number = first(row, "lot_number", "lot")
        if not serial and not lot_number:
            add_error(result, line_number, "Inventory rows need serial_number, lot_number, or row_id.")
            continue

        incoming_type = normalize_key(first(row, "material_type", default="coated_stock"))
        material_type = incoming_type if incoming_type in valid_material_types else "coated_stock"
        master_type = find_or_create_master_type(first(row, "master_type_code", "material_master_type"))
        material = find_material_spec(
            first(row, "material_code", "code"),
            first(row, "material_name", "name"),
            material_type,
            master_type,
        )
        length_feet = decimal_or_none(first(row, "length_feet", "length"))
        quantity = decimal_or_none(first(row, "quantity")) or length_feet or Decimal("0")
        existing = None
        if serial:
            existing = MaterialInventory.objects.filter(serial_number__iexact=serial).first()
        if not existing and lot_number:
            existing = MaterialInventory.objects.filter(lot_number__iexact=lot_number).first()

        defaults = {
            "material": material,
            "material_type": material.material_type if material else material_type,
            "name": first(row, "name", "material_name") or (material.name if material else ""),
            "code": first(row, "material_code", "code") or (material.code if material else ""),
            "serial_number": serial,
            "lot_number": lot_number,
            "supplier": find_or_create_supplier(first(row, "supplier_name", "supplier")),
            "location": find_or_create_location(first(row, "location_code"), first(row, "location_name", "location")),
            "width_inches": decimal_or_none(first(row, "width_inches", "width")),
            "length_feet": length_feet,
            "weight_lbs": decimal_or_none(first(row, "weight_lbs", "weight")),
            "quantity": quantity,
            "unit": choice_value(first(row, "unit"), MaterialInventory.UNIT_CHOICES, "lf"),
            "status": choice_value(first(row, "status"), MaterialInventory.STATUS_CHOICES, "available"),
            "received_date": date_value(first(row, "received_date", "date_received")),
            "notes": mark_imported_note(first(row, "notes"), first(row, "row_id")),
            "is_active": True,
        }
        inventory = existing or MaterialInventory()
        save_model(inventory, defaults, result)
    return result


def find_inventory(row):
    serial = first(row, "inventory_serial", "serial_number", "serial")
    lot = first(row, "inventory_lot", "lot_number", "lot")
    if serial:
        inventory = MaterialInventory.objects.filter(serial_number__iexact=serial).first()
        if inventory:
            return inventory
    if lot:
        return MaterialInventory.objects.filter(lot_number__iexact=lot).first()
    return None


def import_inventory_usage(rows):
    result = import_result()
    for line_number, row in rows:
        inventory = find_inventory(row)
        if not inventory:
            add_error(result, line_number, "Could not find inventory by inventory_serial or inventory_lot.")
            continue

        usage_type = choice_value(first(row, "usage_type"), MaterialUsage.USAGE_TYPE_CHOICES, "manual")
        quantity = decimal_or_none(first(row, "quantity")) or Decimal("0")
        used_date = date_value(first(row, "used_date", "date")) or timezone.localdate()
        reference = first(row, "reference", "job", "job_ticket")
        material = find_material_spec(first(row, "material_code"), material_type=inventory.material_type) or inventory.material
        existing = MaterialUsage.objects.filter(
            inventory=inventory,
            usage_type=usage_type,
            quantity=quantity,
            used_date=used_date,
            reference=reference,
        ).first()
        defaults = {
            "inventory": inventory,
            "material": material,
            "usage_type": usage_type,
            "quantity": quantity,
            "unit": choice_value(first(row, "unit"), MaterialInventory.UNIT_CHOICES, inventory.unit or "lf"),
            "used_date": used_date,
            "used_by": first(row, "used_by", "operator", "employee"),
            "reference": reference,
            "notes": mark_imported_note(first(row, "notes"), first(row, "row_id")),
        }
        usage = existing or MaterialUsage()
        save_model(usage, defaults, result)
    return result


def import_job_ticket_usage(rows):
    result = import_result()
    parsed_rows = []
    legacy_values = set()

    for line_number, row in rows:
        legacy_job_ticket_id = first(row, "job_ticket_id", "legacy_job_ticket_id", "ticket_id", "row_id")[:120]
        used_at = datetime_value(first(row, "date", "used_at", "used_date"))
        quantity = decimal_or_none(first(row, "quantity", "qty")) or Decimal("0")

        if not legacy_job_ticket_id:
            result["skipped"] += 1
            add_warning(result, line_number, "Skipped usage row with no job_ticket_id.")
            continue
        if used_at is None:
            result["skipped"] += 1
            add_warning(result, line_number, "Skipped usage row with missing or invalid date.")
            continue
        if quantity <= 0:
            result["skipped"] += 1
            add_warning(result, line_number, "Skipped usage row with zero quantity.")
            continue

        parsed_rows.append((line_number, row, legacy_job_ticket_id, used_at, quantity))
        legacy_values.add(legacy_job_ticket_id)

    ticket_map = job_ticket_lookup_map(legacy_values)
    existing_map = {}
    if legacy_values:
        for usage in JobTicketUsage.objects.filter(legacy_job_ticket_id__in=legacy_values):
            key = (ticket_lookup_key(usage.legacy_job_ticket_id), usage.used_at, usage.quantity)
            if key not in existing_map:
                existing_map[key] = usage

    to_create = {}
    to_update = {}
    update_fields = ["job_ticket", "legacy_job_ticket_id", "used_at", "quantity", "source", "notes"]

    for line_number, row, legacy_job_ticket_id, used_at, quantity in parsed_rows:
        ticket = ticket_map.get(ticket_lookup_key(legacy_job_ticket_id))
        if not ticket:
            add_warning(result, line_number, f"Could not match job_ticket_id {legacy_job_ticket_id}; usage was kept unlinked.")

        existing_key = (ticket_lookup_key(legacy_job_ticket_id), used_at, quantity)
        existing = existing_map.get(existing_key)
        source = (first(row, "source", default="Glide") or "Glide")[:80]
        defaults = {
            "job_ticket": ticket,
            "legacy_job_ticket_id": legacy_job_ticket_id,
            "used_at": used_at,
            "quantity": quantity,
            "source": source,
            "notes": mark_imported_note(first(row, "notes"), first(row, "row_id"), source),
        }
        usage = existing or JobTicketUsage()
        for field, value in defaults.items():
            setattr(usage, field, value)
        if existing and existing.pk:
            to_update[existing_key] = usage
        else:
            to_create[existing_key] = usage
            existing_map[existing_key] = usage

    if to_create:
        JobTicketUsage.objects.bulk_create(list(to_create.values()), batch_size=1000)
        result["created"] += len(to_create)
    if to_update:
        JobTicketUsage.objects.bulk_update(list(to_update.values()), update_fields, batch_size=1000)
        result["updated"] += len(to_update)
    return result


def find_finished_inventory_by_legacy_id(row_id):
    row_id = str(row_id or "").strip()
    if not row_id:
        return None
    return FinishedInventory.objects.filter(notes__icontains=f"Legacy Row ID: {row_id}").first()


def finished_inventory_lookup_map(row_ids):
    keys = {ticket_lookup_key(row_id) for row_id in row_ids if ticket_lookup_key(row_id)}
    if not keys:
        return {}

    lookup = {}
    for item in FinishedInventory.objects.filter(notes__icontains="Legacy Row ID:").only("id", "notes"):
        key = ticket_lookup_key(legacy_row_id_from_note(item.notes))
        if key and key in keys and key not in lookup:
            lookup[key] = item
    return lookup


def import_finished_inventory(rows):
    result = import_result()
    unmatched_ticket_count = 0
    parsed_rows = []
    row_ids = set()
    tsm_ids = set()

    for line_number, row in rows:
        row_id = first(row, "row_id", "legacy_row_id")
        tsm_id = first(row, "tsm_id", "product_code", "job_ticket", "ticket_number", "job_number", "part_id")
        order_number = first(row, "order_number", "order_id", "schedule_order_number")
        part_number = first(row, "part_number", "sku", "item_number", "item")
        quantity = decimal_or_none(first(row, "quantity", "actual_quantity", "actual_qty", "qty"))

        if not any([row_id, tsm_id, part_number]):
            add_error(result, line_number, "Finished inventory rows need row_id, tsm_id, or part_number.")
            continue
        if quantity is None:
            result["skipped"] += 1
            add_warning(result, line_number, "Skipped finished inventory row with no quantity.")
            continue
        if quantity <= 0:
            result["skipped"] += 1
            add_warning(result, line_number, "Skipped finished inventory row with zero or negative quantity.")
            continue

        parsed_rows.append((line_number, row, row_id, tsm_id, order_number, part_number, quantity))
        if row_id:
            row_ids.add(row_id)
        if tsm_id:
            tsm_ids.add(tsm_id)
        if part_number:
            tsm_ids.add(part_number)

    ticket_map = job_ticket_lookup_map(tsm_ids)
    existing_map = finished_inventory_lookup_map(row_ids)
    location_cache = {}
    create_records = []
    update_records = []

    update_fields = [
        "name",
        "sku",
        "job_ticket",
        "customer_order",
        "order_number",
        "recipe",
        "location",
        "quantity",
        "unit",
        "status",
        "run_date",
        "face_type",
        "liner_type",
        "notes",
        "updated_at",
    ]

    for _line_number, row, row_id, tsm_id, order_number, part_number, quantity in parsed_rows:
        customer_order = CustomerOrder.objects.select_related("job_ticket", "job_ticket__recipe").filter(order_number__iexact=order_number).first() if order_number else None
        job_ticket = customer_order.job_ticket if customer_order else ticket_map.get(ticket_lookup_key(tsm_id)) or ticket_map.get(ticket_lookup_key(part_number))
        if (tsm_id or part_number) and not job_ticket:
            unmatched_ticket_count += 1

        location_value = first(row, "location", "location_code", "location_name")
        location_key = ticket_lookup_key(location_value)
        if location_key not in location_cache:
            location_cache[location_key] = find_or_create_location(location_value, first(row, "location_name", default=location_value))
        location = location_cache[location_key]
        existing = existing_map.get(ticket_lookup_key(row_id))
        note_parts = [
            first(row, "notes", "note"),
            f"Imported TSM ID: {tsm_id}" if tsm_id else "",
            f"Imported Order Number: {order_number}" if order_number else "",
        ]
        notes = mark_imported_note("\n".join([part for part in note_parts if part]), row_id, "Glide Finished Inventory")
        item_name = first(row, "name", "item_name")
        if not item_name:
            if job_ticket:
                item_name = job_ticket.job_name or part_number or tsm_id or row_id
            elif tsm_id and part_number:
                item_name = f"{tsm_id} / {part_number}"
            else:
                item_name = part_number or tsm_id or row_id

        defaults = {
            "name": item_name[:150],
            "sku": part_number[:80],
            "job_ticket": job_ticket,
            "customer_order": customer_order,
            "order_number": order_number[:20],
            "recipe": job_ticket.recipe if job_ticket else None,
            "location": location,
            "quantity": quantity,
            "unit": choice_value(first(row, "unit"), FinishedInventory.UNIT_CHOICES, "carton"),
            "status": choice_value(first(row, "status"), FinishedInventory.STATUS_CHOICES, "available"),
            "run_date": date_value(first(row, "run_date", "date", "last_run_date")),
            "face_type": first(row, "face_type", default=(job_ticket.face_type if job_ticket else "")),
            "liner_type": first(row, "liner_type", default=(job_ticket.liner_type if job_ticket else "")),
            "notes": notes,
            "updated_at": timezone.now(),
        }
        inventory = existing or FinishedInventory()
        for field, value in defaults.items():
            setattr(inventory, field, value)
        if inventory.pk:
            update_records.append(inventory)
        else:
            create_records.append(inventory)

    if create_records:
        FinishedInventory.objects.bulk_create(create_records, batch_size=250)
        result["created"] += len(create_records)
    if update_records:
        FinishedInventory.objects.bulk_update(update_records, update_fields, batch_size=250)
        result["updated"] += len(update_records)

    if unmatched_ticket_count:
        add_warning(
            result,
            "multiple",
            f"{unmatched_ticket_count} rows could not match TSM ID to an existing job ticket; they were imported as unlinked finished inventory.",
        )
    return result


def import_print_plates(rows):
    result = import_result()
    for line_number, row in rows:
        recipe_name = first(row, "recipe_name", "label_layout", "layout_name", "recipe")
        plate_number = first(row, "plate_number", "print_plate_number", "plate")
        if not recipe_name or not plate_number:
            add_error(result, line_number, "Print plate rows need recipe_name and plate_number.")
            continue

        recipe = find_recipe(recipe_name)
        if not recipe:
            add_error(result, line_number, f"Could not find label layout '{recipe_name}'.")
            continue

        existing = PrintPlate.objects.filter(recipe=recipe, plate_number__iexact=plate_number).first()
        defaults = {
            "recipe": recipe,
            "plate_number": plate_number[:100],
            "customer_plate_number": first(row, "customer_plate_number", "customer_plate", "customer_plate_no")[:100],
            "serial_number": first(row, "serial_number", "serial", "plate_serial")[:120],
            "description": first(row, "description", "plate_description")[:220],
            "number_around": int_or_none(first(row, "number_around", "around")),
            "number_across": int_or_none(first(row, "number_across", "across")),
            "notes": mark_imported_note(first(row, "notes"), first(row, "row_id"), "Print Plate"),
            "is_active": bool_value(first(row, "is_active", "active"), default=True),
        }
        plate = existing or PrintPlate()
        save_model(plate, defaults, result)
    return result


def import_print_stations(rows):
    result = import_result()
    for line_number, row in rows:
        recipe_name = first(row, "recipe_name", "label_layout", "layout_name", "recipe")
        plate_number = first(row, "plate_number", "print_plate_number", "plate")
        station_number = int_or_none(first(row, "station_number", "station")) or 1
        if not recipe_name or not plate_number:
            add_error(result, line_number, "Print station rows need recipe_name and plate_number.")
            continue

        recipe = find_recipe(recipe_name)
        if not recipe:
            add_error(result, line_number, f"Could not find label layout '{recipe_name}'.")
            continue

        plate = PrintPlate.objects.filter(recipe=recipe, plate_number__iexact=plate_number).first()
        if not plate:
            add_error(result, line_number, f"Could not find print plate '{plate_number}' for '{recipe_name}'.")
            continue

        existing = PrintStation.objects.filter(print_plate=plate, station_number=station_number).first()
        defaults = {
            "print_plate": plate,
            "station_number": station_number,
            "station_plate_number": first(row, "station_plate_number", "station_plate", "print_plate_no")[:100],
            "print_cylinder_tooth_count": int_or_none(first(row, "print_cylinder_tooth_count", "print_cylinder_tooth", "cylinder_tooth", "tooth")),
            "anilox_gear_number": first(row, "anilox_gear_number", "anilox", "anilox_gear")[:80],
            "pms_color": first(row, "pms_color", "pms", "color")[:80],
            "color_type": choice_value(first(row, "color_type"), PrintStation.COLOR_TYPE_CHOICES, "spot"),
            "notes": mark_imported_note(first(row, "notes"), first(row, "row_id"), "Print Station"),
            "is_active": bool_value(first(row, "is_active", "active"), default=True),
        }
        station = existing or PrintStation()
        save_model(station, defaults, result)
    return result


IMPORTERS = {
    "job_tickets": import_job_tickets,
    "flex_dies": import_flex_dies,
    "inventory": import_inventory,
    "inventory_usage": import_inventory_usage,
    "job_ticket_usage": import_job_ticket_usage,
    "finished_inventory": import_finished_inventory,
    "print_plates": import_print_plates,
    "print_stations": import_print_stations,
}


@api_view(["GET"])
def data_import_templates(request):
    return Response({
        key: {
            **template,
            "csv": sample_csv(template["columns"], template["sample"]),
        }
        for key, template in IMPORT_TEMPLATES.items()
    })


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def data_import_csv(request, import_type):
    denied = admin_required_response(request)
    if denied:
        return denied

    import_type = normalize_key(import_type)
    importer = IMPORTERS.get(import_type)
    if not importer:
        return Response({"error": "Unknown import type."}, status=status.HTTP_404_NOT_FOUND)

    dry_run = bool_value(request.data.get("dry_run"), default=False)
    try:
        rows = read_csv_rows(request)
    except ValueError as error:
        return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)

    try:
        with transaction.atomic():
            result = importer(rows)
            if dry_run:
                transaction.set_rollback(True)
    except Exception as error:
        return Response({"error": f"Import failed: {error}"}, status=status.HTTP_400_BAD_REQUEST)

    result["dry_run"] = dry_run
    result["rows"] = len(rows)
    result["import_type"] = import_type
    return Response(result)


def delete_usage_records():
    count = 0
    for usage in MaterialUsage.objects.select_related("inventory").all():
        usage.delete()
        count += 1
    return count


def flush_job_ticket_data():
    counts = {}
    counts["job_ticket_usage"] = JobTicketUsage.objects.count()
    JobTicketUsage.objects.all().delete()
    counts["customer_order_events"] = CustomerOrderEvent.objects.count()
    CustomerOrderEvent.objects.all().delete()
    counts["customer_orders"] = CustomerOrder.objects.count()
    CustomerOrder.objects.all().delete()
    counts["production_schedule"] = ProductionSchedule.objects.count()
    ProductionSchedule.objects.all().delete()
    counts["job_ticket_events"] = JobTicketEvent.objects.count()
    JobTicketEvent.objects.all().delete()
    linked_quotes = QuoteRecord.objects.exclude(job_ticket=None)
    counts["linked_quotes"] = linked_quotes.count()
    linked_quotes.delete()
    counts["job_tickets"] = JobTicket.objects.count()
    JobTicket.objects.all().delete()
    return counts


def flush_flex_die_data():
    counts = {}
    counts["flex_die_history"] = ToolingHistory.objects.filter(tooling_type="flex_die").count()
    ToolingHistory.objects.filter(tooling_type="flex_die").delete()
    counts["flex_dies"] = FlexDie.objects.count()
    FlexDie.objects.all().delete()
    return counts


def flush_inventory_data(include_inventory=True):
    counts = {"material_usage": delete_usage_records()}
    if include_inventory:
        counts["raw_inventory"] = MaterialInventory.objects.count()
        MaterialInventory.objects.all().delete()
    return counts


def flush_finished_inventory_data():
    counts = {}
    linked_usage = MaterialUsage.objects.exclude(finished_inventory__isnull=True)
    counts["finished_inventory_usage"] = linked_usage.count()
    for usage in linked_usage:
        usage.delete()
    counts["finished_inventory"] = FinishedInventory.objects.count()
    FinishedInventory.objects.all().delete()
    return counts


@api_view(["POST"])
@parser_classes([JSONParser])
def data_flush(request):
    denied = admin_required_response(request)
    if denied:
        return denied

    confirmation = str(request.data.get("confirmation", "")).strip()
    if confirmation != "DELETE DATA":
        return Response({"error": "Type DELETE DATA to confirm."}, status=status.HTTP_400_BAD_REQUEST)

    scope = normalize_key(request.data.get("scope", "setup_data"))
    valid_scopes = {
        "setup_data",
        "job_tickets",
        "finished_inventory",
        "flex_dies",
        "inventory",
        "inventory_usage",
        "job_ticket_usage",
        "quotes",
    }
    if scope not in valid_scopes:
        return Response({"error": "Unknown flush scope."}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        counts = {}
        if scope in {"setup_data", "job_tickets"}:
            counts.update(flush_job_ticket_data())
        if scope in {"setup_data", "finished_inventory"}:
            counts.update(flush_finished_inventory_data())
        if scope in {"setup_data", "flex_dies"}:
            counts.update(flush_flex_die_data())
        if scope in {"setup_data", "inventory"}:
            counts.update(flush_inventory_data(include_inventory=True))
        if scope == "inventory_usage":
            counts.update(flush_inventory_data(include_inventory=False))
        if scope == "job_ticket_usage":
            counts["job_ticket_usage"] = JobTicketUsage.objects.count()
            JobTicketUsage.objects.all().delete()
        if scope in {"setup_data", "quotes"}:
            counts["quotes"] = QuoteRecord.objects.count()
            QuoteRecord.objects.all().delete()

    return Response({
        "scope": scope,
        "deleted": counts,
        "performed_by": str(request.data.get("performed_by", "")).strip(),
    })
