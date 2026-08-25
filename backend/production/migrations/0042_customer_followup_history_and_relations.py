import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0041_customer_crm_interactions"),
    ]

    operations = [
        migrations.AddField(
            model_name="customerinteraction",
            name="contact_company",
            field=models.CharField(blank=True, max_length=180),
        ),
        migrations.AddField(
            model_name="customerinteraction",
            name="contact_email",
            field=models.EmailField(blank=True, max_length=254),
        ),
        migrations.AddField(
            model_name="customerinteraction",
            name="contact_first_name",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="customerinteraction",
            name="contact_last_name",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="customerinteraction",
            name="related_job_tickets",
            field=models.ManyToManyField(blank=True, related_name="customer_followups", to="production.jobticket"),
        ),
        migrations.AddField(
            model_name="customerinteraction",
            name="related_quotes",
            field=models.ManyToManyField(blank=True, related_name="customer_followups", to="production.quoterecord"),
        ),
        migrations.CreateModel(
            name="CustomerInteractionHistory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("action", models.CharField(default="updated", max_length=40)),
                ("summary", models.CharField(blank=True, max_length=255)),
                ("performed_by", models.CharField(blank=True, max_length=120)),
                ("changes", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "interaction",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="history_entries",
                        to="production.customerinteraction",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
    ]
