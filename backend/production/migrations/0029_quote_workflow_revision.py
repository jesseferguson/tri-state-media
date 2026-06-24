from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0028_quote_approval_sales_manager"),
    ]

    operations = [
        migrations.AddField(
            model_name="quoterecord",
            name="workflow_status",
            field=models.CharField(
                choices=[("active", "Active"), ("processed", "Processed")],
                db_index=True,
                default="active",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="processed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="processed_by_user_id",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="processed_by_name",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="processed_by_role",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="last_edited_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="last_edited_by_user_id",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="last_edited_by_name",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="last_edited_by_role",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="quoterecord",
            name="edit_count",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
