from django.contrib import admin

from .models import CoaterRollTag, MaterialMasterType, MaterialSpec, MaterialSupplierOption, MaterialUsage, RawMaterialInventory


@admin.register(MaterialMasterType)
class MaterialMasterTypeAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("code", "name", "description")


@admin.register(MaterialSpec)
class MaterialSpecAdmin(admin.ModelAdmin):
    list_display = (
        "material_type",
        "code",
        "name",
        "company",
        "face_material",
        "liner_material",
        "adhesive_material",
        "silicone_material",
        "coating_material",
        "allowed_face_material_summary",
        "allowed_liner_material_summary",
        "allowed_adhesive_material_summary",
        "allowed_silicone_material_summary",
        "liner_pounds",
        "gsm",
        "material_family",
        "master_type",
        "is_active",
    )
    list_filter = ("material_type", "master_type", "company", "is_active")
    search_fields = (
        "code",
        "name",
        "company",
        "material_family",
        "master_type__code",
        "master_type__name",
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
    )
    autocomplete_fields = (
        "supplier",
        "master_type",
        "face_material",
        "liner_material",
        "adhesive_material",
        "silicone_material",
        "coating_material",
        "allowed_face_materials",
        "allowed_liner_materials",
        "allowed_adhesive_materials",
        "allowed_silicone_materials",
        "allowed_coating_materials",
    )

    def _component_summary(self, obj, relation_name):
        values = []
        for item in getattr(obj, relation_name).all():
            label = item.material_family or item.name or item.code
            if label and label not in values:
                values.append(label)
        return " / ".join(values)

    def allowed_face_material_summary(self, obj):
        return self._component_summary(obj, "allowed_face_materials")

    def allowed_liner_material_summary(self, obj):
        return self._component_summary(obj, "allowed_liner_materials")

    def allowed_adhesive_material_summary(self, obj):
        return self._component_summary(obj, "allowed_adhesive_materials")

    def allowed_silicone_material_summary(self, obj):
        return self._component_summary(obj, "allowed_silicone_materials")


@admin.register(MaterialSupplierOption)
class MaterialSupplierOptionAdmin(admin.ModelAdmin):
    list_display = (
        "material",
        "supplier_name",
        "option_name",
        "supplier_item_number",
        "thickness_mil",
        "width_inches",
        "length_feet",
        "is_active",
    )
    list_filter = ("material__material_type", "supplier_name", "is_active")
    search_fields = (
        "material__name",
        "material__code",
        "supplier__name",
        "supplier_name",
        "option_name",
        "supplier_item_number",
        "notes",
    )
    autocomplete_fields = ("material", "supplier")


@admin.register(RawMaterialInventory)
class RawMaterialInventoryAdmin(admin.ModelAdmin):
    list_display = (
        "material_type",
        "name",
        "code",
        "serial_number",
        "lot_number",
        "width_inches",
        "length_feet",
        "weight_lbs",
        "quantity",
        "unit",
        "status",
        "location",
    )
    list_filter = ("material_type", "status", "unit", "is_active")
    search_fields = ("name", "code", "serial_number", "lot_number", "material__name", "material__code", "notes")
    autocomplete_fields = ("material", "supplier", "location", "source_roll_tag")


@admin.register(MaterialUsage)
class MaterialUsageAdmin(admin.ModelAdmin):
    list_display = (
        "used_date",
        "usage_type",
        "material",
        "inventory",
        "quantity",
        "unit",
        "used_by",
        "reference",
    )
    list_filter = ("usage_type", "unit", "used_date")
    search_fields = (
        "material__name",
        "material__code",
        "inventory__name",
        "inventory__serial_number",
        "inventory__lot_number",
        "used_by",
        "reference",
        "notes",
    )
    autocomplete_fields = ("inventory", "material", "coater_roll_tag", "finished_inventory")
    date_hierarchy = "used_date"


@admin.register(CoaterRollTag)
class CoaterRollTagAdmin(admin.ModelAdmin):
    list_display = (
        "tag_number",
        "name",
        "status",
        "print_status",
        "run_date",
        "operator",
        "press",
        "result_serial_number",
        "logged_inventory",
    )
    list_filter = ("status", "print_status", "run_date")
    search_fields = (
        "tag_number",
        "name",
        "scheduled_by",
        "cut_description",
        "operator_notes",
        "operator",
        "result_code",
        "result_serial_number",
        "result_lot_number",
        "notes",
    )
    autocomplete_fields = (
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
    date_hierarchy = "run_date"
