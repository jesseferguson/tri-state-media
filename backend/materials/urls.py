from rest_framework.routers import DefaultRouter

from .views import (
    CoaterRollTagViewSet,
    MaterialMasterTypeViewSet,
    MaterialSpecViewSet,
    MaterialSupplierOptionViewSet,
    MaterialUsageViewSet,
    RawMaterialInventoryViewSet,
)


router = DefaultRouter()
router.register("material-master-types", MaterialMasterTypeViewSet, basename="material-master-type")
router.register("materials", MaterialSpecViewSet, basename="material")
router.register("material-supplier-options", MaterialSupplierOptionViewSet, basename="material-supplier-option")
router.register("raw-materials", RawMaterialInventoryViewSet, basename="raw-material")
router.register("material-usages", MaterialUsageViewSet, basename="material-usage")
router.register("coater-roll-tags", CoaterRollTagViewSet, basename="coater-roll-tag")

urlpatterns = router.urls
