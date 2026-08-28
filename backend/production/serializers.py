import re
from urllib.parse import unquote, urlparse

from django.db import models
from rest_framework import serializers

from materials.models import MaterialMasterType
from users.constants import QUOTE_COMPANY_CHOICES

from .models import (
    BoxInventory,
    BoxSpec,
    CoreInventory,
    CoreSpec,
    Customer,
    CustomerAddress,
    CustomerContact,
    CustomerInteraction,
    CustomerInteractionHistory,
    CustomerOrder,
    CustomerOrderEvent,
    FinishedInventory,
    JobTicketEvent,
    JobTicket,
    JobTicketUsage,
    LiveFootageArchive,
    LocalLiveFootageReading,
    Message,
    MessageThread,
    ProductionMaterialAssignment,
    ProductionSchedule,
    ProductionShiftReport,
    ProductionShiftSetting,
    QuoteCostRate,
    QuoteFinishedMaterial,
    QuoteRawMaterial,
    QuoteRecord,
    QUOTE_APPROVAL_STATUS_CHOICES,
    QUOTE_WORKFLOW_STATUS_CHOICES,
)


def is_document_url(url):
    parsed = urlparse(str(url or ""))
    path = unquote(parsed.path or "").lower()
    query = unquote(parsed.query or "").lower()
    return ".pdf" in path or ".pdf" in query


def note_value(note, label):
    match = re.search(rf"^{re.escape(label)}:\s*(.+?)\s*$", str(note or ""), flags=re.IGNORECASE | re.MULTILINE)
    return match.group(1).strip() if match else ""


def absolute_api_url(serializer, path):
    request = serializer.context.get("request") if getattr(serializer, "context", None) else None
    return request.build_absolute_uri(path) if request else path


def job_ticket_image_preview_url(serializer, obj, slot):
    image = getattr(obj, f"{slot}_image", None)
    if not image:
        return ""
    return absolute_api_url(serializer, f"/api/job-tickets/{obj.pk}/images/{slot}/preview/")


def job_ticket_general_image_url(serializer, obj):
    protected_url = job_ticket_image_preview_url(serializer, obj, "general")
    if protected_url:
        return protected_url
    return getattr(obj, "external_image_url", "") or ""


def file_name_from_url(url):
    parsed = urlparse(str(url or ""))
    path = unquote(parsed.path or "")
    return path.rsplit("/", 1)[-1] if path else ""


class CustomerContactSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = CustomerContact
        fields = [
            "id",
            "first_name",
            "last_name",
            "full_name",
            "role",
            "email",
            "phone",
            "company",
            "notes",
            "is_primary",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "full_name", "created_at", "updated_at"]


class CustomerAddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerAddress
        fields = [
            "id",
            "label",
            "address_line_1",
            "address_line_2",
            "address_line_3",
            "city",
            "state",
            "postal_code",
            "country",
            "notes",
            "is_primary",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class CustomerSerializer(serializers.ModelSerializer):
    contacts = CustomerContactSerializer(many=True, read_only=True)
    addresses = CustomerAddressSerializer(many=True, read_only=True)
    primary_contact = serializers.JSONField(write_only=True, required=False)
    primary_address = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model = Customer
        fields = [
            "id",
            "name",
            "customer_code",
            "account_owner",
            "crm_stage",
            "next_follow_up",
            "last_contacted_at",
            "website",
            "source_sheet_url",
            "contact_name",
            "phone",
            "email",
            "address_line_1",
            "address_line_2",
            "address_line_3",
            "city",
            "state",
            "postal_code",
            "country",
            "notes",
            "is_active",
            "contacts",
            "addresses",
            "primary_contact",
            "primary_address",
        ]
        read_only_fields = ["id", "last_contacted_at", "contacts", "addresses"]

    def create(self, validated_data):
        primary_contact = validated_data.pop("primary_contact", None)
        primary_address = validated_data.pop("primary_address", None)
        customer = super().create(validated_data)
        self._save_primary_contact(customer, primary_contact)
        self._save_primary_address(customer, primary_address)
        return customer

    def update(self, instance, validated_data):
        primary_contact = validated_data.pop("primary_contact", None)
        primary_address = validated_data.pop("primary_address", None)
        customer = super().update(instance, validated_data)
        self._save_primary_contact(customer, primary_contact)
        self._save_primary_address(customer, primary_address)
        return customer

    def _text(self, payload, name, fallback=""):
        if not isinstance(payload, dict):
            return fallback
        return str(payload.get(name, fallback) or "").strip()

    def _has_contact_info(self, payload):
        return any(self._text(payload, field) for field in ["first_name", "last_name", "role", "email", "phone", "company", "notes"])

    def _has_address_info(self, payload):
        return any(self._text(payload, field) for field in [
            "address_line_1",
            "address_line_2",
            "address_line_3",
            "city",
            "state",
            "postal_code",
        ])

    def _save_primary_contact(self, customer, payload):
        if not self._has_contact_info(payload):
            return None

        contact_id = self._text(payload, "id")
        first_name = self._text(payload, "first_name")
        last_name = self._text(payload, "last_name")
        email = self._text(payload, "email")
        phone = self._text(payload, "phone")

        contact = customer.contacts.filter(pk=contact_id).first() if contact_id.isdigit() else None
        if not contact and email:
            contact = customer.contacts.filter(email__iexact=email).first()
        if not contact and phone:
            contact = customer.contacts.filter(phone__iexact=phone).first()
        if not contact and (first_name or last_name):
            contact = customer.contacts.filter(first_name__iexact=first_name, last_name__iexact=last_name).first()
        if not contact:
            contact = CustomerContact(customer=customer)

        contact.first_name = first_name
        contact.last_name = last_name
        contact.role = self._text(payload, "role")
        contact.email = email
        contact.phone = phone
        contact.company = self._text(payload, "company", customer.name) or customer.name
        contact.notes = self._text(payload, "notes")
        contact.is_primary = True
        contact.save()
        customer.contacts.exclude(pk=contact.pk).filter(is_primary=True).update(is_primary=False)

        full_name = contact.full_name
        update_fields = []
        for field, value in [("contact_name", full_name), ("email", contact.email), ("phone", contact.phone)]:
            if getattr(customer, field) != value:
                setattr(customer, field, value)
                update_fields.append(field)
        if update_fields:
            customer.save(update_fields=update_fields)
        return contact

    def _save_primary_address(self, customer, payload):
        if not self._has_address_info(payload):
            return None

        address_id = self._text(payload, "id")
        address_line_1 = self._text(payload, "address_line_1")
        city = self._text(payload, "city")
        state = self._text(payload, "state")
        postal_code = self._text(payload, "postal_code")

        address = customer.addresses.filter(pk=address_id).first() if address_id.isdigit() else None
        if not address and address_line_1:
            for candidate in customer.addresses.filter(address_line_1__iexact=address_line_1):
                if (
                    candidate.city.lower() == city.lower()
                    and candidate.state.lower() == state.lower()
                    and candidate.postal_code.lower() == postal_code.lower()
                ):
                    address = candidate
                    break
        if not address:
            address = CustomerAddress(customer=customer)

        for field in [
            "label",
            "address_line_1",
            "address_line_2",
            "address_line_3",
            "city",
            "state",
            "postal_code",
            "country",
            "notes",
        ]:
            setattr(address, field, self._text(payload, field))
        address.is_primary = True
        address.save()
        customer.addresses.exclude(pk=address.pk).filter(is_primary=True).update(is_primary=False)

        update_fields = []
        for field in ["address_line_1", "address_line_2", "address_line_3", "city", "state", "postal_code", "country"]:
            value = getattr(address, field)
            if getattr(customer, field) != value:
                setattr(customer, field, value)
                update_fields.append(field)
        if update_fields:
            customer.save(update_fields=update_fields)
        return address


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = "__all__"


class MessageThreadSerializer(serializers.ModelSerializer):
    unreadCount = serializers.SerializerMethodField()
    lastMessage = serializers.SerializerMethodField()

    class Meta:
        model = MessageThread
        fields = "__all__"

    def viewer_id(self):
        request = self.context.get("request")
        return str(request.query_params.get("viewer") or request.query_params.get("viewer_id") or "") if request else ""

    def get_unreadCount(self, obj):
        viewer = self.viewer_id()
        if not viewer:
            return 0
        return sum(
            1
            for message in obj.messages.all()
            if str(message.sender_user_id or "") != viewer and viewer not in [str(item) for item in (message.read_by_user_ids or [])]
        )

    def get_lastMessage(self, obj):
        message = obj.messages.order_by("-created_at", "-id").first()
        if not message:
            return ""
        return message.body[:140]


class QuoteRawMaterialSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="external_id")
    componentType = serializers.CharField(source="component_type")
    msiCost = serializers.DecimalField(source="msi_cost", max_digits=12, decimal_places=4)
    inventoryMsi = serializers.DecimalField(source="inventory_msi", max_digits=14, decimal_places=3)

    class Meta:
        model = QuoteRawMaterial
        fields = ["id", "name", "componentType", "msiCost", "inventoryMsi", "notes"]


class QuoteCostRateSerializer(serializers.ModelSerializer):
    msiCost = serializers.DecimalField(source="msi_cost", max_digits=12, decimal_places=4)

    class Meta:
        model = QuoteCostRate
        fields = ["id", "key", "label", "msiCost", "notes", "locked"]


class QuoteFinishedMaterialSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="external_id")
    unitType = serializers.CharField(source="unit_type", required=False)
    materialMasterTypeId = serializers.PrimaryKeyRelatedField(source="material_master_type", queryset=MaterialMasterType.objects.all(), allow_null=True, required=False)
    materialMasterTypeCode = serializers.CharField(source="material_master_type.code", read_only=True)
    materialMasterTypeName = serializers.CharField(source="material_master_type.name", read_only=True)
    sourceType = serializers.CharField(source="source_type")
    purchasedMsiCost = serializers.DecimalField(source="purchased_msi_cost", max_digits=12, decimal_places=4)
    faceRawId = serializers.CharField(source="face_raw_id", allow_blank=True, required=False)
    linerRawId = serializers.CharField(source="liner_raw_id", allow_blank=True, required=False)
    adhesiveRawId = serializers.CharField(source="adhesive_raw_id", allow_blank=True, required=False)
    siliconeRawId = serializers.CharField(source="silicone_raw_id", allow_blank=True, required=False)
    inkRawId = serializers.CharField(source="ink_raw_id", allow_blank=True, required=False)
    laborMsiCost = serializers.DecimalField(source="labor_msi_cost", max_digits=12, decimal_places=4)
    coatingMsiCost = serializers.DecimalField(source="coating_msi_cost", max_digits=12, decimal_places=4)
    complexityMsiCost = serializers.DecimalField(source="complexity_msi_cost", max_digits=12, decimal_places=4)
    otherMsiCost = serializers.DecimalField(source="other_msi_cost", max_digits=12, decimal_places=4)
    baseMarkupPercent = serializers.DecimalField(source="base_markup_percent", max_digits=7, decimal_places=3)
    targetMarkupPercent = serializers.DecimalField(source="target_markup_percent", max_digits=7, decimal_places=3)

    class Meta:
        model = QuoteFinishedMaterial
        fields = [
            "id",
            "name",
            "unitType",
            "materialMasterTypeId",
            "materialMasterTypeCode",
            "materialMasterTypeName",
            "sourceType",
            "purchasedMsiCost",
            "faceRawId",
            "linerRawId",
            "adhesiveRawId",
            "siliconeRawId",
            "inkRawId",
            "laborMsiCost",
            "coatingMsiCost",
            "complexityMsiCost",
            "otherMsiCost",
            "baseMarkupPercent",
            "targetMarkupPercent",
            "notes",
        ]


class QuoteRecordSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="external_id")
    quoteNumber = serializers.CharField(source="quote_number")
    createdAt = serializers.DateTimeField(source="created_at", required=False)
    preparedByUserId = serializers.CharField(source="prepared_by_user_id", allow_blank=True, required=False)
    preparedByUsername = serializers.CharField(source="prepared_by_username", allow_blank=True, required=False)
    preparedByName = serializers.CharField(source="prepared_by_name", allow_blank=True, required=False)
    preparedByRole = serializers.CharField(source="prepared_by_role", allow_blank=True, required=False)
    quoteCompany = serializers.ChoiceField(source="quote_company", choices=QUOTE_COMPANY_CHOICES, required=False)
    customerId = serializers.PrimaryKeyRelatedField(source="customer", queryset=Customer.objects.all(), allow_null=True, required=False)
    customerCode = serializers.CharField(source="customer.customer_code", read_only=True)
    jobTicketId = serializers.PrimaryKeyRelatedField(source="job_ticket", queryset=JobTicket.objects.all(), allow_null=True, required=False)
    jobTicketNumber = serializers.CharField(source="job_ticket_number", allow_blank=True, required=False)
    customerName = serializers.CharField(source="customer_name", allow_blank=True, required=False)
    jobName = serializers.CharField(source="job_name", allow_blank=True, required=False)
    productCode = serializers.CharField(source="product_code", allow_blank=True, required=False)
    contactName = serializers.CharField(source="contact_name", allow_blank=True, required=False)
    contactEmail = serializers.EmailField(source="contact_email", allow_blank=True, required=False)
    preparedBy = serializers.CharField(source="prepared_by", allow_blank=True, required=False)
    approvalStatus = serializers.ChoiceField(source="approval_status", choices=QUOTE_APPROVAL_STATUS_CHOICES, required=False)
    approvalAt = serializers.DateTimeField(source="approval_at", allow_null=True, required=False)
    approvalByUserId = serializers.CharField(source="approval_by_user_id", allow_blank=True, required=False)
    approvalByName = serializers.CharField(source="approval_by_name", allow_blank=True, required=False)
    approvalByRole = serializers.CharField(source="approval_by_role", allow_blank=True, required=False)
    approvalNote = serializers.CharField(source="approval_note", allow_blank=True, required=False)
    quoteWorkflowStatus = serializers.ChoiceField(source="workflow_status", choices=QUOTE_WORKFLOW_STATUS_CHOICES, required=False)
    processedAt = serializers.DateTimeField(source="processed_at", allow_null=True, required=False)
    processedByUserId = serializers.CharField(source="processed_by_user_id", allow_blank=True, required=False)
    processedByName = serializers.CharField(source="processed_by_name", allow_blank=True, required=False)
    processedByRole = serializers.CharField(source="processed_by_role", allow_blank=True, required=False)
    lastEditedAt = serializers.DateTimeField(source="last_edited_at", allow_null=True, required=False)
    lastEditedByUserId = serializers.CharField(source="last_edited_by_user_id", allow_blank=True, required=False)
    lastEditedByName = serializers.CharField(source="last_edited_by_name", allow_blank=True, required=False)
    lastEditedByRole = serializers.CharField(source="last_edited_by_role", allow_blank=True, required=False)
    editCount = serializers.IntegerField(source="edit_count", required=False, min_value=0)
    materialName = serializers.CharField(source="material_name", allow_blank=True, required=False)
    materialSource = serializers.CharField(source="material_source", allow_blank=True, required=False)
    materialComponents = serializers.CharField(source="material_components", allow_blank=True, required=False)

    class Meta:
        model = QuoteRecord
        fields = [
            "id",
            "quoteNumber",
            "createdAt",
            "preparedByUserId",
            "preparedByUsername",
            "preparedByName",
            "preparedByRole",
            "quoteCompany",
            "customerId",
            "customerCode",
            "jobTicketId",
            "jobTicketNumber",
            "customerName",
            "jobName",
            "productCode",
            "contactName",
            "contactEmail",
            "preparedBy",
            "approvalStatus",
            "approvalAt",
            "approvalByUserId",
            "approvalByName",
            "approvalByRole",
            "approvalNote",
            "quoteWorkflowStatus",
            "processedAt",
            "processedByUserId",
            "processedByName",
            "processedByRole",
            "lastEditedAt",
            "lastEditedByUserId",
            "lastEditedByName",
            "lastEditedByRole",
            "editCount",
            "notes",
            "materialName",
            "materialSource",
            "materialComponents",
            "form",
            "pricing",
        ]


class BoxSpecSerializer(serializers.ModelSerializer):
    class Meta:
        model = BoxSpec
        fields = "__all__"


class BoxInventorySerializer(serializers.ModelSerializer):
    box_name = serializers.CharField(source="box.name", read_only=True)
    box_item_number = serializers.CharField(source="box.item_number", read_only=True)
    box_supplier = serializers.CharField(source="box.supplier", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    location_full_path = serializers.ReadOnlyField(source="location.full_path")

    class Meta:
        model = BoxInventory
        fields = "__all__"


class CoreSpecSerializer(serializers.ModelSerializer):
    class Meta:
        model = CoreSpec
        fields = "__all__"


class CoreInventorySerializer(serializers.ModelSerializer):
    core_name = serializers.CharField(source="core.name", read_only=True)
    core_item_number = serializers.CharField(source="core.item_number", read_only=True)
    core_supplier = serializers.CharField(source="core.supplier", read_only=True)
    core_size_inches = serializers.DecimalField(source="core.core_size_inches", max_digits=6, decimal_places=3, read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    location_full_path = serializers.ReadOnlyField(source="location.full_path")

    class Meta:
        model = CoreInventory
        fields = "__all__"


class JobTicketSerializer(serializers.ModelSerializer):
    performed_by = serializers.CharField(write_only=True, required=False, allow_blank=True)
    customer_display = serializers.SerializerMethodField()
    customer_account_owner = serializers.SerializerMethodField()
    general_image = serializers.SerializerMethodField()
    spec_image = serializers.SerializerMethodField()
    finishing_image = serializers.SerializerMethodField()
    job_images = serializers.SerializerMethodField()
    recent_usage_90d = serializers.SerializerMethodField()
    finished_on_hand_quantity = serializers.SerializerMethodField()
    stockout_business_days = serializers.SerializerMethodField()
    current_schedule_count = serializers.SerializerMethodField()
    schedule_sort_bucket = serializers.SerializerMethodField()
    recent_usage_sort_bucket = serializers.SerializerMethodField()
    recent_order_count_30d = serializers.SerializerMethodField()
    stockout_sort_bucket = serializers.SerializerMethodField()
    recent_monthly_usage = serializers.SerializerMethodField()
    stock_months_on_hand = serializers.SerializerMethodField()
    low_stock_level = serializers.SerializerMethodField()
    recipe_name = serializers.CharField(source="recipe.name", read_only=True)
    box_name = serializers.CharField(source="box.name", read_only=True)
    linked_box_item_number = serializers.CharField(source="box.item_number", read_only=True)
    box_supplier = serializers.CharField(source="box.supplier", read_only=True)
    core_name = serializers.CharField(source="core.name", read_only=True)
    core_item_number = serializers.CharField(source="core.item_number", read_only=True)
    core_supplier = serializers.CharField(source="core.supplier", read_only=True)
    material_spec_name = serializers.SerializerMethodField()
    material_spec_code = serializers.SerializerMethodField()
    material_spec_family = serializers.SerializerMethodField()
    material_spec_gsm = serializers.SerializerMethodField()
    material_spec_liner_pounds = serializers.SerializerMethodField()
    material_master_type_code = serializers.SerializerMethodField()
    material_master_type_name = serializers.SerializerMethodField()
    material_spec_master_type = serializers.SerializerMethodField()
    material_spec_master_type_code = serializers.SerializerMethodField()
    material_spec_master_type_name = serializers.SerializerMethodField()
    print_method_display = serializers.CharField(source="get_print_method_display", read_only=True)
    print_plate_details = serializers.SerializerMethodField()
    print_station_count = serializers.SerializerMethodField()

    def get_print_plate_details(self, obj):
        plates = list(obj.print_plates.all()) if getattr(obj, "pk", None) else []
        return [
            {
                "id": plate.id,
                "plate_number": plate.plate_number,
                "customer_plate_number": plate.customer_plate_number,
                "serial_number": plate.serial_number,
                "description": plate.description,
                "recipe": plate.recipe_id,
                "recipe_name": plate.recipe.name if plate.recipe_id and plate.recipe else "",
                "station_count": sum(1 for station in plate.stations.all() if station.is_active),
            }
            for plate in plates
        ]

    def get_print_station_count(self, obj):
        return sum((plate_detail.get("station_count") or 0) for plate_detail in self.get_print_plate_details(obj))

    def get_customer_display(self, obj):
        return obj.customer.name if obj.customer else obj.customer_name or None

    def get_customer_account_owner(self, obj):
        return obj.customer.account_owner if obj.customer else ""

    def get_material_spec_name(self, obj):
        return obj.material_spec.name if obj.material_spec else None

    def get_material_spec_code(self, obj):
        return obj.material_spec.code if obj.material_spec else None

    def get_material_spec_family(self, obj):
        return obj.material_spec.material_family if obj.material_spec else None

    def get_material_spec_gsm(self, obj):
        return obj.material_spec.gsm if obj.material_spec else None

    def get_material_spec_liner_pounds(self, obj):
        return obj.material_spec.liner_pounds if obj.material_spec else None

    def get_material_master_type_code(self, obj):
        return obj.material_master_type.code if obj.material_master_type else None

    def get_material_master_type_name(self, obj):
        return obj.material_master_type.name if obj.material_master_type else None

    def get_material_spec_master_type(self, obj):
        return obj.material_spec.master_type_id if obj.material_spec else None

    def get_material_spec_master_type_code(self, obj):
        return obj.material_spec.master_type.code if obj.material_spec and obj.material_spec.master_type else None

    def get_material_spec_master_type_name(self, obj):
        return obj.material_spec.master_type.name if obj.material_spec and obj.material_spec.master_type else None

    def get_recent_usage_90d(self, obj):
        return getattr(obj, "recent_usage_90d", 0) or 0

    def get_finished_on_hand_quantity(self, obj):
        return getattr(obj, "finished_on_hand_quantity", 0) or 0

    def get_stockout_business_days(self, obj):
        value = getattr(obj, "stockout_business_days", None)
        if value is None:
            return None
        return round(float(value), 3)

    def get_current_schedule_count(self, obj):
        return int(getattr(obj, "current_schedule_count", 0) or 0)

    def get_schedule_sort_bucket(self, obj):
        return int(getattr(obj, "schedule_sort_bucket", 0) or 0)

    def get_recent_usage_sort_bucket(self, obj):
        return int(getattr(obj, "recent_usage_sort_bucket", 0) or 0)

    def get_recent_order_count_30d(self, obj):
        return int(getattr(obj, "recent_order_count_30d", 0) or 0)

    def get_stockout_sort_bucket(self, obj):
        return int(getattr(obj, "stockout_sort_bucket", 0) or 0)

    def get_recent_monthly_usage(self, obj):
        usage = float(getattr(obj, "recent_usage_90d", 0) or 0)
        return round(usage / 3, 3) if usage > 0 else 0

    def get_stock_months_on_hand(self, obj):
        usage = float(getattr(obj, "recent_usage_90d", 0) or 0)
        on_hand = float(getattr(obj, "finished_on_hand_quantity", 0) or 0)
        monthly = usage / 3 if usage > 0 else 0
        return round(on_hand / monthly, 3) if monthly > 0 else None

    def get_low_stock_level(self, obj):
        usage = float(getattr(obj, "recent_usage_90d", 0) or 0)
        on_hand = float(getattr(obj, "finished_on_hand_quantity", 0) or 0)
        monthly = usage / 3 if usage > 0 else 0
        if monthly <= 0 or on_hand > monthly:
            return ""
        return "critical" if on_hand <= 0 else "low"

    def image_payload(self, obj, slot):
        image = getattr(obj, f"{slot}_image", None)
        protected_url = job_ticket_image_preview_url(self, obj, slot)
        external_url = obj.external_image_url if slot == "general" and not image else ""
        preview_url = protected_url or external_url
        source = ""
        if image:
            source = "New System"
        elif external_url:
            source = obj.external_image_source or "Legacy"
        file_name = image.name.split("/")[-1] if image else file_name_from_url(external_url)
        return {
            "slot": slot,
            "label": {
                "general": "General Image",
                "spec": "Spec Image",
                "finishing": "Finishing Image",
            }.get(slot, slot.title()),
            "url": preview_url,
            "fileName": file_name,
            "storageName": image.name if image else "",
            "name": getattr(obj, f"{slot}_image_name", "") or (f"{source} file" if source and not image else file_name),
            "description": getattr(obj, f"{slot}_image_description", ""),
            "hasImage": bool(preview_url),
            "source": source,
            "isExternal": bool(external_url),
            "isDocument": is_document_url(file_name or external_url),
        }

    def get_job_images(self, obj):
        return [self.image_payload(obj, slot) for slot in ["general", "spec", "finishing"]]

    def get_general_image(self, obj):
        return job_ticket_general_image_url(self, obj)

    def get_spec_image(self, obj):
        return job_ticket_image_preview_url(self, obj, "spec")

    def get_finishing_image(self, obj):
        return job_ticket_image_preview_url(self, obj, "finishing")

    class Meta:
        model = JobTicket
        fields = "__all__"

    def create(self, validated_data):
        validated_data.pop("performed_by", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("performed_by", None)
        return super().update(instance, validated_data)


class JobTicketEventSerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    job_name = serializers.CharField(source="job_ticket.job_name", read_only=True)
    product_code = serializers.CharField(source="job_ticket.product_code", read_only=True)

    class Meta:
        model = JobTicketEvent
        fields = "__all__"


class JobTicketUsageSerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    job_name = serializers.CharField(source="job_ticket.job_name", read_only=True)
    product_code = serializers.CharField(source="job_ticket.product_code", read_only=True)

    class Meta:
        model = JobTicketUsage
        fields = "__all__"


class LiveFootageArchiveSerializer(serializers.ModelSerializer):
    class Meta:
        model = LiveFootageArchive
        fields = "__all__"


class LocalLiveFootageReadingSerializer(serializers.ModelSerializer):
    class Meta:
        model = LocalLiveFootageReading
        fields = "__all__"


class ProductionScheduleSerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    job_name = serializers.CharField(source="job_ticket.job_name", read_only=True)
    job_product_code = serializers.CharField(source="job_ticket.product_code", read_only=True)
    job_description = serializers.CharField(source="job_ticket.description", read_only=True)
    job_notes = serializers.CharField(source="job_ticket.job_notes", read_only=True)
    job_finishing_notes = serializers.CharField(source="job_ticket.finishing_notes", read_only=True)
    job_has_print = serializers.BooleanField(source="job_ticket.has_print", read_only=True)
    job_print_method = serializers.CharField(source="job_ticket.print_method", read_only=True)
    job_print_method_display = serializers.CharField(source="job_ticket.get_print_method_display", read_only=True)
    job_art_file_created = serializers.BooleanField(source="job_ticket.art_file_created", read_only=True)
    job_print_notes = serializers.CharField(source="job_ticket.print_notes", read_only=True)
    job_print_plate_summary = serializers.SerializerMethodField()
    job_general_image_url = serializers.SerializerMethodField()
    job_general_image_source = serializers.SerializerMethodField()
    job_general_image_is_document = serializers.SerializerMethodField()
    job_general_image_name = serializers.CharField(source="job_ticket.general_image_name", read_only=True)
    job_label_width_inches = serializers.CharField(source="job_ticket.label_width_inches", read_only=True)
    job_label_length_inches = serializers.CharField(source="job_ticket.label_length_inches", read_only=True)
    job_repeat_inches = serializers.CharField(source="job_ticket.repeat_inches", read_only=True)
    job_recipe = serializers.IntegerField(source="job_ticket.recipe_id", read_only=True)
    job_cutting_type = serializers.CharField(source="job_ticket.cutting_type", read_only=True)
    job_finishing_type = serializers.CharField(source="job_ticket.finishing_type", read_only=True)
    job_unit_type = serializers.CharField(source="job_ticket.unit_type", read_only=True)
    job_labels_per_unit = serializers.DecimalField(source="job_ticket.labels_per_unit", max_digits=12, decimal_places=3, read_only=True)
    job_units_per_carton = serializers.DecimalField(source="job_ticket.units_per_carton", max_digits=12, decimal_places=3, read_only=True)
    job_labels_per_carton = serializers.DecimalField(source="job_ticket.labels_per_carton", max_digits=12, decimal_places=3, read_only=True)
    job_core_size_inches = serializers.DecimalField(source="job_ticket.core_size_inches", max_digits=8, decimal_places=4, read_only=True)
    job_wind_direction = serializers.CharField(source="job_ticket.wind_direction", read_only=True)
    job_fanfold_gear = serializers.IntegerField(source="job_ticket.fanfold_gear", read_only=True)
    job_labels_per_fold = serializers.IntegerField(source="job_ticket.labels_per_fold", read_only=True)
    job_ribbon = serializers.CharField(source="job_ticket.ribbon", read_only=True)
    job_laminate = serializers.CharField(source="job_ticket.laminate", read_only=True)
    job_bagged = serializers.CharField(source="job_ticket.bagged", read_only=True)
    job_core = serializers.IntegerField(source="job_ticket.core_id", read_only=True)
    job_core_name = serializers.CharField(source="job_ticket.core.name", read_only=True)
    job_core_item_number = serializers.CharField(source="job_ticket.core.item_number", read_only=True)
    job_material_spec = serializers.IntegerField(source="job_ticket.material_spec_id", read_only=True)
    job_material_master_type = serializers.IntegerField(source="job_ticket.material_master_type_id", read_only=True)
    job_material_master_type_code = serializers.SerializerMethodField()
    job_material_spec_master_type = serializers.SerializerMethodField()
    job_material_spec_master_type_code = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()
    job_material_spec_name = serializers.SerializerMethodField()
    job_material_spec_code = serializers.SerializerMethodField()
    recipe_name = serializers.CharField(source="job_ticket.recipe.name", read_only=True)
    box_name = serializers.CharField(source="job_ticket.box.name", read_only=True)
    box_item_number = serializers.CharField(source="job_ticket.box_item_number", read_only=True)
    linked_box_item_number = serializers.CharField(source="job_ticket.box.item_number", read_only=True)
    material_inventory_name = serializers.CharField(source="material_inventory.name", read_only=True)
    material_inventory_serial = serializers.CharField(source="material_inventory.serial_number", read_only=True)
    press_name = serializers.CharField(source="press.name", read_only=True)
    reported_total_footage = serializers.SerializerMethodField()
    reported_good_footage = serializers.SerializerMethodField()
    reported_material_footage = serializers.SerializerMethodField()
    reported_waste_footage = serializers.SerializerMethodField()
    footage_remaining = serializers.SerializerMethodField()
    shift_report_count = serializers.SerializerMethodField()
    active_material_count = serializers.SerializerMethodField()
    customer_order_id = serializers.SerializerMethodField()
    customer_order_number = serializers.SerializerMethodField()
    customer_order_events = serializers.SerializerMethodField()

    def get_job_print_plate_summary(self, obj):
        if not obj.job_ticket_id:
            return []
        return [
            {
                "id": plate.id,
                "plate_number": plate.plate_number,
                "description": plate.description,
                "stations": [
                    {
                        "station_number": station.station_number,
                        "station_plate_number": station.station_plate_number,
                        "pms_color": station.pms_color,
                        "anilox_gear_number": station.anilox_gear_number,
                    }
                    for station in plate.stations.all()
                    if station.is_active
                ],
            }
            for plate in obj.job_ticket.print_plates.all()
        ]

    def get_customer_name(self, obj):
        if obj.customer:
            return obj.customer.name
        if obj.job_ticket and obj.job_ticket.customer:
            return obj.job_ticket.customer.name
        return obj.job_ticket.customer_name if obj.job_ticket else None

    def get_job_material_spec_name(self, obj):
        return obj.job_ticket.material_spec.name if obj.job_ticket and obj.job_ticket.material_spec else None

    def get_job_material_spec_code(self, obj):
        return obj.job_ticket.material_spec.code if obj.job_ticket and obj.job_ticket.material_spec else None

    def get_job_material_master_type_code(self, obj):
        return obj.job_ticket.material_master_type.code if obj.job_ticket and obj.job_ticket.material_master_type else None

    def get_job_material_spec_master_type(self, obj):
        return obj.job_ticket.material_spec.master_type_id if obj.job_ticket and obj.job_ticket.material_spec else None

    def get_job_material_spec_master_type_code(self, obj):
        if not obj.job_ticket or not obj.job_ticket.material_spec or not obj.job_ticket.material_spec.master_type:
            return None
        return obj.job_ticket.material_spec.master_type.code

    def get_job_general_image_url(self, obj):
        if not obj.job_ticket:
            return ""
        return job_ticket_general_image_url(self, obj.job_ticket)

    def get_job_general_image_source(self, obj):
        if not obj.job_ticket:
            return ""
        if obj.job_ticket.general_image:
            return "New System"
        if obj.job_ticket.external_image_url:
            return obj.job_ticket.external_image_source or "Glide"
        return ""

    def get_job_general_image_is_document(self, obj):
        image = obj.job_ticket.general_image if obj.job_ticket else None
        external_url = obj.job_ticket.external_image_url if obj.job_ticket and not image else ""
        return is_document_url(image.name if image else external_url)

    def _report_totals(self, obj):
        cached = getattr(obj, "_report_totals_cache", None)
        if cached is None:
            reports = list(obj.shift_reports.all())
            cached = {
                "total": sum((report.total_footage or 0 for report in reports), 0),
                "good": sum((report.good_footage or 0 for report in reports), 0),
                "material": sum((report.material_footage or 0 for report in reports), 0),
            }
            obj._report_totals_cache = cached
        return cached

    def get_reported_total_footage(self, obj):
        return self._report_totals(obj).get("total") or 0

    def get_reported_good_footage(self, obj):
        return self._report_totals(obj).get("good") or 0

    def get_reported_material_footage(self, obj):
        return self._report_totals(obj).get("material") or 0

    def get_reported_waste_footage(self, obj):
        totals = self._report_totals(obj)
        return max(0, (totals.get("total") or 0) - (totals.get("good") or 0))

    def get_footage_remaining(self, obj):
        if obj.target_footage is None:
            return None
        return max(0, obj.target_footage - self.get_reported_good_footage(obj))

    def get_shift_report_count(self, obj):
        return len(obj.shift_reports.all())

    def get_active_material_count(self, obj):
        return sum(1 for assignment in obj.material_assignments.all() if assignment.status == "active")

    def _customer_order(self, obj):
        cached = getattr(obj, "_customer_order_cache", None)
        if cached is None:
            cached = next(iter(obj.customer_orders.all()), None)
            obj._customer_order_cache = cached
        return cached

    def get_customer_order_id(self, obj):
        order = self._customer_order(obj)
        return order.id if order else None

    def get_customer_order_number(self, obj):
        order = self._customer_order(obj)
        return order.order_number if order else ""

    def get_customer_order_events(self, obj):
        order = self._customer_order(obj)
        if not order:
            return []
        return [
            {
                "id": event.id,
                "event_type": event.event_type,
                "summary": event.summary,
                "performed_by": event.performed_by,
                "created_at": event.created_at.isoformat() if event.created_at else "",
            }
            for event in list(order.events.all())[:6]
        ]

    class Meta:
        model = ProductionSchedule
        fields = "__all__"

    def validate(self, attrs):
        attrs = super().validate(attrs)
        ticket = attrs.get("job_ticket", getattr(self.instance, "job_ticket", None))
        is_dynamic = bool(ticket and ticket.print_method == "dynamic")
        dynamic_file_created = attrs.get("dynamic_file_created", getattr(self.instance, "dynamic_file_created", False))
        dynamic_start_number = str(attrs.get("dynamic_start_number", getattr(self.instance, "dynamic_start_number", "")) or "").strip()
        dynamic_end_number = str(attrs.get("dynamic_end_number", getattr(self.instance, "dynamic_end_number", "")) or "").strip()
        if is_dynamic:
            if dynamic_file_created and (not dynamic_start_number or not dynamic_end_number):
                raise serializers.ValidationError({
                    "dynamic_start_number": "Enter the starting number for this dynamic order.",
                    "dynamic_end_number": "Enter the ending number for this dynamic order.",
                })
            if not dynamic_file_created:
                attrs["status"] = "on_hold"
                reasons = attrs.get("hold_reasons", getattr(self.instance, "hold_reasons", []))
                if not isinstance(reasons, list):
                    reasons = []
                if "art_files" not in reasons:
                    reasons = [*reasons, "art_files"]
                attrs["hold_reasons"] = reasons
                note = "Files not created for this dynamic print job."
                current_notes = str(attrs.get("hold_notes", getattr(self.instance, "hold_notes", "")) or "").strip()
                if note.lower() not in current_notes.lower():
                    attrs["hold_notes"] = "\n".join([part for part in [current_notes, note] if part])
        status = attrs.get("status", getattr(self.instance, "status", ""))
        hold_reasons = attrs.get("hold_reasons", getattr(self.instance, "hold_reasons", []))
        if status == "on_hold":
            if not isinstance(hold_reasons, list) or not hold_reasons:
                raise serializers.ValidationError({"hold_reasons": "Select at least one reason before moving this job to Held."})
            allowed = {value for value, label in ProductionSchedule.HOLD_REASON_CHOICES}
            invalid = [value for value in hold_reasons if value not in allowed]
            if invalid:
                raise serializers.ValidationError({"hold_reasons": f"Unsupported hold reason: {', '.join(invalid)}"})
        return attrs


class ProductionMaterialAssignmentSerializer(serializers.ModelSerializer):
    inventory_serial = serializers.CharField(source="inventory.serial_number", read_only=True)
    inventory_lot = serializers.CharField(source="inventory.lot_number", read_only=True)
    inventory_name = serializers.CharField(source="inventory.name", read_only=True)
    inventory_code = serializers.CharField(source="inventory.code", read_only=True)
    inventory_width_inches = serializers.DecimalField(source="inventory.width_inches", max_digits=8, decimal_places=3, read_only=True)
    inventory_length_feet = serializers.DecimalField(source="inventory.length_feet", max_digits=12, decimal_places=2, read_only=True)
    inventory_quantity = serializers.DecimalField(source="inventory.quantity", max_digits=12, decimal_places=3, read_only=True)
    inventory_status = serializers.CharField(source="inventory.status", read_only=True)
    inventory_location = serializers.CharField(source="inventory.location.full_path", read_only=True)
    supplier_name = serializers.CharField(source="inventory.supplier.name", read_only=True)
    material_name = serializers.CharField(source="inventory.material.name", read_only=True)
    material_code = serializers.CharField(source="inventory.material.code", read_only=True)
    material_master_type = serializers.IntegerField(source="inventory.material.master_type_id", read_only=True)
    material_master_type_code = serializers.CharField(source="inventory.material.master_type.code", read_only=True)
    source_roll_tag = serializers.CharField(source="inventory.source_roll_tag.tag_number", read_only=True)
    job_ticket = serializers.IntegerField(source="production_schedule.job_ticket_id", read_only=True)
    job_ticket_number = serializers.CharField(source="production_schedule.job_ticket.ticket_number", read_only=True)
    job_name = serializers.CharField(source="production_schedule.job_ticket.job_name", read_only=True)
    used_footage = serializers.SerializerMethodField()

    def get_used_footage(self, obj):
        annotated = getattr(obj, "used_footage_total", None)
        if annotated is not None:
            return annotated
        return obj.production_schedule.material_usage_records.filter(
            inventory_id=obj.inventory_id,
            usage_type__in=["finished", "scrap"],
        ).aggregate(total=models.Sum("quantity"))["total"] or 0

    def validate(self, attrs):
        schedule = attrs.get("production_schedule") or getattr(self.instance, "production_schedule", None)
        inventory = attrs.get("inventory") or getattr(self.instance, "inventory", None)
        source_type = attrs.get("source_type") or getattr(self.instance, "source_type", "")
        carton_lot_code = attrs.get("carton_lot_code", getattr(self.instance, "carton_lot_code", ""))
        if schedule and inventory:
            ticket = schedule.job_ticket
            required_master = ticket.material_master_type_id or (
                ticket.material_spec.master_type_id if ticket.material_spec_id and ticket.material_spec else None
            )
            actual_master = inventory.material.master_type_id if inventory.material_id and inventory.material else None
            if required_master and actual_master != required_master:
                raise serializers.ValidationError({"inventory": "This roll is not the material type required by this job."})
            if inventory.material_type != "coated_stock":
                raise serializers.ValidationError({"inventory": "Select a finished coated-material roll."})
            if inventory.status in ["depleted", "scrapped", "on_hold"] or not inventory.is_active:
                raise serializers.ValidationError({"inventory": "This roll is not active production inventory."})
        if source_type == "tsm" and inventory and not inventory.source_roll_tag_id:
            raise serializers.ValidationError({"inventory": "This is not a Tri-State produced roll. Use Purchased Roll."})
        if source_type == "outsourced" and not str(carton_lot_code or "").isdigit():
            raise serializers.ValidationError({"carton_lot_code": "Enter the 5-digit lot number stamped on the cartons."})
        if source_type == "outsourced" and len(str(carton_lot_code or "")) != 5:
            raise serializers.ValidationError({"carton_lot_code": "The carton lot number must be exactly 5 digits."})
        return attrs

    class Meta:
        model = ProductionMaterialAssignment
        fields = "__all__"


class ProductionShiftSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductionShiftSetting
        fields = "__all__"


class ProductionShiftReportSerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    job_name = serializers.CharField(source="job_ticket.job_name", read_only=True)
    customer_name = serializers.SerializerMethodField()
    press_name = serializers.CharField(source="press.name", read_only=True)
    waste_footage = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    coater_schedule_tag_number = serializers.CharField(source="coater_schedule.tag_number", read_only=True)
    coater_schedule_name = serializers.CharField(source="coater_schedule.name", read_only=True)
    coater_material_name = serializers.SerializerMethodField()
    schedule_reference = serializers.SerializerMethodField()
    display_job_name = serializers.SerializerMethodField()

    def get_customer_name(self, obj):
        if obj.coater_schedule_id:
            return "Tri-State Media"
        if not obj.production_schedule_id:
            return obj.job_ticket.customer_name if obj.job_ticket else ""
        if obj.production_schedule.customer:
            return obj.production_schedule.customer.name
        if obj.job_ticket.customer:
            return obj.job_ticket.customer.name
        return obj.job_ticket.customer_name

    def get_coater_material_name(self, obj):
        schedule = obj.coater_schedule
        if not schedule:
            return ""
        material = schedule.produced_material or schedule.scheduled_material
        return getattr(material, "name", "") or getattr(material, "code", "") or schedule.name

    def get_schedule_reference(self, obj):
        if obj.coater_schedule_id:
            return obj.coater_schedule.tag_number
        if obj.production_schedule_id:
            return str(obj.production_schedule_id)
        return ""

    def get_display_job_name(self, obj):
        if obj.coater_schedule_id:
            return self.get_coater_material_name(obj) or obj.coater_schedule.name
        return obj.job_ticket.job_name if obj.job_ticket_id else ""

    def validate(self, attrs):
        production_schedule = attrs.get("production_schedule", getattr(self.instance, "production_schedule", None))
        coater_schedule = attrs.get("coater_schedule", getattr(self.instance, "coater_schedule", None))
        total = attrs.get("total_footage", getattr(self.instance, "total_footage", 0))
        good = attrs.get("good_footage", getattr(self.instance, "good_footage", 0))
        start = attrs.get("shift_start", getattr(self.instance, "shift_start", None))
        end = attrs.get("shift_end", getattr(self.instance, "shift_end", None))
        if bool(production_schedule) == bool(coater_schedule):
            raise serializers.ValidationError({"production_schedule": "Choose either a production schedule or a coater schedule."})
        if total < 0 or good < 0:
            raise serializers.ValidationError("Footage cannot be negative.")
        if good > total:
            raise serializers.ValidationError({"good_footage": "Good footage cannot be greater than total footage."})
        if start and end and end <= start:
            raise serializers.ValidationError({"shift_end": "Shift end must be after shift start."})
        return attrs

    class Meta:
        model = ProductionShiftReport
        fields = "__all__"
        read_only_fields = ["job_ticket"]


class CustomerOrderSerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    schedule_status = serializers.CharField(source="schedule_entry.status", read_only=True)

    class Meta:
        model = CustomerOrder
        fields = "__all__"


class CustomerOrderEventSerializer(serializers.ModelSerializer):
    order_customer_name = serializers.CharField(source="order.customer_name", read_only=True)
    order_job_name = serializers.CharField(source="order.job_name", read_only=True)
    order_number = serializers.CharField(source="order.order_number", read_only=True)
    job_ticket_number = serializers.CharField(source="order.job_ticket.ticket_number", read_only=True)

    class Meta:
        model = CustomerOrderEvent
        fields = "__all__"


class FlexibleQuoteRelatedField(serializers.PrimaryKeyRelatedField):
    def use_pk_only_optimization(self):
        return False

    def to_representation(self, value):
        return value.external_id

    def to_internal_value(self, data):
        if data in ("", None):
            if self.allow_null:
                return None
            self.fail("does_not_exist", pk_value=data)
        try:
            return super().to_internal_value(data)
        except serializers.ValidationError:
            value = str(data).strip()
            try:
                return self.get_queryset().get(external_id=value)
            except QuoteRecord.DoesNotExist:
                self.fail("does_not_exist", pk_value=data)


class CustomerInteractionHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerInteractionHistory
        fields = ["id", "action", "summary", "performed_by", "changes", "created_at"]
        read_only_fields = fields


class CustomerInteractionSerializer(serializers.ModelSerializer):
    quote = FlexibleQuoteRelatedField(queryset=QuoteRecord.objects.all(), allow_null=True, required=False)
    related_quotes = FlexibleQuoteRelatedField(queryset=QuoteRecord.objects.all(), many=True, required=False)
    related_job_tickets = serializers.PrimaryKeyRelatedField(queryset=JobTicket.objects.all(), many=True, required=False)
    customer_contact = serializers.PrimaryKeyRelatedField(queryset=CustomerContact.objects.all(), allow_null=True, required=False)
    customer_address = serializers.PrimaryKeyRelatedField(queryset=CustomerAddress.objects.all(), allow_null=True, required=False)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    order_number = serializers.CharField(source="customer_order.order_number", read_only=True)
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    job_name = serializers.CharField(source="job_ticket.job_name", read_only=True)
    quote_number = serializers.CharField(source="quote.quote_number", read_only=True)
    customer_contact_detail = CustomerContactSerializer(source="customer_contact", read_only=True)
    customer_address_detail = CustomerAddressSerializer(source="customer_address", read_only=True)
    related_job_ticket_details = serializers.SerializerMethodField()
    related_quote_details = serializers.SerializerMethodField()
    history_entries = CustomerInteractionHistorySerializer(many=True, read_only=True)
    interaction_type_label = serializers.CharField(source="get_interaction_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    action_summary = serializers.CharField(write_only=True, required=False, allow_blank=True)

    def get_related_job_ticket_details(self, obj):
        tickets = list(obj.related_job_tickets.all())
        if obj.job_ticket_id and not any(ticket.pk == obj.job_ticket_id for ticket in tickets):
            tickets.insert(0, obj.job_ticket)
        return [
            {
                "id": ticket.pk,
                "ticket_number": ticket.ticket_number,
                "job_name": ticket.job_name,
                "product_code": ticket.product_code,
            }
            for ticket in tickets
            if ticket
        ]

    def get_related_quote_details(self, obj):
        quotes = list(obj.related_quotes.all())
        if obj.quote_id and not any(quote.pk == obj.quote_id for quote in quotes):
            quotes.insert(0, obj.quote)
        return [
            {
                "id": quote.external_id,
                "pk": quote.pk,
                "quote_number": quote.quote_number,
                "job_name": quote.job_name,
                "customer_name": quote.customer_name,
            }
            for quote in quotes
            if quote
        ]

    def validate(self, attrs):
        attrs.pop("action_summary", None)
        customer = attrs.get("customer", getattr(self.instance, "customer", None))
        customer_order = attrs.get("customer_order", getattr(self.instance, "customer_order", None))
        job_ticket = attrs.get("job_ticket", getattr(self.instance, "job_ticket", None))
        quote = attrs.get("quote", getattr(self.instance, "quote", None))
        customer_contact = attrs.get("customer_contact", getattr(self.instance, "customer_contact", None))
        customer_address = attrs.get("customer_address", getattr(self.instance, "customer_address", None))
        related_job_tickets = attrs.get("related_job_tickets")
        related_quotes = attrs.get("related_quotes")
        if related_job_tickets is None and self.instance:
            related_job_tickets = list(self.instance.related_job_tickets.all())
        if related_quotes is None and self.instance:
            related_quotes = list(self.instance.related_quotes.all())
        related_job_tickets = related_job_tickets or []
        related_quotes = related_quotes or []
        if not job_ticket and related_job_tickets:
            attrs["job_ticket"] = related_job_tickets[0]
            job_ticket = related_job_tickets[0]
        if not quote and related_quotes:
            attrs["quote"] = related_quotes[0]
            quote = related_quotes[0]
        if not customer:
            customer = (
                getattr(customer_order, "customer", None)
                or getattr(job_ticket, "customer", None)
                or getattr(quote, "customer", None)
                or next((ticket.customer for ticket in related_job_tickets if ticket.customer_id), None)
                or next((linked_quote.customer for linked_quote in related_quotes if linked_quote.customer_id), None)
            )
            if customer:
                attrs["customer"] = customer
        if not customer:
            raise serializers.ValidationError({"customer": "Choose a customer or link to a customer-owned job, order, or quote."})
        relations = [
            ("customer_order", customer_order),
            ("quote", quote),
            ("customer_contact", customer_contact),
            ("customer_address", customer_address),
        ]
        relations += [("related_quotes", related) for related in related_quotes]
        for field_name, related in relations:
            related_customer = getattr(related, "customer", None)
            if related and related_customer and related_customer.pk != customer.pk:
                raise serializers.ValidationError({field_name: "Linked record belongs to a different customer."})
        return attrs

    def create(self, validated_data):
        validated_data.pop("action_summary", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("action_summary", None)
        return super().update(instance, validated_data)

    class Meta:
        model = CustomerInteraction
        fields = "__all__"


class FinishedInventorySerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    job_ticket_product_code = serializers.CharField(source="job_ticket.product_code", read_only=True)
    customer_order_number = serializers.CharField(source="customer_order.order_number", read_only=True)
    recipe_name = serializers.CharField(source="recipe.name", read_only=True)
    recipe_option_name = serializers.CharField(source="recipe_option.name", read_only=True)
    material_inventory_serial = serializers.CharField(source="material_inventory.serial_number", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    location_full_path = serializers.ReadOnlyField(source="location.full_path")
    imported_tsm_id = serializers.SerializerMethodField()
    legacy_row_id = serializers.SerializerMethodField()

    def get_imported_tsm_id(self, obj):
        return note_value(obj.notes, "Imported TSM ID")

    def get_legacy_row_id(self, obj):
        return note_value(obj.notes, "Legacy Row ID")

    class Meta:
        model = FinishedInventory
        fields = "__all__"

    def validate_location(self, value):
        if value and value.inventory_scope == "raw_material":
            raise serializers.ValidationError("Choose a Finished Product or Shared location.")
        return value
