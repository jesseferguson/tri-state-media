from django.db import models
from django.contrib.auth.hashers import check_password, make_password
from django.core.validators import RegexValidator
from django.utils import timezone
from datetime import time
from decimal import Decimal
from uuid import uuid4

from materials.models import MaterialMasterType, MaterialSpec, MaterialUsage, RawMaterialInventory
from tooling.models import Press, ToolingLocation, ToolingRecipe, ToolingRecipeOption


QUOTE_COMPANY_CHOICES = [
    ("tri_state_media", "Tri-State Media"),
    ("barcode_labels", "Barcode Labels"),
]

QUOTE_APPROVAL_STATUS_CHOICES = [
    ("pending", "Pending Approval"),
    ("approved", "Approved"),
    ("rejected", "Rejected"),
]

QUOTE_WORKFLOW_STATUS_CHOICES = [
    ("active", "Active"),
    ("processed", "Processed"),
]


def job_ticket_image_upload_path(instance, filename):
    safe_ticket = str(instance.ticket_number or instance.pk or "job-ticket").replace("/", "-").replace("\\", "-")
    return f"production/job-tickets/{safe_ticket}/{uuid4().hex}-{filename}"


class Customer(models.Model):
    name = models.CharField(max_length=150, unique=True)
    customer_code = models.CharField(max_length=80, blank=True)
    contact_name = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    address_line_1 = models.CharField(max_length=180, blank=True)
    address_line_2 = models.CharField(max_length=180, blank=True)
    address_line_3 = models.CharField(max_length=180, blank=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=80, blank=True)
    postal_code = models.CharField(max_length=30, blank=True)
    country = models.CharField(max_length=80, blank=True)
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
    quote_company = models.CharField(max_length=40, choices=QUOTE_COMPANY_CHOICES, default="tri_state_media")
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


class MessageThread(models.Model):
    title = models.CharField(max_length=180)
    participant_user_ids = models.JSONField(default=list, blank=True)
    participant_names = models.JSONField(default=list, blank=True)
    context_type = models.CharField(max_length=60, blank=True)
    context_id = models.CharField(max_length=120, blank=True)
    context_label = models.CharField(max_length=220, blank=True)
    created_by_user_id = models.CharField(max_length=120, blank=True)
    created_by_name = models.CharField(max_length=150, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self):
        return self.title


class Message(models.Model):
    thread = models.ForeignKey(MessageThread, on_delete=models.CASCADE, related_name="messages")
    sender_user_id = models.CharField(max_length=120, blank=True)
    sender_name = models.CharField(max_length=150, blank=True)
    body = models.TextField()
    read_by_user_ids = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.thread_id} / {self.sender_name or 'Message'}"


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


class QuoteCostRate(models.Model):
    key = models.CharField(max_length=60, unique=True)
    label = models.CharField(max_length=120)
    msi_cost = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    notes = models.TextField(blank=True)
    locked = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["label"]

    def __str__(self):
        return self.label


class QuoteFinishedMaterial(models.Model):
    external_id = models.CharField(max_length=120, unique=True)
    name = models.CharField(max_length=180)
    unit_type = models.CharField(max_length=20, choices=[("label", "Label"), ("tag", "Tag")], default="label")
    material_master_type = models.ForeignKey(
        MaterialMasterType,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="quote_finished_materials",
        help_text="Central material type this quote material prices, such as PM or PET.",
    )
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
    base_markup_percent = models.DecimalField(max_digits=7, decimal_places=3, default=0)
    target_markup_percent = models.DecimalField(max_digits=7, decimal_places=3, default=0)
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
    quote_company = models.CharField(max_length=40, choices=QUOTE_COMPANY_CHOICES, default="tri_state_media")
    customer = models.ForeignKey(Customer, on_delete=models.SET_NULL, null=True, blank=True, related_name="quote_records")
    job_ticket = models.ForeignKey("JobTicket", on_delete=models.SET_NULL, null=True, blank=True, related_name="quote_records")
    job_ticket_number = models.CharField(max_length=80, blank=True)
    customer_name = models.CharField(max_length=180, blank=True)
    job_name = models.CharField(max_length=180, blank=True)
    product_code = models.CharField(max_length=80, blank=True)
    contact_name = models.CharField(max_length=120, blank=True)
    contact_email = models.EmailField(blank=True)
    prepared_by = models.CharField(max_length=150, blank=True)
    approval_status = models.CharField(max_length=20, choices=QUOTE_APPROVAL_STATUS_CHOICES, default="pending", db_index=True)
    approval_at = models.DateTimeField(null=True, blank=True)
    approval_by_user_id = models.CharField(max_length=120, blank=True)
    approval_by_name = models.CharField(max_length=150, blank=True)
    approval_by_role = models.CharField(max_length=80, blank=True)
    approval_note = models.TextField(blank=True)
    workflow_status = models.CharField(max_length=20, choices=QUOTE_WORKFLOW_STATUS_CHOICES, default="active", db_index=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    processed_by_user_id = models.CharField(max_length=120, blank=True)
    processed_by_name = models.CharField(max_length=150, blank=True)
    processed_by_role = models.CharField(max_length=80, blank=True)
    last_edited_at = models.DateTimeField(null=True, blank=True)
    last_edited_by_user_id = models.CharField(max_length=120, blank=True)
    last_edited_by_name = models.CharField(max_length=150, blank=True)
    last_edited_by_role = models.CharField(max_length=80, blank=True)
    edit_count = models.PositiveIntegerField(default=0)
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
    external_id = models.CharField(max_length=120, blank=True, db_index=True)
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


class CoreSpec(models.Model):
    external_id = models.CharField(max_length=120, blank=True, db_index=True)
    name = models.CharField(max_length=150)
    item_number = models.CharField(max_length=80, blank=True)
    supplier = models.CharField(max_length=150, blank=True)
    core_size_inches = models.DecimalField(max_digits=6, decimal_places=3, null=True, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["supplier", "core_size_inches", "name", "item_number"]

    def __str__(self):
        parts = [self.item_number, self.name, f'{self.core_size_inches}"' if self.core_size_inches else "", self.supplier]
        return " / ".join([part for part in parts if part])


class CoreInventory(models.Model):
    STATUS_CHOICES = BoxInventory.STATUS_CHOICES

    core = models.ForeignKey(
        CoreSpec,
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
        related_name="core_inventory",
    )
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["core__core_size_inches", "core__name", "lot_number"]

    def __str__(self):
        return f"{self.core or 'Core'} / {self.lot_number or self.pk}"


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

    UNIT_TYPE_CHOICES = [
        ("label", "Label"),
        ("tag", "Tag"),
    ]

    RIBBON_CHOICES = [
        ("no_ribbon", "No Ribbon"),
        ("ribbon", "Ribbon"),
    ]

    LAMINATE_CHOICES = [
        ("no_laminate", "No Laminate"),
        ("laminate", "Laminate"),
    ]

    BAGGED_CHOICES = [
        ("not_bagged", "Not Bagged"),
        ("bagged", "Bagged"),
    ]

    CARTON_LABEL_FORMAT_CHOICES = [
        ("standard", "Standard Carton"),
        ("dow_carton", "DOW Carton"),
        ("dow_closure", "DOW Closure"),
        ("customer_label", "Customer Label"),
        ("bcl", "BCL"),
        ("abe", "ABE"),
        ("clopay", "Clopay"),
        ("variable_barcode", "Variable Barcode"),
        ("camslide", "Camslide"),
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
    legacy_row_id = models.CharField(max_length=120, blank=True, db_index=True)
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
    description = models.TextField(blank=True)
    box_item_number = models.CharField(max_length=80, blank=True)

    general_image = models.ImageField(upload_to=job_ticket_image_upload_path, blank=True, null=True)
    general_image_name = models.CharField(max_length=180, blank=True)
    general_image_description = models.TextField(blank=True)
    external_image_url = models.URLField(max_length=1000, blank=True)
    external_image_source = models.CharField(max_length=80, blank=True)
    spec_image = models.ImageField(upload_to=job_ticket_image_upload_path, blank=True, null=True)
    spec_image_name = models.CharField(max_length=180, blank=True)
    spec_image_description = models.TextField(blank=True)
    finishing_image = models.ImageField(upload_to=job_ticket_image_upload_path, blank=True, null=True)
    finishing_image_name = models.CharField(max_length=180, blank=True)
    finishing_image_description = models.TextField(blank=True)

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
    material_master_type = models.ForeignKey(
        MaterialMasterType,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="job_tickets",
        help_text="Central material type used to connect this job to quoting and matching inventory.",
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
    unit_type = models.CharField(max_length=20, choices=UNIT_TYPE_CHOICES, default="label")
    labels_per_unit = models.PositiveIntegerField(null=True, blank=True)
    units_per_carton = models.PositiveIntegerField(null=True, blank=True)
    labels_per_carton = models.PositiveIntegerField(null=True, blank=True)
    box = models.ForeignKey(
        BoxSpec,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="job_tickets",
    )
    core = models.ForeignKey(
        CoreSpec,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="job_tickets",
    )
    core_size_inches = models.DecimalField(max_digits=6, decimal_places=3, null=True, blank=True)
    wind_direction = models.CharField(max_length=5, choices=WIND_DIRECTION_CHOICES, blank=True)
    fanfold_gear = models.PositiveIntegerField(null=True, blank=True)
    labels_per_fold = models.PositiveIntegerField(null=True, blank=True)
    ribbon = models.CharField(max_length=40, choices=RIBBON_CHOICES, default="no_ribbon")
    laminate = models.CharField(max_length=40, choices=LAMINATE_CHOICES, default="no_laminate")
    bagged = models.CharField(max_length=30, choices=BAGGED_CHOICES, default="not_bagged")
    finishing_notes = models.TextField(blank=True)

    carton_label_part_number = models.CharField(max_length=120, blank=True)
    carton_label_description_a = models.CharField(max_length=255, blank=True)
    carton_label_description_b = models.CharField(max_length=255, blank=True)
    carton_label_description_c = models.CharField(max_length=255, blank=True)
    carton_label_finishing_1 = models.CharField(max_length=150, blank=True)
    carton_label_finishing_2 = models.CharField(max_length=150, blank=True)
    carton_label_is_unique = models.BooleanField(default=False)
    carton_label_format = models.CharField(
        max_length=30,
        choices=CARTON_LABEL_FORMAT_CHOICES,
        default="standard",
    )

    job_notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["ticket_number"]

    def __str__(self):
        return f"{self.ticket_number} / {self.job_name}"

    def save(self, *args, **kwargs):
        if self.material_spec_id and not self.material_master_type_id:
            self.material_master_type = self.material_spec.master_type
        if self.box_id and not self.box_item_number:
            self.box_item_number = self.box.item_number
        if self.core_id and not self.core_size_inches:
            self.core_size_inches = self.core.core_size_inches
        self.labels_per_carton = self.units_per_carton
        super().save(*args, **kwargs)


class JobTicketEvent(models.Model):
    job_ticket = models.ForeignKey(
        JobTicket,
        on_delete=models.CASCADE,
        related_name="events",
    )
    event_type = models.CharField(max_length=50)
    summary = models.CharField(max_length=255)
    performed_by = models.CharField(max_length=120, default="system", blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.job_ticket_id} / {self.event_type}"


class JobTicketUsage(models.Model):
    job_ticket = models.ForeignKey(
        JobTicket,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="usage_records",
    )
    legacy_job_ticket_id = models.CharField(max_length=120, blank=True, db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    source = models.CharField(max_length=80, blank=True, default="Glide")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-used_at", "-id"]

    def __str__(self):
        return f"{self.job_ticket or self.legacy_job_ticket_id or 'Usage'} / {self.quantity}"


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
    target_footage = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Planned linear footage for operator progress and shift handoff.",
    )
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
        previous = None
        if not is_create:
            previous = ProductionSchedule.objects.select_related("press").filter(pk=self.pk).first()
        super().save(*args, **kwargs)
        CustomerOrder.objects.sync_from_schedule(self, created=is_create)
        self._log_job_ticket_event(previous=previous, created=is_create)

    def _log_job_ticket_event(self, previous=None, created=False):
        actor = self.last_updated_by or self.scheduled_by or "system"
        if created:
            JobTicketEvent.objects.create(
                job_ticket=self.job_ticket,
                event_type="scheduled",
                summary=(
                    f"{actor} scheduled {self.quantity_to_ship} ship / {self.quantity_to_stock} stock"
                    f"{f' for {self.due_date}' if self.due_date else ''}."
                ),
                performed_by=actor,
                details={
                    "schedule_id": self.id,
                    "status": self.status,
                    "press": self.press.name if self.press else "",
                    "quantity_to_ship": str(self.quantity_to_ship),
                    "quantity_to_stock": str(self.quantity_to_stock),
                    "due_date": str(self.due_date or ""),
                },
            )
            return

        if not previous:
            return

        changes = []
        if previous.status != self.status:
            changes.append(f"status {previous.get_status_display()} to {self.get_status_display()}")
        if previous.press_id != self.press_id:
            changes.append(f"press {previous.press.name if previous.press else 'Unassigned'} to {self.press.name if self.press else 'Unassigned'}")
        if previous.press_sequence != self.press_sequence:
            changes.append(f"press order {previous.press_sequence or '--'} to {self.press_sequence or '--'}")
        if previous.quantity_to_ship != self.quantity_to_ship:
            changes.append(f"ship qty {previous.quantity_to_ship} to {self.quantity_to_ship}")
        if previous.quantity_to_stock != self.quantity_to_stock:
            changes.append(f"stock qty {previous.quantity_to_stock} to {self.quantity_to_stock}")
        if previous.due_date != self.due_date:
            changes.append(f"ship date {previous.due_date or '--'} to {self.due_date or '--'}")
        if previous.operator != self.operator:
            changes.append(f"operator {previous.operator or '--'} to {self.operator or '--'}")
        if previous.actual_footage != self.actual_footage:
            changes.append(f"footage {previous.actual_footage or '--'} to {self.actual_footage or '--'}")

        if not changes:
            return

        JobTicketEvent.objects.create(
            job_ticket=self.job_ticket,
            event_type="schedule_updated",
            summary=f"{actor} updated schedule: {', '.join(changes[:4])}{'...' if len(changes) > 4 else ''}.",
            performed_by=actor,
            details={
                "schedule_id": self.id,
                "changes": changes,
                "status": self.status,
                "press": self.press.name if self.press else "",
            },
        )

    def delete(self, *args, **kwargs):
        reason = getattr(self, "_delete_reason", "")
        actor = getattr(self, "_delete_actor", "") or self.last_updated_by or self.scheduled_by or "system"
        def short_summary(value):
            text = str(value)
            return text if len(text) <= 255 else f"{text[:252]}..."

        if self.job_ticket_id:
            summary = f"{actor} removed this job from the schedule"
            if reason:
                summary = f"{summary}: {reason}"
            JobTicketEvent.objects.create(
                job_ticket=self.job_ticket,
                event_type="schedule_removed",
                summary=short_summary(f"{summary}."),
                performed_by=actor,
                details={
                    "schedule_id": self.id,
                    "reason": reason,
                    "status": self.status,
                    "press": self.press.name if self.press else "",
                },
            )
        orders = list(self.customer_orders.all())
        for order in orders:
            order.schedule_entry = None
            order.status = "schedule_removed"
            order.save(update_fields=["schedule_entry", "status", "updated_at"])
            summary = "Schedule entry was removed; customer order record retained."
            if reason:
                summary = f"Schedule entry was removed: {reason}"
            CustomerOrderEvent.objects.create(
                order=order,
                event_type="schedule_removed",
                summary=short_summary(summary),
                performed_by=actor,
            )
        return super().delete(*args, **kwargs)


class ProductionMaterialAssignment(models.Model):
    SOURCE_CHOICES = [
        ("tsm", "Tri-State Media Roll"),
        ("outsourced", "Purchased Roll"),
    ]
    STATUS_CHOICES = [
        ("active", "Active"),
        ("complete", "Used"),
        ("rejected", "Quality Hold"),
        ("removed", "Removed"),
    ]

    production_schedule = models.ForeignKey(
        ProductionSchedule,
        on_delete=models.CASCADE,
        related_name="material_assignments",
    )
    inventory = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.PROTECT,
        related_name="production_assignments",
    )
    source_type = models.CharField(max_length=20, choices=SOURCE_CHOICES)
    carton_lot_code = models.CharField(
        max_length=5,
        blank=True,
        validators=[RegexValidator(r"^\d{5}$", "Enter the 5-digit lot number stamped on the cartons.")],
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    assigned_by = models.CharField(max_length=120, blank=True)
    quality_note = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-assigned_at", "-id"]

    def __str__(self):
        return f"{self.production_schedule} / {self.inventory.serial_number or self.inventory.lot_number}"


class ProductionShiftSetting(models.Model):
    name = models.CharField(max_length=80, unique=True, default="Plant Reporting Day")
    shift_start_time = models.TimeField(default=time(3, 0))
    shift_end_time = models.TimeField(default=time(3, 0))
    end_on_next_day = models.BooleanField(default=True)
    updated_by = models.CharField(max_length=120, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class ProductionShiftReport(models.Model):
    OUTCOME_CHOICES = [
        ("end_shift", "End of Shift"),
        ("job_complete", "Job Complete"),
    ]

    production_schedule = models.ForeignKey(
        ProductionSchedule,
        on_delete=models.CASCADE,
        related_name="shift_reports",
        null=True,
        blank=True,
    )
    coater_schedule = models.ForeignKey(
        "materials.CoaterRollTag",
        on_delete=models.CASCADE,
        related_name="footage_reports",
        null=True,
        blank=True,
    )
    job_ticket = models.ForeignKey(
        JobTicket,
        on_delete=models.PROTECT,
        related_name="shift_reports",
        null=True,
        blank=True,
    )
    press = models.ForeignKey(
        Press,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="shift_reports",
    )
    operator = models.CharField(max_length=120)
    suboperator = models.CharField(max_length=120, blank=True)
    report_date = models.DateField(default=timezone.localdate, db_index=True)
    shift_start = models.DateTimeField()
    shift_end = models.DateTimeField()
    total_footage = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    good_footage = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    material_footage = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    outcome = models.CharField(max_length=20, choices=OUTCOME_CHOICES, default="end_shift")
    notes = models.TextField(blank=True)
    created_by = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-report_date", "-shift_end", "-id"]

    def save(self, *args, **kwargs):
        if self.production_schedule_id:
            self.job_ticket = self.production_schedule.job_ticket
            if not self.press_id:
                self.press = self.production_schedule.press
        super().save(*args, **kwargs)

    @property
    def waste_footage(self):
        return max(Decimal("0"), Decimal(self.total_footage or 0) - Decimal(self.good_footage or 0))

    def __str__(self):
        return f"{self.report_date} / {self.operator} / {self.good_footage} ft"


class CustomerOrderManager(models.Manager):
    def next_order_number(self, for_date=None):
        order_date = for_date or timezone.localdate()
        prefix = f"ORD{order_date:%y%m%d}"
        existing = self.filter(order_number__startswith=f"{prefix}-").values_list("order_number", flat=True)
        used = set(existing)
        sequence = len(used) + 1
        while True:
            candidate = f"{prefix}-{sequence:04d}"
            if candidate not in used:
                return candidate
            sequence += 1

    def sync_from_schedule(self, schedule, created=False):
        customer = schedule.customer or schedule.job_ticket.customer
        order, order_created = self.get_or_create(
            schedule_entry=schedule,
            defaults={
                "order_number": self.next_order_number(schedule.order_date),
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
                "operator_note": schedule.job_ticket.job_notes,
            },
        )

        if not order_created:
            if not order.order_number:
                order.order_number = self.next_order_number(schedule.order_date)
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
            order.operator_note = schedule.job_ticket.job_notes
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
    order_number = models.CharField(max_length=20, unique=True, db_index=True, blank=True, null=True)
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
        return f"{self.order_number or 'Order'} / {self.customer_name or self.customer or 'Customer'} / {self.job_name}"


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


class LiveFootageArchive(models.Model):
    shift_date = models.DateField(unique=True, db_index=True)
    shift_start = models.DateTimeField()
    shift_end = models.DateTimeField()
    total_footage = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    goal_footage = models.DecimalField(max_digits=14, decimal_places=2, default=400000)
    press_totals = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True)
    saved_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-shift_date"]

    def __str__(self):
        return f"{self.shift_date} / {self.total_footage} ft"


class LocalLiveFootageReading(models.Model):
    KIND_CHOICES = [
        ("speed", "Speed"),
        ("footage", "Footage"),
    ]

    press_key = models.CharField(max_length=40, db_index=True)
    press_name = models.CharField(max_length=120, blank=True)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, db_index=True)
    speed_fpm = models.PositiveIntegerField(null=True, blank=True)
    footage = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    device_timestamp = models.PositiveIntegerField(null=True, blank=True)
    source_ip = models.GenericIPAddressField(null=True, blank=True)
    recorded_at = models.DateTimeField(default=timezone.now, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-recorded_at", "-id"]
        indexes = [
            models.Index(fields=["press_key", "kind", "-recorded_at"]),
            models.Index(fields=["kind", "recorded_at"]),
        ]

    def __str__(self):
        if self.kind == "speed":
            value = f"{self.speed_fpm or 0} FPM"
        else:
            value = f"{self.footage or 0} ft"
        return f"{self.press_name or self.press_key} / {self.kind} / {value}"


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
    customer_order = models.ForeignKey(
        CustomerOrder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finished_inventory",
    )
    order_number = models.CharField(max_length=20, blank=True, db_index=True)

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
        if self.customer_order_id and not self.order_number:
            self.order_number = self.customer_order.order_number
        if self.customer_order_id and not self.job_ticket_id:
            self.job_ticket = self.customer_order.job_ticket
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
