from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0015_jobticket_unit_type_and_carton_label"),
    ]

    operations = [
        migrations.AddField(
            model_name="jobticket",
            name="description",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="bagged",
            field=models.CharField(
                choices=[("not_bagged", "Not Bagged"), ("bagged", "Bagged")],
                default="not_bagged",
                max_length=30,
            ),
        ),
    ]
