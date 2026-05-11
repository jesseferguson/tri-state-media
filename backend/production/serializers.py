from rest_framework import serializers

from .models import BoxInventory, BoxSpec, Customer, CustomerOrder, CustomerOrderEvent, FinishedInventory, JobTicket, ProductionSchedule


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = "__all__"


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
    recipe_name = serializers.CharField(source="recipe.name", read_only=True)
    box_name = serializers.CharField(source="box.name", read_only=True)
    box_item_number = serializers.CharField(source="box.item_number", read_only=True)
    box_supplier = serializers.CharField(source="box.supplier", read_only=True)
    material_spec_name = serializers.SerializerMethodField()
    material_spec_code = serializers.SerializerMethodField()
    material_spec_family = serializers.SerializerMethodField()
    material_spec_gsm = serializers.SerializerMethodField()
    material_spec_liner_pounds = serializers.SerializerMethodField()

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

    class Meta:
        model = JobTicket
        fields = "__all__"


class ProductionScheduleSerializer(serializers.ModelSerializer):
    job_ticket_number = serializers.CharField(source="job_ticket.ticket_number", read_only=True)
    job_name = serializers.CharField(source="job_ticket.job_name", read_only=True)
    customer_name = serializers.SerializerMethodField()
    job_material_spec_name = serializers.SerializerMethodField()
    job_material_spec_code = serializers.SerializerMethodField()
    recipe_name = serializers.CharField(source="job_ticket.recipe.name", read_only=True)
    box_name = serializers.CharField(source="job_ticket.box.name", read_only=True)
    box_item_number = serializers.CharField(source="job_ticket.box.item_number", read_only=True)
    material_inventory_name = serializers.CharField(source="material_inventory.name", read_only=True)
    material_inventory_serial = serializers.CharField(source="material_inventory.serial_number", read_only=True)

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
