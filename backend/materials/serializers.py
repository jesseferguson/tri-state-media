from django.db.models import DecimalField, Sum
from django.db.models.functions import Coalesce
from rest_framework import serializers

from .models import CoaterRollTag, MaterialSpec, MaterialSupplierOption, MaterialUsage, RawMaterialInventory


class MaterialSpecSerializer(serializers.ModelSerializer):
    inventory_total_feet = serializers.SerializerMethodField()
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    face_material_name = serializers.CharField(source="face_material.name", read_only=True)
    face_material_code = serializers.CharField(source="face_material.code", read_only=True)
    face_material_family = serializers.CharField(source="face_material.material_family", read_only=True)
    liner_material_name = serializers.CharField(source="liner_material.name", read_only=True)
    liner_material_code = serializers.CharField(source="liner_material.code", read_only=True)
    liner_material_family = serializers.CharField(source="liner_material.material_family", read_only=True)
    adhesive_material_name = serializers.CharField(source="adhesive_material.name", read_only=True)
    adhesive_material_code = serializers.CharField(source="adhesive_material.code", read_only=True)
    adhesive_material_family = serializers.CharField(source="adhesive_material.material_family", read_only=True)
    silicone_material_name = serializers.CharField(source="silicone_material.name", read_only=True)
    silicone_material_code = serializers.CharField(source="silicone_material.code", read_only=True)
    silicone_material_family = serializers.CharField(source="silicone_material.material_family", read_only=True)
    coating_material_name = serializers.CharField(source="coating_material.name", read_only=True)
    coating_material_code = serializers.CharField(source="coating_material.code", read_only=True)
    coating_material_family = serializers.CharField(source="coating_material.material_family", read_only=True)

    class Meta:
        model = MaterialSpec
        fields = "__all__"

    def get_inventory_total_feet(self, obj):
        annotated_total = getattr(obj, "inventory_total_feet", None)
        if annotated_total is not None:
            return annotated_total

        footage_value = Coalesce(
            "length_feet",
            "quantity",
            output_field=DecimalField(max_digits=12, decimal_places=3),
        )
        return obj.inventory.filter(is_active=True).exclude(status__in=["depleted", "scrapped", "in_use"]).aggregate(
            total=Coalesce(
                Sum(footage_value),
                0,
                output_field=DecimalField(max_digits=14, decimal_places=2),
            )
        )["total"]


class MaterialSupplierOptionSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    material_code = serializers.CharField(source="material.code", read_only=True)
    material_type = serializers.CharField(source="material.material_type", read_only=True)
    material_family = serializers.CharField(source="material.material_family", read_only=True)
    supplier_lookup_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = MaterialSupplierOption
        fields = "__all__"


class RawMaterialInventorySerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    material_code = serializers.CharField(source="material.code", read_only=True)
    material_family = serializers.CharField(source="material.material_family", read_only=True)
    material_company = serializers.CharField(source="material.company", read_only=True)
    material_gsm = serializers.DecimalField(source="material.gsm", max_digits=8, decimal_places=2, read_only=True)
    material_liner_pounds = serializers.DecimalField(source="material.liner_pounds", max_digits=7, decimal_places=2, read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    location_full_path = serializers.ReadOnlyField(source="location.full_path")
    source_roll_tag_number = serializers.CharField(source="source_roll_tag.tag_number", read_only=True)

    class Meta:
        model = RawMaterialInventory
        fields = "__all__"


class MaterialUsageSerializer(serializers.ModelSerializer):
    inventory_name = serializers.CharField(source="inventory.name", read_only=True)
    inventory_serial = serializers.CharField(source="inventory.serial_number", read_only=True)
    inventory_lot = serializers.CharField(source="inventory.lot_number", read_only=True)
    inventory_width_inches = serializers.DecimalField(source="inventory.width_inches", max_digits=8, decimal_places=3, read_only=True)
    material_name = serializers.CharField(source="material.name", read_only=True)
    material_code = serializers.CharField(source="material.code", read_only=True)
    material_type = serializers.CharField(source="material.material_type", read_only=True)
    coater_roll_tag_number = serializers.CharField(source="coater_roll_tag.tag_number", read_only=True)
    finished_inventory_name = serializers.CharField(source="finished_inventory.name", read_only=True)
    finished_inventory_sku = serializers.CharField(source="finished_inventory.sku", read_only=True)

    class Meta:
        model = MaterialUsage
        fields = "__all__"


class CoaterRollTagSerializer(serializers.ModelSerializer):
    scheduled_material_name = serializers.CharField(source="scheduled_material.name", read_only=True)
    liner_name = serializers.CharField(source="liner.name", read_only=True)
    liner_code = serializers.CharField(source="liner.code", read_only=True)
    face_name = serializers.CharField(source="face.name", read_only=True)
    face_code = serializers.CharField(source="face.code", read_only=True)
    adhesive_name = serializers.CharField(source="adhesive.name", read_only=True)
    adhesive_code = serializers.CharField(source="adhesive.code", read_only=True)
    silicone_name = serializers.CharField(source="silicone.name", read_only=True)
    silicone_code = serializers.CharField(source="silicone.code", read_only=True)
    coating_name = serializers.CharField(source="coating.name", read_only=True)
    produced_material_name = serializers.CharField(source="produced_material.name", read_only=True)
    liner_inventory_serial = serializers.CharField(source="liner_inventory.serial_number", read_only=True)
    face_inventory_serial = serializers.CharField(source="face_inventory.serial_number", read_only=True)
    adhesive_inventory_serial = serializers.CharField(source="adhesive_inventory.serial_number", read_only=True)
    silicone_inventory_serial = serializers.CharField(source="silicone_inventory.serial_number", read_only=True)
    coating_inventory_serial = serializers.CharField(source="coating_inventory.serial_number", read_only=True)
    press_name = serializers.CharField(source="press.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    logged_inventory_serial = serializers.CharField(source="logged_inventory.serial_number", read_only=True)

    class Meta:
        model = CoaterRollTag
        fields = "__all__"
