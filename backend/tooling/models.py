from django.core.exceptions import ValidationError
from django.db import models


# =========================
# BASIC SUPPORT MODELS
# =========================

class Supplier(models.Model):
    name = models.CharField(max_length=100, unique=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)

    address_line_1 = models.CharField(max_length=150, blank=True)
    address_line_2 = models.CharField(max_length=150, blank=True)
    city = models.CharField(max_length=80, blank=True)
    state = models.CharField(max_length=50, blank=True)
    zip_code = models.CharField(max_length=20, blank=True)
    country = models.CharField(max_length=50, default="USA")

    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class ToolingLocation(models.Model):
    LOCATION_TYPE_CHOICES = [
        ("company", "Company"),
        ("shop", "Shop"),
        ("room", "Room"),
        ("rack", "Rack"),
        ("shelf", "Shelf"),
        ("position", "Position"),
        ("press", "Press"),
        ("supplier", "Supplier"),
        ("unknown", "Unknown"),
    ]

    name = models.CharField(max_length=100)
    code = models.CharField(max_length=50, unique=True)

    location_type = models.CharField(
        max_length=20,
        choices=LOCATION_TYPE_CHOICES,
        default="position",
    )

    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )

    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tooling_locations",
    )

    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    def full_path(self):
        parts = [self.name]
        parent = self.parent

        while parent:
            parts.append(parent.name)
            parent = parent.parent

        return " > ".join(reversed(parts))

    def __str__(self):
        return self.full_path()

    def clean(self):
        super().clean()

        if not self.parent_id:
            return

        if self.parent_id == self.pk:
            raise ValidationError({"parent": "A location cannot be its own parent."})

        ancestor = self.parent
        while ancestor:
            if ancestor.pk == self.pk:
                raise ValidationError({"parent": "A location cannot be nested inside itself."})
            ancestor = ancestor.parent

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class Press(models.Model):
    name = models.CharField(max_length=100, unique=True)  # Press 001

    location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="presses",
    )

    max_web_width_inches = models.DecimalField(
        max_digits=7,
        decimal_places=3,
        null=True,
        blank=True,
    )

    color_count = models.PositiveIntegerField(default=0)
    has_digital_print = models.BooleanField(default=False)

    die_station_count = models.PositiveIntegerField(default=0)
    has_undercut_capability = models.BooleanField(default=False)
    has_perf_capability = models.BooleanField(default=True)

    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


# =========================
# TOOLING MODELS
# =========================

class Mag(models.Model):
    STATUS_CHOICES = [
        ("ordered", "Ordered"),
        ("in_stock", "In Stock"),
        ("in_use", "In Use"),
        ("needs_repair", "Needs Repair"),
        ("out_for_retool", "Out for Retool"),
        ("retired", "Retired"),
        ("missing", "Missing"),
    ]

    name = models.CharField(max_length=50, unique=True)

    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="mags",
    )

    current_location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="mags",
    )

    compatible_presses = models.ManyToManyField(
        Press,
        blank=True,
        related_name="compatible_mags",
    )

    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="in_stock")

    tooth_count = models.PositiveIntegerField()
    repeat_inches = models.DecimalField(max_digits=7, decimal_places=3)
    face_width_inches = models.DecimalField(max_digits=7, decimal_places=3, null=True, blank=True)

    notes = models.TextField(blank=True)

    def __str__(self):
        return f"{self.name} - {self.tooth_count}T - {self.repeat_inches}\""


class FlexDie(models.Model):
    STATUS_CHOICES = [
        ("ordered", "Ordered"),
        ("in_stock", "In Stock"),
        ("in_use", "In Use"),
        ("needs_repair", "Needs Repair"),
        ("out_for_retool", "Out for Retool"),
        ("retired", "Retired"),
        ("missing", "Missing"),
    ]

    SHAPE_TYPE_CHOICES = [
        ("rcr", "RCR"),
        ("circle", "Circle"),
        ("oval", "Oval"),
        ("rectangle", "Rectangle"),
        ("special", "Special"),
        ("custom", "Custom"),
    ]

    CUTTING_TYPE_CHOICES = [
        ("to_liner", "To Liner"),
        ("metal_to_metal", "Metal to Metal"),
        ("score", "Score"),
        ("special", "Special"),
    ]

    name = models.CharField(max_length=50, unique=True)

    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="flex_dies",
    )

    current_location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="flex_dies",
    )

    compatible_mags = models.ManyToManyField(
        Mag,
        blank=True,
        related_name="compatible_flex_dies",
    )

    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="in_stock")

    label_width_inches = models.DecimalField(max_digits=7, decimal_places=3)
    label_length_inches = models.DecimalField(max_digits=7, decimal_places=3)
    repeat_inches = models.DecimalField(max_digits=7, decimal_places=3)

    face_type = models.CharField(max_length=100, blank=True)   # Poly, paper, BOPP, DT
    liner_type = models.CharField(max_length=100, blank=True)  # 40# liner, PET liner

    shape_type = models.CharField(max_length=30, choices=SHAPE_TYPE_CHOICES, default="rcr")
    cutting_type = models.CharField(max_length=30, choices=CUTTING_TYPE_CHOICES, default="to_liner")

    gear = models.PositiveIntegerField(null=True, blank=True)

    number_across = models.PositiveIntegerField(default=1)
    number_around = models.PositiveIntegerField(default=1)

    corner_radius_inches = models.DecimalField(max_digits=6, decimal_places=3, null=True, blank=True)
    gap_across_inches = models.DecimalField(max_digits=6, decimal_places=3, null=True, blank=True)
    gap_around_inches = models.DecimalField(max_digits=6, decimal_places=3, null=True, blank=True)
    web_width_inches = models.DecimalField(max_digits=7, decimal_places=3, null=True, blank=True)

    tool_number = models.CharField(max_length=50, blank=True)
    drawing_number = models.CharField(max_length=50, blank=True)

    notes = models.TextField(blank=True)

    def __str__(self):
        return f"{self.name} - {self.label_width_inches}\" x {self.label_length_inches}\""


class PerfCylinder(models.Model):
    STATUS_CHOICES = [
        ("ordered", "Ordered"),
        ("in_stock", "In Stock"),
        ("in_use", "In Use"),
        ("needs_repair", "Needs Repair"),
        ("out_for_repair", "Out for Repair"),
        ("retired", "Retired"),
        ("missing", "Missing"),
    ]

    name = models.CharField(max_length=50, unique=True)

    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="perf_cylinders",
    )

    current_location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="perf_cylinders",
    )

    compatible_presses = models.ManyToManyField(
        Press,
        blank=True,
        related_name="compatible_perf_cylinders",
    )

    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="in_stock")

    gear_tooth_count = models.PositiveIntegerField()
    cylinder_width_inches = models.DecimalField(max_digits=7, decimal_places=3)
    max_blade_count = models.PositiveIntegerField(null=True, blank=True)

    notes = models.TextField(blank=True)

    def __str__(self):
        return f"{self.name} - {self.gear_tooth_count}T"


class PerfBladeSetup(models.Model):
    perf_cylinder = models.ForeignKey(
        PerfCylinder,
        on_delete=models.CASCADE,
        related_name="blade_setups",
    )

    name = models.CharField(max_length=100)

    blade_count = models.PositiveIntegerField()
    standard_repeat_inches = models.DecimalField(max_digits=7, decimal_places=3, null=True, blank=True)
    has_offset_blades = models.BooleanField(default=False)

    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.perf_cylinder.name} - {self.name}"


class PerfBlade(models.Model):
    BLADE_TYPE_CHOICES = [
        ("standard", "Standard"),
        ("offset", "Offset"),
        ("skip", "Skip"),
        ("custom", "Custom"),
    ]

    setup = models.ForeignKey(
        PerfBladeSetup,
        on_delete=models.CASCADE,
        related_name="blades",
    )

    blade_number = models.PositiveIntegerField()
    blade_type = models.CharField(max_length=20, choices=BLADE_TYPE_CHOICES, default="standard")

    blade_width_inches = models.DecimalField(max_digits=7, decimal_places=3, null=True, blank=True)
    position_inches = models.DecimalField(max_digits=7, decimal_places=3, null=True, blank=True)
    offset_inches = models.DecimalField(max_digits=7, decimal_places=3, null=True, blank=True)

    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    class Meta:
        unique_together = ["setup", "blade_number"]

    def __str__(self):
        return f"{self.setup.name} - Blade {self.blade_number}"
    
# =========================
# TOOLING RECIPE BOOK
# =========================

class ToolingRecipe(models.Model):
    SHAPE_TYPE_CHOICES = FlexDie.SHAPE_TYPE_CHOICES
    CUTTING_TYPE_CHOICES = FlexDie.CUTTING_TYPE_CHOICES

    PERF_OPTION_CHOICES = [
        ("none", "No Perf"),
        ("perf", "Perf"),
    ]

    INTERNAL_PERF_CUTTING_TYPE_CHOICES = [
        ("to_liner", "To Liner"),
        ("through_liner", "Through Liner"),
    ]

    name = models.CharField(max_length=150, unique=True)

    label_width_inches = models.DecimalField(max_digits=7, decimal_places=3)
    label_length_inches = models.DecimalField(max_digits=7, decimal_places=3)

    face_type = models.CharField(max_length=100, blank=True)
    liner_type = models.CharField(max_length=100, blank=True)

    # External perf between labels. If selected, this requires a perf cylinder in the tooling option.
    perf_option = models.CharField(
        max_length=20,
        choices=PERF_OPTION_CHOICES,
        default="none",
        blank=True,
        help_text="External perf between labels. Defaults to No Perf.",
    )

    # External perf TPI. Only used when perf_option = perf.
    tpi = models.DecimalField(
        max_digits=6,
        decimal_places=3,
        null=True,
        blank=True,
        help_text="External perf TPI. Only used when external perf is selected.",
    )

    perf_notes = models.TextField(
        blank=True,
        default="",
        help_text="External perf notes. Only used when external perf is selected.",
    )

    # Internal perf inside the label. Does not automatically require an external perf cylinder.
    internal_perf_option = models.CharField(
        max_length=20,
        choices=PERF_OPTION_CHOICES,
        default="none",
        blank=True,
        help_text="Internal perf inside the label. Defaults to No Perf.",
    )

    internal_perf_cutting_type = models.CharField(
        max_length=30,
        choices=INTERNAL_PERF_CUTTING_TYPE_CHOICES,
        blank=True,
        default="",
        help_text="Only used when internal perf is selected.",
    )

    internal_perf_tpi = models.DecimalField(
        max_digits=6,
        decimal_places=3,
        null=True,
        blank=True,
        help_text="Internal perf TPI. Only used when internal perf is selected.",
    )

    internal_perf_notes = models.TextField(
        blank=True,
        default="",
        help_text="Internal perf notes. Only used when internal perf is selected.",
    )

    shape_type = models.CharField(
        max_length=30,
        choices=SHAPE_TYPE_CHOICES,
        default="rcr",
    )

    # Main label cut. This is not the perf setting.
    cutting_type = models.CharField(
        max_length=30,
        choices=CUTTING_TYPE_CHOICES,
        default="to_liner",
    )

    repeat_inches = models.DecimalField(max_digits=7, decimal_places=3, null=True, blank=True)

    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    @property
    def requires_external_perf(self):
        return self.perf_option == "perf"

    @property
    def requires_internal_perf(self):
        return self.internal_perf_option == "perf"

    @property
    def requires_perf(self):
        return self.requires_external_perf or self.requires_internal_perf

    @property
    def is_no_perf(self):
        return not self.requires_perf

    @property
    def external_perf_cutting_type(self):
        if self.requires_external_perf:
            return "through_liner"
        return ""

    def clean(self):
        super().clean()

        if not self.perf_option:
            self.perf_option = "none"

        if not self.internal_perf_option:
            self.internal_perf_option = "none"

        # If external perf is off, clear its hidden fields.
        if self.perf_option != "perf":
            self.tpi = None
            self.perf_notes = ""

        # If internal perf is off, clear its hidden fields.
        if self.internal_perf_option != "perf":
            self.internal_perf_cutting_type = ""
            self.internal_perf_tpi = None
            self.internal_perf_notes = ""

        if self.internal_perf_option == "perf" and not self.internal_perf_cutting_type:
            raise ValidationError({
                "internal_perf_cutting_type": "Choose whether the internal perf cuts to the liner or through the liner."
            })

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self):
        return self.name

class ToolingRecipeOption(models.Model):
    """
    One approved way to run a recipe.

    Example:
    Recipe: 2 x 1 Poly Roll - 12TPI
    Option: Run on Press 001 using Mag 88T + FlexDie FD-2001 + Perf PERF-001
    """

    SETUP_TYPE_CHOICES = [
        ("standard", "Standard"),
        ("undercut", "Undercut"),
        ("manual_custom", "Manual Custom"),
        ("experimental", "Experimental"),
    ]

    recipe = models.ForeignKey(
        ToolingRecipe,
        on_delete=models.CASCADE,
        related_name="options",
    )

    press = models.ForeignKey(
        Press,
        on_delete=models.CASCADE,
        related_name="recipe_options",
    )

    name = models.CharField(max_length=150)

    setup_type = models.CharField(
        max_length=30,
        choices=SETUP_TYPE_CHOICES,
        default="standard",
    )

    is_preferred = models.BooleanField(default=False)
    is_approved = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)

    requires_undercut = models.BooleanField(default=False)
    requires_manual_review = models.BooleanField(default=False)

    setup_notes = models.TextField(blank=True)
    operator_notes = models.TextField(blank=True)

    estimated_setup_minutes = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        unique_together = ["recipe", "press", "name"]
        ordering = ["recipe", "press", "-is_preferred", "name"]

    def can_run_on_press(self):
        if self.requires_undercut and not self.press.has_undercut_capability:
            return False

        if not self.is_active or not self.is_approved:
            return False

        return True

    def __str__(self):
        return f"{self.recipe.name} on {self.press.name} - {self.name}"

    def clean(self):
        super().clean()

        if self.requires_undercut and self.press_id and not self.press.has_undercut_capability:
            raise ValidationError(
                {"requires_undercut": f"{self.press.name} does not support undercut setups."}
            )

        if not self.is_preferred:
            return

        duplicate_preferred = ToolingRecipeOption.objects.filter(
            recipe=self.recipe,
            press=self.press,
            is_preferred=True,
        )
        if self.pk:
            duplicate_preferred = duplicate_preferred.exclude(pk=self.pk)

        if duplicate_preferred.exists():
            raise ValidationError(
                {"is_preferred": "Only one preferred option is allowed per recipe and press."}
            )

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

class ToolingRecipeTool(models.Model):
    """
    The actual tooling items used in one recipe option.
    This allows manual custom jobs too.
    """

    TOOL_TYPE_CHOICES = [
        ("mag", "Mag"),
        ("flex_die", "Flex Die"),
        ("perf_cylinder", "Perf Cylinder"),
        ("perf_blade_setup", "Perf Blade Setup"),
        ("manual_tooling", "Manual Tooling"),
        ("other", "Other"),
    ]

    recipe_option = models.ForeignKey(
        ToolingRecipeOption,
        on_delete=models.CASCADE,
        related_name="tools",
    )

    TOOL_ROLE_CHOICES = [
    ("top", "Top / Main"),
    ("undercut", "Undercut"),
    ("perf", "Perf"),
    ("other", "Other"),
    ]

    tool_role = models.CharField(
        max_length=30,
        choices=TOOL_ROLE_CHOICES,
        default="top",
    )

    tool_type = models.CharField(max_length=30, choices=TOOL_TYPE_CHOICES)

    mag = models.ForeignKey(
        Mag,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recipe_tools",
    )

    flex_die = models.ForeignKey(
        FlexDie,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recipe_tools",
    )

    perf_cylinder = models.ForeignKey(
        PerfCylinder,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recipe_tools",
    )

    perf_blade_setup = models.ForeignKey(
        PerfBladeSetup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recipe_tools",
    )

    manual_description = models.CharField(
        max_length=200,
        blank=True,
        help_text="Use this for odd/custom tooling not stored as a normal tool.",
    )

    station_number = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Die station, perf station, undercut station, etc.",
    )

    is_required = models.BooleanField(default=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["recipe_option", "station_number", "tool_type"]

    def __str__(self):
        tool = (
            self.mag
            or self.flex_die
            or self.perf_cylinder
            or self.perf_blade_setup
            or self.manual_description
            or self.tool_type
        )
        return f"{self.recipe_option.name} - {tool}"

    def clean(self):
        super().clean()

        manual_description = (self.manual_description or "").strip()
        selected_sources = {
            "mag": self.mag_id is not None,
            "flex_die": self.flex_die_id is not None,
            "perf_cylinder": self.perf_cylinder_id is not None,
            "perf_blade_setup": self.perf_blade_setup_id is not None,
            "manual_description": bool(manual_description),
        }
        selected_source_count = sum(selected_sources.values())

        if selected_source_count != 1:
            raise ValidationError(
                "Provide exactly one tooling source: a stored tool reference or a manual description."
            )

        tool_type_requirements = {
            "mag": "mag",
            "flex_die": "flex_die",
            "perf_cylinder": "perf_cylinder",
            "perf_blade_setup": "perf_blade_setup",
            "manual_tooling": "manual_description",
            "other": "manual_description",
        }
        required_source = tool_type_requirements.get(self.tool_type)

        if required_source and not selected_sources[required_source]:
            field_name = "manual_description" if required_source == "manual_description" else required_source
            raise ValidationError(
                {
                    field_name: (
                        f"Tool type '{self.tool_type}' must use the matching tooling reference."
                    )
                }
            )

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
    
# =========================
# TOOLING HISTORY
# =========================

class ToolingHistory(models.Model):
    TOOLING_TYPE_CHOICES = [
        ("mag", "Mag"),
        ("flex_die", "Flex Die"),
        ("perf_cylinder", "Perf Cylinder"),
    ]

    EVENT_TYPE_CHOICES = [
        ("created", "Created"),
        ("moved", "Moved"),
        ("installed_on_press", "Installed on Press"),
        ("removed_from_press", "Removed from Press"),
        ("sent_to_supplier", "Sent to Supplier"),
        ("returned_from_supplier", "Returned from Supplier"),
        ("repair", "Repair"),
        ("retool", "Retool"),
        ("status_change", "Status Change"),
        ("inspection", "Inspection"),
        ("note", "Note"),
        ("retired", "Retired"),
    ]

    tooling_type = models.CharField(max_length=30, choices=TOOLING_TYPE_CHOICES)

    mag = models.ForeignKey(
        Mag,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="history",
    )

    flex_die = models.ForeignKey(
        FlexDie,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="history",
    )

    perf_cylinder = models.ForeignKey(
        PerfCylinder,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="history",
    )

    event_type = models.CharField(max_length=40, choices=EVENT_TYPE_CHOICES)

    from_location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="history_from_locations",
    )

    to_location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="history_to_locations",
    )

    press = models.ForeignKey(
        Press,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tooling_history",
    )

    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tooling_history",
    )

    performed_by = models.CharField(max_length=100, blank=True)

    summary = models.CharField(max_length=200)
    notes = models.TextField(blank=True)

    event_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-event_date"]

    def __str__(self):
        item = self.mag or self.flex_die or self.perf_cylinder
        return f"{item} - {self.event_type}"

    def clean(self):
        super().clean()

        selected_tools = {
            "mag": self.mag_id is not None,
            "flex_die": self.flex_die_id is not None,
            "perf_cylinder": self.perf_cylinder_id is not None,
        }
        selected_tool_count = sum(selected_tools.values())

        if selected_tool_count != 1:
            raise ValidationError(
                "History entries must reference exactly one tooling item."
            )

        if not selected_tools.get(self.tooling_type, False):
            raise ValidationError(
                {
                    "tooling_type": (
                        f"Tooling type '{self.tooling_type}' must match the referenced tooling item."
                    )
                }
            )

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


# =========================
# MANUFACTURING INVENTORY
# =========================

class RawMaterialInventory(models.Model):
    MATERIAL_TYPE_CHOICES = [
        ("face", "Face"),
        ("liner", "Liner"),
        ("adhesive", "Adhesive"),
        ("silicone", "Silicone"),
    ]

    STATUS_CHOICES = [
        ("available", "Available"),
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

    material_type = models.CharField(max_length=20, choices=MATERIAL_TYPE_CHOICES)
    name = models.CharField(max_length=150)
    serial_number = models.CharField(max_length=80, blank=True)
    lot_number = models.CharField(max_length=80, blank=True)

    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="raw_materials",
    )

    location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="raw_materials",
    )

    face_type = models.CharField(max_length=100, blank=True)
    liner_type = models.CharField(max_length=100, blank=True)
    adhesive_type = models.CharField(max_length=100, blank=True)
    silicone_type = models.CharField(max_length=100, blank=True)

    width_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    length_feet = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    quantity = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    unit = models.CharField(max_length=20, choices=UNIT_CHOICES, default="lf")

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="available")
    received_date = models.DateField(null=True, blank=True)

    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["material_type", "name", "serial_number"]

    def __str__(self):
        return f"{self.get_material_type_display()} - {self.name}"


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
        ("case", "Case"),
        ("label", "Label"),
        ("lf", "Linear Feet"),
        ("each", "Each"),
    ]

    name = models.CharField(max_length=150)
    sku = models.CharField(max_length=80, blank=True)

    job_ticket = models.ForeignKey(
        "JobTicket",
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
        related_name="finished_inventory",
    )

    recipe_option = models.ForeignKey(
        ToolingRecipeOption,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finished_inventory",
    )

    location = models.ForeignKey(
        ToolingLocation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finished_inventory",
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


class JobTicket(models.Model):
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("scheduled", "Scheduled"),
        ("in_production", "In Production"),
        ("finishing", "Finishing"),
        ("complete", "Complete"),
        ("on_hold", "On Hold"),
        ("cancelled", "Cancelled"),
    ]

    PRIORITY_CHOICES = [
        ("normal", "Normal"),
        ("rush", "Rush"),
        ("hot", "Hot"),
    ]

    FINISHING_TYPE_CHOICES = [
        ("none", "None"),
        ("rewind", "Rewind"),
        ("sheet", "Sheet"),
        ("fanfold", "Fanfold"),
        ("pack", "Pack"),
        ("inspect", "Inspect"),
        ("custom", "Custom"),
    ]

    ticket_number = models.CharField(max_length=80, unique=True)
    customer_name = models.CharField(max_length=150, blank=True)
    product_name = models.CharField(max_length=150)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="draft")
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="normal")

    due_date = models.DateField(null=True, blank=True)
    scheduled_date = models.DateField(null=True, blank=True)

    recipe = models.ForeignKey(
        ToolingRecipe,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="job_tickets",
    )

    recipe_option = models.ForeignKey(
        ToolingRecipeOption,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="job_tickets",
    )

    press = models.ForeignKey(
        Press,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="job_tickets",
    )

    face_material = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="face_jobs",
    )

    liner_material = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="liner_jobs",
    )

    adhesive_material = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="adhesive_jobs",
    )

    silicone_material = models.ForeignKey(
        RawMaterialInventory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="silicone_jobs",
    )

    material_width_inches = models.DecimalField(max_digits=8, decimal_places=3, null=True, blank=True)
    material_length_feet = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    requested_quantity = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    produced_quantity = models.DecimalField(max_digits=12, decimal_places=3, default=0)

    finishing_type = models.CharField(max_length=30, choices=FINISHING_TYPE_CHOICES, default="none")
    finishing_notes = models.TextField(blank=True)

    operator = models.CharField(max_length=100, blank=True)
    suboperator = models.CharField(max_length=100, blank=True)

    production_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-scheduled_date", "ticket_number"]

    def __str__(self):
        return f"{self.ticket_number} - {self.product_name}"


