from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tooling", "0011_supplier_tags"),
    ]

    operations = [
        migrations.AlterField(
            model_name="perfblade",
            name="blade_type",
            field=models.CharField(
                choices=[
                    ("standard", "Standard"),
                    ("offset", "Offset"),
                    ("skip", "Skip"),
                    ("sheeter", "Sheeter"),
                    ("custom", "Custom"),
                ],
                default="standard",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="toolingrecipe",
            name="perf_option",
            field=models.CharField(
                blank=True,
                choices=[
                    ("none", "No Perf"),
                    ("perf", "Perf"),
                    ("sheeted", "Sheeted / Sheeter Cut"),
                ],
                default="none",
                help_text="External perf or sheeter cut between labels. Defaults to No Perf.",
                max_length=20,
            ),
        ),
    ]
