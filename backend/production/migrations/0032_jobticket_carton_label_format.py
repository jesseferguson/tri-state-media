from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0031_locallivefootagereading"),
    ]

    operations = [
        migrations.AddField(
            model_name="jobticket",
            name="carton_label_is_unique",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="carton_label_format",
            field=models.CharField(
                choices=[
                    ("standard", "Standard Carton"),
                    ("dow_carton", "DOW Carton"),
                    ("dow_closure", "DOW Closure"),
                    ("customer_label", "Customer Label"),
                    ("bcl", "BCL"),
                    ("abe", "ABE"),
                    ("clopay", "Clopay"),
                    ("variable_barcode", "Variable Barcode"),
                    ("camslide", "Camslide"),
                ],
                default="standard",
                max_length=30,
            ),
        ),
    ]
