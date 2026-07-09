import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0023_inventory_origin_direct_rack"),
        ("production", "0036_add_storage_tracking_access"),
    ]

    operations = [
        migrations.AlterField(
            model_name="productionshiftreport",
            name="production_schedule",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="shift_reports",
                to="production.productionschedule",
            ),
        ),
        migrations.AddField(
            model_name="productionshiftreport",
            name="coater_schedule",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="footage_reports",
                to="materials.coaterrolltag",
            ),
        ),
        migrations.AlterField(
            model_name="productionshiftreport",
            name="job_ticket",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="shift_reports",
                to="production.jobticket",
            ),
        ),
        migrations.AddField(
            model_name="productionshiftreport",
            name="suboperator",
            field=models.CharField(blank=True, max_length=120),
        ),
    ]
