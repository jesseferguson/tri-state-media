from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0019_boxspec_corespec_external_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="jobticket",
            name="external_image_url",
            field=models.URLField(blank=True, max_length=1000),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="external_image_source",
            field=models.CharField(blank=True, max_length=80),
        ),
    ]
