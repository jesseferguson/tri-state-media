import logging

from rest_framework import filters, status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from .models import (
    BoxInventory,
    BoxSpec,
    CompanyRole,
    CompanyUser,
    CoreInventory,
    CoreSpec,
    Customer,
    CustomerOrder,
    CustomerOrderEvent,
    FinishedInventory,
    JobTicketEvent,
    JobTicket,
    ProductionSchedule,
    QuoteCostRate,
    QuoteFinishedMaterial,
    QuoteRawMaterial,
    QuoteRecord,
)
from .serializers import (
    BoxInventorySerializer,
    BoxSpecSerializer,
    CompanyRoleSerializer,
    CompanyUserSerializer,
    CoreInventorySerializer,
    CoreSpecSerializer,
    CustomerSerializer,
    CustomerOrderEventSerializer,
    CustomerOrderSerializer,
    FinishedInventorySerializer,
    JobTicketEventSerializer,
    JobTicketSerializer,
    ProductionScheduleSerializer,
    QuoteCostRateSerializer,
    QuoteFinishedMaterialSerializer,
    QuoteRawMaterialSerializer,
    QuoteRecordSerializer,
)


logger = logging.getLogger(__name__)


class BaseProductionViewSet(viewsets.ModelViewSet):
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    parser_classes = [JSONParser, FormParser, MultiPartParser]


class CustomerViewSet(BaseProductionViewSet):
    queryset = Customer.objects.all().order_by("name")
    serializer_class = CustomerSerializer
    search_fields = ["name", "customer_code", "contact_name", "phone", "email", "notes"]
    ordering_fields = ["name", "customer_code", "is_active"]


class CompanyRoleViewSet(BaseProductionViewSet):
    queryset = CompanyRole.objects.all().order_by("name")
    serializer_class = CompanyRoleSerializer
    search_fields = ["name", "description"]
    ordering_fields = ["name", "created_at"]


class CompanyUserViewSet(BaseProductionViewSet):
    queryset = CompanyUser.objects.select_related("role").all().order_by("name", "username")
    serializer_class = CompanyUserSerializer
    search_fields = ["name", "username", "role__name"]
    ordering_fields = ["name", "username", "active", "created_at"]


class QuoteRawMaterialViewSet(BaseProductionViewSet):
    queryset = QuoteRawMaterial.objects.all().order_by("component_type", "name")
    serializer_class = QuoteRawMaterialSerializer
    lookup_field = "external_id"
    search_fields = ["name", "component_type", "notes"]
    ordering_fields = ["name", "component_type", "msi_cost", "updated_at"]


class QuoteCostRateViewSet(BaseProductionViewSet):
    queryset = QuoteCostRate.objects.all().order_by("label")
    serializer_class = QuoteCostRateSerializer
    search_fields = ["key", "label", "notes"]
    ordering_fields = ["key", "label", "msi_cost", "updated_at"]


class QuoteFinishedMaterialViewSet(BaseProductionViewSet):
    queryset = QuoteFinishedMaterial.objects.select_related("material_master_type").all().order_by("name")
    serializer_class = QuoteFinishedMaterialSerializer
    lookup_field = "external_id"
    search_fields = ["name", "material_master_type__code", "material_master_type__name", "source_type", "notes"]
    ordering_fields = ["name", "material_master_type__code", "source_type", "updated_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        master_type = self.request.query_params.get("master_type")
        if master_type:
            qs = qs.filter(material_master_type_id=master_type)
        return qs


class QuoteRecordViewSet(BaseProductionViewSet):
    queryset = QuoteRecord.objects.select_related("job_ticket").all().order_by("-created_at", "-id")
    serializer_class = QuoteRecordSerializer
    lookup_field = "external_id"
    search_fields = [
        "quote_number",
        "customer_name",
        "job_name",
        "product_code",
        "description",
        "prepared_by_name",
        "prepared_by_role",
        "material_name",
        "notes",
    ]
    ordering_fields = ["created_at", "quote_number", "customer_name", "prepared_by_name", "material_name"]


@api_view(["POST"])
def company_sign_in(request):
    username = str(request.data.get("username", "")).strip().lower()
    password = str(request.data.get("password", ""))
    try:
        user = CompanyUser.objects.select_related("role").get(username__iexact=username)
    except CompanyUser.DoesNotExist:
        return Response({"error": "Username or password is not correct."}, status=status.HTTP_400_BAD_REQUEST)

    if not user.check_password(password):
        return Response({"error": "Username or password is not correct."}, status=status.HTTP_400_BAD_REQUEST)
    if not user.active:
        return Response({"error": "This user is inactive. Ask an admin to reactivate the account."}, status=status.HTTP_400_BAD_REQUEST)

    return Response({
        "user": CompanyUserSerializer(user).data,
        "users": CompanyUserSerializer(CompanyUser.objects.select_related("role").all(), many=True).data,
        "roles": CompanyRoleSerializer(CompanyRole.objects.all(), many=True).data,
    })


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


class CoreSpecViewSet(BaseProductionViewSet):
    queryset = CoreSpec.objects.all().order_by("supplier", "core_size_inches", "name", "item_number")
    serializer_class = CoreSpecSerializer
    search_fields = ["name", "item_number", "supplier", "core_size_inches", "notes"]
    ordering_fields = ["name", "item_number", "supplier", "core_size_inches", "is_active"]


class CoreInventoryViewSet(BaseProductionViewSet):
    queryset = (
        CoreInventory.objects.select_related("core", "location")
        .all()
        .order_by("core__core_size_inches", "core__name", "lot_number")
    )
    serializer_class = CoreInventorySerializer
    search_fields = ["core__name", "core__item_number", "core__supplier", "lot_number", "status", "location__name", "notes"]
    ordering_fields = ["core__core_size_inches", "core__name", "lot_number", "quantity", "status", "received_date"]


class JobTicketViewSet(BaseProductionViewSet):
    queryset = (
        JobTicket.objects.select_related(
            "customer",
            "recipe",
            "material_spec",
            "material_spec__master_type",
            "material_master_type",
            "box",
            "core",
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
        "description",
        "recipe__name",
        "material_spec__code",
        "material_spec__name",
        "material_spec__company",
        "material_spec__material_family",
        "material_spec__master_type__code",
        "material_spec__master_type__name",
        "material_master_type__code",
        "material_master_type__name",
        "box__name",
        "box_item_number",
        "box__item_number",
        "box__supplier",
        "core__name",
        "core__item_number",
        "core__supplier",
        "fanfold_gear",
        "general_image_name",
        "general_image_description",
        "spec_image_name",
        "spec_image_description",
        "finishing_image_name",
        "finishing_image_description",
        "finishing_type",
        "cutting_type",
        "unit_type",
        "ribbon",
        "laminate",
        "bagged",
        "carton_label_part_number",
        "carton_label_description_a",
        "carton_label_description_b",
        "carton_label_description_c",
        "carton_label_finishing_1",
        "carton_label_finishing_2",
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

    image_slots = {"general", "spec", "finishing"}

    @action(detail=True, methods=["post", "delete"], url_path=r"images/(?P<slot>general|spec|finishing)")
    def images(self, request, pk=None, slot=None):
        ticket = self.get_object()
        if slot not in self.image_slots:
            return Response({"error": "Unknown image slot."}, status=status.HTTP_400_BAD_REQUEST)

        image_field = f"{slot}_image"
        name_field = f"{slot}_image_name"
        description_field = f"{slot}_image_description"

        if request.method == "DELETE":
            try:
                current_file = getattr(ticket, image_field)
                if current_file:
                    current_file.delete(save=False)
                setattr(ticket, image_field, None)
                setattr(ticket, name_field, "")
                setattr(ticket, description_field, "")
                ticket.save(update_fields=[image_field, name_field, description_field, "updated_at"])
                return Response(self.get_serializer(ticket).data)
            except Exception as error:
                logger.exception("Could not delete job ticket image from storage.")
                return Response({"error": f"Could not delete image from storage: {error}"}, status=status.HTTP_502_BAD_GATEWAY)

        upload = request.FILES.get("image")
        if upload:
            current_file = getattr(ticket, image_field)
            if current_file:
                current_file.delete(save=False)
            setattr(ticket, image_field, upload)
            if not request.data.get("name"):
                setattr(ticket, name_field, upload.name)

        if "name" in request.data:
            setattr(ticket, name_field, str(request.data.get("name") or "").strip())
        if "description" in request.data:
            setattr(ticket, description_field, str(request.data.get("description") or "").strip())

        try:
            ticket.save(update_fields=[image_field, name_field, description_field, "updated_at"])
        except Exception as error:
            logger.exception("Could not upload job ticket image to storage.")
            return Response({"error": f"Could not upload image to storage: {error}"}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(self.get_serializer(ticket).data)


class JobTicketEventViewSet(BaseProductionViewSet):
    serializer_class = JobTicketEventSerializer
    search_fields = [
        "event_type",
        "summary",
        "performed_by",
        "job_ticket__ticket_number",
        "job_ticket__job_name",
        "job_ticket__product_code",
    ]
    ordering_fields = ["created_at", "event_type", "performed_by"]

    def get_queryset(self):
        qs = (
            JobTicketEvent.objects.select_related("job_ticket")
            .all()
            .order_by("-created_at", "-id")
        )
        job_ticket = self.request.query_params.get("job_ticket")
        if job_ticket:
            qs = qs.filter(job_ticket_id=job_ticket)
        return qs


class ProductionScheduleViewSet(BaseProductionViewSet):
    queryset = (
        ProductionSchedule.objects.select_related(
            "job_ticket",
            "customer",
            "job_ticket__customer",
            "job_ticket__material_spec",
            "job_ticket__material_spec__master_type",
            "job_ticket__material_master_type",
            "job_ticket__recipe",
            "job_ticket__box",
            "job_ticket__core",
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
        "job_ticket__box_item_number",
        "job_ticket__box__item_number",
        "job_ticket__core__name",
        "job_ticket__core__item_number",
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

    @action(detail=True, methods=["post"], url_path="remove-from-schedule")
    def remove_from_schedule(self, request, pk=None):
        schedule = self.get_object()
        reason = str(request.data.get("reason", "")).strip()
        if not reason:
            return Response({"reason": ["A reason is required to remove a scheduled job."]}, status=status.HTTP_400_BAD_REQUEST)

        actor = str(request.data.get("performed_by", "")).strip() or schedule.last_updated_by or schedule.scheduled_by or "system"
        schedule._delete_reason = reason
        schedule._delete_actor = actor
        schedule.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
