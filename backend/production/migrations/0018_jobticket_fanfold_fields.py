from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0017_cores_and_jobticket_packaging_links"),
    ]

    operations = [
        migrations.AddField(
            model_name="jobticket",
            name="fanfold_gear",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="labels_per_fold",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
