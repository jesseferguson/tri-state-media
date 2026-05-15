from decimal import Decimal

from django.db import migrations
from django.db.models import Sum


def restore_inventory_added_adjustments(apps, schema_editor):
    RawMaterialInventory = apps.get_model("materials", "RawMaterialInventory")
    MaterialUsage = apps.get_model("materials", "MaterialUsage")

    added_rows = (
        MaterialUsage.objects.filter(
            usage_type="adjustment",
            reference="Inventory added",
            inventory__isnull=False,
        )
        .values("inventory_id")
        .annotate(total=Sum("quantity"))
    )

    consuming_types = ["checkout", "manual", "coater", "finished", "scrap"]

    for row in added_rows:
        inventory = RawMaterialInventory.objects.filter(pk=row["inventory_id"]).first()
        if not inventory:
            continue

        has_later_consumption = MaterialUsage.objects.filter(
            inventory_id=inventory.pk,
            usage_type__in=consuming_types,
        ).exclude(usage_type="adjustment", reference="Inventory added").exists()
        if has_later_consumption:
            continue

        current_quantity = Decimal(inventory.quantity or 0)
        current_feet = Decimal(inventory.length_feet or 0)
        if current_quantity > 0 or current_feet > 0:
            continue

        restored = Decimal(row["total"] or 0)
        if restored <= 0:
            continue

        inventory.quantity = restored
        if inventory.unit == "lf":
            inventory.length_feet = restored
        if inventory.status in ["depleted", "in_use"]:
            inventory.status = "available"
        inventory.save(update_fields=["quantity", "length_feet", "status"])


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0011_materialsupplieroption"),
    ]

    operations = [
        migrations.RunPython(restore_inventory_added_adjustments, migrations.RunPython.noop),
    ]
