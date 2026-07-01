from django.db import migrations, models


def populate_unique_roll_lots(apps, schema_editor):
    CoaterRollTag = apps.get_model("materials", "CoaterRollTag")
    used = set()

    for tag in CoaterRollTag.objects.order_by("id").iterator():
        base = str(tag.result_lot_number or "").strip() or f"LOT-{tag.tag_number or f'CRT-{tag.pk:06d}'}"
        candidate = base
        if candidate.lower() in used:
            candidate = f"{base}-{tag.tag_number or tag.pk}"
        suffix = 2
        while candidate.lower() in used:
            candidate = f"{base}-{tag.tag_number or tag.pk}-{suffix}"
            suffix += 1
        used.add(candidate.lower())
        if tag.result_lot_number != candidate:
            tag.result_lot_number = candidate
            tag.save(update_fields=["result_lot_number"])


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0016_coaterrolltag_supplier_options"),
    ]

    operations = [
        migrations.RunPython(populate_unique_roll_lots, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="coaterrolltag",
            name="result_lot_number",
            field=models.CharField(blank=True, max_length=80, unique=True),
        ),
    ]
