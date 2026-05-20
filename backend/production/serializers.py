from rest_framework import serializers

from materials.models import MaterialMasterType

from .models import (
    BoxInventory,
    BoxSpec,
    CompanyRole,
    CompanyUser,
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


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = "__all__"


class CompanyRoleSerializer(serializers.ModelSerializer):
    allowedResourceKeys = serializers.JSONField(source="allowed_resource_keys")
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = CompanyRole
        fields = ["id", "name", "description", "allowedResourceKeys", "locked", "createdAt"]


class CompanyUserSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source="role.name")
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = CompanyUser
        fields = ["id", "username", "password", "name", "role", "active", "createdAt"]

    def create(self, validated_data):
        password = validated_data.pop("password", "")
        role_data = validated_data.pop("role", {})
        role_name = role_data.get("name") or "CSR"
        role = CompanyRole.objects.get(name=role_name)
        user = CompanyUser(role=role, **validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", "")
        role_data = validated_data.pop("role", None)
        if role_data:
            instance.role = CompanyRole.objects.get(name=role_data.get("name"))
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


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
    jobTicketId = serializers.PrimaryKeyRelatedField(source="job_ticket", queryset=JobTicket.objects.all(), allow_null=True, required=False)
    jobTicketNumber = serializers.CharField(source="job_ticket_number", allow_blank=True, required=False)
    customerName = serializers.CharField(source="customer_name", allow_blank=True, required=False)
    jobName = serializers.CharField(source="job_name", allow_blank=True, required=False)
    productCode = serializers.CharField(source="product_code", allow_blank=True, required=False)
    contactName = serializers.CharField(source="contact_name", allow_blank=True, required=False)
    contactEmail = serializers.EmailField(source="contact_email", allow_blank=True, required=False)
    preparedBy = serializers.CharField(source="prepared_by", allow_blank=True, required=False)
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
            "jobTicketId",
            "jobTicketNumber",
            "customerName",
            "jobName",
            "productCode",
            "contactName",
            "contactEmail",
            "preparedBy",
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


class JobTicketSerializer(serializers.ModelSerializer):
    customer_display = serializers.SerializerMethodField()
    job_images = serializers.SerializerMethodField()
    recipe_name = serializers.CharField(source="recipe.name", read_only=True)
    box_name = serializers.CharField(source="box.name", read_only=True)
    box_item_number = serializers.CharField(source="box.item_number", read_only=True)
    box_supplier = serializers.CharField(source="box.supplier", read_only=True)
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

    def get_customer_display(self, obj):
        return obj.customer.name if obj.customer else obj.customer_name or None

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

    def image_payload(self, obj, slot):
        image = getattr(obj, f"{slot}_image", None)
        url = ""
        if image:
            try:
                url = image.url
            except ValueError:
                url = ""
        return {
            "slot": slot,
            "label": {
                "general": "General Image",
                "spec": "Spec Image",
                "finishing": "Finishing Image",
            }.get(slot, slot.title()),
            "url": url,
            "fileName": image.name.split("/")[-1] if image else "",
            "storageName": image.name if image else "",
            "name": getattr(obj, f"{slot}_image_name", ""),
            "description": getattr(obj, f"{slot}_image_description", ""),
            "hasImage": bool(image),
        }

    def get_job_images(self, obj):
        return [self.image_payload(obj, slot) for slot in ["general", "spec", "finishing"]]

    class Meta:
        model = JobTicket
        fields = "__all__"


class JobTicketEventSerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    job_name = serializers.CharField(source="job_ticket.job_name", read_only=True)
    product_code = serializers.CharField(source="job_ticket.product_code", read_only=True)

    class Meta:
        model = JobTicketEvent
        fields = "__all__"


class ProductionScheduleSerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    job_name = serializers.CharField(source="job_ticket.job_name", read_only=True)
    job_product_code = serializers.CharField(source="job_ticket.product_code", read_only=True)
    job_general_image_url = serializers.SerializerMethodField()
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
    job_ribbon = serializers.CharField(source="job_ticket.ribbon", read_only=True)
    job_laminate = serializers.CharField(source="job_ticket.laminate", read_only=True)
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
    box_item_number = serializers.CharField(source="job_ticket.box.item_number", read_only=True)
    material_inventory_name = serializers.CharField(source="material_inventory.name", read_only=True)
    material_inventory_serial = serializers.CharField(source="material_inventory.serial_number", read_only=True)
    press_name = serializers.CharField(source="press.name", read_only=True)

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
        image = obj.job_ticket.general_image if obj.job_ticket else None
        if not image:
            return ""
        try:
            return image.url
        except ValueError:
            return ""

    class Meta:
        model = ProductionSchedule
        fields = "__all__"


class CustomerOrderSerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    schedule_status = serializers.CharField(source="schedule_entry.status", read_only=True)

    class Meta:
        model = CustomerOrder
        fields = "__all__"


class CustomerOrderEventSerializer(serializers.ModelSerializer):
    order_customer_name = serializers.CharField(source="order.customer_name", read_only=True)
    order_job_name = serializers.CharField(source="order.job_name", read_only=True)
    job_ticket_number = serializers.CharField(source="order.job_ticket.ticket_number", read_only=True)

    class Meta:
        model = CustomerOrderEvent
        fields = "__all__"


class FinishedInventorySerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    recipe_name = serializers.CharField(source="recipe.name", read_only=True)
    recipe_option_name = serializers.CharField(source="recipe_option.name", read_only=True)
    material_inventory_serial = serializers.CharField(source="material_inventory.serial_number", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    location_full_path = serializers.ReadOnlyField(source="location.full_path")

    class Meta:
        model = FinishedInventory
        fields = "__all__"
