from rest_framework.routers import DefaultRouter

from django.urls import path

from .views import (
    BoxInventoryViewSet,
    BoxSpecViewSet,
    CompanyRoleViewSet,
    CompanyUserViewSet,
    CustomerOrderEventViewSet,
    CustomerOrderViewSet,
    CustomerViewSet,
    FinishedInventoryViewSet,
    JobTicketEventViewSet,
    JobTicketViewSet,
    ProductionScheduleViewSet,
    QuoteCostRateViewSet,
    QuoteFinishedMaterialViewSet,
    QuoteRawMaterialViewSet,
    QuoteRecordViewSet,
    company_sign_in,
)


router = DefaultRouter()
router.register("customers", CustomerViewSet, basename="customer")
router.register("company-roles", CompanyRoleViewSet, basename="company-role")
router.register("company-users", CompanyUserViewSet, basename="company-user")
router.register("quote-raw-materials", QuoteRawMaterialViewSet, basename="quote-raw-material")
router.register("quote-cost-rates", QuoteCostRateViewSet, basename="quote-cost-rate")
router.register("quote-finished-materials", QuoteFinishedMaterialViewSet, basename="quote-finished-material")
router.register("quote-records", QuoteRecordViewSet, basename="quote-record")
router.register("customer-orders", CustomerOrderViewSet, basename="customer-order")
router.register("customer-order-events", CustomerOrderEventViewSet, basename="customer-order-event")
router.register("boxes", BoxSpecViewSet, basename="box")
router.register("box-inventory", BoxInventoryViewSet, basename="box-inventory")
router.register("job-tickets", JobTicketViewSet, basename="job-ticket")
router.register("job-ticket-events", JobTicketEventViewSet, basename="job-ticket-event")
router.register("production-schedule", ProductionScheduleViewSet, basename="production-schedule")
router.register("finished-inventory", FinishedInventoryViewSet, basename="finished-inventory")

urlpatterns = [
    path("auth/sign-in/", company_sign_in, name="company-sign-in"),
    *router.urls,
]
