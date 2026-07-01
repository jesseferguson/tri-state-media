from django.db import migrations, models
import django.db.models.deletion


def label_existing_schedules(apps, schema_editor):
    CoaterRollTag = apps.get_model("materials", "CoaterRollTag")
    for schedule in CoaterRollTag.objects.filter(source_schedule__isnull=True, log_inventory=False):
        next_tag = f"CRS-{schedule.pk:06d}"
        schedule.tag_number = next_tag
        schedule.result_serial_number = next_tag
        schedule.result_lot_number = f"LOT-{next_tag}"
        schedule.save(update_fields=["tag_number", "result_serial_number", "result_lot_number"])


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0017_unique_coater_roll_lot"),
    ]

    operations = [
        migrations.AddField(
            model_name="coaterrolltag",
            name="source_schedule",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="produced_rolls",
                to="materials.coaterrolltag",
            ),
        ),
        migrations.RunPython(label_existing_schedules, migrations.RunPython.noop),
    ]
