from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0024_coater_suboperator_lot_reuse"),
    ]

    operations = [
        migrations.AddField(
            model_name="coaterrolltag",
            name="press_sequence",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
