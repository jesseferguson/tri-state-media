from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tooling", "0010_printplate_printstation"),
    ]

    operations = [
        migrations.AddField(
            model_name="supplier",
            name="tags",
            field=models.CharField(
                blank=True,
                help_text="Comma-separated tags such as tooling, material, box, core, shipping.",
                max_length=240,
            ),
        ),
    ]
