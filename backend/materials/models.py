from decimal import Decimal
from uuid import uuid4

from django.db import models, transaction
from django.utils import timezone

from tooling.models import Press, Supplier, ToolingLocation


MATERIAL_TYPE_PREFIXES = {
    "liner": "LIN",
    "face": "FAC",
    "adhesive": "ADH",
    "silicone": "SIL",
    "coating": "COA",
    "coated_stock": "CS",
}


class MaterialMasterType(models.Model):
    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code", "name"]

    def __str__(self):
        return f"{self.code} / {self.name}" if self.name and self.name != self.code else self.code


class MaterialSpec(models.Model):
    MATERIAL_TYPE_CHOICES = [
        ("liner", "Liner"),
        ("face", "Face"),
        ("adhesive", "Adhesive"),
        ("silicone", "Silicone"),
        ("coating", "Coating"),
        ("coated_stock", "Coated Stock"),
    ]

    material_type = models.CharField(max_length=30, choices=MATERIAL_TYPE_CHOICES)
    code = models.CharField(max_length=80, unique=True, blank=True)
    name = models.CharField(max_length=150)
    company = models.CharField(max_length=120, blank=True)

    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="material_specs",
    )

    liner_pounds = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    gsm = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    material_family = models.CharField(
        max_length=100,
        blank=True,
        help_text="User-defined family/type, such as SCK liner, PolyMatte face, removable adhesive, or easy-release silicone.",
    )
    master_type = models.ForeignKey(
        MaterialMasterType,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="material_specs",
        help_text="Central material type such as PM, PMDT, PET, LPO, or LV. Used to link tickets, inventory, and quoting.",
    )

    face_material = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finished_face_materials",
        limit_choices_to={"material_type": "face"},
    )
    liner_material = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finished_liner_materials",
        limit_choices_to={"material_type": "liner"},
    )
    adhesive_material = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finished_adhesive_materials",
        limit_choices_to={"material_type": "adhesive"},
    )
    silicone_material = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finished_silicone_materials",
        limit_choices_to={"material_type": "silicone"},
    )
    coating_material = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finished_coating_materials",
        limit_choices_to={"material_type": "coating"},
    )
    allowed_face_materials = models.ManyToManyField(
        "self",
        blank=True,
        symmetrical=False,
        related_name="compatible_face_finished_materials",
        limit_choices_to={"material_type": "face"},
        help_text="Face data types this finished raw material may be made with.",
    )
    allowed_liner_materials = models.ManyToManyField(
        "self",
        blank=True,
        symmetrical=False,
        related_name="compatible_liner_finished_materials",
        limit_choices_to={"material_type": "liner"},
        help_text="Liner data types this finished raw material may be made with.",
    )
    allowed_adhesive_materials = models.ManyToManyField(
        "self",
        blank=True,
        symmetrical=False,
        related_name="compatible_adhesive_finished_materials",
        limit_choices_to={"material_type": "adhesive"},
        help_text="Adhesive data types this finished raw material may be made with.",
    )
    allowed_silicone_materials = models.ManyToManyField(
        "self",
        blank=True,
        symmetrical=False,
        related_name="compatible_silicone_finished_materials",
        limit_choices_to={"material_type": "silicone"},
        help_text="Silicone data types this finished raw material may be made with.",
    )
    allowed_coating_materials = models.ManyToManyField(
        "self",
        blank=True,
        symmetrical=False,
        related_name="compatible_coating_finished_materials",
        limit_choices_to={"material_type": "coating"},
        help_text="Coating or varnish data types this finished raw material may be made with.",
    )

    scheduled_by = models.CharField(max_length=100, blank=True)
    coater_cut_plan = models.CharField(
        max_length=200,
        blank=True,
        help_text="Cut plan operators should run, such as 3 x 13 in or 2 x 6.5 in.",
    )
    target_run_length_feet = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    operator_notes = models.TextField(blank=True)

    color = models.CharField(max_length=80, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["material_type", "company", "name", "code"]

    def __str__(self):
        parts = [self.company, self.name, self.code]
        return " / ".join([part for part in parts if part])

    def save(self, *args, **kwargs):
        needs_code = not self.code
        if needs_code and not self.pk:
            self.code = f"PENDING-{uuid4().hex[:12].upper()}"

        result = super().save(*args, **kwargs)

        if needs_code:
            prefix = MATERIAL_TYPE_PREFIXES.get(self.material_type, "MAT")
            self.code = f"{prefix}-{self.pk:05d}"
            super().save(update_fields=["code"])

        return result


class MaterialSupplierOption(models.Model):
    material = models.ForeignKey(
        MaterialSpec,
        on_delete=models.CASCADE,
        related_name="supplier_options",
        help_text="The face, liner, adhesive, silicone, or coating data type this supplier option can fulfill.",
    )
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="material_supplier_options",
    )
    supplier_name = models.CharField(max_length=140, blank=True)
    option_name = models.CharField(max_length=160, blank=True)
    supplier_item_number = models.CharField(max_length=100, blank=True)
    thickness_mil = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    width_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    length_feet = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["material__material_type", "material__name", "supplier_name", "option_name"]

    def __str__(self):
        parts = [self.material.name if self.material_id else "", self.option_name, self.supplier_name]
        return " / ".join([part for part in parts if part])

    def save(self, *args, **kwargs):
        if self.supplier:
            self.supplier_name = self.supplier.name
        super().save(*args, **kwargs)


class RawMaterialInventory(models.Model):
    STATUS_CHOICES = [
        ("available", "Available"),
        ("scheduled", "Scheduled"),
        ("allocated", "Allocated"),
        ("in_use", "In Use"),
        ("on_hold", "On Hold"),
        ("depleted", "Depleted"),
        ("scrapped", "Scrapped"),
    ]

    UNIT_CHOICES = [
        ("lf", "Linear Feet"),
        ("msi", "MSI"),
        ("lbs", "Pounds"),
        ("gal", "Gallons"),
        ("roll", "Roll"),
        ("each", "Each"),
    ]

    material = models.ForeignKey(
        MaterialSpec,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inventory",
    )

    material_type = models.CharField(
        max_length=30,
        choices=MaterialSpec.MATERIAL_TYPE_CHOICES,
        default="coated_stock",
    )

    name = models.CharField(max_length=150, blank=True)
    code = models.CharField(max_length=80, blank=True)
    serial_number = models.CharField(max_length=80, blank=True)
    lot_number = models.CharField(max_length=80, blank=True)

    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="material_inventory",
    )

    location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="material_inventory",
    )

    width_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    length_feet = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    weight_lbs = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    unit = models.CharField(max_length=20, choices=UNIT_CHOICES, default="lf")

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="available")
    received_date = models.DateField(null=True, blank=True)

    source_roll_tag = models.ForeignKey(
        "CoaterRollTag",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inventory_entries",
    )

    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["material_type", "name", "serial_number"]

    def save(self, *args, **kwargs):
        needs_serial = not self.serial_number
        if self.material:
            self.material_type = self.material.material_type
            if not self.code:
                self.code = self.material.code
            if not self.name:
                self.name = self.material.name
            if not self.supplier_id:
                self.supplier = self.material.supplier
        result = super().save(*args, **kwargs)
        if needs_serial:
            prefix = MATERIAL_TYPE_PREFIXES.get(self.material_type, "MAT")
            self.serial_number = f"{prefix}-{self.pk:06d}"
            super().save(update_fields=["serial_number"])
        return result

    def __str__(self):
        return f"{self.name} / {self.serial_number or self.lot_number or self.pk}"


class MaterialUsage(models.Model):
    USAGE_TYPE_CHOICES = [
        ("checkout", "Checked Out"),
        ("returned", "Returned"),
        ("qc_issue", "QC Issue"),
        ("coater", "Coater"),
        ("finished", "Finished Production"),
        ("shipped", "Shipped Finished Stock"),
        ("manual", "Manual Consumption"),
        ("scrap", "Scrap"),
        ("adjustment", "Adjustment"),
    ]

    inventory = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="usage_records",
    )
    material = models.ForeignKey(
        MaterialSpec,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="usage_records",
    )
    usage_type = models.CharField(max_length=30, choices=USAGE_TYPE_CHOICES, default="manual")
    quantity = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    unit = models.CharField(max_length=20, choices=RawMaterialInventory.UNIT_CHOICES, default="lf")
    used_date = models.DateField(default=timezone.localdate)
    used_by = models.CharField(max_length=120, blank=True)
    reference = models.CharField(max_length=150, blank=True)
    coater_roll_tag = models.ForeignKey(
        "CoaterRollTag",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="material_usages",
    )
    finished_inventory = models.ForeignKey(
        "production.FinishedInventory",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="material_usages",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-used_date", "-created_at"]

    def save(self, *args, **kwargs):
        with transaction.atomic():
            previous = None
            if self.pk:
                previous = MaterialUsage.objects.select_related("inventory").filter(pk=self.pk).first()

            if self.inventory:
                if not self.material_id:
                    self.material = self.inventory.material
                if not self.unit:
                    self.unit = self.inventory.unit

            super().save(*args, **kwargs)

            if previous and previous.inventory_id and previous.consumes_inventory:
                self._adjust_inventory(previous.inventory, previous.quantity)
            if self.inventory_id and self.consumes_inventory:
                self._adjust_inventory(self.inventory, -self.quantity)

    def delete(self, *args, **kwargs):
        inventory = self.inventory
        quantity = self.quantity
        with transaction.atomic():
            result = super().delete(*args, **kwargs)
            if inventory and self.consumes_inventory:
                self._adjust_inventory(inventory, quantity)
            return result

    @property
    def consumes_inventory(self):
        return self.usage_type in ["checkout", "manual", "coater", "finished", "shipped", "scrap"]

    def _adjust_inventory(self, inventory, delta):
        if not inventory:
            return

        delta = Decimal(delta or 0)
        inventory.quantity = max(Decimal("0"), Decimal(inventory.quantity or 0) + delta)

        if self.unit == "lf" and inventory.length_feet is not None:
            inventory.length_feet = max(Decimal("0"), Decimal(inventory.length_feet or 0) + delta)

        available = inventory.length_feet if self.unit == "lf" and inventory.length_feet is not None else inventory.quantity
        if available <= 0:
            inventory.status = "depleted"
        elif inventory.status == "depleted":
            inventory.status = "available"
        inventory.save()

    def __str__(self):
        return f"{self.material or self.inventory or 'Material'} / {self.quantity} {self.unit}"


class CoaterRollTag(models.Model):
    STATUS_CHOICES = [
        ("scheduled", "Scheduled"),
        ("running", "Running"),
        ("complete", "Complete"),
        ("on_hold", "On Hold"),
        ("void", "Void"),
    ]

    PRINT_STATUS_CHOICES = [
        ("not_printed", "Not Printed"),
        ("queued", "Queued"),
        ("printed", "Printed"),
        ("reprint", "Needs Reprint"),
    ]

    tag_number = models.CharField(max_length=80, unique=True, blank=True)
    name = models.CharField(max_length=150)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="scheduled")
    print_status = models.CharField(max_length=20, choices=PRINT_STATUS_CHOICES, default="not_printed")

    scheduled_by = models.CharField(max_length=100, blank=True)
    cut_description = models.CharField(max_length=200, blank=True)
    operator_notes = models.TextField(blank=True)
    scheduled_material = models.ForeignKey(
        MaterialSpec,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="scheduled_roll_tags",
    )

    liner = models.ForeignKey(
        MaterialSpec,
        on_delete=models.PROTECT,
        related_name="coater_liner_tags",
        limit_choices_to={"material_type": "liner"},
    )
    face = models.ForeignKey(
        MaterialSpec,
        on_delete=models.PROTECT,
        related_name="coater_face_tags",
        limit_choices_to={"material_type": "face"},
    )
    adhesive = models.ForeignKey(
        MaterialSpec,
        on_delete=models.PROTECT,
        related_name="coater_adhesive_tags",
        limit_choices_to={"material_type": "adhesive"},
    )
    silicone = models.ForeignKey(
        MaterialSpec,
        on_delete=models.PROTECT,
        related_name="coater_silicone_tags",
        limit_choices_to={"material_type": "silicone"},
    )
    coating = models.ForeignKey(
        MaterialSpec,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_coating_tags",
        limit_choices_to={"material_type": "coating"},
    )

    liner_inventory = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_liner_usages",
        limit_choices_to={"material_type": "liner"},
    )
    face_inventory = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_face_usages",
        limit_choices_to={"material_type": "face"},
    )
    adhesive_inventory = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_adhesive_usages",
        limit_choices_to={"material_type": "adhesive"},
    )
    silicone_inventory = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_silicone_usages",
        limit_choices_to={"material_type": "silicone"},
    )
    coating_inventory = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_coating_usages",
        limit_choices_to={"material_type": "coating"},
    )

    liner_supplier_option = models.ForeignKey(
        MaterialSupplierOption,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_liner_tags",
    )
    face_supplier_option = models.ForeignKey(
        MaterialSupplierOption,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_face_tags",
    )
    adhesive_supplier_option = models.ForeignKey(
        MaterialSupplierOption,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_adhesive_tags",
    )
    silicone_supplier_option = models.ForeignKey(
        MaterialSupplierOption,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_silicone_tags",
    )
    coating_supplier_option = models.ForeignKey(
        MaterialSupplierOption,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_coating_tags",
    )

    produced_material = models.ForeignKey(
        MaterialSpec,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="produced_roll_tags",
        limit_choices_to={"material_type": "coated_stock"},
    )

    result_code = models.CharField(max_length=80, blank=True)
    result_serial_number = models.CharField(max_length=80, blank=True)
    result_lot_number = models.CharField(max_length=80, unique=True, blank=True)
    width_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    length_feet = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    weight_lbs = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    operator = models.CharField(max_length=100, blank=True)
    run_date = models.DateField(null=True, blank=True)
    press = models.ForeignKey(
        Press,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_roll_tags",
    )
    location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coater_roll_tags",
    )

    log_inventory = models.BooleanField(default=True)
    logged_inventory = models.OneToOneField(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_by_roll_tag",
    )

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-run_date", "tag_number"]

    def save(self, *args, **kwargs):
        needs_tag_number = not self.tag_number
        needs_lot_number = not self.result_lot_number
        if needs_tag_number and not self.pk:
            self.tag_number = f"PENDING-{uuid4().hex[:12].upper()}"
        if needs_lot_number:
            self.result_lot_number = f"LOT-{self.tag_number}"

        super().save(*args, **kwargs)

        if needs_tag_number:
            self.tag_number = f"CRT-{self.pk:06d}"
            if needs_lot_number:
                self.result_lot_number = f"LOT-{self.tag_number}"
            super().save(update_fields=["tag_number", "result_lot_number", "updated_at"])

        if not self.log_inventory or self.logged_inventory_id:
            self._log_component_usage()
            return

        inventory = RawMaterialInventory.objects.create(
            material=self.produced_material or self.scheduled_material,
            material_type=(self.produced_material or self.scheduled_material).material_type
            if (self.produced_material or self.scheduled_material)
            else "coated_stock",
            name=self.name,
            code=self.result_code,
            serial_number=self.result_serial_number,
            lot_number=self.result_lot_number,
            location=self.location,
            width_inches=self.width_inches,
            length_feet=self.length_feet,
            weight_lbs=self.weight_lbs,
            quantity=self.length_feet or 0,
            unit="lf",
            status="available" if self.status == "complete" else "scheduled",
            received_date=self.run_date,
            source_roll_tag=self,
            notes=f"Created from coater roll tag {self.tag_number}",
        )
        self.logged_inventory = inventory
        super().save(update_fields=["logged_inventory", "updated_at"])

        self._log_component_usage()

    def _log_component_usage(self):
        if self.status not in ["running", "complete"] or not self.length_feet:
            return

        for inventory, material in [
            (self.liner_inventory, self.liner),
            (self.face_inventory, self.face),
            (self.adhesive_inventory, self.adhesive),
            (self.silicone_inventory, self.silicone),
            (self.coating_inventory, self.coating),
        ]:
            if not inventory:
                continue
            usage = MaterialUsage.objects.filter(
                coater_roll_tag=self,
                inventory=inventory,
            ).first() or MaterialUsage(coater_roll_tag=self, inventory=inventory)
            usage.material = inventory.material or material
            usage.usage_type = "coater"
            usage.quantity = self.length_feet
            usage.unit = inventory.unit or "lf"
            usage.used_date = self.run_date or timezone.localdate()
            usage.used_by = self.operator
            usage.reference = self.tag_number
            usage.notes = f"Consumed for coater roll tag {self.tag_number}"
            usage.save()

    def __str__(self):
        return f"{self.tag_number} / {self.name}"
