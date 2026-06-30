import json
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from tooling.models import Press

from .models import CoaterRollTag, MaterialSpec, RawMaterialInventory


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
        face_roll = RawMaterialInventory.objects.create(
            material=face,
            lot_number="FACE-LOT",
            serial_number="FACE-ROLL-1",
            length_feet=5000,
            quantity=5000,
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
            face_inventory=face_roll,
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
                {"copies": 2, "performed_by": "ET Operator"},
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 201, response.content)
        firebase_request = mocked_urlopen.call_args.args[0]
        body = json.loads(firebase_request.data.decode("utf-8"))
        self.assertIn("/TEST_PRINT_SERVER_JOBS/SHARED.json", firebase_request.full_url)
        self.assertEqual(body["TYPE"], "COATER")
        self.assertEqual(body["Printer"], "192.168.1.70")
        self.assertEqual(body["Total Ship Stock"], 2)
        self.assertEqual(body["Part Number List Logic"], "PM-2417-40")
        self.assertIn("PM", body["Face"])
        self.assertIn("FACE-LOT", body["Face"])
        self.assertEqual(body["Lot Number"], "LOT-2026-1")
        self.assertEqual(body["ID"], "CRT-TEST-1")
        self.assertIn("Easy Release", body["Note"])
        tag.refresh_from_db()
        self.assertEqual(tag.print_status, "queued")
