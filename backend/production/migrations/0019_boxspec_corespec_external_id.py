from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0018_jobticket_fanfold_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="boxspec",
            name="external_id",
            field=models.CharField(blank=True, db_index=True, max_length=120),
        ),
        migrations.AddField(
            model_name="corespec",
            name="external_id",
            field=models.CharField(blank=True, db_index=True, max_length=120),
        ),
    ]
