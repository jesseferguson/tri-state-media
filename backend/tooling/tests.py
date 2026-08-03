import json
from decimal import Decimal
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.urls import reverse
from django.test import TestCase
from rest_framework.test import APIClient

from production.models import CompanyRole, CompanyUser
from .models import (
    FlexDie,
    FlexDieRequest,
    Mag,
    PerfBladeSetup,
    PerfCylinder,
    Press,
    ToolingHistory,
    ToolingLocation,
    ToolingRecipe,
    ToolingRecipeOption,
    ToolingRecipeTool,
)


class ToolingModelValidationTests(TestCase):
    def setUp(self):
        self.press = Press.objects.create(name="Press 001")
        self.undercut_press = Press.objects.create(
            name="Press 002",
            has_undercut_capability=True,
        )
        self.recipe = ToolingRecipe.objects.create(
            name="2 x 1 Poly Roll - 12TPI",
            label_width_inches="2.000",
            label_length_inches="1.000",
        )
        self.mag = Mag.objects.create(
            name="MAG-88T",
            tooth_count=88,
            repeat_inches="8.000",
        )
        self.perf_cylinder = PerfCylinder.objects.create(
            name="PERF-001",
            gear_tooth_count=120,
            cylinder_width_inches="10.000",
        )
        self.perf_blade_setup = PerfBladeSetup.objects.create(
            perf_cylinder=self.perf_cylinder,
            name="Standard 12TPI",
            blade_count=12,
            standard_repeat_inches="8.000",
        )

    def test_location_cannot_reference_itself_as_parent(self):
        location = ToolingLocation.objects.create(name="Rack A", code="RACK-A")
        location.parent = location

        with self.assertRaises(ValidationError):
            location.save()

    def test_preferred_recipe_option_must_be_unique_per_recipe_and_press(self):
        ToolingRecipeOption.objects.create(
            recipe=self.recipe,
            press=self.press,
            name="Primary",
            is_preferred=True,
        )

        with self.assertRaises(ValidationError):
            ToolingRecipeOption.objects.create(
                recipe=self.recipe,
                press=self.press,
                name="Backup",
                is_preferred=True,
            )

    def test_requires_undercut_must_match_press_capability(self):
        with self.assertRaises(ValidationError):
            ToolingRecipeOption.objects.create(
                recipe=self.recipe,
                press=self.press,
                name="Undercut Setup",
                requires_undercut=True,
            )

        option = ToolingRecipeOption.objects.create(
            recipe=self.recipe,
            press=self.undercut_press,
            name="Valid Undercut Setup",
            requires_undercut=True,
        )

        self.assertTrue(option.can_run_on_press())

    def test_recipe_tool_requires_matching_reference_for_tool_type(self):
        option = ToolingRecipeOption.objects.create(
            recipe=self.recipe,
            press=self.press,
            name="Standard",
        )

        with self.assertRaises(ValidationError):
            ToolingRecipeTool.objects.create(
                recipe_option=option,
                tool_type="mag",
                manual_description="Loose magnetic cylinder",
            )

        tool = ToolingRecipeTool.objects.create(
            recipe_option=option,
            tool_type="mag",
            mag=self.mag,
        )

        self.assertEqual(tool.mag, self.mag)

    def test_recipe_tool_requires_exactly_one_source(self):
        option = ToolingRecipeOption.objects.create(
            recipe=self.recipe,
            press=self.press,
            name="Manual",
        )

        with self.assertRaises(ValidationError):
            ToolingRecipeTool.objects.create(
                recipe_option=option,
                tool_type="manual_tooling",
                manual_description="Custom shim pack",
                mag=self.mag,
            )

    def test_history_requires_one_matching_tool_reference(self):
        with self.assertRaises(ValidationError):
            ToolingHistory.objects.create(
                tooling_type="mag",
                flex_die_id=999,
                event_type="note",
                summary="Mismatched history entry",
            )

        entry = ToolingHistory.objects.create(
            tooling_type="perf_cylinder",
            perf_cylinder=self.perf_cylinder,
            event_type="inspection",
            summary="Cylinder inspected",
        )

        self.assertEqual(entry.perf_cylinder, self.perf_cylinder)

    def test_history_rejects_multiple_tool_references(self):
        with self.assertRaises(ValidationError):
            ToolingHistory.objects.create(
                tooling_type="perf_cylinder",
                perf_cylinder=self.perf_cylinder,
                mag=self.mag,
                event_type="note",
                summary="Too many linked tools",
            )


class ToolingLocationApiTests(TestCase):
    def test_location_search_matches_visible_full_path_terms(self):
        root = ToolingLocation.objects.create(name="Test Warehouse", code="TEST-WH", location_type="shop")
        ToolingLocation.objects.create(
            name="Annex Material Floor",
            code="TEST-ANNEX-FLOOR",
            location_type="position",
            inventory_scope="raw_material",
            parent=root,
        )
        ToolingLocation.objects.create(
            name="Finished Goods",
            code="FG",
            location_type="room",
            inventory_scope="finished_product",
            parent=root,
        )

        response = APIClient().get(reverse("location-list"), {"search": "Test Warehouse > Annex Material Floor"})

        self.assertEqual(response.status_code, 200, response.content)
        codes = [row["code"] for row in response.json()["results"]]
        self.assertEqual(codes, ["TEST-ANNEX-FLOOR"])


class ToolingApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.location = ToolingLocation.objects.create(name="Warehouse", code="WH-1")
        self.press = Press.objects.create(name="Press 001", location=self.location)
        self.recipe = ToolingRecipe.objects.create(
            name="2 x 1 Paper Roll",
            label_width_inches="2.000",
            label_length_inches="1.000",
        )

    def test_press_list_endpoint_returns_created_press(self):
        response = self.client.get("/api/presses/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Press 001")
        self.assertEqual(response.data["results"][0]["location_name"], "Warehouse")

    def test_recipe_option_can_be_created_over_api(self):
        payload = {
            "recipe": self.recipe.id,
            "press": self.press.id,
            "name": "Standard Setup",
            "setup_type": "standard",
            "is_preferred": True,
        }

        response = self.client.post("/api/recipe-options/", payload, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["name"], "Standard Setup")
        self.assertTrue(response.data["can_run"])


class FlexDieRequestWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.die = FlexDie.objects.create(
            name="FD-13-381",
            label_width_inches=Decimal("4"),
            label_length_inches=Decimal("6"),
            repeat_inches=Decimal("6"),
            gap_across_inches=Decimal("0.188"),
            number_across=3,
            number_around=2,
            gear=96,
            active_die_count=1,
            target_die_count=1,
        )

    def test_request_reorder_creates_open_request_record(self):
        response = self.client.post(
            reverse("flex-die-request-reorder", args=[self.die.id]),
            {"requested_by": "Operator", "notes": "Need another die for production."},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        request_record = FlexDieRequest.objects.get(flex_die=self.die)
        self.assertEqual(request_record.status, "requested")
        self.assertEqual(request_record.requested_by, "Operator")
        self.assertEqual(request_record.request_notes, "Need another die for production.")
        self.assertTrue(ToolingHistory.objects.filter(flex_die=self.die, event_type="die_reorder_requested").exists())

    def test_request_can_be_marked_ordered(self):
        request_record = FlexDieRequest.objects.create(
            flex_die=self.die,
            requested_by="Operator",
            request_notes="Need a spare.",
        )

        response = self.client.post(
            reverse("flex-die-request-mark-ordered", args=[request_record.id]),
            {"performed_by": "Tool Room", "notes": "Ordered from current supplier."},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        request_record.refresh_from_db()
        self.die.refresh_from_db()
        self.assertEqual(request_record.status, "ordered")
        self.assertEqual(request_record.ordered_by, "Tool Room")
        self.assertEqual(self.die.status, "ordered")
        self.assertTrue(ToolingHistory.objects.filter(flex_die=self.die, event_type="die_ordered").exists())

    def test_request_can_be_received_and_updates_die_count(self):
        request_record = FlexDieRequest.objects.create(
            flex_die=self.die,
            status="ordered",
            requested_by="Operator",
            ordered_by="Tool Room",
        )

        response = self.client.post(
            reverse("flex-die-request-receive", args=[request_record.id]),
            {"received_by": "Tool Room", "quantity": 2, "serial_number": "MOD26-001", "notes": "Received complete."},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        request_record.refresh_from_db()
        self.die.refresh_from_db()
        self.assertEqual(request_record.status, "received")
        self.assertEqual(request_record.received_quantity, 2)
        self.assertEqual(self.die.active_die_count, 3)
        self.assertEqual(self.die.status, "in_stock")
        self.assertIn("MOD26-001", self.die.serial_numbers)
        self.assertTrue(ToolingHistory.objects.filter(flex_die=self.die, event_type="die_received").exists())

    def test_request_can_be_closed_without_order(self):
        request_record = FlexDieRequest.objects.create(
            flex_die=self.die,
            requested_by="Operator",
            request_notes="Need a 4 across die instead.",
        )

        response = self.client.post(
            reverse("flex-die-request-close-without-order", args=[request_record.id]),
            {"performed_by": "Tool Room", "reason": "Specs belong in a different FD folder."},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        request_record.refresh_from_db()
        self.assertEqual(request_record.status, "closed_without_order")
        self.assertEqual(request_record.closed_by, "Tool Room")
        self.assertEqual(request_record.closed_reason, "Specs belong in a different FD folder.")
        self.assertTrue(ToolingHistory.objects.filter(flex_die=self.die, event_type="die_request_closed").exists())


class ToolingPrintQueueTests(TestCase):
    class FirebaseResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return b'{"name":"flex-die-label-1"}'

    def setUp(self):
        self.client = APIClient()
        self.role, _ = CompanyRole.objects.get_or_create(name="Admin", defaults={"allowed_resource_keys": ["*"]})
        self.user = CompanyUser(username="tooling-print-admin", name="Admin", role=self.role, password_hash="")
        self.user.set_password("pw")
        self.user.save()
        self.headers = {
            "HTTP_X_COMPANY_USER_ID": str(self.user.id),
            "HTTP_X_COMPANY_USERNAME": self.user.username,
        }
        self.press = Press.objects.create(
            name="ETI",
            printer_ip="192.168.1.70",
            printer_port=9101,
            printer_speed="7",
            printer_darkness="14",
            printer_queue_key="ETI",
        )

    def test_flex_die_folder_label_queues_2_5_by_5_zpl(self):
        die = FlexDie.objects.create(
            name="FD-13-100",
            label_width_inches=Decimal("3"),
            label_length_inches=Decimal("4"),
            repeat_inches=Decimal("4.125"),
            gap_across_inches=Decimal("0.125"),
            number_across=2,
            number_around=1,
            gear=99,
            face_type="paper",
            cutting_type="to_liner",
            original_serial_number="FC123",
            active_die_count=2,
            target_die_count=4,
        )

        with patch("production.views.urlopen", return_value=self.FirebaseResponse()) as mocked_urlopen:
            response = self.client.post(
                reverse("flex-die-print-folder-label", args=[die.id]),
                {
                    "press": self.press.id,
                    "copies": 2,
                    "frontend_url": "https://plant.example.com",
                    "performed_by": "Tool Room",
                },
                format="json",
                **self.headers,
            )

        self.assertEqual(response.status_code, 201, response.content)
        firebase_request = mocked_urlopen.call_args.args[0]
        self.assertIn("/TEST_PRESS_001/print_node.json", firebase_request.full_url)
        body = json.loads(firebase_request.data.decode("utf-8"))
        self.assertEqual(body["TYPE"], "SKID_LABEL_3X3")
        self.assertEqual(body["Label Type"], "FLEX_DIE_FOLDER_LABEL_2_5X5")
        self.assertEqual(body["Print Format"], "ZPL")
        self.assertEqual(body["Printer"], "192.168.1.70")
        self.assertEqual(body["Printer Port"], 9101)
        self.assertEqual(body["SPEED"], "7")
        self.assertEqual(body["DARKNESS"], "14")
        self.assertEqual(body["Total Ship Stock"], 2)
        self.assertEqual(body["Label Size"], "2.5x5")
        self.assertEqual(body["Label Width Inches"], "2.5")
        self.assertEqual(body["Label Length Inches"], "5")
        self.assertEqual(body["Tooling Kind"], "flex_die")
        self.assertIn("^PW508", body["ZPL"])
        self.assertIn("^LL1015", body["ZPL"])
        self.assertIn("^BQN,2,5", body["ZPL"])
        self.assertIn("FD-13-100", body["ZPL"])
        self.assertIn("ACROSS", body["ZPL"])
        self.assertIn("AROUND", body["ZPL"])
        self.assertIn("WIDTH", body["ZPL"])
        self.assertIn('3"', body["ZPL"])
        self.assertIn("LENGTH", body["ZPL"])
        self.assertIn('4"', body["ZPL"])
        self.assertIn("WEB WIDTH", body["ZPL"])
        self.assertIn('6.125"', body["ZPL"])
        self.assertNotIn("SHOULD HAVE", body["ZPL"])
        self.assertNotIn("ORIG SERIAL", body["ZPL"])
        self.assertIn("CURRENT ORIGINAL SERIAL NUMBER", body["ZPL"])
        self.assertIn("FC123", body["ZPL"])
        self.assertEqual(body["ZPL"].count("FC123"), 1)
        self.assertIn("flexDieId=", body["ZPL"])
        self.assertEqual(response.json()["labelType"], "FLEX_DIE_FOLDER_LABEL_2_5X5")
        self.assertEqual(response.json()["firebaseType"], "SKID_LABEL_3X3")
        self.assertEqual(response.json()["labelSize"], "2.5x5")
        self.assertTrue(ToolingHistory.objects.filter(flex_die=die, event_type="label_printed").exists())
