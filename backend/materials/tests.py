import json
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from tooling.models import Press

from .models import CoaterRollTag, MaterialSpec, MaterialSupplierOption


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
        adhesive = MaterialSpec.objects.create(material_type="adhesive", code="ADH-2417", name="2417 Adhesive", material_family="2417")
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
        self.assertEqual(body["Part Number List Logic"], "PM-2417-40")
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
        liner = MaterialSpec.objects.create(material_type="liner", code="LINER-SCHEDULE", name="40 Liner")
        adhesive = MaterialSpec.objects.create(material_type="adhesive", code="ADH-SCHEDULE", name="2417 Adhesive")
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
        self.assertTrue(response.json()["tag_number"].startswith("CRT-"))
        self.assertEqual(response.json()["result_lot_number"], f"LOT-{response.json()['tag_number']}")
        self.assertEqual(response.json()["press"], press.id)
        self.assertEqual(response.json()["cut_description"], "Cut 9/9")
