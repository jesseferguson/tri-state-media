from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tooling", "0018_toolingrecipe_layout_file"),
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
                    ("die_count_adjusted", "Die Count Adjusted"),
                    ("label_printed", "Label Printed"),
                ],
                max_length=40,
            ),
        ),
    ]
