from django.contrib import admin

from .models import CoaterRollTag, MaterialSpec, MaterialUsage, RawMaterialInventory


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
        "liner_pounds",
        "gsm",
        "material_family",
        "is_active",
    )
    list_filter = ("material_type", "company", "is_active")
    search_fields = (
        "code",
        "name",
        "company",
        "material_family",
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
    )
    autocomplete_fields = (
        "supplier",
        "face_material",
        "liner_material",
        "adhesive_material",
        "silicone_material",
        "coating_material",
    )


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
