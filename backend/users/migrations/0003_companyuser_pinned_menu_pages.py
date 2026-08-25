from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0002_companyuser_default_landing_page"),
    ]

    operations = [
        migrations.AddField(
            model_name="companyuser",
            name="pinned_menu_pages",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
