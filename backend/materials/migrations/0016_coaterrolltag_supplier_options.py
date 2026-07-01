import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0015_materialspec_allowed_component_materials"),
    ]

    operations = [
        migrations.AddField(
            model_name="coaterrolltag",
            name="liner_supplier_option",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="coater_liner_tags", to="materials.materialsupplieroption"),
        ),
        migrations.AddField(
            model_name="coaterrolltag",
            name="face_supplier_option",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="coater_face_tags", to="materials.materialsupplieroption"),
        ),
        migrations.AddField(
            model_name="coaterrolltag",
            name="adhesive_supplier_option",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="coater_adhesive_tags", to="materials.materialsupplieroption"),
        ),
        migrations.AddField(
            model_name="coaterrolltag",
            name="silicone_supplier_option",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="coater_silicone_tags", to="materials.materialsupplieroption"),
        ),
        migrations.AddField(
            model_name="coaterrolltag",
            name="coating_supplier_option",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="coater_coating_tags", to="materials.materialsupplieroption"),
        ),
    ]
