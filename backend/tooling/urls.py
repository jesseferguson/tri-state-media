from rest_framework.routers import DefaultRouter

from .views import (
    FlexDieViewSet,
    MagViewSet,
    PerfBladeSetupViewSet,
    PerfBladeViewSet,
    PerfCylinderViewSet,
    PressViewSet,
    PrintPlateViewSet,
    PrintStationViewSet,
    SupplierViewSet,
    ToolingHistoryViewSet,
    ToolingLocationViewSet,
    ToolingRecipeOptionViewSet,
    ToolingRecipeToolViewSet,
    ToolingRecipeViewSet,
)

router = DefaultRouter()
router.register("suppliers", SupplierViewSet, basename="supplier")
router.register("locations", ToolingLocationViewSet, basename="location")
router.register("presses", PressViewSet, basename="press")
router.register("mags", MagViewSet, basename="mag")
router.register("flex-dies", FlexDieViewSet, basename="flex-die")
router.register("perf-cylinders", PerfCylinderViewSet, basename="perf-cylinder")
router.register("perf-blade-setups", PerfBladeSetupViewSet, basename="perf-blade-setup")
router.register("perf-blades", PerfBladeViewSet, basename="perf-blade")
router.register("recipes", ToolingRecipeViewSet, basename="recipe")
router.register("print-plates", PrintPlateViewSet, basename="print-plate")
router.register("print-stations", PrintStationViewSet, basename="print-station")
router.register("recipe-options", ToolingRecipeOptionViewSet, basename="recipe-option")
router.register("recipe-tools", ToolingRecipeToolViewSet, basename="recipe-tool")
router.register("history", ToolingHistoryViewSet, basename="history")

urlpatterns = router.urls
