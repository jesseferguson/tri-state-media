from django.db import migrations, models


def add_sales_manager_role(apps, schema_editor):
    CompanyRole = apps.get_model("production", "CompanyRole")
    CompanyRole.objects.update_or_create(
        name="Sales Manager",
        defaults={
            "description": "Quote calculator access with saved quote approval",
            "allowed_resource_keys": ["quote-calculator", "quote-approval"],
            "locked": False,
        },
    )


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0027_add_coater_role"),
    ]

    operations = [
        migrations.AddField(
            model_name="quoterecord",
            name="approval_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="approval_by_name",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="approval_by_role",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="approval_by_user_id",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="approval_note",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="approval_status",
            field=models.CharField(
                choices=[("pending", "Pending Approval"), ("approved", "Approved"), ("rejected", "Rejected")],
                db_index=True,
                default="pending",
                max_length=20,
            ),
        ),
        migrations.RunPython(add_sales_manager_role, migrations.RunPython.noop),
    ]
