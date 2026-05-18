from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0010_quotecostrate_jobticket_labels_per_carton_and_more"),
    ]

    operations = [
        migrations.RenameField(
            model_name="quotefinishedmaterial",
            old_name="target_margin_percent",
            new_name="target_markup_percent",
        ),
    ]
