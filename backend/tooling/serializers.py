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

    class Meta:
        model = FlexDie
        fields = "__all__"

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
                "name": die.name,
                "width": die.label_width_inches,
                "length": die.label_length_inches,
                "repeat": die.repeat_inches,
                "across": die.number_across,
                "around": die.number_around,
                "gear": die.gear,
                "face_type": die.face_type,
                "liner_type": die.liner_type,
                "shape_type": die.shape_type,
                "cutting_type": die.cutting_type,
                "tool_number": die.tool_number,
                "drawing_number": die.drawing_number,
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
    from_location_name = serializers.CharField(source="from_location.name", read_only=True)
    to_location_name = serializers.CharField(source="to_location.name", read_only=True)
    press_name = serializers.CharField(source="press.name", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = ToolingHistory
        fields = "__all__"

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
