from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0025_quote_finished_material_unit_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="companyuser",
            name="quote_company",
            field=models.CharField(
                choices=[("tri_state_media", "Tri-State Media"), ("barcode_labels", "Barcode Labels")],
                default="tri_state_media",
                max_length=40,
            ),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="quote_company",
            field=models.CharField(
                choices=[("tri_state_media", "Tri-State Media"), ("barcode_labels", "Barcode Labels")],
                default="tri_state_media",
                max_length=40,
            ),
        ),
    ]
