from django.db import models
from django.contrib.auth.hashers import check_password, make_password
from django.utils import timezone

from materials.models import MaterialSpec, MaterialUsage, RawMaterialInventory
from tooling.models import Press, ToolingLocation, ToolingRecipe, ToolingRecipeOption


class Customer(models.Model):
    name = models.CharField(max_length=150, unique=True)
    customer_code = models.CharField(max_length=80, blank=True)
    contact_name = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class CompanyRole(models.Model):
    name = models.CharField(max_length=80, unique=True)
    description = models.CharField(max_length=255, blank=True)
    allowed_resource_keys = models.JSONField(default=list, blank=True)
    locked = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class CompanyUser(models.Model):
    username = models.CharField(max_length=80, unique=True)
    name = models.CharField(max_length=150)
    password_hash = models.CharField(max_length=255)
    role = models.ForeignKey(CompanyRole, on_delete=models.PROTECT, related_name="users")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "username"]

    def __str__(self):
        return f"{self.name} / {self.username}"

    def set_password(self, raw_password):
        self.password_hash = make_password(raw_password)

    def check_password(self, raw_password):
        return check_password(raw_password, self.password_hash)


class QuoteRawMaterial(models.Model):
    external_id = models.CharField(max_length=120, unique=True)
    name = models.CharField(max_length=180)
    component_type = models.CharField(max_length=40, default="face")
    msi_cost = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    inventory_msi = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["component_type", "name"]

    def __str__(self):
        return self.name


class QuoteFinishedMaterial(models.Model):
    external_id = models.CharField(max_length=120, unique=True)
    name = models.CharField(max_length=180)
    source_type = models.CharField(max_length=40, default="made")
    purchased_msi_cost = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    face_raw_id = models.CharField(max_length=120, blank=True)
    liner_raw_id = models.CharField(max_length=120, blank=True)
    adhesive_raw_id = models.CharField(max_length=120, blank=True)
    silicone_raw_id = models.CharField(max_length=120, blank=True)
    ink_raw_id = models.CharField(max_length=120, blank=True)
    labor_msi_cost = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    coating_msi_cost = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    complexity_msi_cost = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    other_msi_cost = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class QuoteRecord(models.Model):
    external_id = models.CharField(max_length=120, unique=True)
    quote_number = models.CharField(max_length=80, unique=True)
    created_at = models.DateTimeField(default=timezone.now)
    prepared_by_user_id = models.CharField(max_length=120, blank=True)
    prepared_by_username = models.CharField(max_length=80, blank=True)
    prepared_by_name = models.CharField(max_length=150, blank=True)
    prepared_by_role = models.CharField(max_length=80, blank=True)
    job_ticket = models.ForeignKey("JobTicket", on_delete=models.SET_NULL, null=True, blank=True, related_name="quote_records")
    job_ticket_number = models.CharField(max_length=80, blank=True)
    customer_name = models.CharField(max_length=180, blank=True)
    job_name = models.CharField(max_length=180, blank=True)
    product_code = models.CharField(max_length=80, blank=True)
    contact_name = models.CharField(max_length=120, blank=True)
    contact_email = models.EmailField(blank=True)
    prepared_by = models.CharField(max_length=150, blank=True)
    notes = models.TextField(blank=True)
    material_name = models.CharField(max_length=180, blank=True)
    material_source = models.CharField(max_length=40, blank=True)
    material_components = models.TextField(blank=True)
    form = models.JSONField(default=dict, blank=True)
    pricing = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return self.quote_number


class BoxSpec(models.Model):
    name = models.CharField(max_length=150)
    item_number = models.CharField(max_length=80, blank=True)
    supplier = models.CharField(max_length=150, blank=True)
    width_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    length_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    height_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["supplier", "name", "item_number"]

    def __str__(self):
        parts = [self.item_number, self.name, self.supplier]
        return " / ".join([part for part in parts if part])


class BoxInventory(models.Model):
    STATUS_CHOICES = [
        ("available", "Available"),
        ("scheduled", "Scheduled"),
        ("allocated", "Allocated"),
        ("on_hold", "On Hold"),
        ("depleted", "Depleted"),
        ("scrapped", "Scrapped"),
    ]

    box = models.ForeignKey(
        BoxSpec,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inventory",
    )
    lot_number = models.CharField(max_length=80, blank=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="available")
    received_date = models.DateField(null=True, blank=True)
    location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="box_inventory",
    )
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["box__name", "lot_number"]

    def __str__(self):
        return f"{self.box or 'Box'} / {self.lot_number or self.pk}"


class JobTicket(models.Model):
    CUTTING_TYPE_CHOICES = [
        ("to_liner", "To Liner"),
        ("metal_to_metal", "Metal to Metal"),
        ("score", "Score"),
        ("special", "Special"),
    ]

    FINISHING_TYPE_CHOICES = [
        ("rolls", "Rolls"),
        ("fanfold", "Fanfold"),
        ("sheeted", "Sheeted"),
    ]

    WIND_DIRECTION_CHOICES = [
        ("", "Not Set"),
        ("1", "Wind 1"),
        ("2", "Wind 2"),
        ("3", "Wind 3"),
        ("4", "Wind 4"),
        ("5", "Wind 5"),
        ("6", "Wind 6"),
        ("7", "Wind 7"),
        ("8", "Wind 8"),
    ]

    ticket_number = models.CharField(max_length=80, unique=True)
    customer = models.ForeignKey(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="job_tickets",
    )
    customer_name = models.CharField(max_length=150, blank=True)
    job_name = models.CharField(max_length=150)
    product_code = models.CharField(max_length=80, blank=True)

    label_width_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    label_length_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    repeat_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    cutting_type = models.CharField(max_length=30, choices=CUTTING_TYPE_CHOICES, default="to_liner")
    face_type = models.CharField(max_length=100, blank=True)
    liner_type = models.CharField(max_length=100, blank=True)

    material_spec = models.ForeignKey(
        MaterialSpec,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="job_tickets",
        limit_choices_to={"material_type": "coated_stock"},
        help_text="The finished raw material family/spec this job should run on. Specific inventory rolls are assigned on the production schedule.",
    )

    recipe = models.ForeignKey(
        ToolingRecipe,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="production_job_tickets",
    )

    requested_quantity = models.DecimalField(max_digits=12, decimal_places=3, default=0)

    finishing_type = models.CharField(max_length=30, choices=FINISHING_TYPE_CHOICES, default="rolls")
    labels_per_unit = models.PositiveIntegerField(null=True, blank=True)
    units_per_carton = models.PositiveIntegerField(null=True, blank=True)
    box = models.ForeignKey(
        BoxSpec,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="job_tickets",
    )
    core_size_inches = models.DecimalField(max_digits=6, decimal_places=3, null=True, blank=True)
    wind_direction = models.CharField(max_length=5, choices=WIND_DIRECTION_CHOICES, blank=True)
    finishing_notes = models.TextField(blank=True)

    job_notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["ticket_number"]

    def __str__(self):
        return f"{self.ticket_number} / {self.job_name}"


class ProductionSchedule(models.Model):
    STATUS_CHOICES = [
        ("unscheduled", "Unscheduled"),
        ("scheduled", "Scheduled"),
        ("ready", "Ready"),
        ("running", "Running"),
        ("complete", "Complete"),
        ("on_hold", "On Hold"),
        ("cancelled", "Cancelled"),
    ]

    PRIORITY_CHOICES = [
        ("normal", "Normal"),
        ("rush", "Rush"),
        ("hot", "Hot"),
    ]

    job_ticket = models.ForeignKey(
        JobTicket,
        on_delete=models.CASCADE,
        related_name="schedule_entries",
    )

    customer = models.ForeignKey(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="schedule_entries",
    )

    customer_po = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="unscheduled")
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="normal")
    scheduled_by = models.CharField(max_length=120, blank=True)
    last_updated_by = models.CharField(max_length=120, blank=True)

    quantity_to_ship = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    quantity_to_stock = models.DecimalField(max_digits=12, decimal_places=3, default=0)

    order_date = models.DateField(default=timezone.localdate)
    scheduled_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)

    material_inventory = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="production_schedule",
        help_text="The coated stock or roll selected for this scheduled run.",
    )

    material_width_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    press = models.ForeignKey(
        Press,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="production_schedule",
    )
    press_sequence = models.PositiveIntegerField(null=True, blank=True)
    operator = models.CharField(max_length=100, blank=True)
    actual_footage = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    footage_report = models.TextField(blank=True)
    notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scheduled_date", "priority", "job_ticket__ticket_number"]

    def __str__(self):
        return f"{self.job_ticket.ticket_number} / {self.get_status_display()}"

    def save(self, *args, **kwargs):
        is_create = self.pk is None
        super().save(*args, **kwargs)
        CustomerOrder.objects.sync_from_schedule(self, created=is_create)

    def delete(self, *args, **kwargs):
        orders = list(self.customer_orders.all())
        for order in orders:
            order.schedule_entry = None
            order.status = "schedule_removed"
            order.save(update_fields=["schedule_entry", "status", "updated_at"])
            CustomerOrderEvent.objects.create(
                order=order,
                event_type="schedule_removed",
                summary="Schedule entry was removed; customer order record retained.",
            )
        return super().delete(*args, **kwargs)


class CustomerOrderManager(models.Manager):
    def sync_from_schedule(self, schedule, created=False):
        customer = schedule.customer or schedule.job_ticket.customer
        order, order_created = self.get_or_create(
            schedule_entry=schedule,
            defaults={
                "job_ticket": schedule.job_ticket,
                "customer": customer,
                "customer_name": customer.name if customer else schedule.job_ticket.customer_name,
                "customer_po": schedule.customer_po,
                "job_name": schedule.job_ticket.job_name,
                "product_code": schedule.job_ticket.product_code,
                "quantity_to_ship": schedule.quantity_to_ship,
                "quantity_to_stock": schedule.quantity_to_stock,
                "order_date": schedule.order_date,
                "scheduled_date": schedule.scheduled_date,
                "due_date": schedule.due_date,
                "priority": schedule.priority,
                "status": schedule.status,
                "scheduled_by": schedule.scheduled_by,
                "last_updated_by": schedule.last_updated_by,
                "press_name": schedule.press.name if schedule.press else "",
                "press_sequence": schedule.press_sequence,
                "operator": schedule.operator,
                "actual_footage": schedule.actual_footage,
                "footage_report": schedule.footage_report,
                "operator_note": schedule.notes,
            },
        )

        if not order_created:
            order.job_ticket = schedule.job_ticket
            order.customer = customer
            order.customer_name = customer.name if customer else schedule.job_ticket.customer_name
            order.customer_po = schedule.customer_po
            order.job_name = schedule.job_ticket.job_name
            order.product_code = schedule.job_ticket.product_code
            order.quantity_to_ship = schedule.quantity_to_ship
            order.quantity_to_stock = schedule.quantity_to_stock
            order.order_date = schedule.order_date
            order.scheduled_date = schedule.scheduled_date
            order.due_date = schedule.due_date
            order.priority = schedule.priority
            order.status = schedule.status
            order.scheduled_by = schedule.scheduled_by
            order.last_updated_by = schedule.last_updated_by
            order.press_name = schedule.press.name if schedule.press else ""
            order.press_sequence = schedule.press_sequence
            order.operator = schedule.operator
            order.actual_footage = schedule.actual_footage
            order.footage_report = schedule.footage_report
            order.operator_note = schedule.notes
            order.save()

        actor = schedule.last_updated_by or schedule.scheduled_by or "system"
        press_label = f" / Press: {schedule.press.name}" if schedule.press else ""
        operator_label = f" / Operator: {schedule.operator}" if schedule.operator else ""
        CustomerOrderEvent.objects.create(
            order=order,
            event_type="scheduled" if created or order_created else "schedule_updated",
            summary=(
                f"Job scheduled with status {schedule.get_status_display()}{press_label}{operator_label}."
                if created or order_created
                else f"Schedule updated to {schedule.get_status_display()}{press_label}{operator_label}."
            ),
            performed_by=actor,
        )
        return order


class CustomerOrder(models.Model):
    STATUS_CHOICES = [
        ("unscheduled", "Unscheduled"),
        ("scheduled", "Scheduled"),
        ("ready", "Ready"),
        ("running", "Running"),
        ("complete", "Complete"),
        ("on_hold", "On Hold"),
        ("cancelled", "Cancelled"),
        ("schedule_removed", "Schedule Removed"),
    ]

    objects = CustomerOrderManager()

    schedule_entry = models.ForeignKey(
        ProductionSchedule,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_orders",
    )
    job_ticket = models.ForeignKey(
        JobTicket,
        on_delete=models.PROTECT,
        related_name="customer_orders",
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="orders",
    )
    customer_name = models.CharField(max_length=150, blank=True)
    customer_po = models.CharField(max_length=100, blank=True)
    job_name = models.CharField(max_length=150, blank=True)
    product_code = models.CharField(max_length=80, blank=True)
    quantity_to_ship = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    quantity_to_stock = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    order_date = models.DateField(default=timezone.localdate)
    scheduled_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    priority = models.CharField(max_length=20, choices=ProductionSchedule.PRIORITY_CHOICES, default="normal")
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="scheduled")
    scheduled_by = models.CharField(max_length=120, blank=True)
    last_updated_by = models.CharField(max_length=120, blank=True)
    press_name = models.CharField(max_length=150, blank=True)
    press_sequence = models.PositiveIntegerField(null=True, blank=True)
    operator = models.CharField(max_length=100, blank=True)
    actual_footage = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    footage_report = models.TextField(blank=True)
    operator_note = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-order_date", "-scheduled_date", "customer_name", "job_name"]

    def __str__(self):
        return f"{self.customer_name or self.customer or 'Customer'} / {self.job_name}"


class CustomerOrderEvent(models.Model):
    order = models.ForeignKey(
        CustomerOrder,
        on_delete=models.CASCADE,
        related_name="events",
    )
    event_type = models.CharField(max_length=50)
    summary = models.CharField(max_length=255)
    performed_by = models.CharField(max_length=120, default="system")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.order_id} / {self.event_type}"


class FinishedInventory(models.Model):
    STATUS_CHOICES = [
        ("available", "Available"),
        ("allocated", "Allocated"),
        ("shipped", "Shipped"),
        ("on_hold", "On Hold"),
        ("scrapped", "Scrapped"),
    ]

    UNIT_CHOICES = [
        ("roll", "Roll"),
        ("carton", "Carton"),
        ("case", "Case"),
        ("label", "Label"),
        ("sheet", "Sheet"),
        ("each", "Each"),
    ]

    name = models.CharField(max_length=150)
    sku = models.CharField(max_length=80, blank=True)

    job_ticket = models.ForeignKey(
        JobTicket,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finished_inventory",
    )

    material_inventory = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finished_inventory",
    )

    recipe = models.ForeignKey(
        ToolingRecipe,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="production_finished_inventory",
    )

    recipe_option = models.ForeignKey(
        ToolingRecipeOption,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="production_finished_inventory",
    )

    location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="production_finished_inventory",
    )

    material_width_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    material_length_feet = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    face_type = models.CharField(max_length=100, blank=True)
    liner_type = models.CharField(max_length=100, blank=True)
    liner_serial_number = models.CharField(max_length=80, blank=True)
    face_serial_number = models.CharField(max_length=80, blank=True)

    quantity = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    unit = models.CharField(max_length=20, choices=UNIT_CHOICES, default="roll")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="available")

    operator = models.CharField(max_length=100, blank=True)
    suboperator = models.CharField(max_length=100, blank=True)
    run_date = models.DateField(null=True, blank=True)

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-run_date", "name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.material_inventory_id or not self.material_length_feet:
            return

        usage = MaterialUsage.objects.filter(finished_inventory=self).first()
        if not usage:
            usage = MaterialUsage(finished_inventory=self)

        usage.inventory = self.material_inventory
        usage.material = self.material_inventory.material
        usage.usage_type = "finished"
        usage.quantity = self.material_length_feet
        usage.unit = "lf"
        usage.used_date = self.run_date or timezone.localdate()
        usage.used_by = self.operator
        usage.reference = self.sku or self.name
        usage.notes = f"Consumed for finished inventory {self.name}"
        usage.save()
