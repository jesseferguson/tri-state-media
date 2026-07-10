from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("tooling", "0016_add_offsite_floor_location"),
    ]

    operations = [
        migrations.AddField(
            model_name="flexdie",
            name="tooling_kind",
            field=models.CharField(
                choices=[("flex_die", "Flex Die"), ("rotary_die", "Rotary Die")],
                db_index=True,
                default="flex_die",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="flexdie",
            name="last_order_price",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name="flexdie",
            name="last_quote_price",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name="flexdie",
            name="last_quote_supplier",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="quoted_die_tooling",
                to="tooling.supplier",
            ),
        ),
        migrations.AddField(
            model_name="flexdie",
            name="last_ordered_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="flexdie",
            name="procurement_notes",
            field=models.TextField(blank=True),
        ),
    ]
