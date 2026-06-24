from django.contrib import admin

from .models import BoxInventory, BoxSpec, CoreInventory, CoreSpec, Customer, CustomerOrder, CustomerOrderEvent, FinishedInventory, JobTicket, JobTicketEvent, JobTicketUsage, ProductionSchedule, QuoteRecord


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("name", "customer_code", "contact_name", "city", "state", "phone", "email", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name", "customer_code", "contact_name", "phone", "email", "address_line_1", "city", "state", "postal_code", "notes")


@admin.register(BoxSpec)
class BoxSpecAdmin(admin.ModelAdmin):
    list_display = ("name", "item_number", "supplier", "width_inches", "length_inches", "height_inches", "is_active")
    list_filter = ("supplier", "is_active")
    search_fields = ("name", "item_number", "supplier", "notes")


@admin.register(BoxInventory)
class BoxInventoryAdmin(admin.ModelAdmin):
    list_display = ("box", "lot_number", "quantity", "status", "location", "received_date", "is_active")
    list_filter = ("status", "location", "received_date", "is_active")
    search_fields = ("box__name", "box__item_number", "box__supplier", "lot_number", "notes")
    autocomplete_fields = ("box", "location")


@admin.register(CoreSpec)
class CoreSpecAdmin(admin.ModelAdmin):
    list_display = ("name", "item_number", "supplier", "core_size_inches", "is_active")
    list_filter = ("supplier", "core_size_inches", "is_active")
    search_fields = ("name", "item_number", "supplier", "notes")


@admin.register(CoreInventory)
class CoreInventoryAdmin(admin.ModelAdmin):
    list_display = ("core", "lot_number", "quantity", "status", "location", "received_date", "is_active")
    list_filter = ("status", "location", "received_date", "is_active")
    search_fields = ("core__name", "core__item_number", "core__supplier", "lot_number", "notes")
    autocomplete_fields = ("core", "location")


@admin.register(JobTicket)
class JobTicketAdmin(admin.ModelAdmin):
    list_display = (
        "ticket_number",
        "customer",
        "job_name",
        "bagged",
        "material_master_type",
        "material_spec",
        "label_width_inches",
        "label_length_inches",
        "repeat_inches",
        "cutting_type",
        "recipe",
        "box",
        "core",
        "fanfold_gear",
        "finishing_type",
        "unit_type",
    )
    list_filter = ("finishing_type", "unit_type", "ribbon", "laminate", "bagged", "cutting_type", "material_master_type", "material_spec", "box", "core")
    search_fields = (
        "ticket_number",
        "customer__name",
        "customer__customer_code",
        "customer_name",
        "job_name",
        "product_code",
        "description",
        "material_spec__code",
        "material_spec__name",
        "material_spec__material_family",
        "material_master_type__code",
        "material_master_type__name",
        "box_item_number",
        "box__name",
        "box__item_number",
        "box__supplier",
        "core__name",
        "core__item_number",
        "core__supplier",
        "fanfold_gear",
        "job_notes",
        "finishing_notes",
    )
    autocomplete_fields = ("customer", "material_master_type", "material_spec", "recipe", "box", "core")


@admin.register(JobTicketEvent)
class JobTicketEventAdmin(admin.ModelAdmin):
    list_display = ("job_ticket", "event_type", "summary", "performed_by", "created_at")
    list_filter = ("event_type", "performed_by", "created_at")
    search_fields = ("summary", "performed_by", "job_ticket__ticket_number", "job_ticket__job_name", "job_ticket__product_code")
    autocomplete_fields = ("job_ticket",)
    readonly_fields = ("created_at",)


@admin.register(JobTicketUsage)
class JobTicketUsageAdmin(admin.ModelAdmin):
    list_display = ("job_ticket", "legacy_job_ticket_id", "used_at", "quantity", "source")
    list_filter = ("source", "used_at")
    search_fields = ("job_ticket__ticket_number", "job_ticket__job_name", "legacy_job_ticket_id", "notes")
    autocomplete_fields = ("job_ticket",)
    readonly_fields = ("created_at",)


@admin.register(ProductionSchedule)
class ProductionScheduleAdmin(admin.ModelAdmin):
    list_display = (
        "job_ticket",
        "customer",
        "customer_po",
        "status",
        "priority",
        "quantity_to_ship",
        "quantity_to_stock",
        "scheduled_date",
        "due_date",
        "material_inventory",
    )
    list_filter = ("status", "priority", "customer", "scheduled_date", "due_date")
    search_fields = (
        "job_ticket__ticket_number",
        "customer__name",
        "customer__customer_code",
        "job_ticket__customer_name",
        "job_ticket__job_name",
        "customer_po",
        "notes",
    )
    autocomplete_fields = ("job_ticket", "customer", "material_inventory")
    date_hierarchy = "scheduled_date"


@admin.register(CustomerOrder)
class CustomerOrderAdmin(admin.ModelAdmin):
    list_display = (
        "customer_name",
        "job_ticket",
        "customer_po",
        "quantity_to_ship",
        "quantity_to_stock",
        "order_date",
        "scheduled_date",
        "due_date",
        "priority",
        "status",
    )
    list_filter = ("status", "priority", "customer", "order_date", "scheduled_date", "due_date")
    search_fields = (
        "customer_name",
        "customer__name",
        "customer_po",
        "job_name",
        "product_code",
        "job_ticket__ticket_number",
        "operator_note",
    )
    autocomplete_fields = ("schedule_entry", "job_ticket", "customer")
    readonly_fields = ("updated_at",)
    date_hierarchy = "order_date"


@admin.register(CustomerOrderEvent)
class CustomerOrderEventAdmin(admin.ModelAdmin):
    list_display = ("order", "event_type", "summary", "performed_by", "created_at")
    list_filter = ("event_type", "performed_by", "created_at")
    search_fields = ("summary", "performed_by", "order__customer_name", "order__job_name", "order__job_ticket__ticket_number")
    autocomplete_fields = ("order",)
    readonly_fields = ("created_at",)


@admin.register(QuoteRecord)
class QuoteRecordAdmin(admin.ModelAdmin):
    list_display = ("quote_number", "customer_name", "prepared_by_name", "approval_status", "workflow_status", "last_edited_by_name", "processed_by_name", "quote_company", "created_at")
    list_filter = ("approval_status", "workflow_status", "quote_company", "prepared_by_role", "created_at")
    search_fields = ("quote_number", "customer_name", "job_name", "product_code", "prepared_by_name", "approval_by_name", "processed_by_name", "last_edited_by_name", "material_name", "notes")
    readonly_fields = ("created_at", "updated_at")
    date_hierarchy = "created_at"


@admin.register(FinishedInventory)
class FinishedInventoryAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "sku",
        "job_ticket",
        "material_width_inches",
        "material_length_feet",
        "face_type",
        "liner_type",
        "quantity",
        "unit",
        "status",
        "operator",
        "suboperator",
        "run_date",
    )
    list_filter = ("status", "unit", "face_type", "liner_type", "run_date")
    search_fields = (
        "name",
        "sku",
        "liner_serial_number",
        "face_serial_number",
        "operator",
        "suboperator",
        "notes",
    )
    autocomplete_fields = ("job_ticket", "material_inventory", "recipe", "recipe_option", "location")
    date_hierarchy = "run_date"
