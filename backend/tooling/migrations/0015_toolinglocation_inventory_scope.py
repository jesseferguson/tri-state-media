from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tooling", "0014_add_wilmington_plant_floor"),
    ]

    operations = [
        migrations.AddField(
            model_name="toolinglocation",
            name="inventory_scope",
            field=models.CharField(
                choices=[
                    ("shared", "Shared / All Inventory"),
                    ("finished_product", "Finished Product"),
                    ("raw_material", "Raw Material"),
                ],
                default="shared",
                help_text="Controls whether this location is offered for finished product, raw material, or both.",
                max_length=30,
            ),
        ),
    ]
