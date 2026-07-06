from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0021_skid_rack_tracking"),
        ("tooling", "0014_add_wilmington_plant_floor"),
    ]

    operations = [
        migrations.AddField(
            model_name="materialrack",
            name="location",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="material_racks",
                to="tooling.toolinglocation",
            ),
        ),
    ]
