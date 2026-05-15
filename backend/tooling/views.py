from rest_framework import filters, viewsets
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

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
from .serializers import (
    FlexDieSerializer,
    FinishedInventorySerializer,
    JobTicketSerializer,
    MagSerializer,
    PerfBladeSerializer,
    PerfBladeSetupSerializer,
    PerfCylinderSerializer,
    PressSerializer,
    RawMaterialInventorySerializer,
    SupplierSerializer,
    ToolingHistorySerializer,
    ToolingLocationSerializer,
    ToolingRecipeOptionSerializer,
    ToolingRecipeSerializer,
    ToolingRecipeToolSerializer,
)


class BaseToolingViewSet(viewsets.ModelViewSet):
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]


class SupplierViewSet(BaseToolingViewSet):
    queryset = Supplier.objects.all().order_by("name")
    serializer_class = SupplierSerializer
    search_fields = ["name", "email", "phone", "city", "state", "zip_code", "notes"]
    ordering_fields = ["name", "city", "state", "is_active"]


class ToolingLocationViewSet(BaseToolingViewSet):
    queryset = (
        ToolingLocation.objects.select_related("parent", "supplier")
        .all()
        .order_by("name", "code")
    )
    serializer_class = ToolingLocationSerializer
    search_fields = ["name", "code", "location_type", "notes", "supplier__name", "parent__name"]
    ordering_fields = ["name", "code", "location_type", "is_active"]


class PressViewSet(BaseToolingViewSet):
    queryset = Press.objects.select_related("location").all().order_by("name")
    serializer_class = PressSerializer
    search_fields = ["name", "notes", "location__name", "location__code"]
    ordering_fields = ["name", "color_count", "die_station_count", "max_web_width_inches", "is_active"]


class MagViewSet(BaseToolingViewSet):
    queryset = (
        Mag.objects.select_related("supplier", "current_location")
        .prefetch_related("compatible_presses")
        .all()
        .order_by("name")
    )
    serializer_class = MagSerializer
    search_fields = ["name", "notes", "supplier__name", "current_location__name", "status"]
    ordering_fields = ["name", "status", "tooth_count", "repeat_inches"]


class FlexDieViewSet(BaseToolingViewSet):
    serializer_class = FlexDieSerializer
    search_fields = [
        "name",
        "tool_number",
        "drawing_number",
        "face_type",
        "liner_type",
        "shape_type",
        "cutting_type",
        "notes",
        "supplier__name",
        "status",
    ]
    ordering_fields = [
        "name",
        "status",
        "label_width_inches",
        "label_length_inches",
        "repeat_inches",
        "gear",
        "number_across",
        "number_around",
    ]

    def get_queryset(self):
        qs = (
            FlexDie.objects.select_related("supplier", "current_location")
            .prefetch_related("compatible_mags")
            .all()
            .order_by("name")
        )

        params = self.request.query_params

        width = params.get("width")
        length = params.get("length")
        across = params.get("across")
        around = params.get("around")
        gear = params.get("gear")
        face_type = params.get("face_type")
        liner_type = params.get("liner_type")
        shape_type = params.get("shape_type")
        cutting_type = params.get("cutting_type")

        if width:
            qs = qs.filter(label_width_inches=width)

        if length:
            qs = qs.filter(label_length_inches=length)

        if across:
            qs = qs.filter(number_across=across)

        if around:
            qs = qs.filter(number_around=around)

        if gear:
            qs = qs.filter(gear=gear)

        if face_type:
            qs = qs.filter(face_type__icontains=face_type)

        if liner_type:
            qs = qs.filter(liner_type__icontains=liner_type)

        if shape_type:
            qs = qs.filter(shape_type=shape_type)

        if cutting_type:
            qs = qs.filter(cutting_type=cutting_type)

        return qs

class PerfCylinderViewSet(BaseToolingViewSet):
    queryset = (
        PerfCylinder.objects.select_related("supplier", "current_location")
        .prefetch_related("compatible_presses")
        .all()
        .order_by("name")
    )
    serializer_class = PerfCylinderSerializer
    search_fields = ["name", "notes", "supplier__name", "status"]
    ordering_fields = ["name", "status", "gear_tooth_count", "cylinder_width_inches"]


class PerfBladeSetupViewSet(BaseToolingViewSet):
    queryset = PerfBladeSetup.objects.select_related("perf_cylinder").all().order_by("perf_cylinder__name", "name")
    serializer_class = PerfBladeSetupSerializer
    search_fields = ["name", "notes", "perf_cylinder__name"]
    ordering_fields = ["name", "blade_count", "standard_repeat_inches", "is_active"]


class PerfBladeViewSet(BaseToolingViewSet):
    queryset = PerfBlade.objects.select_related("setup", "setup__perf_cylinder").all().order_by("setup__name", "blade_number")
    serializer_class = PerfBladeSerializer
    search_fields = ["setup__name", "setup__perf_cylinder__name", "notes", "blade_type"]
    ordering_fields = ["blade_number", "blade_type", "position_inches", "offset_inches", "is_active"]


class ToolingRecipeViewSet(BaseToolingViewSet):
    queryset = ToolingRecipe.objects.all().order_by("name")
    serializer_class = ToolingRecipeSerializer
    search_fields = ["name", "face_type", "liner_type", "shape_type", "notes"]
    ordering_fields = ["name", "label_width_inches", "label_length_inches", "repeat_inches", "tpi", "is_active"]


class ToolingRecipeOptionViewSet(BaseToolingViewSet):
    queryset = (
    ToolingRecipeOption.objects
    .select_related(
        "recipe",
        "press",
        "press__location",
    )
    .prefetch_related(
        "tools__mag",
        "tools__mag__current_location",
        "tools__flex_die",
        "tools__flex_die__current_location",
        "tools__perf_cylinder",
        "tools__perf_cylinder__current_location",
        "tools__perf_blade_setup",
        "tools__perf_blade_setup__perf_cylinder",
        "tools__perf_blade_setup__perf_cylinder__current_location",
    )
    .all()
    .order_by("recipe__name", "press__name", "-is_preferred", "name")
)

    serializer_class = ToolingRecipeOptionSerializer

    search_fields = [
        "name",
        "recipe__name",
        "press__name",
        "setup_notes",
        "operator_notes",
        "tools__mag__name",
        "tools__flex_die__name",
        "tools__flex_die__tool_number",
        "tools__flex_die__drawing_number",
        "tools__perf_cylinder__name",
        "tools__perf_blade_setup__name",
    ]

    ordering_fields = [
        "name",
        "estimated_setup_minutes",
        "is_preferred",
        "is_approved",
        "is_active",
        "recipe__name",
        "press__name",
    ]

class ToolingRecipeToolViewSet(BaseToolingViewSet):
    queryset = (
        ToolingRecipeTool.objects.select_related(
            "recipe_option",
            "recipe_option__recipe",
            "recipe_option__press",
            "mag",
            "flex_die",
            "perf_cylinder",
            "perf_blade_setup",
        )
        .all()
        .order_by("recipe_option__recipe__name", "recipe_option__name", "station_number", "tool_type")
    )
    serializer_class = ToolingRecipeToolSerializer
    search_fields = [
        "recipe_option__name",
        "recipe_option__recipe__name",
        "recipe_option__press__name",
        "manual_description",
        "notes",
        "mag__name",
        "flex_die__name",
        "perf_cylinder__name",
        "perf_blade_setup__name",
    ]
    ordering_fields = ["station_number", "tool_type", "is_required"]


class ToolingHistoryViewSet(BaseToolingViewSet):
    queryset = (
        ToolingHistory.objects.select_related(
            "mag",
            "flex_die",
            "perf_cylinder",
            "from_location",
            "to_location",
            "press",
            "supplier",
        )
        .all()
        .order_by("-event_date")
    )
    serializer_class = ToolingHistorySerializer
    search_fields = [
        "summary",
        "notes",
        "performed_by",
        "mag__name",
        "flex_die__name",
        "perf_cylinder__name",
        "press__name",
        "supplier__name",
    ]
    ordering_fields = ["event_date", "event_type", "performed_by", "tooling_type"]


class RawMaterialInventoryViewSet(BaseToolingViewSet):
    queryset = (
        RawMaterialInventory.objects.select_related("supplier", "location")
        .all()
        .order_by("material_type", "name", "serial_number")
    )
    serializer_class = RawMaterialInventorySerializer
    search_fields = [
        "name",
        "serial_number",
        "lot_number",
        "material_type",
        "face_type",
        "liner_type",
        "adhesive_type",
        "silicone_type",
        "status",
        "supplier__name",
        "location__name",
        "notes",
    ]
    ordering_fields = [
        "material_type",
        "name",
        "serial_number",
        "width_inches",
        "length_feet",
        "quantity",
        "status",
        "received_date",
    ]


class JobTicketViewSet(BaseToolingViewSet):
    queryset = (
        JobTicket.objects.select_related(
            "recipe",
            "recipe_option",
            "press",
            "face_material",
            "liner_material",
            "adhesive_material",
            "silicone_material",
        )
        .all()
        .order_by("-scheduled_date", "ticket_number")
    )
    serializer_class = JobTicketSerializer
    search_fields = [
        "ticket_number",
        "customer_name",
        "product_name",
        "status",
        "priority",
        "recipe__name",
        "recipe_option__name",
        "press__name",
        "face_material__name",
        "face_material__serial_number",
        "liner_material__name",
        "liner_material__serial_number",
        "finishing_type",
        "finishing_notes",
        "operator",
        "suboperator",
        "production_notes",
    ]
    ordering_fields = [
        "ticket_number",
        "customer_name",
        "product_name",
        "status",
        "priority",
        "due_date",
        "scheduled_date",
        "requested_quantity",
        "produced_quantity",
    ]


class FinishedInventoryViewSet(BaseToolingViewSet):
    queryset = (
        FinishedInventory.objects.select_related(
            "job_ticket",
            "recipe",
            "recipe_option",
            "location",
        )
        .all()
        .order_by("-run_date", "name")
    )
    serializer_class = FinishedInventorySerializer
    search_fields = [
        "name",
        "sku",
        "status",
        "job_ticket__ticket_number",
        "recipe__name",
        "recipe_option__name",
        "face_type",
        "liner_type",
        "liner_serial_number",
        "face_serial_number",
        "operator",
        "suboperator",
        "location__name",
        "notes",
    ]
    ordering_fields = [
        "name",
        "sku",
        "status",
        "material_width_inches",
        "material_length_feet",
        "quantity",
        "run_date",
        "operator",
    ]
