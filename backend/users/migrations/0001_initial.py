import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("production", "0039_update_shift_window_defaults"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.CreateModel(
                    name="CompanyRole",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("name", models.CharField(max_length=80, unique=True)),
                        ("description", models.CharField(blank=True, max_length=255)),
                        ("allowed_resource_keys", models.JSONField(blank=True, default=list)),
                        ("locked", models.BooleanField(default=False)),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                    ],
                    options={
                        "db_table": "production_companyrole",
                        "ordering": ["name"],
                    },
                ),
                migrations.CreateModel(
                    name="CompanyUser",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("username", models.CharField(max_length=80, unique=True)),
                        ("name", models.CharField(max_length=150)),
                        ("password_hash", models.CharField(max_length=255)),
                        (
                            "quote_company",
                            models.CharField(
                                choices=[("tri_state_media", "Tri-State Media"), ("barcode_labels", "Barcode Labels")],
                                default="tri_state_media",
                                max_length=40,
                            ),
                        ),
                        ("active", models.BooleanField(default=True)),
                        ("created_at", models.DateTimeField(auto_now_add=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                        (
                            "role",
                            models.ForeignKey(
                                on_delete=django.db.models.deletion.PROTECT,
                                related_name="users",
                                to="users.companyrole",
                            ),
                        ),
                    ],
                    options={
                        "db_table": "production_companyuser",
                        "ordering": ["name", "username"],
                    },
                ),
            ],
        ),
    ]
