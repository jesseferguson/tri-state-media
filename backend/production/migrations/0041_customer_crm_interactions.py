import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0040_move_company_access_to_users_app"),
    ]

    operations = [
        migrations.AddField(
            model_name="customer",
            name="account_owner",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="customer",
            name="crm_stage",
            field=models.CharField(
                choices=[
                    ("active", "Active"),
                    ("prospect", "Prospect"),
                    ("onboarding", "Onboarding"),
                    ("watch", "Watch"),
                    ("inactive", "Inactive"),
                ],
                db_index=True,
                default="active",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="customer",
            name="last_contacted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="customer",
            name="next_follow_up",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="customer",
            name="source_sheet_url",
            field=models.URLField(blank=True, max_length=1000),
        ),
        migrations.AddField(
            model_name="customer",
            name="website",
            field=models.URLField(blank=True, max_length=500),
        ),
        migrations.CreateModel(
            name="CustomerInteraction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "interaction_type",
                    models.CharField(
                        choices=[
                            ("note", "Note"),
                            ("email", "Email"),
                            ("call", "Call"),
                            ("meeting", "Meeting"),
                            ("task", "Task"),
                            ("status", "Status Update"),
                            ("job_comment", "Job Comment"),
                        ],
                        default="note",
                        max_length=30,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("open", "Open"),
                            ("waiting_customer", "Waiting on Customer"),
                            ("waiting_internal", "Waiting Internally"),
                            ("scheduled", "Scheduled"),
                            ("closed", "Closed"),
                        ],
                        db_index=True,
                        default="open",
                        max_length=30,
                    ),
                ),
                ("subject", models.CharField(max_length=180)),
                ("body", models.TextField(blank=True)),
                ("email_from", models.EmailField(blank=True, max_length=254)),
                ("email_to", models.TextField(blank=True)),
                ("email_subject", models.CharField(blank=True, max_length=255)),
                ("email_url", models.URLField(blank=True, max_length=1000)),
                ("email_message_id", models.CharField(blank=True, max_length=255)),
                ("occurred_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("follow_up_date", models.DateField(blank=True, db_index=True, null=True)),
                ("pinned", models.BooleanField(default=False)),
                ("created_by", models.CharField(blank=True, max_length=120)),
                ("updated_by", models.CharField(blank=True, max_length=120)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "customer",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="interactions",
                        to="production.customer",
                    ),
                ),
                (
                    "customer_order",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="customer_interactions",
                        to="production.customerorder",
                    ),
                ),
                (
                    "job_ticket",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="customer_interactions",
                        to="production.jobticket",
                    ),
                ),
                (
                    "quote",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="customer_interactions",
                        to="production.quoterecord",
                    ),
                ),
            ],
            options={
                "ordering": ["-pinned", "-occurred_at", "-id"],
            },
        ),
    ]
