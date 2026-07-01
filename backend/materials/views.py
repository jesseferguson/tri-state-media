from decimal import Decimal
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

from django.conf import settings
from django.db import transaction
from django.db.models import DecimalField, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from tooling.models import Press

from .models import CoaterRollTag, MaterialMasterType, MaterialSpec, MaterialSupplierOption, MaterialUsage, RawMaterialInventory
from .serializers import (
    CoaterRollTagSerializer,
    MaterialMasterTypeSerializer,
    MaterialSpecSerializer,
    MaterialSupplierOptionSerializer,
    MaterialUsageSerializer,
    RawMaterialInventorySerializer,
)


class BaseMaterialsViewSet(viewsets.ModelViewSet):
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]


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
            RawMaterialInventory.objects.select_related("material", "material__master_type", "supplier", "location", "source_roll_tag")
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
        return qs


class CoaterRollTagViewSet(BaseMaterialsViewSet):
    queryset = (
        CoaterRollTag.objects.select_related(
            "scheduled_material",
            "liner",
            "face",
            "adhesive",
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
            "press",
            "location",
            "logged_inventory",
        )
        .all()
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
        )

        tag = self.get_object()
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
        part_number = tag.result_code or getattr(material, "code", "") or tag.name
        queue_key = _firebase_safe_key(press.printer_queue_key or press.name or printer_ip)
        frontend_base = _print_text(request.data, "frontend_url", settings.FRONTEND_PUBLIC_URL).rstrip("/")
        if urlparse(frontend_base).hostname in {"localhost", "127.0.0.1"}:
            frontend_base = settings.FRONTEND_PUBLIC_URL
        roll_tag_url = f"{frontend_base}/?rollTagId={tag.pk}"
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
        tag.save(update_fields=["print_status", "updated_at"])
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
                "copies": payload.get("Total Ship Stock"),
                "rollTagUrl": roll_tag_url,
            },
            status=status.HTTP_201_CREATED,
        )
