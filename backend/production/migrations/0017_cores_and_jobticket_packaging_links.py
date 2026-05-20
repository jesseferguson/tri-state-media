from django.db import migrations, models
import django.db.models.deletion


def backfill_job_ticket_packaging(apps, schema_editor):
    JobTicket = apps.get_model("production", "JobTicket")
    for ticket in JobTicket.objects.select_related("box").iterator():
        changed = []
        if ticket.box_id and not ticket.box_item_number:
            ticket.box_item_number = ticket.box.item_number
            changed.append("box_item_number")
        if changed:
            ticket.save(update_fields=changed)


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0016_jobticket_description_bagged"),
    ]

    operations = [
        migrations.CreateModel(
            name="CoreSpec",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=150)),
                ("item_number", models.CharField(blank=True, max_length=80)),
                ("supplier", models.CharField(blank=True, max_length=150)),
                ("core_size_inches", models.DecimalField(blank=True, decimal_places=3, max_digits=6, null=True)),
                ("notes", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
            ],
            options={
                "ordering": ["supplier", "core_size_inches", "name", "item_number"],
            },
        ),
        migrations.CreateModel(
            name="CoreInventory",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("lot_number", models.CharField(blank=True, max_length=80)),
                ("quantity", models.DecimalField(decimal_places=3, default=0, max_digits=12)),
                ("status", models.CharField(choices=[("available", "Available"), ("scheduled", "Scheduled"), ("allocated", "Allocated"), ("on_hold", "On Hold"), ("depleted", "Depleted"), ("scrapped", "Scrapped")], default="available", max_length=20)),
                ("received_date", models.DateField(blank=True, null=True)),
                ("notes", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("core", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="inventory", to="production.corespec")),
                ("location", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="core_inventory", to="tooling.toolinglocation")),
            ],
            options={
                "ordering": ["core__core_size_inches", "core__name", "lot_number"],
            },
        ),
        migrations.AddField(
            model_name="jobticket",
            name="box_item_number",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="core",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="job_tickets", to="production.corespec"),
        ),
        migrations.RunPython(backfill_job_ticket_packaging, migrations.RunPython.noop),
    ]
