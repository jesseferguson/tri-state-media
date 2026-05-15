from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("tooling", "0006_alter_flexdie_shape_type_and_more"),
        ("materials", "0010_coater_schedule_press_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="MaterialSupplierOption",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("supplier_name", models.CharField(blank=True, max_length=140)),
                ("option_name", models.CharField(blank=True, max_length=160)),
                ("supplier_item_number", models.CharField(blank=True, max_length=100)),
                ("thickness_mil", models.DecimalField(blank=True, decimal_places=3, max_digits=8, null=True)),
                ("width_inches", models.DecimalField(blank=True, decimal_places=3, max_digits=8, null=True)),
                ("length_feet", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("is_active", models.BooleanField(default=True)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "material",
                    models.ForeignKey(
                        help_text="The face, liner, adhesive, silicone, or coating data type this supplier option can fulfill.",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="supplier_options",
                        to="materials.materialspec",
                    ),
                ),
                (
                    "supplier",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="material_supplier_options",
                        to="tooling.supplier",
                    ),
                ),
            ],
            options={
                "ordering": ["material__material_type", "material__name", "supplier_name", "option_name"],
            },
        ),
    ]
