from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0030_messagethread_message"),
    ]

    operations = [
        migrations.CreateModel(
            name="LocalLiveFootageReading",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("press_key", models.CharField(db_index=True, max_length=40)),
                ("press_name", models.CharField(blank=True, max_length=120)),
                ("kind", models.CharField(choices=[("speed", "Speed"), ("footage", "Footage")], db_index=True, max_length=20)),
                ("speed_fpm", models.PositiveIntegerField(blank=True, null=True)),
                ("footage", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("device_timestamp", models.PositiveIntegerField(blank=True, null=True)),
                ("source_ip", models.GenericIPAddressField(blank=True, null=True)),
                ("recorded_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["-recorded_at", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="locallivefootagereading",
            index=models.Index(fields=["press_key", "kind", "-recorded_at"], name="production__press_k_69e66b_idx"),
        ),
        migrations.AddIndex(
            model_name="locallivefootagereading",
            index=models.Index(fields=["kind", "recorded_at"], name="production__kind_3398fa_idx"),
        ),
    ]
