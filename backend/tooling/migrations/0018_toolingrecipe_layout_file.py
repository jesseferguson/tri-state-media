from django.db import migrations, models

import tooling.models


class Migration(migrations.Migration):
    dependencies = [
        ("tooling", "0017_flexdie_tooling_kind_and_procurement"),
    ]

    operations = [
        migrations.AddField(
            model_name="toolingrecipe",
            name="layout_file",
            field=models.FileField(blank=True, null=True, upload_to=tooling.models.tooling_recipe_layout_upload_path),
        ),
        migrations.AddField(
            model_name="toolingrecipe",
            name="layout_file_name",
            field=models.CharField(blank=True, max_length=180),
        ),
    ]
