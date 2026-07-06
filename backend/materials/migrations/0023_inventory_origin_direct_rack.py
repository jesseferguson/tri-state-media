from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0022_materialrack_location"),
    ]

    operations = [
        migrations.AddField(
            model_name="rawmaterialinventory",
            name="direct_rack",
            field=models.ForeignKey(
                blank=True,
                help_text="Rack holding this material when it is not stored on a skid.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="loose_rolls",
                to="materials.materialrack",
            ),
        ),
        migrations.AddField(
            model_name="rawmaterialinventory",
            name="inventory_origin",
            field=models.CharField(
                choices=[
                    ("tri_state", "Tri-State Produced"),
                    ("purchased", "Purchased / Outsourced"),
                    ("legacy", "Existing Stock / No QR"),
                ],
                default="tri_state",
                max_length=20,
            ),
        ),
    ]
