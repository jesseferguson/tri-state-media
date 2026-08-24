import datetime

from django.db import migrations, models


def update_plant_reporting_day(apps, schema_editor):
    ProductionShiftSetting = apps.get_model("production", "ProductionShiftSetting")
    ProductionShiftSetting.objects.filter(
        name="Plant Reporting Day",
    ).update(
        shift_start_time=datetime.time(5, 0),
        shift_end_time=datetime.time(2, 20),
        end_on_next_day=True,
    )


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0038_finished_inventory_moved_status"),
    ]

    operations = [
        migrations.AlterField(
            model_name="productionshiftsetting",
            name="shift_start_time",
            field=models.TimeField(default=datetime.time(5, 0)),
        ),
        migrations.AlterField(
            model_name="productionshiftsetting",
            name="shift_end_time",
            field=models.TimeField(default=datetime.time(2, 20)),
        ),
        migrations.RunPython(update_plant_reporting_day, migrations.RunPython.noop),
    ]
