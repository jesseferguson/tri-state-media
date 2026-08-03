from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("tooling", "0019_toolinghistory_label_printed_event"),
    ]

    operations = [
        migrations.AlterField(
            model_name="toolinghistory",
            name="event_type",
            field=models.CharField(
                choices=[
                    ("created", "Created"),
                    ("moved", "Moved"),
                    ("installed_on_press", "Installed on Press"),
                    ("removed_from_press", "Removed from Press"),
                    ("sent_to_supplier", "Sent to Supplier"),
                    ("returned_from_supplier", "Returned from Supplier"),
                    ("repair", "Repair"),
                    ("retool", "Retool"),
                    ("status_change", "Status Change"),
                    ("inspection", "Inspection"),
                    ("note", "Note"),
                    ("retired", "Retired"),
                    ("die_reorder_requested", "Die Reorder Requested"),
                    ("die_ordered", "Die Ordered"),
                    ("die_received", "Die Received"),
                    ("die_request_closed", "Die Request Closed"),
                    ("die_count_adjusted", "Die Count Adjusted"),
                    ("label_printed", "Label Printed"),
                ],
                max_length=40,
            ),
        ),
        migrations.CreateModel(
            name="FlexDieRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(choices=[("requested", "Requested"), ("ordered", "Ordered"), ("received", "Received"), ("closed_without_order", "Closed Without Order")], db_index=True, default="requested", max_length=40)),
                ("requested_by", models.CharField(blank=True, max_length=100)),
                ("request_notes", models.TextField(blank=True)),
                ("ordered_by", models.CharField(blank=True, max_length=100)),
                ("ordered_notes", models.TextField(blank=True)),
                ("ordered_at", models.DateTimeField(blank=True, null=True)),
                ("received_by", models.CharField(blank=True, max_length=100)),
                ("received_notes", models.TextField(blank=True)),
                ("received_serial_number", models.CharField(blank=True, max_length=100)),
                ("received_quantity", models.PositiveIntegerField(default=0)),
                ("received_at", models.DateTimeField(blank=True, null=True)),
                ("closed_by", models.CharField(blank=True, max_length=100)),
                ("closed_reason", models.TextField(blank=True)),
                ("closed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("flex_die", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="requests", to="tooling.flexdie")),
            ],
            options={
                "ordering": ["-updated_at", "-created_at"],
            },
        ),
    ]
