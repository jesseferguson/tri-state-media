from rest_framework import serializers

from .models import (
    FlexDie,
    FinishedInventory,
    JobTicket,
    Mag,
    PerfBlade,
    PerfBladeSetup,
    PerfCylinder,
    Press,
    RawMaterialInventory,
    Supplier,
    ToolingHistory,
    ToolingLocation,
    ToolingRecipe,
    ToolingRecipeOption,
    ToolingRecipeTool,
)

class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = "__all__"

class ToolingLocationSerializer(serializers.ModelSerializer):
    full_path = serializers.ReadOnlyField()
    parent_name = serializers.CharField(source="parent.name", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = ToolingLocation
        fields = "__all__"

class PressSerializer(serializers.ModelSerializer):
    location_name = serializers.CharField(source="location.name", read_only=True)
    location_full_path = serializers.ReadOnlyField(source="location.full_path")

    class Meta:
        model = Press
        fields = "__all__"

class MagSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    current_location_name = serializers.CharField(source="current_location.name", read_only=True)
    current_location_full_path = serializers.ReadOnlyField(source="current_location.full_path")

    class Meta:
        model = Mag
        fields = "__all__"

class FlexDieSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    current_location_name = serializers.CharField(source="current_location.name", read_only=True)
    current_location_full_path = serializers.ReadOnlyField(source="current_location.full_path")
    computed_web_width_inches = serializers.DecimalField(max_digits=7, decimal_places=3, read_only=True)
    die_count_status = serializers.CharField(read_only=True)
    serial_number_list = serializers.SerializerMethodField()
    dieline_image_url = serializers.SerializerMethodField()

    class Meta:
        model = FlexDie
        fields = "__all__"

    def get_serial_number_list(self, obj):
        return [line.strip() for line in (obj.serial_numbers or "").splitlines() if line.strip()]

    def get_dieline_image_url(self, obj):
        if not obj.dieline_image:
            return ""
        try:
            return obj.dieline_image.url
        except ValueError:
            return ""

class PerfCylinderSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    current_location_name = serializers.CharField(source="current_location.name", read_only=True)
    current_location_full_path = serializers.ReadOnlyField(source="current_location.full_path")

    class Meta:
        model = PerfCylinder
        fields = "__all__"

class PerfBladeSetupSerializer(serializers.ModelSerializer):
    perf_cylinder_name = serializers.CharField(source="perf_cylinder.name", read_only=True)

    class Meta:
        model = PerfBladeSetup
        fields = "__all__"

class PerfBladeSerializer(serializers.ModelSerializer):
    setup_name = serializers.CharField(source="setup.name", read_only=True)
    perf_cylinder_name = serializers.CharField(source="setup.perf_cylinder.name", read_only=True)

    class Meta:
        model = PerfBlade
        fields = "__all__"

class ToolingRecipeSerializer(serializers.ModelSerializer):
    requires_external_perf = serializers.BooleanField(read_only=True)
    requires_internal_perf = serializers.BooleanField(read_only=True)
    requires_perf = serializers.BooleanField(read_only=True)
    is_no_perf = serializers.BooleanField(read_only=True)
    external_perf_cutting_type = serializers.CharField(read_only=True)
    class Meta:
        model = ToolingRecipe
        fields = "__all__"

class ToolingRecipeToolNestedSerializer(serializers.ModelSerializer):
    tool_details = serializers.SerializerMethodField()

    class Meta:
        model = ToolingRecipeTool
        fields = [
            "id",
            "tool_type",
            "tool_role",
            "station_number",
            "is_required",
            "notes",
            "tool_details",
        ]

    def get_location_path(self, location):
        if not location:
            return None
        return location.full_path()

    def get_tool_details(self, obj):
        if obj.flex_die:
            die = obj.flex_die
            return {
                "type": "Flex Die",
                "id": die.id,
                "name": die.name,
                "width": die.label_width_inches,
                "length": die.label_length_inches,
                "repeat": die.repeat_inches,
                "across": die.number_across,
                "around": die.number_around,
                "gap_across": die.gap_across_inches,
                "computed_web_width": die.computed_web_width_inches,
                "gear": die.gear,
                "face_type": die.face_type,
                "liner_type": die.liner_type,
                "shape_type": die.shape_type,
                "cutting_type": die.cutting_type,
                "original_serial_number": die.original_serial_number,
                "serial_numbers": [line.strip() for line in (die.serial_numbers or "").splitlines() if line.strip()],
                "active_die_count": die.active_die_count,
                "target_die_count": die.target_die_count,
                "die_count_status": die.die_count_status,
                "dieline_image_url": die.dieline_image.url if die.dieline_image else "",
                "web_width": die.web_width_inches,
                "status": die.status,
                "location": self.get_location_path(die.current_location),
                "location_id": die.current_location_id,
            }

        if obj.mag:
            mag = obj.mag
            return {
                "type": "Mag",
                "name": mag.name,
                "tooth_count": mag.tooth_count,
                "repeat": mag.repeat_inches,
                "face_width": mag.face_width_inches,
                "status": mag.status,
                "location": self.get_location_path(mag.current_location),
                "location_id": mag.current_location_id,
            }

        if obj.perf_cylinder:
            perf = obj.perf_cylinder
            return {
                "type": "Perf Cylinder",
                "name": perf.name,
                "gear": perf.gear_tooth_count,
                "width": perf.cylinder_width_inches,
                "max_blades": perf.max_blade_count,
                "status": perf.status,
                "location": self.get_location_path(perf.current_location),
                "location_id": perf.current_location_id,
            }

        if obj.perf_blade_setup:
            setup = obj.perf_blade_setup
            cylinder = setup.perf_cylinder
            return {
                "type": "Perf Blade Setup",
                "name": setup.name,
                "perf_cylinder": cylinder.name,
                "blade_count": setup.blade_count,
                "repeat": setup.standard_repeat_inches,
                "offset_blades": setup.has_offset_blades,
                "is_active": setup.is_active,
                "location": self.get_location_path(cylinder.current_location),
                "location_id": cylinder.current_location_id,
            }

        return {
            "type": "Manual",
            "name": obj.manual_description,
            "location": None,
            "location_id": None,
        }

class ToolingRecipeOptionSerializer(serializers.ModelSerializer):
    recipe_name = serializers.CharField(source="recipe.name", read_only=True)
    press_name = serializers.CharField(source="press.name", read_only=True)
    can_run = serializers.BooleanField(source="can_run_on_press", read_only=True)
    recipe_details = ToolingRecipeSerializer(source="recipe", read_only=True)
    tools = ToolingRecipeToolNestedSerializer(many=True, read_only=True)

    press_location = serializers.SerializerMethodField()
    press_location_id = serializers.IntegerField(source="press.location_id", read_only=True)

    class Meta:
        model = ToolingRecipeOption
        fields = "__all__"
        extra_kwargs = {
            "name": {"required": False, "allow_blank": True},
        }

    def validate(self, attrs):
        attrs = super().validate(attrs)
        name = str(attrs.get("name", getattr(self.instance, "name", "")) or "").strip()
        if name:
            attrs["name"] = name
            return attrs

        recipe = attrs.get("recipe") or getattr(self.instance, "recipe", None)
        press = attrs.get("press") or getattr(self.instance, "press", None)
        if recipe and press:
            attrs["name"] = f"{recipe.name} - {press.name}"[:150]
        return attrs

    def get_press_location(self, obj):
        if obj.press and obj.press.location:
            return obj.press.location.full_path()
        return None

class ToolingRecipeToolSerializer(serializers.ModelSerializer):
    recipe_option_name = serializers.CharField(source="recipe_option.name", read_only=True)
    recipe_name = serializers.CharField(source="recipe_option.recipe.name", read_only=True)
    press_name = serializers.CharField(source="recipe_option.press.name", read_only=True)
    mag_name = serializers.CharField(source="mag.name", read_only=True)
    flex_die_name = serializers.CharField(source="flex_die.name", read_only=True)
    perf_cylinder_name = serializers.CharField(source="perf_cylinder.name", read_only=True)
    perf_blade_setup_name = serializers.CharField(source="perf_blade_setup.name", read_only=True)
    tool_details = serializers.SerializerMethodField()

    class Meta:
        model = ToolingRecipeTool
        fields = "__all__"

    def get_tool_details(self, obj):
        return ToolingRecipeToolNestedSerializer().get_tool_details(obj)

class ToolingHistorySerializer(serializers.ModelSerializer):
    mag_name = serializers.CharField(source="mag.name", read_only=True)
    flex_die_name = serializers.CharField(source="flex_die.name", read_only=True)
    perf_cylinder_name = serializers.CharField(source="perf_cylinder.name", read_only=True)
    tool_label = serializers.SerializerMethodField()
    from_location_name = serializers.CharField(source="from_location.name", read_only=True)
    to_location_name = serializers.CharField(source="to_location.name", read_only=True)
    press_name = serializers.CharField(source="press.name", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = ToolingHistory
        fields = "__all__"

    def get_tool_label(self, obj):
        return str(obj.mag or obj.flex_die or obj.perf_cylinder or "")

class RawMaterialInventorySerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    location_full_path = serializers.ReadOnlyField(source="location.full_path")

    class Meta:
        model = RawMaterialInventory
        fields = "__all__"

class JobTicketSerializer(serializers.ModelSerializer):
    recipe_name = serializers.CharField(source="recipe.name", read_only=True)
    recipe_option_name = serializers.CharField(source="recipe_option.name", read_only=True)
    press_name = serializers.CharField(source="press.name", read_only=True)
    face_material_name = serializers.CharField(source="face_material.name", read_only=True)
    face_material_serial = serializers.CharField(source="face_material.serial_number", read_only=True)
    liner_material_name = serializers.CharField(source="liner_material.name", read_only=True)
    liner_material_serial = serializers.CharField(source="liner_material.serial_number", read_only=True)
    adhesive_material_name = serializers.CharField(source="adhesive_material.name", read_only=True)
    silicone_material_name = serializers.CharField(source="silicone_material.name", read_only=True)

    class Meta:
        model = JobTicket
        fields = "__all__"

class FinishedInventorySerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    recipe_name = serializers.CharField(source="recipe.name", read_only=True)
    recipe_option_name = serializers.CharField(source="recipe_option.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    location_full_path = serializers.ReadOnlyField(source="location.full_path")

    class Meta:
        model = FinishedInventory
        fields = "__all__"
