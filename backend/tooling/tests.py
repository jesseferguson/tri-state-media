from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient

from .models import (
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
