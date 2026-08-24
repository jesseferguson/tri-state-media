from rest_framework.routers import DefaultRouter

from django.urls import path

from .views import (
    BoxInventoryViewSet,
    BoxSpecViewSet,
    CoreInventoryViewSet,
    CoreSpecViewSet,
    CustomerOrderEventViewSet,
    CustomerOrderViewSet,
    CustomerInteractionViewSet,
    CustomerViewSet,
    FinishedInventoryViewSet,
    JobTicketEventViewSet,
    JobTicketUsageViewSet,
    JobTicketViewSet,
    LiveFootageArchiveViewSet,
    LocalLiveFootageReadingViewSet,
    MessageThreadViewSet,
    MessageViewSet,
    ProductionMaterialAssignmentViewSet,
    ProductionScheduleViewSet,
    ProductionShiftReportViewSet,
    ProductionShiftSettingViewSet,
    QuoteCostRateViewSet,
    QuoteFinishedMaterialViewSet,
    QuoteRawMaterialViewSet,
    QuoteRecordViewSet,
    eti_device_settings,
    local_live_footage_relay,
    local_live_footage_reset_shift,
    local_live_footage_snapshot,
    live_footage_relay,
    press_dashboard_qr_label,
    press_goal_shares,
)
from .data_import import data_flush, data_import_csv, data_import_templates


router = DefaultRouter()
router.register("customers", CustomerViewSet, basename="customer")
router.register("customer-interactions", CustomerInteractionViewSet, basename="customer-interaction")
router.register("message-threads", MessageThreadViewSet, basename="message-thread")
router.register("messages", MessageViewSet, basename="message")
router.register("quote-raw-materials", QuoteRawMaterialViewSet, basename="quote-raw-material")
router.register("quote-cost-rates", QuoteCostRateViewSet, basename="quote-cost-rate")
router.register("quote-finished-materials", QuoteFinishedMaterialViewSet, basename="quote-finished-material")
router.register("quote-records", QuoteRecordViewSet, basename="quote-record")
router.register("customer-orders", CustomerOrderViewSet, basename="customer-order")
router.register("customer-order-events", CustomerOrderEventViewSet, basename="customer-order-event")
router.register("boxes", BoxSpecViewSet, basename="box")
router.register("box-inventory", BoxInventoryViewSet, basename="box-inventory")
router.register("cores", CoreSpecViewSet, basename="core")
router.register("core-inventory", CoreInventoryViewSet, basename="core-inventory")
router.register("job-tickets", JobTicketViewSet, basename="job-ticket")
router.register("job-ticket-events", JobTicketEventViewSet, basename="job-ticket-event")
router.register("job-ticket-usages", JobTicketUsageViewSet, basename="job-ticket-usage")
router.register("live-footage-archives", LiveFootageArchiveViewSet, basename="live-footage-archive")
router.register("local-live-footage-readings", LocalLiveFootageReadingViewSet, basename="local-live-footage-reading")
router.register("production-schedule", ProductionScheduleViewSet, basename="production-schedule")
router.register("production-material-assignments", ProductionMaterialAssignmentViewSet, basename="production-material-assignment")
router.register("production-shift-reports", ProductionShiftReportViewSet, basename="production-shift-report")
router.register("production-shift-settings", ProductionShiftSettingViewSet, basename="production-shift-setting")
router.register("finished-inventory", FinishedInventoryViewSet, basename="finished-inventory")

urlpatterns = [
    path("data-import/templates/", data_import_templates, name="data-import-templates"),
    path("data-import/flush/", data_flush, name="data-import-flush"),
    path("data-import/<str:import_type>/", data_import_csv, name="data-import-csv"),
    path("live-footage/eti-settings/", eti_device_settings, name="eti-device-settings"),
    path("live-footage/press-goal-shares/", press_goal_shares, name="press-goal-shares"),
    path("live-footage/press-dashboard-label/", press_dashboard_qr_label, name="press-dashboard-qr-label"),
    path("live-footage-relay/<str:press>/<str:kind>/", live_footage_relay, name="live-footage-relay"),
    path("local-live-footage/snapshot/", local_live_footage_snapshot, name="local-live-footage-snapshot"),
    path("local-live-footage/reset-shift/", local_live_footage_reset_shift, name="local-live-footage-reset-shift"),
    path("local-live-footage/<str:press>/<str:kind>/", local_live_footage_relay, name="local-live-footage-relay"),
    *router.urls,
]
