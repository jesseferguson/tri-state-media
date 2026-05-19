from decimal import Decimal

from django.db import transaction
from django.db.models import DecimalField, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

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
            qs = qs.filter(material_type=material_type)
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
            )
            .all()
            .order_by("-used_date", "-created_at")
        )
        material = self.request.query_params.get("material")
        inventory = self.request.query_params.get("inventory")
        if material:
            qs = qs.filter(material_id=material)
        if inventory:
            qs = qs.filter(inventory_id=inventory)
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
