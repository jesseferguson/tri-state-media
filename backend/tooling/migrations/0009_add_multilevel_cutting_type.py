from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tooling", "0008_flexdie_active_die_count_flexdie_dieline_image_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="flexdie",
            name="cutting_type",
            field=models.CharField(
                choices=[
                    ("to_liner", "To Liner"),
                    ("metal_to_metal", "Metal to Metal"),
                    ("multilevel", "Multilevel"),
                    ("score", "Score"),
                    ("special", "Special"),
                ],
                default="to_liner",
                max_length=30,
            ),
        ),
        migrations.AlterField(
            model_name="toolingrecipe",
            name="cutting_type",
            field=models.CharField(
                choices=[
                    ("to_liner", "To Liner"),
                    ("metal_to_metal", "Metal to Metal"),
                    ("multilevel", "Multilevel"),
                    ("score", "Score"),
                    ("special", "Special"),
                ],
                default="to_liner",
                max_length=30,
            ),
        ),
    ]
