from django.db import migrations


def add_offsite_floor_location(apps, schema_editor):
    ToolingLocation = apps.get_model("tooling", "ToolingLocation")
    wilmington = (
        ToolingLocation.objects.filter(code="WILMINGTON-OHIO").first()
        or ToolingLocation.objects.filter(name__iexact="Wilmington Ohio", parent__isnull=True).first()
        or ToolingLocation(code="WILMINGTON-OHIO")
    )
    wilmington.code = "WILMINGTON-OHIO"
    wilmington.name = "Wilmington Ohio"
    wilmington.location_type = "shop"
    wilmington.inventory_scope = "shared"
    wilmington.is_active = True
    wilmington.save()

    for code, name in [
        ("WILMINGTON-PLANT-FLOOR", "Plant Floor"),
        ("WILMINGTON-OFFSITE-FLOOR", "Off-Site Floor"),
    ]:
        location = (
            ToolingLocation.objects.filter(code=code).first()
            or ToolingLocation.objects.filter(name__iexact=name, parent=wilmington).first()
            or ToolingLocation(code=code)
        )
        location.code = code
        location.name = name
        location.location_type = "position"
        location.inventory_scope = "raw_material"
        location.parent = wilmington
        location.is_active = True
        location.save()


class Migration(migrations.Migration):
    dependencies = [
        ("tooling", "0015_toolinglocation_inventory_scope"),
    ]

    operations = [
        migrations.RunPython(add_offsite_floor_location, migrations.RunPython.noop),
    ]
