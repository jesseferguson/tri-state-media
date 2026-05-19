from django.db import migrations, models
import django.db.models.deletion


def seed_master_types(apps, schema_editor):
    MaterialMasterType = apps.get_model("materials", "MaterialMasterType")
    MaterialSpec = apps.get_model("materials", "MaterialSpec")

    families = (
        MaterialSpec.objects.exclude(material_family="")
        .values_list("material_family", flat=True)
        .distinct()
    )
    by_family = {}
    used_codes = set(MaterialMasterType.objects.values_list("code", flat=True))

    for family in families:
        label = str(family or "").strip()
        if not label:
            continue
        code = "".join(ch if ch.isalnum() else "-" for ch in label.upper()).strip("-")[:50] or "MAT"
        base_code = code
        suffix = 2
        while code in used_codes:
            tail = f"-{suffix}"
            code = f"{base_code[:50 - len(tail)]}{tail}"
            suffix += 1
        master, _ = MaterialMasterType.objects.get_or_create(
            code=code,
            defaults={"name": label, "description": "Created from existing material family data."},
        )
        used_codes.add(master.code)
        by_family[label.lower()] = master.id

    for spec in MaterialSpec.objects.exclude(material_family="").iterator():
        master_id = by_family.get(str(spec.material_family or "").strip().lower())
        if master_id and not spec.master_type_id:
            spec.master_type_id = master_id
            spec.save(update_fields=["master_type"])


def unseed_master_types(apps, schema_editor):
    MaterialSpec = apps.get_model("materials", "MaterialSpec")
    MaterialSpec.objects.update(master_type=None)


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0012_restore_inventory_added_adjustments"),
    ]

    operations = [
        migrations.CreateModel(
            name="MaterialMasterType",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=50, unique=True)),
                ("name", models.CharField(max_length=120)),
                ("description", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["code", "name"],
            },
        ),
        migrations.AddField(
            model_name="materialspec",
            name="master_type",
            field=models.ForeignKey(
                blank=True,
                help_text="Central material type such as PM, PMDT, PET, LPO, or LV. Used to link tickets, inventory, and quoting.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="material_specs",
                to="materials.materialmastertype",
            ),
        ),
        migrations.RunPython(seed_master_types, unseed_master_types),
    ]
