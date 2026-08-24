from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0039_update_shift_window_defaults"),
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.DeleteModel(name="CompanyUser"),
                migrations.DeleteModel(name="CompanyRole"),
            ],
        ),
    ]
