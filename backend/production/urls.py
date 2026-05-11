from rest_framework.routers import DefaultRouter

from .views import BoxInventoryViewSet, BoxSpecViewSet, CustomerOrderEventViewSet, CustomerOrderViewSet, CustomerViewSet, FinishedInventoryViewSet, JobTicketViewSet, ProductionScheduleViewSet


router = DefaultRouter()
router.register("customers", CustomerViewSet, basename="customer")
router.register("customer-orders", CustomerOrderViewSet, basename="customer-order")
router.register("customer-order-events", CustomerOrderEventViewSet, basename="customer-order-event")
router.register("boxes", BoxSpecViewSet, basename="box")
router.register("box-inventory", BoxInventoryViewSet, basename="box-inventory")
router.register("job-tickets", JobTicketViewSet, basename="job-ticket")
router.register("production-schedule", ProductionScheduleViewSet, basename="production-schedule")
router.register("finished-inventory", FinishedInventoryViewSet, basename="finished-inventory")

urlpatterns = router.urls
