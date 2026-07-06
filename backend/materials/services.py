import re
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qs, urlparse

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import CoaterRollTag, MaterialMovement, MaterialRack, MaterialSkid, MaterialUsage, RawMaterialInventory


class MaterialWorkflowError(Exception):
    def __init__(self, message, *, code="invalid", status_code=400, details=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details or {}


def roll_amount(roll):
    return Decimal(roll.length_feet if roll.length_feet is not None else roll.quantity or 0)


def skid_location(skid):
    if skid.current_rack_id:
        return f"Rack {skid.current_rack.rack_code}"
    return skid.other_location or "Plant Floor"


def roll_location(roll):
    if roll.status in {"depleted", "scrapped"} or roll_amount(roll) <= 0:
        return "Used / Consumed" if roll.status == "depleted" else "Scrapped"
    if roll.current_skid_id:
        if roll.current_skid.current_rack_id:
            return f"Skid {roll.current_skid.skid_number} / Rack {roll.current_skid.current_rack.rack_code}"
        return f"Skid {roll.current_skid.skid_number} / Plant Floor"
    if roll.location_id:
        return roll.location.full_path()
    return "Plant Floor"


def actor_context(request):
    return {
        "actor_name": str(
            request.data.get("performed_by")
            or request.data.get("used_by")
            or request.META.get("HTTP_X_COMPANY_USERNAME")
            or ""
        ).strip(),
        "actor_user_id": str(request.META.get("HTTP_X_COMPANY_USER_ID") or "").strip(),
        "device_info": str(request.META.get("HTTP_USER_AGENT") or "")[:500],
        "scan_session_id": str(request.data.get("scan_session_id") or "").strip()[:100],
    }


def movement(*, action_type, roll=None, skid=None, rack=None, source="manual", **kwargs):
    return MaterialMovement.objects.create(
        action_type=action_type,
        roll=roll,
        skid=skid,
        rack=rack,
        source=source,
        **kwargs,
    )


def _scan_candidates(value):
    text = str(value or "").strip()
    if not text:
        return []
    values = [text]
    try:
        parsed = urlparse(text)
        query = parse_qs(parsed.query)
        for key in ["rollTagId", "rollId", "inventoryId"]:
            values.extend(query.get(key, []))
        path_value = parsed.path.rstrip("/").split("/")[-1] if parsed.path else ""
        if path_value:
            values.append(path_value)
    except ValueError:
        pass
    match = re.search(r"(?:rollTagId|rollId|inventoryId)=([^&\s]+)", text, flags=re.IGNORECASE)
    if match:
        values.append(match.group(1))
    return list(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


def resolve_roll_scan(value, *, for_update=False, materialize_printed_tag=False):
    queryset = RawMaterialInventory.objects.select_related(
        "location",
        "current_skid",
        "current_skid__current_rack",
        "source_roll_tag",
    )
    if for_update:
        queryset = queryset.select_for_update()
    for candidate in _scan_candidates(value):
        filters = (
            Q(serial_number__iexact=candidate)
            | Q(lot_number__iexact=candidate)
            | Q(source_roll_tag__tag_number__iexact=candidate)
            | Q(source_roll_tag__result_serial_number__iexact=candidate)
            | Q(source_roll_tag__result_lot_number__iexact=candidate)
        )
        if candidate.isdigit():
            filters |= Q(pk=int(candidate)) | Q(source_roll_tag_id=int(candidate))
        roll = queryset.filter(filters).first()
        if roll:
            return roll

    if materialize_printed_tag:
        tag_queryset = CoaterRollTag.objects.filter(source_schedule__isnull=False).select_related(
            "logged_inventory",
            "produced_material",
            "scheduled_material",
        )
        if for_update:
            tag_queryset = tag_queryset.select_for_update()
        for candidate in _scan_candidates(value):
            filters = (
                Q(tag_number__iexact=candidate)
                | Q(result_serial_number__iexact=candidate)
                | Q(result_lot_number__iexact=candidate)
            )
            if candidate.isdigit():
                filters |= Q(pk=int(candidate))
            tag = tag_queryset.filter(filters).first()
            if not tag:
                continue
            if tag.logged_inventory_id:
                return tag.logged_inventory
            if not tag.length_feet or Decimal(tag.length_feet) <= 0:
                raise MaterialWorkflowError(
                    f"{tag.tag_number} has no roll footage. Edit the roll before adding it to a skid.",
                    code="roll_footage_required",
                    status_code=409,
                )
            tag.status = "complete"
            tag.log_inventory = True
            tag.run_date = tag.run_date or timezone.localdate()
            tag.save()
            if tag.logged_inventory_id:
                return tag.logged_inventory
            raise MaterialWorkflowError(
                f"{tag.tag_number} could not create its inventory record.",
                code="roll_inventory_missing",
                status_code=409,
            )
    raise MaterialWorkflowError("Scan not recognized.", code="scan_not_recognized", status_code=404)


def resolve_skid_scan(value, *, for_update=False):
    text = str(value or "").strip()
    if not text:
        raise MaterialWorkflowError("Scan a skid QR code.", code="missing_skid")
    candidates = [text]
    try:
        parsed = urlparse(text)
        query = parse_qs(parsed.query)
        candidates.extend(query.get("skidToken", []))
        if parsed.path:
            candidates.append(parsed.path.rstrip("/").split("/")[-1])
    except ValueError:
        pass
    queryset = MaterialSkid.objects.select_related("current_rack")
    if for_update:
        queryset = queryset.select_for_update()
    for candidate in dict.fromkeys(str(item).strip() for item in candidates if str(item).strip()):
        filters = Q(skid_number__iexact=candidate) | Q(qr_token__iexact=candidate)
        if candidate.isdigit():
            filters |= Q(pk=int(candidate))
        skid = queryset.filter(filters).first()
        if skid:
            return skid
    raise MaterialWorkflowError("Scan not recognized.", code="scan_not_recognized", status_code=404)


def resolve_rack_scan(value, *, for_update=False):
    text = str(value or "").strip()
    if not text:
        raise MaterialWorkflowError("Scan a rack QR code.", code="missing_rack")
    candidates = [text]
    try:
        parsed = urlparse(text)
        query = parse_qs(parsed.query)
        candidates.extend(query.get("rackToken", []))
        if parsed.path:
            candidates.append(parsed.path.rstrip("/").split("/")[-1])
    except ValueError:
        pass
    queryset = MaterialRack.objects.all()
    if for_update:
        queryset = queryset.select_for_update()
    for candidate in dict.fromkeys(str(item).strip() for item in candidates if str(item).strip()):
        filters = Q(rack_code__iexact=candidate) | Q(qr_token__iexact=candidate)
        if candidate.isdigit():
            filters |= Q(pk=int(candidate))
        rack = queryset.filter(filters).first()
        if rack:
            return rack
    raise MaterialWorkflowError("Scan not recognized.", code="scan_not_recognized", status_code=404)


@transaction.atomic
def add_roll_to_skid(*, skid_id, scan_value, actor, allow_move=False, source="scan"):
    skid = MaterialSkid.objects.select_for_update().select_related("current_rack").get(pk=skid_id)
    if skid.status != "active":
        raise MaterialWorkflowError(f"{skid.skid_number} is not active.", code="inactive_skid", status_code=409)
    roll = resolve_roll_scan(scan_value, for_update=True, materialize_printed_tag=True)
    before = roll_amount(roll)
    if not roll.is_active or roll.status in {"depleted", "scrapped"} or before <= 0:
        raise MaterialWorkflowError("This roll has already been fully used.", code="roll_consumed", status_code=409)
    if roll.current_skid_id == skid.id:
        raise MaterialWorkflowError(
            f"This roll is already on {skid.skid_number}.",
            code="already_on_skid",
            status_code=409,
        )
    previous_skid = roll.current_skid
    if previous_skid and not allow_move:
        raise MaterialWorkflowError(
            f"This roll is already on {previous_skid.skid_number}. Move it here?",
            code="roll_on_another_skid",
            status_code=409,
            details={"current_skid": previous_skid.skid_number, "requires_confirmation": True},
        )
    from_location = roll_location(roll)
    was_removed = MaterialMovement.objects.filter(
        roll=roll,
        action_type="roll_removed_from_skid",
    ).exists()
    roll.current_skid = skid
    roll.location = None
    roll.save(update_fields=["current_skid", "location"])
    movement(
        action_type="roll_added_back_to_skid" if was_removed else "roll_assigned_to_skid",
        roll=roll,
        skid=skid,
        rack=skid.current_rack,
        from_location=from_location,
        to_location=roll_location(roll),
        quantity_before=before,
        quantity_after=before,
        notes=f"Roll added to {skid.skid_number}.",
        source=source,
        **actor,
    )
    return roll, skid


@transaction.atomic
def remove_roll_from_skid(*, skid_id, roll_value, actor, source="scan"):
    skid = MaterialSkid.objects.select_for_update().select_related("current_rack").get(pk=skid_id)
    roll = resolve_roll_scan(roll_value, for_update=True)
    if roll.current_skid_id != skid.id:
        raise MaterialWorkflowError(
            f"This roll is not currently on {skid.skid_number}.",
            code="roll_not_on_skid",
            status_code=409,
        )
    before = roll_amount(roll)
    from_location = roll_location(roll)
    roll.current_skid = None
    roll.location = None
    roll.save(update_fields=["current_skid", "location"])
    movement(
        action_type="roll_removed_from_skid",
        roll=roll,
        skid=skid,
        rack=skid.current_rack,
        from_location=from_location,
        to_location="Plant Floor",
        quantity_before=before,
        quantity_after=before,
        notes=f"Roll removed from {skid.skid_number}.",
        source=source,
        **actor,
    )
    return roll, skid


@transaction.atomic
def use_roll_from_skid(*, skid_id, roll_value, actor, use_all=False, amount_used=None, notes="", source="scan"):
    skid = MaterialSkid.objects.select_for_update().select_related("current_rack").get(pk=skid_id)
    roll = resolve_roll_scan(roll_value, for_update=True)
    if roll.current_skid_id != skid.id:
        raise MaterialWorkflowError(
            f"This roll is not currently on {skid.skid_number}.",
            code="roll_not_on_skid",
            status_code=409,
        )
    before = roll_amount(roll)
    if before <= 0:
        raise MaterialWorkflowError("This roll has already been fully used.", code="roll_consumed", status_code=409)
    try:
        used = before if use_all else Decimal(str(amount_used))
    except (InvalidOperation, TypeError, ValueError):
        raise MaterialWorkflowError("Enter the footage used.", code="invalid_amount")
    if used <= 0:
        raise MaterialWorkflowError("Footage used must be greater than zero.", code="invalid_amount")
    if used > before:
        raise MaterialWorkflowError(
            f"Only {before} ft remain on this roll.",
            code="amount_exceeds_remaining",
            status_code=409,
            details={"remaining": before},
        )
    from_location = roll_location(roll)
    usage = MaterialUsage.objects.create(
        inventory=roll,
        material=roll.material,
        usage_type="manual",
        quantity=used,
        unit="lf",
        used_date=timezone.localdate(),
        used_by=actor.get("actor_name", ""),
        reference=skid.skid_number,
        notes=notes or ("Full roll used from skid." if used == before else "Partial roll usage from skid."),
    )
    roll.refresh_from_db()
    after = roll_amount(roll)
    fully_used = after <= 0
    if fully_used:
        roll.current_skid = None
        roll.status = "depleted"
        roll.save(update_fields=["current_skid", "status"])
    else:
        roll.status = "available"
        roll.save(update_fields=["status"])
    movement(
        action_type="roll_fully_used" if fully_used else "roll_partially_used",
        roll=roll,
        skid=skid,
        rack=skid.current_rack,
        from_location=from_location,
        to_location="Used / Consumed" if fully_used else roll_location(roll),
        quantity_before=before,
        quantity_after=after,
        amount_used=used,
        notes=notes,
        source=source,
        **actor,
    )
    return roll, usage, skid


@transaction.atomic
def add_skid_to_rack(*, rack_id, skid_value, actor, allow_move=False, source="scan"):
    rack = MaterialRack.objects.select_for_update().get(pk=rack_id)
    if rack.status != "active":
        raise MaterialWorkflowError("This rack is inactive.", code="inactive_rack", status_code=409)
    skid = resolve_skid_scan(skid_value, for_update=True)
    if skid.status != "active":
        raise MaterialWorkflowError(f"{skid.skid_number} is not active.", code="inactive_skid", status_code=409)
    if skid.current_rack_id == rack.id:
        raise MaterialWorkflowError(
            f"This skid is already in {rack.rack_code}.",
            code="already_in_rack",
            status_code=409,
        )
    if skid.current_rack_id and not allow_move:
        raise MaterialWorkflowError(
            f"This skid is already in {skid.current_rack.rack_code}. Move it here?",
            code="skid_in_another_rack",
            status_code=409,
            details={"current_rack": skid.current_rack.rack_code, "requires_confirmation": True},
        )
    from_location = skid_location(skid)
    skid.current_rack = rack
    skid.other_location = ""
    skid.save(update_fields=["current_rack", "other_location", "updated_at"])
    movement(
        action_type="skid_assigned_to_rack",
        skid=skid,
        rack=rack,
        from_location=from_location,
        to_location=f"Rack {rack.rack_code}",
        notes=f"{skid.skid_number} moved into {rack.rack_code}.",
        source=source,
        **actor,
    )
    return skid, rack


@transaction.atomic
def remove_skid_from_rack(*, rack_id, skid_value, actor, source="scan"):
    rack = MaterialRack.objects.select_for_update().get(pk=rack_id)
    skid = resolve_skid_scan(skid_value, for_update=True)
    if skid.current_rack_id != rack.id:
        raise MaterialWorkflowError(
            f"{skid.skid_number} is not currently in {rack.rack_code}.",
            code="skid_not_in_rack",
            status_code=409,
        )
    skid.current_rack = None
    skid.other_location = ""
    skid.save(update_fields=["current_rack", "other_location", "updated_at"])
    movement(
        action_type="skid_removed_from_rack",
        skid=skid,
        rack=rack,
        from_location=f"Rack {rack.rack_code}",
        to_location="Plant Floor",
        notes=f"{skid.skid_number} removed from {rack.rack_code}.",
        source=source,
        **actor,
    )
    return skid, rack
