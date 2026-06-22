from django.db import migrations, models


def seed_allowed_components(apps, schema_editor):
    MaterialSpec = apps.get_model("materials", "MaterialSpec")
    component_pairs = [
        ("face_material_id", "allowed_face_materials"),
        ("liner_material_id", "allowed_liner_materials"),
        ("adhesive_material_id", "allowed_adhesive_materials"),
        ("silicone_material_id", "allowed_silicone_materials"),
        ("coating_material_id", "allowed_coating_materials"),
    ]
    for material in MaterialSpec.objects.filter(material_type="coated_stock").iterator():
        for field_name, relation_name in component_pairs:
            component_id = getattr(material, field_name, None)
            if component_id:
                getattr(material, relation_name).add(component_id)


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0014_alter_materialusage_usage_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="materialspec",
            name="allowed_face_materials",
            field=models.ManyToManyField(
                blank=True,
                help_text="Face data types this finished raw material may be made with.",
                limit_choices_to={"material_type": "face"},
                related_name="compatible_face_finished_materials",
                symmetrical=False,
                to="materials.materialspec",
            ),
        ),
        migrations.AddField(
            model_name="materialspec",
            name="allowed_liner_materials",
            field=models.ManyToManyField(
                blank=True,
                help_text="Liner data types this finished raw material may be made with.",
                limit_choices_to={"material_type": "liner"},
                related_name="compatible_liner_finished_materials",
                symmetrical=False,
                to="materials.materialspec",
            ),
        ),
        migrations.AddField(
            model_name="materialspec",
            name="allowed_adhesive_materials",
            field=models.ManyToManyField(
                blank=True,
                help_text="Adhesive data types this finished raw material may be made with.",
                limit_choices_to={"material_type": "adhesive"},
                related_name="compatible_adhesive_finished_materials",
                symmetrical=False,
                to="materials.materialspec",
            ),
        ),
        migrations.AddField(
            model_name="materialspec",
            name="allowed_silicone_materials",
            field=models.ManyToManyField(
                blank=True,
                help_text="Silicone data types this finished raw material may be made with.",
                limit_choices_to={"material_type": "silicone"},
                related_name="compatible_silicone_finished_materials",
                symmetrical=False,
                to="materials.materialspec",
            ),
        ),
        migrations.AddField(
            model_name="materialspec",
            name="allowed_coating_materials",
            field=models.ManyToManyField(
                blank=True,
                help_text="Coating or varnish data types this finished raw material may be made with.",
                limit_choices_to={"material_type": "coating"},
                related_name="compatible_coating_finished_materials",
                symmetrical=False,
                to="materials.materialspec",
            ),
        ),
        migrations.RunPython(seed_allowed_components, migrations.RunPython.noop),
    ]
