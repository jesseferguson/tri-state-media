"""Read-only, exact identification of the physical roll named by a scan."""

from urllib.parse import parse_qs, urlparse

from django.conf import settings
from django.db.models import Q

from .models import CoaterRollTag, RawMaterialInventory
from .serializers import CoaterRollTagSerializer, MaterialSpecSerializer, RawMaterialInventorySerializer
from .services import MaterialWorkflowError


def _not_found():
    return MaterialWorkflowError("No roll matches this code. Scan its Tri-State label or enter its exact serial number.", code="scan_not_recognized", status_code=404)


def _ambiguous():
    return MaterialWorkflowError("This code matches more than one roll. Scan the QR code for the individual roll.", code="ambiguous_roll_scan", status_code=409)


def parse_intake_scan(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 2048:
        raise MaterialWorkflowError("Scan a roll label or enter its serial number.", code="invalid_roll_scan")
    value = value.strip()
    try:
        parsed = urlparse(value)
        is_url = bool(parsed.scheme or parsed.netloc or "?" in value or value.startswith("/"))
        if not is_url:
            return "text", value
        if parsed.scheme or parsed.netloc:
            allowed_origins = [settings.FRONTEND_PUBLIC_URL, *settings.CORS_ALLOWED_ORIGINS]
            trusted = {(urlparse(origin).scheme.lower(), urlparse(origin).netloc.lower()) for origin in allowed_origins}
            if parsed.scheme.lower() not in {"http", "https"} or (parsed.scheme.lower(), parsed.netloc.lower()) not in trusted:
                raise MaterialWorkflowError("This QR code is not from a trusted Tri-State address. Enter the printed roll serial number instead.", code="untrusted_roll_url")
        query = parse_qs(parsed.query, keep_blank_values=True)
    except ValueError as error:
        raise MaterialWorkflowError("This roll QR code is malformed.", code="invalid_roll_scan") from error
    selectors = [key for key in ["rollTagId", "inventoryId", "rollId"] if key in query]
    if len(selectors) != 1 or any(key in query for key in ["skidToken", "rackToken"]):
        raise MaterialWorkflowError("Scan an individual roll QR code, not a skid, rack, or schedule label.", code="wrong_scan_type")
    values = query[selectors[0]]
    if len(values) != 1 or not values[0].isascii() or not values[0].isdigit() or not 0 < int(values[0]) <= 9223372036854775807:
        raise MaterialWorkflowError("This roll QR code has an invalid identifier.", code="invalid_roll_scan")
    return ("tag" if selectors[0] == "rollTagId" else "inventory"), int(values[0])


def inventory_for_tag(tag):
    rows = list(RawMaterialInventory.objects.filter(Q(source_roll_tag=tag) | Q(pk=tag.logged_inventory_id)).distinct()[:2])
    if len(rows) > 1:
        raise _ambiguous()
    return rows[0] if rows else None


def validate_produced_tag(tag):
    if not tag.source_schedule_id and not tag.logged_inventory_id:
        raise MaterialWorkflowError("This label identifies a coater schedule. Scan the printed label for an individual roll.", code="schedule_not_roll")
    if tag.status in {"void", "on_hold"}:
        raise MaterialWorkflowError("This roll is void or on hold. Have production review it before receiving material.", code="roll_unavailable", status_code=409)


def lookup_intake_scan(value):
    kind, identifier = parse_intake_scan(value)
    inventory = None
    tag = None
    if kind == "inventory":
        inventory = RawMaterialInventory.objects.filter(pk=identifier).first()
        if not inventory:
            raise _not_found()
    elif kind == "tag":
        tag = CoaterRollTag.objects.filter(pk=identifier).first()
        if not tag:
            raise _not_found()
    else:
        inventories = list(RawMaterialInventory.objects.filter(serial_number__iexact=identifier)[:2])
        tags = list(CoaterRollTag.objects.filter(Q(tag_number__iexact=identifier) | Q(result_serial_number__iexact=identifier))[:2])
        if len(inventories) > 1 or len(tags) > 1:
            raise _ambiguous()
        inventory = inventories[0] if inventories else None
        tag = tags[0] if tags else None
        if not inventory and not tag:
            raise _not_found()
        if inventory and tag and inventory.source_roll_tag_id != tag.pk and tag.logged_inventory_id != inventory.pk:
            raise _ambiguous()

    if inventory and not tag:
        tags = list(CoaterRollTag.objects.filter(Q(pk=inventory.source_roll_tag_id) | Q(logged_inventory=inventory)).distinct()[:2])
        if len(tags) > 1:
            raise _ambiguous()
        tag = tags[0] if tags else None
    if tag:
        validate_produced_tag(tag)
        linked = inventory_for_tag(tag)
        if inventory and linked and inventory.pk != linked.pk:
            raise _ambiguous()
        inventory = inventory or linked
        if not inventory and tag.status == "complete":
            raise MaterialWorkflowError("This roll is marked complete but its inventory record is missing. Have production review it before receiving it again.", code="roll_inventory_missing", status_code=409)

    material = inventory.material if inventory else (tag.produced_material or tag.scheduled_material)
    return {
        "kind": "inventory" if inventory else "pending_tag",
        "inventory": RawMaterialInventorySerializer(inventory).data if inventory else None,
        "roll_tag": CoaterRollTagSerializer(tag).data if tag else None,
        "material": MaterialSpecSerializer(material).data if material else None,
    }
