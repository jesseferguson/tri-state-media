from rest_framework import filters, viewsets

from .models import BoxInventory, BoxSpec, Customer, CustomerOrder, CustomerOrderEvent, FinishedInventory, JobTicket, ProductionSchedule
from .serializers import (
    BoxInventorySerializer,
    BoxSpecSerializer,
    CustomerSerializer,
    CustomerOrderEventSerializer,
    CustomerOrderSerializer,
    FinishedInventorySerializer,
    JobTicketSerializer,
    ProductionScheduleSerializer,
)


class BaseProductionViewSet(viewsets.ModelViewSet):
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]


class CustomerViewSet(BaseProductionViewSet):
    queryset = Customer.objects.all().order_by("name")
    serializer_class = CustomerSerializer
    search_fields = ["name", "customer_code", "contact_name", "phone", "email", "notes"]
    ordering_fields = ["name", "customer_code", "is_active"]


class BoxSpecViewSet(BaseProductionViewSet):
    queryset = BoxSpec.objects.all().order_by("supplier", "name", "item_number")
    serializer_class = BoxSpecSerializer
    search_fields = ["name", "item_number", "supplier", "notes"]
    ordering_fields = ["name", "item_number", "supplier", "width_inches", "length_inches", "height_inches", "is_active"]


class BoxInventoryViewSet(BaseProductionViewSet):
    queryset = (
        BoxInventory.objects.select_related("box", "location")
        .all()
        .order_by("box__name", "lot_number")
    )
    serializer_class = BoxInventorySerializer
    search_fields = ["box__name", "box__item_number", "box__supplier", "lot_number", "status", "location__name", "notes"]
    ordering_fields = ["box__name", "lot_number", "quantity", "status", "received_date"]


class JobTicketViewSet(BaseProductionViewSet):
    queryset = (
        JobTicket.objects.select_related(
            "customer",
            "recipe",
            "material_spec",
            "box",
        )
        .all()
        .order_by("ticket_number")
    )
    serializer_class = JobTicketSerializer
    search_fields = [
        "ticket_number",
        "customer_name",
        "customer__name",
        "customer__customer_code",
        "job_name",
        "product_code",
        "recipe__name",
        "material_spec__code",
        "material_spec__name",
        "material_spec__company",
        "material_spec__material_family",
        "box__name",
        "box__item_number",
        "box__supplier",
        "finishing_type",
        "cutting_type",
        "finishing_notes",
        "job_notes",
    ]
    ordering_fields = [
        "ticket_number",
        "customer_name",
        "job_name",
        "label_width_inches",
        "label_length_inches",
        "repeat_inches",
        "requested_quantity",
    ]


class ProductionScheduleViewSet(BaseProductionViewSet):
    queryset = (
        ProductionSchedule.objects.select_related(
            "job_ticket",
            "customer",
            "job_ticket__customer",
            "job_ticket__material_spec",
            "job_ticket__recipe",
            "job_ticket__box",
            "material_inventory",
            "press",
        )
        .all()
        .order_by("scheduled_date", "priority", "job_ticket__ticket_number")
    )
    serializer_class = ProductionScheduleSerializer
    search_fields = [
        "job_ticket__ticket_number",
        "job_ticket__customer_name",
        "customer__name",
        "customer__customer_code",
        "job_ticket__customer__name",
        "job_ticket__job_name",
        "customer_po",
        "status",
        "priority",
        "material_inventory__name",
        "material_inventory__serial_number",
        "press__name",
        "operator",
        "scheduled_by",
        "last_updated_by",
        "notes",
        "footage_report",
    ]
    ordering_fields = [
        "scheduled_date",
        "due_date",
        "priority",
        "status",
        "quantity_to_ship",
        "quantity_to_stock",
        "material_width_inches",
        "order_date",
        "press__name",
        "press_sequence",
        "operator",
    ]


class CustomerOrderViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = (
        CustomerOrder.objects.select_related("schedule_entry", "job_ticket", "customer")
        .all()
        .order_by("-order_date", "-scheduled_date", "customer_name", "job_name")
    )
    serializer_class = CustomerOrderSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        "customer_name",
        "customer__name",
        "customer_po",
        "job_name",
        "product_code",
        "job_ticket__ticket_number",
        "status",
        "operator_note",
    ]
    ordering_fields = [
        "order_date",
        "scheduled_date",
        "due_date",
        "priority",
        "status",
        "customer_name",
        "job_name",
    ]


class CustomerOrderEventViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = (
        CustomerOrderEvent.objects.select_related("order", "order__job_ticket", "order__customer")
        .all()
        .order_by("-created_at")
    )
    serializer_class = CustomerOrderEventSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        "event_type",
        "summary",
        "performed_by",
        "order__customer_name",
        "order__job_name",
        "order__job_ticket__ticket_number",
    ]
    ordering_fields = ["created_at", "event_type", "performed_by"]


class FinishedInventoryViewSet(BaseProductionViewSet):
    queryset = (
        FinishedInventory.objects.select_related(
            "job_ticket",
            "material_inventory",
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
        "material_inventory__name",
        "material_inventory__serial_number",
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
