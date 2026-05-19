from django.db import migrations, models
import django.db.models.deletion


def seed_job_ticket_master_types(apps, schema_editor):
    JobTicket = apps.get_model("production", "JobTicket")
    for ticket in JobTicket.objects.select_related("material_spec").iterator():
        if ticket.material_master_type_id or not ticket.material_spec_id:
            continue
        master_id = getattr(ticket.material_spec, "master_type_id", None)
        if master_id:
            ticket.material_master_type_id = master_id
            ticket.save(update_fields=["material_master_type"])


def clear_job_ticket_master_types(apps, schema_editor):
    JobTicket = apps.get_model("production", "JobTicket")
    JobTicket.objects.update(material_master_type=None)


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0013_materialmastertype_materialspec_master_type"),
        ("production", "0012_jobticket_finishing_image_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="quotefinishedmaterial",
            name="material_master_type",
            field=models.ForeignKey(
                blank=True,
                help_text="Central material type this quote material prices, such as PM or PET.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="quote_finished_materials",
                to="materials.materialmastertype",
            ),
        ),
        migrations.AddField(
            model_name="jobticket",
            name="material_master_type",
            field=models.ForeignKey(
                blank=True,
                help_text="Central material type used to connect this job to quoting and matching inventory.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="job_tickets",
                to="materials.materialmastertype",
            ),
        ),
        migrations.RunPython(seed_job_ticket_master_types, clear_job_ticket_master_types),
    ]
