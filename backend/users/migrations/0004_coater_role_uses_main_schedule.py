from django.db import migrations


def coater_role_uses_main_schedule(apps, schema_editor):
    CompanyRole = apps.get_model("users", "CompanyRole")
    role = CompanyRole.objects.filter(name__iexact="Coater").first()
    if not role:
        return
    keys = list(role.allowed_resource_keys or [])
    for key in ["production-schedule", "coater-operator", "material-handling", "skids", "racks"]:
        if key not in keys:
            keys.append(key)
    role.allowed_resource_keys = keys
    role.save(update_fields=["allowed_resource_keys", "updated_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0003_companyuser_pinned_menu_pages"),
    ]

    operations = [
        migrations.RunPython(coater_role_uses_main_schedule, migrations.RunPython.noop),
    ]
