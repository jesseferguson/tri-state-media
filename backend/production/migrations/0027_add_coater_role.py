from django.db import migrations


def add_coater_role(apps, schema_editor):
    CompanyRole = apps.get_model("production", "CompanyRole")
    CompanyRole.objects.update_or_create(
        name="Coater",
        defaults={
            "description": "Coater operator lineup and roll tag workflow",
            "allowed_resource_keys": ["coater-operator"],
            "locked": False,
        },
    )


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0026_companyuser_quoterecord_quote_company"),
    ]

    operations = [
        migrations.RunPython(add_coater_role, migrations.RunPython.noop),
    ]
