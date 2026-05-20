import csv
import io
import re
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date
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
from tooling.models import FlexDie, Supplier, ToolingHistory, ToolingLocation, ToolingRecipe

from .models import (
    BoxSpec,
    Customer,
    CustomerOrder,
    CustomerOrderEvent,
    JobTicket,
    JobTicketEvent,
    ProductionSchedule,
    QuoteRecord,
)


JOB_TICKET_COLUMNS = [
    "row_id",
    "ticket_number",
    "tsm_id",
    "customer_name",
    "customer_code",
    "job_number",
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
    "labels_per_unit",
    "units_per_carton",
    "labels_per_carton",
    "box_item_number",
    "core_size",
    "wind",
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

IMPORT_TEMPLATES = {
    "job_tickets": {
        "label": "Job Tickets",
        "description": "Imports production job tickets. The legacy row_id is preserved in notes and can be used as a fallback ticket number.",
        "columns": JOB_TICKET_COLUMNS,
        "sample": {
            "row_id": "12345",
            "ticket_number": "1-000-001",
            "tsm_id": "1-000-001",
            "customer_name": "Tri-State Media",
            "customer_code": "TRI",
            "job_number": "MAR-PMDT-225-75-R-NP",
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
            "labels_per_unit": "3600",
            "units_per_carton": "3600",
            "labels_per_carton": "",
            "box_item_number": "",
            "core_size": "3",
            "wind": "1",
            "job_notes": "Imported from old system",
        },
    },
    "flex_dies": {
        "label": "Flex Dies",
        "description": "Imports flex die jackets/folders. Serial numbers can be separated with semicolons, pipes, or new lines.",
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
}


def sample_csv(columns, sample):
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerow({column: sample.get(column, "") for column in columns})
    return stream.getvalue()


def normalize_key(key):
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", str(key or "").strip().lower())).strip("_")


def normalize_row(row):
    return {normalize_key(key): str(value or "").strip() for key, value in row.items()}


def first(row, *keys, default=""):
    for key in keys:
        value = row.get(normalize_key(key), "")
        if value not in ("", None):
            return str(value).strip()
    return default


def decimal_or_none(value):
    if value in ("", None):
        return None
    try:
        return Decimal(str(value).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return None


def int_or_none(value):
    number = decimal_or_none(value)
    if number is None:
        return None
    return int(number)


def bool_value(value, default=False):
    if value in ("", None):
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "manual"}


def date_value(value):
    if not value:
        return None
    parsed = parse_date(str(value).strip())
    return parsed


def clean_code(value):
    text = str(value or "").strip()
    if "/" in text:
        text = text.split("/", 1)[0].strip()
    return text


def append_legacy_note(existing_note, row_id):
    note = str(existing_note or "").strip()
    row_id = str(row_id or "").strip()
    if not row_id:
        return note
    legacy = f"Legacy Row ID: {row_id}"
    if legacy in note:
        return note
    return "\n".join([part for part in [note, legacy] if part])


def choice_value(value, choices, default):
    text = str(value or "").strip()
    if not text:
        return default
    normalized = normalize_key(text)
    for key, label in choices:
        if normalized in {normalize_key(key), normalize_key(label)}:
            return key
    return default


def read_csv_rows(request):
    upload = request.FILES.get("file")
    if not upload:
        raise ValueError("Attach a CSV file named file.")

    text = upload.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV file needs a header row.")

    return [(index, normalize_row(row)) for index, row in enumerate(reader, start=2)]


def import_result():
    return {"created": 0, "updated": 0, "skipped": 0, "errors": [], "warnings": []}


def add_error(result, line_number, message):
    result["skipped"] += 1
    result["errors"].append({"line": line_number, "message": message})


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


def find_box(item_number="", name=""):
    item_number = str(item_number or "").strip()
    name = str(name or "").strip()
    if item_number:
        box = BoxSpec.objects.filter(item_number__iexact=item_number).first()
        if box:
            return box
    if name:
        return BoxSpec.objects.filter(name__iexact=name).first()
    return None


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
        ticket_number = first(row, "ticket_number", "tsm_id", "product_code", "row_id")
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
            first(row, "finished_material_code", "material_code", "material_spec_code"),
            first(row, "finished_material_name", "material_name"),
            "coated_stock",
            master_type,
        )
        recipe = find_recipe(first(row, "recipe_name", "recipe"))
        box = find_box(first(row, "box_item_number", "box_code"), first(row, "box_name"))

        label_length = decimal_or_none(first(row, "label_length", "label_length_inches", "length"))
        repeat = decimal_or_none(first(row, "repeat", "repeat_inches"))
        gap = decimal_or_none(first(row, "gap", "gap_around", "gap_around_inches"))
        if repeat is None and label_length is not None and gap is not None:
            repeat = label_length + gap

        existing = JobTicket.objects.filter(ticket_number=ticket_number).first()
        notes = append_legacy_note(first(row, "job_notes", "notes"), row_id)
        defaults = {
            "customer": customer,
            "customer_name": customer.name if customer else customer_name,
            "job_name": first(row, "job_number", "job_name", "part_number", default=ticket_number),
            "product_code": first(row, "tsm_id", "product_code", default=ticket_number),
            "label_width_inches": decimal_or_none(first(row, "label_width", "label_width_inches", "width")),
            "label_length_inches": label_length,
            "repeat_inches": repeat,
            "cutting_type": choice_value(first(row, "cutting_type"), JobTicket.CUTTING_TYPE_CHOICES, "to_liner"),
            "face_type": first(row, "face_type", "face"),
            "liner_type": first(row, "liner_type", "liner"),
            "material_master_type": master_type or (material_spec.master_type if material_spec else None),
            "material_spec": material_spec,
            "recipe": recipe,
            "requested_quantity": decimal_or_none(first(row, "requested_quantity", "quantity")) or Decimal("0"),
            "finishing_type": choice_value(first(row, "finishing_type", "finishing"), JobTicket.FINISHING_TYPE_CHOICES, "rolls"),
            "labels_per_unit": int_or_none(first(row, "labels_per_unit", "labels_per_roll")),
            "units_per_carton": int_or_none(first(row, "units_per_carton", "units_in_carton", "labels_in_box")),
            "labels_per_carton": int_or_none(first(row, "labels_per_carton", "number_of_labels_in_box")),
            "box": box,
            "core_size_inches": decimal_or_none(first(row, "core_size", "core_size_inches")),
            "wind_direction": first(row, "wind", "wind_direction"),
            "finishing_notes": first(row, "finishing_notes"),
            "job_notes": notes,
        }
        ticket = existing or JobTicket(ticket_number=ticket_number)
        save_model(ticket, defaults, result)
    return result


def import_flex_dies(rows):
    result = import_result()
    for line_number, row in rows:
        name = first(row, "name", "tool_number", "die_number", "row_id")
        if not name:
            add_error(result, line_number, "Missing name or row_id.")
            continue

        label_width = decimal_or_none(first(row, "label_width", "label_width_inches", "width"))
        label_length = decimal_or_none(first(row, "label_length", "label_length_inches", "length"))
        repeat = decimal_or_none(first(row, "repeat", "repeat_inches"))
        gap_around = decimal_or_none(first(row, "gap_around", "gap", "gap_around_inches"))
        if repeat is None and label_length is not None and gap_around is not None:
            repeat = label_length + gap_around
        if label_width is None or label_length is None or repeat is None:
            add_error(result, line_number, "Flex die rows need label_width, label_length, and repeat.")
            continue

        serials = serial_number_text(first(row, "serial_numbers", "serial_number"))
        active_count = int_or_none(first(row, "active_die_count"))
        if active_count is None:
            active_count = len([line for line in serials.splitlines() if line.strip()]) or 1

        web_width = decimal_or_none(first(row, "web_width", "web_width_inches"))
        manual_web_width = bool_value(first(row, "manual_web_width"), default=web_width is not None)
        existing = FlexDie.objects.filter(name__iexact=name).first()
        defaults = {
            "supplier": find_or_create_supplier(first(row, "supplier_name", "supplier")),
            "current_location": find_or_create_location(first(row, "location_code"), first(row, "location_name", "location")),
            "status": choice_value(first(row, "status"), FlexDie.STATUS_CHOICES, "in_stock"),
            "label_width_inches": label_width,
            "label_length_inches": label_length,
            "repeat_inches": repeat,
            "face_type": first(row, "face_type", "face"),
            "liner_type": first(row, "liner_type", "liner"),
            "shape_type": choice_value(first(row, "shape_type", "shape"), FlexDie.SHAPE_TYPE_CHOICES, "rcr"),
            "cutting_type": choice_value(first(row, "cutting_type"), FlexDie.CUTTING_TYPE_CHOICES, "to_liner"),
            "gear": int_or_none(first(row, "gear", "gear_tooth_count")),
            "number_across": int_or_none(first(row, "number_across", "across")) or 1,
            "number_around": int_or_none(first(row, "number_around", "around")) or 1,
            "corner_radius_inches": decimal_or_none(first(row, "corner_radius", "corner_radius_inches")),
            "gap_across_inches": decimal_or_none(first(row, "gap_across", "gap", "gap_across_inches")),
            "gap_around_inches": gap_around,
            "manual_web_width": manual_web_width,
            "web_width_inches": web_width,
            "original_serial_number": first(row, "original_serial_number", "original_serial"),
            "serial_numbers": serials,
            "active_die_count": active_count,
            "target_die_count": int_or_none(first(row, "target_die_count")) or active_count or 1,
        }
        die = existing or FlexDie(name=name)
        save_model(die, defaults, result)
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
            "notes": append_legacy_note(first(row, "notes"), first(row, "row_id")),
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
            "notes": append_legacy_note(first(row, "notes"), first(row, "row_id")),
        }
        usage = existing or MaterialUsage()
        save_model(usage, defaults, result)
    return result


IMPORTERS = {
    "job_tickets": import_job_tickets,
    "flex_dies": import_flex_dies,
    "inventory": import_inventory,
    "inventory_usage": import_inventory_usage,
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
    import_type = normalize_key(import_type)
    importer = IMPORTERS.get(import_type)
    if not importer:
        return Response({"error": "Unknown import type."}, status=status.HTTP_404_NOT_FOUND)

    dry_run = bool_value(request.data.get("dry_run"), default=False)
    try:
        rows = read_csv_rows(request)
    except ValueError as error:
        return Response({"error": str(error)}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        result = importer(rows)
        if dry_run:
            transaction.set_rollback(True)

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


@api_view(["POST"])
@parser_classes([JSONParser])
def data_flush(request):
    confirmation = str(request.data.get("confirmation", "")).strip()
    if confirmation != "DELETE DATA":
        return Response({"error": "Type DELETE DATA to confirm."}, status=status.HTTP_400_BAD_REQUEST)

    scope = normalize_key(request.data.get("scope", "setup_data"))
    valid_scopes = {"setup_data", "job_tickets", "flex_dies", "inventory", "inventory_usage", "quotes"}
    if scope not in valid_scopes:
        return Response({"error": "Unknown flush scope."}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        counts = {}
        if scope in {"setup_data", "job_tickets"}:
            counts.update(flush_job_ticket_data())
        if scope in {"setup_data", "flex_dies"}:
            counts.update(flush_flex_die_data())
        if scope in {"setup_data", "inventory"}:
            counts.update(flush_inventory_data(include_inventory=True))
        if scope == "inventory_usage":
            counts.update(flush_inventory_data(include_inventory=False))
        if scope in {"setup_data", "quotes"}:
            counts["quotes"] = QuoteRecord.objects.count()
            QuoteRecord.objects.all().delete()

    return Response({
        "scope": scope,
        "deleted": counts,
        "performed_by": str(request.data.get("performed_by", "")).strip(),
    })
