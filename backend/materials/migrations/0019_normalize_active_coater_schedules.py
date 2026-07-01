from django.db import migrations


def normalize_active_schedules(apps, schema_editor):
    CoaterRollTag = apps.get_model("materials", "CoaterRollTag")
    active = CoaterRollTag.objects.filter(
        source_schedule__isnull=True,
        status__in=["scheduled", "running", "on_hold"],
    )
    for schedule in active:
        inventory = schedule.logged_inventory
        schedule.logged_inventory = None
        schedule.log_inventory = False
        schedule.tag_number = f"CRS-{schedule.pk:06d}"
        schedule.result_serial_number = schedule.tag_number
        schedule.result_lot_number = f"LOT-{schedule.tag_number}"
        schedule.save(
            update_fields=[
                "logged_inventory",
                "log_inventory",
                "tag_number",
                "result_serial_number",
                "result_lot_number",
            ]
        )
        if (
            inventory
            and inventory.source_roll_tag_id == schedule.pk
            and inventory.status == "scheduled"
            and str(inventory.notes or "").startswith("Created from coater roll tag")
        ):
            inventory.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("materials", "0018_coater_schedule_roll_relationship"),
    ]

    operations = [
        migrations.RunPython(normalize_active_schedules, migrations.RunPython.noop),
    ]
