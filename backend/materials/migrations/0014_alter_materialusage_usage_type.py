from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0013_materialmastertype_materialspec_master_type"),
    ]

    operations = [
        migrations.AlterField(
            model_name="materialusage",
            name="usage_type",
            field=models.CharField(
                choices=[
                    ("checkout", "Checked Out"),
                    ("returned", "Returned"),
                    ("qc_issue", "QC Issue"),
                    ("coater", "Coater"),
                    ("finished", "Finished Production"),
                    ("shipped", "Shipped Finished Stock"),
                    ("manual", "Manual Consumption"),
                    ("scrap", "Scrap"),
                    ("adjustment", "Adjustment"),
                ],
                default="manual",
                max_length=30,
            ),
        ),
    ]
