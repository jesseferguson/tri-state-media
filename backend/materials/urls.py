from rest_framework.routers import DefaultRouter

from .views import CoaterRollTagViewSet, MaterialSpecViewSet, MaterialUsageViewSet, RawMaterialInventoryViewSet


router = DefaultRouter()
router.register("materials", MaterialSpecViewSet, basename="material")
router.register("raw-materials", RawMaterialInventoryViewSet, basename="raw-material")
router.register("material-usages", MaterialUsageViewSet, basename="material-usage")
router.register("coater-roll-tags", CoaterRollTagViewSet, basename="coater-roll-tag")

urlpatterns = router.urls
