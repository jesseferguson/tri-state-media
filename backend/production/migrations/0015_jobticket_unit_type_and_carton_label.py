from django.db import migrations, models


def backfill_units_per_carton(apps, schema_editor):
    JobTicket = apps.get_model("production", "JobTicket")
    JobTicket.objects.filter(units_per_carton__isnull=True, labels_per_carton__isnull=False).update(
        units_per_carton=models.F("labels_per_carton")
    )


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0014_jobticketevent"),
    ]

    operations = [
        migrations.AddField(
            model_name="jobticket",
            name="unit_type",
            field=models.CharField(
                choices=[("label", "Label"), ("tag", "Tag")],
                default="label",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="ribbon",
            field=models.CharField(
                choices=[("no_ribbon", "No Ribbon"), ("ribbon", "Ribbon")],
                default="no_ribbon",
                max_length=40,
            ),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="laminate",
            field=models.CharField(
                choices=[("no_laminate", "No Laminate"), ("laminate", "Laminate")],
                default="no_laminate",
                max_length=40,
            ),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="carton_label_part_number",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="carton_label_description_a",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="carton_label_description_b",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="carton_label_description_c",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="carton_label_finishing_1",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="carton_label_finishing_2",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.RunPython(backfill_units_per_carton, migrations.RunPython.noop),
    ]
