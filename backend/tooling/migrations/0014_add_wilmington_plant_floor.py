from django.db import migrations


def add_wilmington_plant_floor(apps, schema_editor):
    ToolingLocation = apps.get_model("tooling", "ToolingLocation")
    wilmington = ToolingLocation.objects.filter(name__iexact="Wilmington Ohio").first()
    if not wilmington:
        wilmington = ToolingLocation.objects.create(
            name="Wilmington Ohio",
            code="WILMINGTON-OHIO",
            location_type="shop",
        )

    plant_floor = ToolingLocation.objects.filter(
        parent=wilmington,
        name__iexact="Plant Floor",
    ).first()
    if plant_floor:
        plant_floor.location_type = "position"
        plant_floor.is_active = True
        plant_floor.save(update_fields=["location_type", "is_active"])
    else:
        ToolingLocation.objects.update_or_create(
            code="WILMINGTON-PLANT-FLOOR",
            defaults={
                "name": "Plant Floor",
                "location_type": "position",
                "parent": wilmington,
                "is_active": True,
            },
        )


class Migration(migrations.Migration):
    dependencies = [
        ("tooling", "0013_press_printer_settings"),
    ]

    operations = [
        migrations.RunPython(add_wilmington_plant_floor, migrations.RunPython.noop),
    ]
