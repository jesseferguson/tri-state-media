from django.db import migrations


def add_storage_tracking_access(apps, schema_editor):
    CompanyRole = apps.get_model("production", "CompanyRole")
    for role in CompanyRole.objects.all():
        keys = list(role.allowed_resource_keys or [])
        if "material-handling" not in keys and role.name.lower() not in {"admin", "production", "coater"}:
            continue
        changed = False
        for key in ["skids", "racks"]:
            if key not in keys:
                keys.append(key)
                changed = True
        if changed:
            role.allowed_resource_keys = keys
            role.save(update_fields=["allowed_resource_keys"])


class Migration(migrations.Migration):
    dependencies = [
        ("production", "0035_add_footage_report_access"),
    ]

    operations = [
        migrations.RunPython(add_storage_tracking_access, migrations.RunPython.noop),
    ]
