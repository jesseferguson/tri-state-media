from django.db import migrations


def add_material_handling_access(apps, schema_editor):
    CompanyRole = apps.get_model("production", "CompanyRole")
    for name in ["Coater", "Production"]:
        role = CompanyRole.objects.filter(name__iexact=name).first()
        if not role:
            continue
        keys = list(role.allowed_resource_keys or [])
        if "material-handling" not in keys:
            keys.append("material-handling")
            role.allowed_resource_keys = keys
            role.save(update_fields=["allowed_resource_keys"])


class Migration(migrations.Migration):
    dependencies = [
        ("production", "0032_jobticket_carton_label_format"),
    ]

    operations = [
        migrations.RunPython(add_material_handling_access, migrations.RunPython.noop),
    ]
