from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tooling", "0012_sheeted_layout_and_sheeter_blades"),
    ]

    operations = [
        migrations.AddField(
            model_name="press",
            name="printer_darkness",
            field=models.CharField(blank=True, default="11", max_length=20),
        ),
        migrations.AddField(
            model_name="press",
            name="printer_ip",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="press",
            name="printer_port",
            field=models.PositiveIntegerField(default=9100),
        ),
        migrations.AddField(
            model_name="press",
            name="printer_queue_key",
            field=models.CharField(blank=True, help_text="Firebase print queue key used by the ESP32 print server for this press.", max_length=80),
        ),
        migrations.AddField(
            model_name="press",
            name="printer_speed",
            field=models.CharField(blank=True, default="5", max_length=20),
        ),
    ]
