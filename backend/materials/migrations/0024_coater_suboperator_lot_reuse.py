from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0023_inventory_origin_direct_rack"),
    ]

    operations = [
        migrations.AlterField(
            model_name="coaterrolltag",
            name="result_lot_number",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="coaterrolltag",
            name="suboperator",
            field=models.CharField(blank=True, max_length=100),
        ),
    ]
