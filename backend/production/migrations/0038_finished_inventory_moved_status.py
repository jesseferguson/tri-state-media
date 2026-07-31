from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0037_coater_shift_reports"),
    ]

    operations = [
        migrations.AlterField(
            model_name="finishedinventory",
            name="status",
            field=models.CharField(
                choices=[
                    ("available", "Available"),
                    ("allocated", "Allocated"),
                    ("moved", "Moved"),
                    ("shipped", "Shipped"),
                    ("on_hold", "On Hold"),
                    ("scrapped", "Scrapped"),
                ],
                default="available",
                max_length=20,
            ),
        ),
    ]
