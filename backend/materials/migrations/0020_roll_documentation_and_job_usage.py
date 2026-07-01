import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0019_normalize_active_coater_schedules"),
        ("production", "0032_jobticket_carton_label_format"),
    ]

    operations = [
        migrations.AlterField(
            model_name="coaterrolltag",
            name="status",
            field=models.CharField(
                choices=[
                    ("scheduled", "Scheduled"),
                    ("running", "Running"),
                    ("tag_printed", "Tag Printed"),
                    ("complete", "Complete"),
                    ("on_hold", "On Hold"),
                    ("void", "Void"),
                ],
                default="scheduled",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="materialusage",
            name="job_ticket",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="material_usage_records",
                to="production.jobticket",
            ),
        ),
        migrations.AddField(
            model_name="materialusage",
            name="production_schedule",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="material_usage_records",
                to="production.productionschedule",
            ),
        ),
    ]
