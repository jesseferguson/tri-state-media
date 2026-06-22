from django.contrib import admin

from .models import (
    FlexDie,
    Mag,
    PerfBlade,
    PerfBladeSetup,
    PerfCylinder,
    Press,
    PrintPlate,
    PrintStation,
    Supplier,
    ToolingHistory,
    ToolingLocation,
    ToolingRecipe,
    ToolingRecipeOption,
    ToolingRecipeTool,
)


class PerfBladeInline(admin.TabularInline):
    model = PerfBlade
    extra = 0
    ordering = ("blade_number",)


class ToolingRecipeToolInline(admin.TabularInline):
    model = ToolingRecipeTool
    extra = 0
    autocomplete_fields = ("mag", "flex_die", "perf_cylinder", "perf_blade_setup")


class PrintStationInline(admin.TabularInline):
    model = PrintStation
    extra = 0
    ordering = ("station_number",)


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ("name", "tags", "email", "phone", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name", "tags", "email", "phone", "city", "state", "zip_code")


@admin.register(ToolingLocation)
class ToolingLocationAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "location_type", "parent", "supplier", "is_active")
    list_filter = ("location_type", "is_active", "supplier")
    search_fields = ("name", "code", "notes")
    autocomplete_fields = ("parent", "supplier")


@admin.register(Press)
class PressAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "location",
        "max_web_width_inches",
        "color_count",
        "die_station_count",
        "has_digital_print",
        "has_undercut_capability",
        "has_perf_capability",
        "is_active",
    )
    list_filter = (
        "is_active",
        "has_digital_print",
        "has_undercut_capability",
        "has_perf_capability",
    )
    search_fields = ("name", "notes")
    autocomplete_fields = ("location",)


@admin.register(Mag)
class MagAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "status",
        "supplier",
        "current_location",
        "tooth_count",
        "repeat_inches",
        "face_width_inches",
    )
    list_filter = ("status", "supplier")
    search_fields = ("name", "notes")
    autocomplete_fields = ("supplier", "current_location")
    filter_horizontal = ("compatible_presses",)


@admin.register(FlexDie)
class FlexDieAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "status",
        "supplier",
        "current_location",
        "label_width_inches",
        "label_length_inches",
        "repeat_inches",
        "shape_type",
        "active_die_count",
        "target_die_count",
    )
    list_filter = ("status", "shape_type", "cutting_type", "supplier")
    search_fields = ("name", "original_serial_number", "serial_numbers", "face_type", "liner_type")
    autocomplete_fields = ("supplier", "current_location")
    exclude = ("tool_number", "drawing_number", "compatible_mags", "notes")


@admin.register(PerfCylinder)
class PerfCylinderAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "status",
        "supplier",
        "current_location",
        "gear_tooth_count",
        "cylinder_width_inches",
        "max_blade_count",
    )
    list_filter = ("status", "supplier")
    search_fields = ("name", "notes")
    autocomplete_fields = ("supplier", "current_location")
    filter_horizontal = ("compatible_presses",)


@admin.register(PerfBladeSetup)
class PerfBladeSetupAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "perf_cylinder",
        "blade_count",
        "standard_repeat_inches",
        "has_offset_blades",
        "is_active",
    )
    list_filter = ("is_active", "has_offset_blades")
    search_fields = ("name", "perf_cylinder__name", "notes")
    autocomplete_fields = ("perf_cylinder",)
    inlines = [PerfBladeInline]


@admin.register(PerfBlade)
class PerfBladeAdmin(admin.ModelAdmin):
    list_display = (
        "setup",
        "blade_number",
        "blade_type",
        "blade_width_inches",
        "position_inches",
        "offset_inches",
        "is_active",
    )
    list_filter = ("blade_type", "is_active")
    search_fields = ("setup__name", "setup__perf_cylinder__name", "notes")
    autocomplete_fields = ("setup",)


@admin.register(ToolingRecipe)
class ToolingRecipeAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "label_width_inches",
        "label_length_inches",
        "repeat_inches",
        "tpi",
        "is_active",
    )
    list_filter = ("is_active",)
    search_fields = ("name", "face_type", "liner_type", "shape_type", "notes")


@admin.register(PrintPlate)
class PrintPlateAdmin(admin.ModelAdmin):
    list_display = ("plate_number", "recipe", "customer_plate_number", "serial_number", "number_across", "number_around", "is_active")
    list_filter = ("is_active",)
    search_fields = ("plate_number", "customer_plate_number", "serial_number", "description", "recipe__name")
    autocomplete_fields = ("recipe",)
    inlines = [PrintStationInline]


@admin.register(PrintStation)
class PrintStationAdmin(admin.ModelAdmin):
    list_display = ("print_plate", "station_number", "station_plate_number", "print_cylinder_tooth_count", "anilox_gear_number", "pms_color", "color_type", "is_active")
    list_filter = ("color_type", "is_active")
    search_fields = ("print_plate__plate_number", "station_plate_number", "pms_color", "anilox_gear_number", "notes")
    autocomplete_fields = ("print_plate",)


@admin.register(ToolingRecipeOption)
class ToolingRecipeOptionAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "recipe",
        "press",
        "setup_type",
        "is_preferred",
        "is_approved",
        "is_active",
        "requires_undercut",
        "can_run_on_press",
    )
    list_filter = (
        "setup_type",
        "is_preferred",
        "is_approved",
        "is_active",
        "requires_undercut",
        "requires_manual_review",
    )
    search_fields = ("name", "recipe__name", "press__name", "setup_notes", "operator_notes")
    autocomplete_fields = ("recipe", "press")
    inlines = [ToolingRecipeToolInline]

    @admin.display(boolean=True, description="Can Run")
    def can_run_on_press(self, obj):
        return obj.can_run_on_press()


@admin.register(ToolingRecipeTool)
class ToolingRecipeToolAdmin(admin.ModelAdmin):
    list_display = (
        "recipe_option",
        "tool_type",
        "station_number",
        "is_required",
        "tool_summary",
    )
    list_filter = ("tool_type", "is_required")
    search_fields = (
        "recipe_option__name",
        "recipe_option__recipe__name",
        "manual_description",
        "notes",
    )
    autocomplete_fields = ("recipe_option", "mag", "flex_die", "perf_cylinder", "perf_blade_setup")

    @admin.display(description="Tool")
    def tool_summary(self, obj):
        return obj.mag or obj.flex_die or obj.perf_cylinder or obj.perf_blade_setup or obj.manual_description


@admin.register(ToolingHistory)
class ToolingHistoryAdmin(admin.ModelAdmin):
    list_display = (
        "event_date",
        "tooling_item",
        "tooling_type",
        "event_type",
        "from_location",
        "to_location",
        "press",
        "supplier",
        "performed_by",
    )
    list_filter = ("tooling_type", "event_type", "press", "supplier")
    search_fields = (
        "summary",
        "notes",
        "performed_by",
        "mag__name",
        "flex_die__name",
        "perf_cylinder__name",
    )
    autocomplete_fields = ("mag", "flex_die", "perf_cylinder", "from_location", "to_location", "press", "supplier")
    date_hierarchy = "event_date"

    @admin.display(description="Tooling Item")
    def tooling_item(self, obj):
        return obj.mag or obj.flex_die or obj.perf_cylinder
