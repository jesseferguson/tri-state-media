from django.db import migrations


def add_footage_report_access(apps, schema_editor):
    CompanyRole = apps.get_model("production", "CompanyRole")
    for name in ["CSR", "Production"]:
        role = CompanyRole.objects.filter(name__iexact=name).first()
        if not role:
            continue
        keys = list(role.allowed_resource_keys or [])
        if "footage-reports" not in keys:
            keys.append("footage-reports")
            role.allowed_resource_keys = keys
            role.save(update_fields=["allowed_resource_keys"])


class Migration(migrations.Migration):
    dependencies = [
        ("production", "0034_production_material_and_shift_workflow"),
    ]

    operations = [
        migrations.RunPython(add_footage_report_access, migrations.RunPython.noop),
    ]
