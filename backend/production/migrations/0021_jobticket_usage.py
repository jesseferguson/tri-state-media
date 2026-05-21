from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0020_jobticket_external_image"),
    ]

    operations = [
        migrations.AddField(
            model_name="jobticket",
            name="legacy_row_id",
            field=models.CharField(blank=True, db_index=True, max_length=120),
        ),
        migrations.CreateModel(
            name="JobTicketUsage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("legacy_job_ticket_id", models.CharField(blank=True, db_index=True, max_length=120)),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                ("quantity", models.DecimalField(decimal_places=3, default=0, max_digits=12)),
                ("source", models.CharField(blank=True, default="Glide", max_length=80)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "job_ticket",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="usage_records",
                        to="production.jobticket",
                    ),
                ),
            ],
            options={
                "ordering": ["-used_at", "-id"],
            },
        ),
    ]
