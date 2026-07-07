import json
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from production.models import CompanyRole, CompanyUser, JobTicket, ProductionMaterialAssignment, ProductionSchedule
from tooling.models import Press, Supplier, ToolingLocation

from .models import (
    CoaterRollTag,
    MaterialMasterType,
    MaterialMovement,
    MaterialRack,
    MaterialSkid,
    MaterialSpec,
    MaterialSupplierOption,
    MaterialUsage,
    RawMaterialInventory,
)
from .zpl import rack_label_zpl, skid_label_zpl


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
        schedule = CoaterRollTag.objects.create(
            name="PM-2417-40 schedule",
            status="running",
            face=face,
            liner=liner,
            adhesive=adhesive,
            silicone=silicone,
            produced_material=produced,
            width_inches=Decimal("13"),
            length_feet=Decimal("10000"),
            operator="ET Operator",
            press=press,
            log_inventory=False,
        )
        tag = CoaterRollTag.objects.create(
            name="PM-2417-40",
            status="tag_printed",
            print_status="not_printed",
            source_schedule=schedule,
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
                    "auto_document": True,
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
        self.assertEqual(
            body["Roll Tag URL"],
            f"https://plant.example.com/?rollTagId={tag.id}&lot=LOT-2026-1",
        )
        self.assertIn("Easy Release", body["Note"])
        tag.refresh_from_db()
        self.assertEqual(tag.print_status, "queued")
        self.assertEqual(tag.status, "complete")
        self.assertTrue(response.json()["documented"])
        self.assertTrue(tag.logged_inventory_id)
        logged_inventory_id = tag.logged_inventory_id
        self.assertTrue(RawMaterialInventory.objects.filter(source_roll_tag=tag, status="available").exists())
        linked_job = JobTicket.objects.create(ticket_number="JT-ROLL-DELETE", job_name="Delete test")
        linked_schedule = ProductionSchedule.objects.create(job_ticket=linked_job, status="running")
        ProductionMaterialAssignment.objects.create(
            production_schedule=linked_schedule,
            inventory_id=logged_inventory_id,
            source_type="tsm",
            assigned_by="ET Operator",
        )
        MaterialUsage.objects.create(
            inventory_id=logged_inventory_id,
            material=produced,
            usage_type="adjustment",
            quantity=Decimal("0"),
            coater_roll_tag=tag,
            production_schedule=linked_schedule,
            job_ticket=linked_job,
            used_by="ET Operator",
        )
        press.refresh_from_db()
        self.assertEqual(press.printer_ip, "192.168.1.72")
        self.assertEqual(press.printer_port, 9101)
        self.assertEqual(press.printer_speed, "8")
        self.assertEqual(press.printer_darkness, "15")
        self.assertTrue(response.json()["printerSettingsSaved"])

        admin_role, _ = CompanyRole.objects.get_or_create(name="Admin")
        admin_user = CompanyUser.objects.create(
            username="roll-delete-admin",
            name="Roll Delete Admin",
            password_hash="test",
            role=admin_role,
        )
        delete_headers = {
            "HTTP_X_COMPANY_USER_ID": str(admin_user.id),
            "HTTP_X_COMPANY_USERNAME": admin_user.username,
        }
        wrong_delete = self.client.post(
            reverse("coater-roll-tag-delete-roll", args=[tag.id]),
            {"confirm_delete": False},
            content_type="application/json",
            **delete_headers,
        )
        self.assertEqual(wrong_delete.status_code, 400, wrong_delete.content)

        delete_response = self.client.post(
            reverse("coater-roll-tag-delete-roll", args=[tag.id]),
            {"confirm_delete": True},
            content_type="application/json",
            **delete_headers,
        )
        self.assertEqual(delete_response.status_code, 200, delete_response.content)
        self.assertFalse(CoaterRollTag.objects.filter(pk=tag.id).exists())
        self.assertFalse(RawMaterialInventory.objects.filter(pk=logged_inventory_id).exists())
        self.assertFalse(ProductionMaterialAssignment.objects.filter(inventory_id=logged_inventory_id).exists())
        self.assertFalse(MaterialUsage.objects.filter(coater_roll_tag_id=tag.id).exists())

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

    def test_raw_material_endpoint_serializes_location_paths(self):
        root = ToolingLocation.objects.create(name="Wilmington Ohio", code="WIL", location_type="company")
        shelf = ToolingLocation.objects.create(name="Material Shelf 1", code="WIL-SHELF-1", parent=root)
        material = MaterialSpec.objects.create(material_type="coated_stock", code="PM", name="PM")
        RawMaterialInventory.objects.create(
            material=material,
            lot_number="LOT-LOCATION",
            width_inches=Decimal("12.75"),
            length_feet=Decimal("10000"),
            location=shelf,
            status="available",
        )

        response = self.client.get(reverse("raw-material-list"), {"material_type": "coated_stock", "page_size": 10})

        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()["results"][0]
        self.assertEqual(row["location_full_path"], "Wilmington Ohio > Material Shelf 1")
        self.assertEqual(row["current_location_display"], "Wilmington Ohio > Material Shelf 1")


class MaterialInventoryDeletionTests(TestCase):
    def setUp(self):
        self.material = MaterialSpec.objects.create(
            material_type="coated_stock",
            code="PM-DELETE",
            name="PM Delete Test",
        )
        self.roll = RawMaterialInventory.objects.create(
            material=self.material,
            lot_number="DELETE-LOT-1",
            length_feet=Decimal("12000"),
            quantity=Decimal("12000"),
            unit="lf",
        )
        self.usage = MaterialUsage.objects.create(
            inventory=self.roll,
            material=self.material,
            usage_type="adjustment",
            quantity=Decimal("0"),
            reference="Inventory added",
        )
        ticket = JobTicket.objects.create(ticket_number="JT-DELETE-INVENTORY", job_name="Delete inventory")
        schedule = ProductionSchedule.objects.create(job_ticket=ticket, status="running")
        self.assignment = ProductionMaterialAssignment.objects.create(
            production_schedule=schedule,
            inventory=self.roll,
            source_type="outsourced",
            assigned_by="Test",
        )
        self.manager = self.create_user("Manager", "inventory-manager")
        self.handler = self.create_user("Material Handler", "material-handler")
        self.csr = self.create_user("CSR", "inventory-csr")

    @staticmethod
    def create_user(role_name, username):
        role, _ = CompanyRole.objects.get_or_create(name=role_name)
        return CompanyUser.objects.create(
            username=username,
            name=username.replace("-", " ").title(),
            password_hash="test",
            role=role,
        )

    @staticmethod
    def headers(user):
        return {
            "HTTP_X_COMPANY_USER_ID": str(user.id),
            "HTTP_X_COMPANY_USERNAME": user.username,
        }

    def test_only_allowed_roles_can_remove_roll_without_recording_usage(self):
        unauthorized = self.client.post(
            reverse("raw-material-remove-from-inventory", args=[self.roll.id]),
            {"confirm_delete": True},
            content_type="application/json",
            **self.headers(self.csr),
        )
        self.assertEqual(unauthorized.status_code, 403, unauthorized.content)
        self.assertTrue(RawMaterialInventory.objects.filter(pk=self.roll.id).exists())

        unconfirmed = self.client.post(
            reverse("raw-material-remove-from-inventory", args=[self.roll.id]),
            {"confirm_delete": False},
            content_type="application/json",
            **self.headers(self.manager),
        )
        self.assertEqual(unconfirmed.status_code, 400, unconfirmed.content)
        self.assertTrue(RawMaterialInventory.objects.filter(pk=self.roll.id).exists())

        direct_delete = self.client.delete(
            reverse("raw-material-detail", args=[self.roll.id]),
            **self.headers(self.manager),
        )
        self.assertEqual(direct_delete.status_code, 405, direct_delete.content)

        movement_id = self.roll.movement_history.get(action_type="roll_registered").id
        usage_count = MaterialUsage.objects.count()
        response = self.client.post(
            reverse("raw-material-remove-from-inventory", args=[self.roll.id]),
            {"confirm_delete": True},
            content_type="application/json",
            **self.headers(self.handler),
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(RawMaterialInventory.objects.filter(pk=self.roll.id).exists())
        self.assertFalse(MaterialUsage.objects.filter(pk=self.usage.id).exists())
        self.assertFalse(ProductionMaterialAssignment.objects.filter(pk=self.assignment.id).exists())
        movement = MaterialMovement.objects.get(pk=movement_id)
        self.assertIsNone(movement.roll_id)
        self.assertEqual(movement.roll_reference, self.roll.serial_number)
        self.assertLess(MaterialUsage.objects.count(), usage_count)


class MaterialInventoryIntakeTests(TestCase):
    def setUp(self):
        role, _ = CompanyRole.objects.get_or_create(name="Material Handler")
        self.user = CompanyUser.objects.create(
            username="intake-handler",
            name="Inventory Handler",
            password_hash="test",
            role=role,
        )
        self.headers = {
            "HTTP_X_COMPANY_USER_ID": str(self.user.id),
            "HTTP_X_COMPANY_USERNAME": self.user.username,
        }
        self.location = ToolingLocation.objects.create(
            name="Warehouse A",
            code="WH-A",
            location_type="room",
        )
        self.rack = MaterialRack.objects.create(
            rack_code="RACK-PM-DT",
            location=self.location,
            aisle="2",
            bay="4",
        )
        self.ricoh = Supplier.objects.create(name="RICOH")

    def test_purchased_finished_material_can_be_created_directly_in_rack_without_qr(self):
        response = self.client.post(
            reverse("raw-material-intake"),
            {
                "create_material": {
                    "material_type": "coated_stock",
                    "master_type_code": "PMDT",
                    "name": "PMDT",
                    "company": "RICOH",
                    "supplier": self.ricoh.id,
                },
                "supplier": self.ricoh.id,
                "inventory_origin": "purchased",
                "lot_number": "RICOH-LOT-44",
                "width_inches": 12.75,
                "length_feet": 50000,
                "quantity": 50000,
                "roll_count": 3,
                "unit": "lf",
                "direct_rack": self.rack.id,
            },
            content_type="application/json",
            **self.headers,
        )

        self.assertEqual(response.status_code, 201, response.content)
        master_type = MaterialMasterType.objects.get(code="PMDT")
        inventory = RawMaterialInventory.objects.select_related("material", "direct_rack").get(pk=response.json()["id"])
        self.assertEqual(inventory.material.master_type, master_type)
        self.assertEqual(inventory.material.company, "RICOH")
        self.assertEqual(inventory.inventory_origin, "purchased")
        self.assertEqual(inventory.direct_rack, self.rack)
        self.assertIsNone(inventory.current_skid_id)
        self.assertIsNone(inventory.source_roll_tag_id)
        self.assertTrue(inventory.serial_number)
        self.assertEqual(response.json()["current_rack_code"], self.rack.rack_code)
        self.assertEqual(response.json()["created_count"], 3)
        self.assertEqual(RawMaterialInventory.objects.filter(lot_number="RICOH-LOT-44").count(), 3)

        rack_response = self.client.get(reverse("rack-detail", args=[self.rack.id]))
        self.assertEqual(rack_response.status_code, 200, rack_response.content)
        self.assertEqual(rack_response.json()["roll_count"], 3)
        self.assertIn(inventory.id, [row["id"] for row in rack_response.json()["loose_rolls"]])

    def test_legacy_raw_component_can_be_added_to_floor_without_qr(self):
        face = MaterialSpec.objects.create(
            material_type="face",
            code="FACE-PM-LEGACY",
            name="PM Face",
            company="Legacy Supplier",
        )
        response = self.client.post(
            reverse("raw-material-intake"),
            {
                "material": face.id,
                "inventory_origin": "legacy",
                "lot_number": "OLD-FACE-1",
                "width_inches": 40,
                "length_feet": 18000,
                "unit": "lf",
                "location": self.location.id,
            },
            content_type="application/json",
            **self.headers,
        )

        self.assertEqual(response.status_code, 201, response.content)
        inventory = RawMaterialInventory.objects.get(pk=response.json()["id"])
        self.assertEqual(inventory.material_type, "face")
        self.assertEqual(inventory.inventory_origin, "legacy")
        self.assertIsNone(inventory.source_roll_tag_id)
        self.assertIsNone(inventory.current_skid_id)
        self.assertIsNone(inventory.direct_rack_id)
        self.assertEqual(inventory.location, self.location)


class SkidRackWorkflowTests(TestCase):
    class FirebaseResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return b'{"name":"storage-print-1"}'

    def setUp(self):
        admin_role, _ = CompanyRole.objects.get_or_create(name="Admin")
        production_role, _ = CompanyRole.objects.get_or_create(name="Production")
        self.admin = CompanyUser.objects.create(
            username="storage-admin",
            name="Storage Admin",
            password_hash="unused",
            role=admin_role,
        )
        self.operator = CompanyUser.objects.create(
            username="storage-operator",
            name="Storage Operator",
            password_hash="unused",
            role=production_role,
        )
        self.admin_headers = {
            "HTTP_X_COMPANY_USER_ID": str(self.admin.id),
            "HTTP_X_COMPANY_USERNAME": self.admin.username,
        }
        self.operator_headers = {
            "HTTP_X_COMPANY_USER_ID": str(self.operator.id),
            "HTTP_X_COMPANY_USERNAME": self.operator.username,
        }
        self.material = MaterialSpec.objects.create(
            material_type="coated_stock",
            code="PM-STORAGE",
            name="PM Storage",
        )
        self.roll = RawMaterialInventory.objects.create(
            material=self.material,
            serial_number="ROLL-STORAGE-001",
            lot_number="LOT-STORAGE-001",
            width_inches=Decimal("9"),
            length_feet=Decimal("10000"),
            quantity=Decimal("10000"),
            unit="lf",
            status="available",
        )
        self.press = Press.objects.create(
            name="Storage Zebra",
            printer_ip="192.168.1.90",
            printer_port=9100,
            printer_speed="6",
            printer_darkness="18",
        )
        self.wilmington = ToolingLocation.objects.create(
            name="Wilmington Ohio",
            code="TEST-WILMINGTON",
            location_type="shop",
        )
        self.warehouse = ToolingLocation.objects.create(
            name="Warehouse",
            code="TEST-WAREHOUSE",
            location_type="room",
            parent=self.wilmington,
        )

    def create_skid(self):
        response = self.client.post(
            reverse("skid-list"),
            {"status": "active", "notes": "Test skid"},
            content_type="application/json",
            **self.admin_headers,
        )
        self.assertEqual(response.status_code, 201, response.content)
        return MaterialSkid.objects.get(pk=response.json()["id"])

    def create_rack(self, code="RACK-03-A"):
        response = self.client.post(
            reverse("rack-list"),
            {"rack_code": code, "location": self.warehouse.id, "aisle": "03", "bay": "A", "status": "active"},
            content_type="application/json",
            **self.admin_headers,
        )
        self.assertEqual(response.status_code, 201, response.content)
        return MaterialRack.objects.get(pk=response.json()["id"])

    def add_roll(self, skid, roll=None):
        target = roll or self.roll
        return self.client.post(
            reverse("skid-add-roll", args=[skid.id]),
            {"scan_value": target.serial_number, "performed_by": self.operator.name},
            content_type="application/json",
            **self.operator_headers,
        )

    def test_create_skid_and_rack_generate_identifiers_and_history(self):
        skid = self.create_skid()
        rack = self.create_rack()

        self.assertRegex(skid.skid_number, r"^SKID-\d{4}-\d{6}$")
        self.assertEqual(rack.rack_code, "RACK-03-A")
        self.assertTrue(skid.qr_token)
        self.assertTrue(rack.qr_token)
        self.assertEqual(rack.location_id, self.warehouse.id)
        self.assertEqual(rack.storage_location_display, "Wilmington Ohio > Warehouse > Aisle 03 > Bay A")
        self.assertTrue(MaterialMovement.objects.filter(skid=skid, action_type="skid_created").exists())
        self.assertTrue(MaterialMovement.objects.filter(rack=rack, action_type="rack_created").exists())

    def test_add_and_remove_roll_from_skid_records_each_movement(self):
        skid = self.create_skid()
        added = self.add_roll(skid)
        self.assertEqual(added.status_code, 200, added.content)
        self.roll.refresh_from_db()
        self.assertEqual(self.roll.current_skid_id, skid.id)

        removed = self.client.post(
            reverse("skid-remove-roll", args=[skid.id]),
            {"scan_value": self.roll.serial_number, "performed_by": self.operator.name},
            content_type="application/json",
            **self.operator_headers,
        )
        self.assertEqual(removed.status_code, 200, removed.content)
        self.roll.refresh_from_db()
        self.assertIsNone(self.roll.current_skid_id)
        self.assertEqual(removed.json()["roll"]["current_location_display"], "Plant Floor")
        self.assertTrue(MaterialMovement.objects.filter(roll=self.roll, action_type="roll_assigned_to_skid").exists())
        self.assertTrue(MaterialMovement.objects.filter(roll=self.roll, action_type="roll_removed_from_skid").exists())

        added_back = self.add_roll(skid)
        self.assertEqual(added_back.status_code, 200, added_back.content)
        self.assertTrue(MaterialMovement.objects.filter(roll=self.roll, action_type="roll_added_back_to_skid").exists())

    def test_roll_detail_qr_url_adds_the_linked_roll_to_a_skid(self):
        face = MaterialSpec.objects.create(material_type="face", code="FACE-QR", name="QR Face")
        liner = MaterialSpec.objects.create(material_type="liner", code="LINER-QR", name="QR Liner")
        adhesive = MaterialSpec.objects.create(material_type="adhesive", code="ADH-QR", name="QR Adhesive")
        silicone = MaterialSpec.objects.create(material_type="silicone", code="SIL-QR", name="QR Silicone")
        schedule = CoaterRollTag.objects.create(
            name="PM schedule",
            status="running",
            face=face,
            liner=liner,
            adhesive=adhesive,
            silicone=silicone,
            scheduled_material=self.material,
            log_inventory=False,
        )
        tag = CoaterRollTag.objects.create(
            name="PM roll",
            status="tag_printed",
            result_lot_number=self.roll.lot_number,
            face=face,
            liner=liner,
            adhesive=adhesive,
            silicone=silicone,
            produced_material=self.material,
            source_schedule=schedule,
            length_feet=Decimal("10000"),
            width_inches=Decimal("9"),
            log_inventory=False,
        )
        self.roll.delete()
        self.assertFalse(RawMaterialInventory.objects.filter(source_roll_tag=tag).exists())
        skid = self.create_skid()

        response = self.client.post(
            reverse("skid-add-roll", args=[skid.id]),
            {
                "scan_value": (
                    f"https://plant.example.com/?rollTagId={tag.id}"
                    f"&lot={self.roll.lot_number}"
                ),
                "performed_by": self.operator.name,
            },
            content_type="application/json",
            **self.operator_headers,
        )

        self.assertEqual(response.status_code, 200, response.content)
        tag.refresh_from_db()
        self.assertIsNotNone(tag.logged_inventory_id)
        self.assertEqual(tag.logged_inventory.current_skid_id, skid.id)

    def test_add_and_remove_skid_from_rack_updates_derived_roll_location(self):
        skid = self.create_skid()
        rack = self.create_rack()
        self.add_roll(skid)

        added = self.client.post(
            reverse("rack-add-skid", args=[rack.id]),
            {"scan_value": str(skid.qr_token), "performed_by": self.operator.name},
            content_type="application/json",
            **self.operator_headers,
        )
        self.assertEqual(added.status_code, 200, added.content)
        skid.refresh_from_db()
        self.assertEqual(skid.current_rack_id, rack.id)
        roll_detail = self.client.get(reverse("raw-material-detail", args=[self.roll.id]))
        self.assertIn(rack.rack_code, roll_detail.json()["current_location_display"])

        removed = self.client.post(
            reverse("rack-remove-skid", args=[rack.id]),
            {"scan_value": skid.skid_number, "performed_by": self.operator.name},
            content_type="application/json",
            **self.operator_headers,
        )
        self.assertEqual(removed.status_code, 200, removed.content)
        skid.refresh_from_db()
        self.assertIsNone(skid.current_rack_id)
        self.assertTrue(MaterialMovement.objects.filter(skid=skid, action_type="skid_assigned_to_rack").exists())
        self.assertTrue(MaterialMovement.objects.filter(skid=skid, action_type="skid_removed_from_rack").exists())

    def test_skid_page_can_scan_rack_qr_and_move_directly(self):
        skid = self.create_skid()
        rack = self.create_rack()

        response = self.client.post(
            reverse("skid-move-to-rack", args=[skid.id]),
            {
                "scan_value": f"https://plant.example.com/?rackToken={rack.qr_token}",
                "performed_by": self.operator.name,
            },
            content_type="application/json",
            **self.operator_headers,
        )

        self.assertEqual(response.status_code, 200, response.content)
        skid.refresh_from_db()
        self.assertEqual(skid.current_rack_id, rack.id)
        self.assertIn(rack.rack_code, response.json()["completed"])

    def test_skid_page_can_move_skid_to_production_floor(self):
        skid = self.create_skid()
        rack = self.create_rack()
        self.client.post(
            reverse("rack-add-skid", args=[rack.id]),
            {"scan_value": skid.skid_number, "performed_by": self.operator.name},
            content_type="application/json",
            **self.operator_headers,
        )
        skid.refresh_from_db()
        self.assertEqual(skid.current_rack_id, rack.id)

        response = self.client.post(
            reverse("skid-move-to-floor", args=[skid.id]),
            {"performed_by": self.operator.name},
            content_type="application/json",
            **self.operator_headers,
        )

        self.assertEqual(response.status_code, 200, response.content)
        skid.refresh_from_db()
        self.assertIsNone(skid.current_rack_id)
        self.assertEqual(skid.other_location, "Wilmington Ohio > Plant Floor")
        self.assertIn("Wilmington Ohio > Plant Floor", response.json()["completed"])
        self.assertTrue(MaterialMovement.objects.filter(
            skid=skid,
            action_type="skid_removed_from_rack",
            from_location__icontains=rack.rack_code,
            to_location="Wilmington Ohio > Plant Floor",
        ).exists())

    def test_partial_and_full_roll_usage_keep_inventory_consistent(self):
        skid = self.create_skid()
        self.add_roll(skid)

        partial = self.client.post(
            reverse("skid-use-roll", args=[skid.id]),
            {"scan_value": self.roll.serial_number, "amount_used": 2500, "performed_by": self.operator.name},
            content_type="application/json",
            **self.operator_headers,
        )
        self.assertEqual(partial.status_code, 200, partial.content)
        self.roll.refresh_from_db()
        self.assertEqual(self.roll.length_feet, Decimal("7500"))
        self.assertEqual(self.roll.current_skid_id, skid.id)
        self.assertTrue(MaterialMovement.objects.filter(roll=self.roll, action_type="roll_partially_used", amount_used=2500).exists())
        self.assertTrue(
            MaterialUsage.objects.filter(
                inventory=self.roll,
                usage_type="manual",
                quantity=Decimal("2500"),
                reference=skid.skid_number,
            ).exists()
        )

        full = self.client.post(
            reverse("skid-use-roll", args=[skid.id]),
            {"scan_value": self.roll.serial_number, "use_all": True, "performed_by": self.operator.name},
            content_type="application/json",
            **self.operator_headers,
        )
        self.assertEqual(full.status_code, 200, full.content)
        self.roll.refresh_from_db()
        self.assertEqual(self.roll.length_feet, Decimal("0"))
        self.assertEqual(self.roll.status, "depleted")
        self.assertIsNone(self.roll.current_skid_id)
        self.assertTrue(MaterialMovement.objects.filter(roll=self.roll, action_type="roll_fully_used").exists())
        self.assertEqual(
            sum(
                MaterialUsage.objects.filter(inventory=self.roll, usage_type="manual")
                .values_list("quantity", flat=True),
                Decimal("0"),
            ),
            Decimal("10000"),
        )

    def test_cannot_use_more_than_remaining_quantity(self):
        skid = self.create_skid()
        self.add_roll(skid)

        response = self.client.post(
            reverse("skid-use-roll", args=[skid.id]),
            {"scan_value": self.roll.serial_number, "amount_used": 10001},
            content_type="application/json",
            **self.operator_headers,
        )

        self.assertEqual(response.status_code, 409, response.content)
        self.roll.refresh_from_db()
        self.assertEqual(self.roll.length_feet, Decimal("10000"))
        self.assertFalse(MaterialMovement.objects.filter(roll=self.roll, action_type="roll_partially_used").exists())

    def test_print_and_reprint_skid_label_reuse_identifier_and_queue_3x3_zpl(self):
        skid = self.create_skid()
        original_number = skid.skid_number
        original_token = skid.qr_token
        payload = {
            "press": self.press.id,
            "copies": 1,
            "frontend_url": "https://plant.example.com",
            "performed_by": self.admin.name,
        }

        with patch("production.views.urlopen", return_value=self.FirebaseResponse()) as mocked_urlopen:
            first = self.client.post(
                reverse("skid-print-label", args=[skid.id]),
                payload,
                content_type="application/json",
                **self.admin_headers,
            )
            second = self.client.post(
                reverse("skid-print-label", args=[skid.id]),
                payload,
                content_type="application/json",
                **self.admin_headers,
            )

        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)
        self.assertFalse(first.json()["reprint"])
        self.assertTrue(second.json()["reprint"])
        skid.refresh_from_db()
        self.assertEqual(skid.skid_number, original_number)
        self.assertEqual(skid.qr_token, original_token)
        body = json.loads(mocked_urlopen.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(body["TYPE"], "SKID_LABEL_3X3")
        self.assertIn("^PW609", body["ZPL"])
        self.assertIn("^LL609", body["ZPL"])
        self.assertIn("^BQN,2,8", body["ZPL"])
        self.assertIn(str(skid.qr_token), body["ZPL"])
        self.assertNotIn("Status:", body["ZPL"])
        self.assertNotIn("Location:", body["ZPL"])
        self.assertNotIn("Rolls:", body["ZPL"])
        self.assertNotIn("Created:", body["ZPL"])

    def test_print_and_reprint_rack_label_reuse_identifier_and_queue_3x3_zpl(self):
        rack = self.create_rack()
        original_token = rack.qr_token
        payload = {
            "press": self.press.id,
            "frontend_url": "https://plant.example.com",
            "performed_by": self.admin.name,
        }

        with patch("production.views.urlopen", return_value=self.FirebaseResponse()) as mocked_urlopen:
            first = self.client.post(
                reverse("rack-print-label", args=[rack.id]),
                payload,
                content_type="application/json",
                **self.admin_headers,
            )
            second = self.client.post(
                reverse("rack-print-label", args=[rack.id]),
                payload,
                content_type="application/json",
                **self.admin_headers,
            )

        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)
        self.assertTrue(second.json()["reprint"])
        rack.refresh_from_db()
        self.assertEqual(rack.rack_code, "RACK-03-A")
        self.assertEqual(rack.qr_token, original_token)
        body = json.loads(mocked_urlopen.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(body["TYPE"], "RACK_LABEL_3X3")
        self.assertIn("^PW609", body["ZPL"])
        self.assertIn("^LL609", body["ZPL"])
        self.assertIn(str(rack.qr_token), body["ZPL"])

    def test_zpl_generators_include_size_and_scan_urls(self):
        skid = self.create_skid()
        rack = self.create_rack()
        skid_zpl = skid_label_zpl(skid, f"https://plant.example.com/?skidToken={skid.qr_token}")
        rack_zpl = rack_label_zpl(rack, f"https://plant.example.com/?rackToken={rack.qr_token}")

        self.assertIn("^PW609", skid_zpl)
        self.assertIn("^LL609", skid_zpl)
        self.assertIn("^FO103,105^BQN,2,8", skid_zpl)
        self.assertIn("^BQN,2,8", skid_zpl)
        self.assertIn("SCAN FOR LIVE CONTENTS", skid_zpl)
        self.assertIn(str(skid.qr_token), skid_zpl)
        self.assertNotIn("Status:", skid_zpl)
        self.assertNotIn("Location:", skid_zpl)
        self.assertNotIn("Rolls:", skid_zpl)
        self.assertNotIn("Created:", skid_zpl)
        self.assertIn("^PW609", rack_zpl)
        self.assertIn("^LL609", rack_zpl)
        self.assertIn("^FO103,105^BQN,2,8", rack_zpl)
        self.assertIn(str(rack.qr_token), rack_zpl)
