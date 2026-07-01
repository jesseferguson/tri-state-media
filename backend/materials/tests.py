import json
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from production.models import JobTicket, ProductionSchedule
from tooling.models import Press

from .models import CoaterRollTag, MaterialSpec, MaterialSupplierOption, MaterialUsage, RawMaterialInventory


class CoaterRollTagPrintQueueTests(TestCase):
    class FirebaseResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return b'{"name":"roll-print-1"}'

    def test_roll_tag_print_uses_manufacturing_and_printer_data(self):
        face = MaterialSpec.objects.create(material_type="face", code="FACE-PM", name="PM Face", material_family="PM")
        liner = MaterialSpec.objects.create(material_type="liner", code="LINER-40", name="40 Liner", material_family="40")
        adhesive = MaterialSpec.objects.create(material_type="adhesive", code="ADH-3180", name="3180 Adhesive", material_family="3180")
        silicone = MaterialSpec.objects.create(material_type="silicone", code="SIL-EASY", name="Easy Release", material_family="Easy Release")
        produced = MaterialSpec.objects.create(material_type="coated_stock", code="PM-2417-40", name="PM-2417-40")
        face_supplier = MaterialSupplierOption.objects.create(
            material=face,
            supplier_name="Face Supply Co",
            option_name="PM Face Stock",
            supplier_item_number="FACE-100",
            thickness_mil=Decimal("2.5"),
            width_inches=Decimal("13"),
        )
        press = Press.objects.create(
            name="ETI",
            printer_ip="192.168.1.70",
            printer_port=9100,
            printer_speed="6",
            printer_darkness="13",
            printer_queue_key="ETI",
        )
        tag = CoaterRollTag.objects.create(
            name="PM-2417-40",
            status="complete",
            print_status="not_printed",
            face=face,
            liner=liner,
            adhesive=adhesive,
            silicone=silicone,
            face_supplier_option=face_supplier,
            produced_material=produced,
            result_code="PM-2417-40",
            result_serial_number="CRT-TEST-1",
            result_lot_number="LOT-2026-1",
            width_inches=Decimal("13"),
            length_feet=Decimal("5000"),
            operator="ET Operator",
            press=press,
            log_inventory=False,
        )

        with patch("production.views.urlopen", return_value=self.FirebaseResponse()) as mocked_urlopen:
            response = self.client.post(
                reverse("coater-roll-tag-queue-print-label", args=[tag.id]),
                {
                    "copies": 2,
                    "printer_ip": "192.168.1.72",
                    "printer_port": 9101,
                    "speed": "8",
                    "darkness": "15",
                    "save_printer_settings": True,
                    "performed_by": "ET Operator",
                    "frontend_url": "https://plant.example.com",
                },
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 201, response.content)
        firebase_request = mocked_urlopen.call_args.args[0]
        body = json.loads(firebase_request.data.decode("utf-8"))
        self.assertIn("/TEST_PRINT_SERVER_JOBS/SHARED.json", firebase_request.full_url)
        self.assertEqual(body["TYPE"], "COATER")
        self.assertEqual(body["Printer"], "192.168.1.72")
        self.assertEqual(body["Printer Port"], 9101)
        self.assertEqual(body["SPEED"], "8")
        self.assertEqual(body["DARKNESS"], "15")
        self.assertEqual(body["Total Ship Stock"], 2)
        self.assertEqual(body["Part Number List Logic"], "PM-40-3180")
        self.assertIn("PM", body["Face"])
        self.assertIn("Face Supply Co", body["Face"])
        self.assertIn("FACE-100", body["Face"])
        self.assertEqual(body["Face"], "PM - Face Supply Co - FACE-100")
        self.assertEqual(body["Width"], '13"')
        self.assertEqual(body["Lot Number"], "LOT-2026-1")
        self.assertEqual(body["ID"], "CRT-TEST-1")
        self.assertEqual(body["Roll Tag URL"], f"https://plant.example.com/?rollTagId={tag.id}")
        self.assertIn("Easy Release", body["Note"])
        tag.refresh_from_db()
        self.assertEqual(tag.print_status, "queued")
        press.refresh_from_db()
        self.assertEqual(press.printer_ip, "192.168.1.72")
        self.assertEqual(press.printer_port, 9101)
        self.assertEqual(press.printer_speed, "8")
        self.assertEqual(press.printer_darkness, "15")
        self.assertTrue(response.json()["printerSettingsSaved"])

    def test_finished_material_schedule_payload_creates_coater_job(self):
        face = MaterialSpec.objects.create(material_type="face", code="FACE-SCHEDULE", name="PM Face")
        liner = MaterialSpec.objects.create(material_type="liner", code="LINER-SCHEDULE", name="40 Liner", material_family="40")
        adhesive = MaterialSpec.objects.create(material_type="adhesive", code="ADH-SCHEDULE", name="3180 Adhesive", material_family="3180")
        silicone = MaterialSpec.objects.create(material_type="silicone", code="SIL-SCHEDULE", name="Easy Release")
        material = MaterialSpec.objects.create(material_type="coated_stock", code="PM-SCHEDULE", name="PM")
        material.allowed_face_materials.add(face)
        material.allowed_liner_materials.add(liner)
        material.allowed_adhesive_materials.add(adhesive)
        material.allowed_silicone_materials.add(silicone)
        press = Press.objects.create(name="ETI Schedule", printer_ip="192.168.1.71")

        response = self.client.post(
            reverse("coater-roll-tag-list"),
            {
                "name": material.name,
                "status": "scheduled",
                "print_status": "not_printed",
                "scheduled_by": "Scheduler",
                "scheduled_material": material.id,
                "produced_material": material.id,
                "liner": liner.id,
                "face": face.id,
                "adhesive": adhesive.id,
                "silicone": silicone.id,
                "result_code": material.code,
                "length_feet": 150000,
                "run_date": "2026-06-30",
                "cut_description": "Cut 9/9",
                "operator_notes": "Run easy release",
                "press": press.id,
                "log_inventory": False,
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.json()["tag_number"].startswith("CRS-"))
        self.assertEqual(response.json()["result_lot_number"], f"LOT-{response.json()['tag_number']}")
        self.assertEqual(response.json()["press"], press.id)
        self.assertEqual(response.json()["cut_description"], "Cut 9/9")

        schedule_id = response.json()["id"]
        first_roll = self.client.post(
            reverse("coater-roll-tag-create-roll", args=[schedule_id]),
            {
                "liner": liner.id,
                "face": face.id,
                "adhesive": adhesive.id,
                "silicone": silicone.id,
                "width_inches": 13,
                "operator": "ET Operator",
                "press": press.id,
                "notes": "First roll",
            },
            content_type="application/json",
        )
        second_roll = self.client.post(
            reverse("coater-roll-tag-create-roll", args=[schedule_id]),
            {
                "liner": liner.id,
                "face": face.id,
                "adhesive": adhesive.id,
                "silicone": silicone.id,
                "width_inches": 13,
                "operator": "ET Operator",
                "press": press.id,
                "notes": "Second roll",
            },
            content_type="application/json",
        )

        self.assertEqual(first_roll.status_code, 201, first_roll.content)
        self.assertEqual(second_roll.status_code, 201, second_roll.content)
        self.assertTrue(first_roll.json()["tag_number"].startswith("CRT-"))
        self.assertNotEqual(first_roll.json()["tag_number"], second_roll.json()["tag_number"])
        self.assertEqual(first_roll.json()["source_schedule"], schedule_id)
        self.assertEqual(first_roll.json()["schedule_id"], schedule_id)
        self.assertEqual(first_roll.json()["schedule_tag_number"], response.json()["tag_number"])
        self.assertEqual(first_roll.json()["status"], "tag_printed")

        schedule = CoaterRollTag.objects.get(pk=schedule_id)
        self.assertEqual(schedule.status, "running")
        self.assertEqual(schedule.produced_rolls.count(), 2)
        self.assertFalse(schedule.logged_inventory_id)
        first = CoaterRollTag.objects.get(pk=first_roll.json()["id"])
        self.assertEqual(first.result_serial_number, first.tag_number)
        self.assertFalse(RawMaterialInventory.objects.filter(source_roll_tag=first).exists())

        first_documented = self.client.post(
            reverse("coater-roll-tag-document-roll", args=[first.id]),
            {
                "length_feet": 40000,
                "width_inches": 13,
                "operator": "ET Operator",
                "location": None,
                "notes": "Master roll one",
            },
            content_type="application/json",
        )
        second_documented = self.client.post(
            reverse("coater-roll-tag-document-roll", args=[second_roll.json()["id"]]),
            {
                "length_feet": 60000,
                "width_inches": 13,
                "operator": "ET Operator",
                "notes": "Master roll two",
            },
            content_type="application/json",
        )
        self.assertEqual(first_documented.status_code, 200, first_documented.content)
        self.assertEqual(second_documented.status_code, 200, second_documented.content)
        self.assertEqual(first_documented.json()["status"], "complete")
        self.assertTrue(RawMaterialInventory.objects.filter(source_roll_tag=first, status="available").exists())

        schedule_detail = self.client.get(reverse("coater-roll-tag-detail", args=[schedule_id]))
        self.assertEqual(schedule_detail.json()["schedule_pending_roll_count"], 0)
        self.assertEqual(schedule_detail.json()["schedule_documented_roll_count"], 2)
        self.assertEqual(Decimal(schedule_detail.json()["schedule_documented_footage"]), Decimal("100000"))
        self.assertEqual(schedule_detail.json()["schedule_progress_percent"], 66.7)

        ticket = JobTicket.objects.create(
            ticket_number="JT-MATERIAL-USE",
            job_name="Material consumption",
            product_code="PM-TEST",
        )
        production_schedule = ProductionSchedule.objects.create(
            job_ticket=ticket,
            status="running",
            press=press,
            scheduled_by="Scheduler",
        )
        inventory = RawMaterialInventory.objects.get(source_roll_tag=first)
        consumption = self.client.post(
            reverse("raw-material-consume-roll", args=[inventory.id]),
            {
                "mode": "partial",
                "used_feet": 10000,
                "used_by": "Press Operator",
                "production_schedule": production_schedule.id,
                "notes": "Job finished before roll ran out",
            },
            content_type="application/json",
        )
        self.assertEqual(consumption.status_code, 200, consumption.content)
        self.assertEqual(Decimal(consumption.json()["deductedFootage"]), Decimal("10300.000"))
        self.assertEqual(Decimal(consumption.json()["remainingFootage"]), Decimal("29700.000"))
        usage = MaterialUsage.objects.get(pk=consumption.json()["usage"]["id"])
        self.assertEqual(usage.job_ticket_id, ticket.id)
        self.assertEqual(usage.production_schedule_id, production_schedule.id)
