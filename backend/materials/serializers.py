import re

from django.db.models import DecimalField, Sum
from django.db.models.functions import Coalesce
from rest_framework import serializers

from .models import CoaterRollTag, MaterialMasterType, MaterialSpec, MaterialSupplierOption, MaterialUsage, RawMaterialInventory


def note_value(note, label):
    match = re.search(rf"^{re.escape(label)}:\s*(.+?)\s*$", str(note or ""), flags=re.IGNORECASE | re.MULTILINE)
    return match.group(1).strip() if match else ""


class MaterialMasterTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaterialMasterType
        fields = "__all__"


class MaterialSpecSerializer(serializers.ModelSerializer):
    inventory_total_feet = serializers.SerializerMethodField()
    allowed_face_material_summary = serializers.SerializerMethodField()
    allowed_liner_material_summary = serializers.SerializerMethodField()
    allowed_adhesive_material_summary = serializers.SerializerMethodField()
    allowed_silicone_material_summary = serializers.SerializerMethodField()
    allowed_coating_material_summary = serializers.SerializerMethodField()
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    master_type_code = serializers.CharField(source="master_type.code", read_only=True)
    master_type_name = serializers.CharField(source="master_type.name", read_only=True)
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

    def component_summary(self, obj, relation_name, fallback=None):
        values = []
        if fallback:
            values.append(fallback)
        relation = getattr(obj, relation_name)
        for item in relation.all():
            label = item.material_family or item.name or item.code
            if label and label not in values:
                values.append(label)
        return " / ".join(values)

    def get_allowed_face_material_summary(self, obj):
        fallback = obj.face_material.material_family or obj.face_material.name if obj.face_material_id else ""
        return self.component_summary(obj, "allowed_face_materials", fallback)

    def get_allowed_liner_material_summary(self, obj):
        fallback = obj.liner_material.material_family or obj.liner_material.name if obj.liner_material_id else ""
        return self.component_summary(obj, "allowed_liner_materials", fallback)

    def get_allowed_adhesive_material_summary(self, obj):
        fallback = obj.adhesive_material.material_family or obj.adhesive_material.name if obj.adhesive_material_id else ""
        return self.component_summary(obj, "allowed_adhesive_materials", fallback)

    def get_allowed_silicone_material_summary(self, obj):
        fallback = obj.silicone_material.material_family or obj.silicone_material.name if obj.silicone_material_id else ""
        return self.component_summary(obj, "allowed_silicone_materials", fallback)

    def get_allowed_coating_material_summary(self, obj):
        fallback = obj.coating_material.material_family or obj.coating_material.name if obj.coating_material_id else ""
        return self.component_summary(obj, "allowed_coating_materials", fallback)

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
    material_master_type = serializers.IntegerField(source="material.master_type_id", read_only=True)
    material_master_type_code = serializers.CharField(source="material.master_type.code", read_only=True)
    material_master_type_name = serializers.CharField(source="material.master_type.name", read_only=True)
    supplier_lookup_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = MaterialSupplierOption
        fields = "__all__"


class RawMaterialInventorySerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    material_code = serializers.CharField(source="material.code", read_only=True)
    material_family = serializers.CharField(source="material.material_family", read_only=True)
    material_master_type = serializers.IntegerField(source="material.master_type_id", read_only=True)
    material_master_type_code = serializers.CharField(source="material.master_type.code", read_only=True)
    material_master_type_name = serializers.CharField(source="material.master_type.name", read_only=True)
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
    finished_inventory_unit = serializers.CharField(source="finished_inventory.unit", read_only=True)
    finished_inventory_location_name = serializers.CharField(source="finished_inventory.location.name", read_only=True)
    finished_inventory_location_full_path = serializers.ReadOnlyField(source="finished_inventory.location.full_path")
    finished_inventory_job_ticket = serializers.IntegerField(source="finished_inventory.job_ticket_id", read_only=True)
    finished_inventory_job_ticket_number = serializers.CharField(source="finished_inventory.job_ticket.ticket_number", read_only=True)
    finished_inventory_job_product_code = serializers.CharField(source="finished_inventory.job_ticket.product_code", read_only=True)
    finished_inventory_imported_tsm_id = serializers.SerializerMethodField()

    def get_finished_inventory_imported_tsm_id(self, obj):
        return note_value(obj.finished_inventory.notes if obj.finished_inventory else "", "Imported TSM ID")

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
    liner_supplier_name = serializers.CharField(source="liner_supplier_option.supplier_name", read_only=True)
    liner_supplier_item_number = serializers.CharField(source="liner_supplier_option.supplier_item_number", read_only=True)
    face_supplier_name = serializers.CharField(source="face_supplier_option.supplier_name", read_only=True)
    face_supplier_item_number = serializers.CharField(source="face_supplier_option.supplier_item_number", read_only=True)
    adhesive_supplier_name = serializers.CharField(source="adhesive_supplier_option.supplier_name", read_only=True)
    adhesive_supplier_item_number = serializers.CharField(source="adhesive_supplier_option.supplier_item_number", read_only=True)
    silicone_supplier_name = serializers.CharField(source="silicone_supplier_option.supplier_name", read_only=True)
    silicone_supplier_item_number = serializers.CharField(source="silicone_supplier_option.supplier_item_number", read_only=True)
    coating_supplier_name = serializers.CharField(source="coating_supplier_option.supplier_name", read_only=True)
    coating_supplier_item_number = serializers.CharField(source="coating_supplier_option.supplier_item_number", read_only=True)
    press_name = serializers.CharField(source="press.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    logged_inventory_serial = serializers.CharField(source="logged_inventory.serial_number", read_only=True)
    schedule_id = serializers.SerializerMethodField()
    schedule_tag_number = serializers.SerializerMethodField()
    schedule_roll_count = serializers.SerializerMethodField()
    is_schedule = serializers.SerializerMethodField()

    class Meta:
        model = CoaterRollTag
        fields = "__all__"

    def get_schedule_id(self, obj):
        return obj.source_schedule_id or obj.pk

    def get_schedule_tag_number(self, obj):
        return obj.source_schedule.tag_number if obj.source_schedule_id else obj.tag_number

    def get_schedule_roll_count(self, obj):
        schedule = obj.source_schedule if obj.source_schedule_id else obj
        return sum(1 for roll in schedule.produced_rolls.all() if roll.status != "void")

    def get_is_schedule(self, obj):
        return not obj.source_schedule_id and not obj.log_inventory

    @staticmethod
    def component_family_key(material):
        return str(material.material_family or material.name or material.code or "").strip().lower()

    def validate(self, attrs):
        attrs = super().validate(attrs)
        errors = {}
        for component_key in ["liner", "face", "adhesive", "silicone", "coating"]:
            material = attrs.get(component_key, getattr(self.instance, component_key, None))
            option_key = f"{component_key}_supplier_option"
            option = attrs.get(option_key, getattr(self.instance, option_key, None))
            same_family = (
                option
                and material
                and option.material.material_type == material.material_type
                and self.component_family_key(option.material) == self.component_family_key(material)
            )
            if option and material and option.material_id != material.id and not same_family:
                errors[option_key] = [f"Select a supplier option linked to this {component_key} type."]
        if errors:
            raise serializers.ValidationError(errors)
        return attrs
