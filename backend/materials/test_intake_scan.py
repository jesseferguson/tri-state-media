from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase, skipUnlessDBFeature
from django.urls import reverse

from tooling.models import ToolingLocation
from users.models import CompanyRole, CompanyUser

from .intake import receive_material_inventory
from .models import CoaterRollTag, MaterialIntakeReceipt, MaterialMovement, MaterialRack, MaterialSpec, MaterialUsage, RawMaterialInventory


class ProducedRollFixtures:
    def setUp(self):
        role, _ = CompanyRole.objects.get_or_create(name="Material Handler")
        self.user = CompanyUser.objects.create(username="scan-handler", name="Scan Handler", password_hash="test", role=role)
        self.headers = {"HTTP_X_COMPANY_USER_ID": str(self.user.pk), "HTTP_X_COMPANY_USERNAME": self.user.username}
        self.material = MaterialSpec.objects.create(material_type="coated_stock", name="Printed Stock")
        components = {
            kind: MaterialSpec.objects.create(material_type=kind, name=f"Printed {kind}")
            for kind in ["face", "liner", "adhesive", "silicone"]
        }
        self.schedule = CoaterRollTag.objects.create(
            name="Coater Schedule", scheduled_material=self.material, produced_material=self.material,
            log_inventory=False, status="running", **components,
        )
        self.tag = CoaterRollTag.objects.create(
            name="Printed Roll", source_schedule=self.schedule, scheduled_material=self.material,
            produced_material=self.material, log_inventory=False, status="tag_printed",
            result_lot_number="PRINTED-LOT", width_inches=12, length_feet=100,
            run_date="2026-06-30", **components,
        )
        self.location = ToolingLocation.objects.create(name="Receiving Floor", code="RECEIVING-FLOOR", inventory_scope="raw_material")
        self.rack = MaterialRack.objects.create(rack_code="RECEIVING-RACK", location=self.location)
        self.payload = {"source_roll_tag": self.tag.pk, "length_feet": "150.25", "width_inches": "13.125", "direct_rack": self.rack.pk}

    def lookup(self, value, *, headers=None):
        return self.client.post(reverse("raw-material-intake-scan"), {"scan_value": value}, content_type="application/json", **(self.headers if headers is None else headers))

    def receive(self, payload=None, *, key=None, headers=None):
        return self.client.post(
            reverse("raw-material-intake"), self.payload if payload is None else payload, content_type="application/json",
            HTTP_IDEMPOTENCY_KEY=key or str(uuid4()), **(self.headers if headers is None else headers),
        )

    def tag_url(self, tag=None):
        return f"{settings.FRONTEND_PUBLIC_URL}/?rollTagId={(tag or self.tag).pk}"


class IntakeScanLookupTests(ProducedRollFixtures, TestCase):
    def test_tag_url_stays_in_tag_namespace_and_lookup_does_not_write(self):
        unrelated = RawMaterialInventory.objects.create(pk=self.tag.pk, material=self.material, serial_number="UNRELATED", quantity=10)
        before = (RawMaterialInventory.objects.count(), MaterialMovement.objects.count(), MaterialUsage.objects.count())
        response = self.lookup(self.tag_url())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["kind"], "pending_tag")
        self.assertIsNone(response.json()["inventory"])
        self.assertEqual(response.json()["roll_tag"]["id"], self.tag.pk)
        self.assertEqual(response.json()["material"]["id"], self.material.pk)
        self.assertEqual(before, (RawMaterialInventory.objects.count(), MaterialMovement.objects.count(), MaterialUsage.objects.count()))
        self.tag.refresh_from_db()
        self.assertEqual(self.tag.status, "tag_printed")
        self.assertFalse(self.tag.log_inventory)
        inventory_lookup = self.lookup(f"/?inventoryId={unrelated.pk}")
        self.assertEqual(inventory_lookup.json()["inventory"]["id"], unrelated.pk)

    def test_exact_tag_number_and_serial_identify_one_physical_roll(self):
        pending = self.lookup(self.tag.tag_number.lower())
        self.assertEqual(pending.status_code, 200, pending.content)
        self.assertEqual(pending.json()["kind"], "pending_tag")
        self.tag.status = "complete"
        self.tag.log_inventory = True
        self.tag.save()
        documented = self.lookup(self.tag.tag_number)
        self.assertEqual(documented.status_code, 200, documented.content)
        self.assertEqual(documented.json()["kind"], "inventory")
        self.assertEqual(documented.json()["inventory"]["id"], self.tag.logged_inventory_id)
        self.assertEqual(documented.json()["roll_tag"]["id"], self.tag.pk)

    def test_shared_lot_name_partial_text_and_bare_database_id_do_not_match(self):
        for value in ["PRINTED-LOT", self.material.name, "CRT-", str(self.tag.pk), "UNKNOWN"]:
            with self.subTest(value=value):
                response = self.lookup(value)
                self.assertEqual(response.status_code, 404, response.content)

    def test_duplicate_serials_are_ambiguous(self):
        for _ in range(2):
            RawMaterialInventory.objects.create(material=self.material, serial_number="DUPLICATE", quantity=1)
        response = self.lookup("DUPLICATE")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "ambiguous_roll_scan")

    def test_foreign_malformed_and_wrong_qr_codes_are_rejected(self):
        for value in [
            f"https://supplier.example.com/?rollTagId={self.tag.pk}",
            "/?rackToken=123", "/?rollTagId=1&inventoryId=1", "/?rollTagId=1&rollTagId=2",
            "/?rollTagId=invalid", "/?rollTagId=0", "/?rollTagId=9223372036854775808", "",
        ]:
            with self.subTest(value=value):
                self.assertEqual(self.lookup(value).status_code, 400)
        self.assertEqual(self.lookup(self.tag_url(self.schedule)).json()["code"], "schedule_not_roll")

    def test_void_on_hold_and_complete_without_inventory_require_review(self):
        for state, code in [("void", "roll_unavailable"), ("on_hold", "roll_unavailable"), ("complete", "roll_inventory_missing")]:
            with self.subTest(state=state):
                CoaterRollTag.objects.filter(pk=self.tag.pk).update(status=state)
                response = self.lookup(self.tag_url())
                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(response.json()["code"], code)
        self.assertEqual(RawMaterialInventory.objects.count(), 0)

    def test_lookup_requires_an_active_verified_user(self):
        self.assertEqual(self.lookup(self.tag_url(), headers={}).status_code, 403)
        self.user.active = False
        self.user.save()
        self.assertEqual(self.lookup(self.tag_url()).status_code, 403)

    def test_lookup_reports_missing_active_material_before_receiving_steps(self):
        self.material.is_active = False
        self.material.save()
        response = self.lookup(self.tag_url())
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "roll_material_required")


class ProducedRollIntakeTests(ProducedRollFixtures, TestCase):
    def test_confirmed_tag_uses_actual_dimensions_original_identity_and_selected_rack(self):
        response = self.receive()
        self.assertEqual(response.status_code, 201, response.content)
        inventory = RawMaterialInventory.objects.get(pk=response.json()["id"])
        self.tag.refresh_from_db()
        self.assertEqual(self.tag.logged_inventory_id, inventory.pk)
        self.assertEqual(self.tag.status, "complete")
        self.assertEqual(inventory.source_roll_tag_id, self.tag.pk)
        self.assertEqual(inventory.material_id, self.material.pk)
        self.assertEqual(inventory.serial_number, self.tag.result_serial_number)
        self.assertEqual(inventory.lot_number, "PRINTED-LOT")
        self.assertEqual(str(inventory.received_date), "2026-06-30")
        self.assertEqual(inventory.quantity, Decimal("150.25"))
        self.assertEqual(inventory.original_length_feet, Decimal("150.25"))
        self.assertEqual(inventory.width_inches, Decimal("13.125"))
        self.assertEqual(inventory.direct_rack_id, self.rack.pk)
        self.assertIsNone(inventory.location_id)
        self.assertEqual(inventory.inventory_origin, "tri_state")
        for event in inventory.movement_history.all():
            self.assertEqual(event.actor_user_id, str(self.user.pk))
            self.assertEqual(event.rack_id, self.rack.pk)
            self.assertIn(self.rack.rack_code, event.to_location)
        self.assertFalse(response.json()["already_in_inventory"])

    def test_explicit_lot_date_floor_and_notes_are_saved(self):
        response = self.receive({
            **self.payload, "direct_rack": None, "location": self.location.pk, "lot_number": "ACTUAL-LOT",
            "received_date": "2026-07-01", "notes": "Actual receiving notes",
        })
        self.assertEqual(response.status_code, 201, response.content)
        inventory = RawMaterialInventory.objects.get(pk=response.json()["id"])
        self.assertEqual(inventory.location_id, self.location.pk)
        self.assertEqual(inventory.lot_number, "ACTUAL-LOT")
        self.assertEqual(str(inventory.received_date), "2026-07-01")
        self.assertIn("Actual receiving notes", inventory.notes)

    def test_retry_with_new_key_and_other_user_reuses_inventory_without_mutation(self):
        first = self.receive()
        self.assertEqual(first.status_code, 201, first.content)
        other = CompanyUser.objects.create(username="other-scanner", name="Other", password_hash="test", role=self.user.role)
        before_history = MaterialMovement.objects.count()
        retry = self.receive({**self.payload, "length_feet": "999", "notes": "Do not overwrite"}, headers={
            "HTTP_X_COMPANY_USER_ID": str(other.pk), "HTTP_X_COMPANY_USERNAME": other.username,
        })
        self.assertEqual(retry.status_code, 201, retry.content)
        self.assertEqual(retry.json()["id"], first.json()["id"])
        self.assertTrue(retry.json()["already_in_inventory"])
        self.assertEqual(retry.json()["created_count"], 0)
        self.assertEqual(retry.json()["created_inventory"], [])
        self.assertEqual(retry.json()["total_received"], 0)
        self.assertEqual(RawMaterialInventory.objects.count(), 1)
        self.assertEqual(MaterialMovement.objects.count(), before_history)
        self.tag.refresh_from_db()
        self.assertEqual(self.tag.length_feet, Decimal("150.25"))
        self.assertNotIn("Do not overwrite", self.tag.notes)

    def test_failed_receipt_response_rolls_back_tag_inventory_and_history(self):
        original_save = MaterialIntakeReceipt.save

        def fail_response(instance, *args, **kwargs):
            if instance.pk:
                raise RuntimeError("Receipt failed")
            return original_save(instance, *args, **kwargs)

        with patch("materials.intake.MaterialIntakeReceipt.save", new=fail_response):
            with self.assertRaisesMessage(RuntimeError, "Receipt failed"):
                self.receive()
        self.tag.refresh_from_db()
        self.assertEqual(self.tag.status, "tag_printed")
        self.assertIsNone(self.tag.logged_inventory_id)
        self.assertEqual(RawMaterialInventory.objects.count(), 0)
        self.assertEqual(MaterialMovement.objects.count(), 0)
        self.assertEqual(MaterialIntakeReceipt.objects.count(), 0)

    def test_non_foot_component_inventory_requires_production_review_without_consumption(self):
        component = RawMaterialInventory.objects.create(material=self.tag.adhesive, quantity=50, unit="gal")
        self.tag.adhesive_inventory = component
        self.tag.save()
        lookup = self.lookup(self.tag_url())
        self.assertEqual(lookup.status_code, 409, lookup.content)
        self.assertEqual(lookup.json()["code"], "component_unit_review_required")
        response = self.receive()
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "component_unit_review_required")
        component.refresh_from_db()
        self.assertEqual(component.quantity, 50)
        self.assertEqual(MaterialUsage.objects.count(), 0)
        self.assertFalse(RawMaterialInventory.objects.filter(source_roll_tag=self.tag).exists())

    def test_invalid_dimensions_destinations_material_or_tag_cannot_finalize(self):
        for changes in [{"width_inches": "0"}, {"length_feet": "NaN"}, {"location": self.location.pk}, {"direct_rack": 999999}, {"direct_rack": None}]:
            with self.subTest(changes=changes):
                response = self.receive({**self.payload, **changes})
                self.assertEqual(response.status_code, 400, response.content)
        for state in ["void", "on_hold", "complete"]:
            CoaterRollTag.objects.filter(pk=self.tag.pk).update(status=state)
            self.assertEqual(self.receive().status_code, 409)
        CoaterRollTag.objects.filter(pk=self.tag.pk).update(status="tag_printed")
        self.material.is_active = False
        self.material.save()
        self.assertEqual(self.receive().json()["code"], "roll_material_required")
        self.assertEqual(RawMaterialInventory.objects.count(), 0)

    def test_stale_tag_save_cannot_create_a_second_inventory_record(self):
        component = RawMaterialInventory.objects.create(material=self.tag.face, quantity=1000, length_feet=1000, unit="lf")
        self.tag.face_inventory = component
        self.tag.save()
        stale = CoaterRollTag.objects.get(pk=self.tag.pk)
        first = self.receive()
        self.assertEqual(first.status_code, 201, first.content)
        stale.log_inventory = True
        stale.status = "complete"
        stale.print_status = "queued"
        stale.save()
        self.assertEqual(stale.logged_inventory_id, first.json()["id"])
        self.assertEqual(RawMaterialInventory.objects.filter(source_roll_tag=self.tag).count(), 1)
        self.tag.refresh_from_db()
        self.assertEqual(self.tag.length_feet, Decimal("150.25"))
        self.assertEqual(self.tag.print_status, "queued")
        component.refresh_from_db()
        self.assertEqual(component.quantity, Decimal("849.75"))
        self.assertEqual(MaterialUsage.objects.filter(coater_roll_tag=self.tag).count(), 1)
        duplicate = self.receive()
        self.assertTrue(duplicate.json()["already_in_inventory"])
        component.refresh_from_db()
        self.assertEqual(component.quantity, Decimal("849.75"))

    def test_document_roll_and_intake_share_duplicate_protection(self):
        documented = self.client.post(
            reverse("coater-roll-tag-document-roll", args=[self.tag.pk]),
            {"length_feet": "125.5", "width_inches": "12.5", "operator": "Coater Operator"},
            content_type="application/json", **self.headers,
        )
        self.assertEqual(documented.status_code, 200, documented.content)
        response = self.receive()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.json()["already_in_inventory"])
        self.assertEqual(Decimal(response.json()["length_feet"]), Decimal("125.5"))
        self.assertEqual(RawMaterialInventory.objects.count(), 1)


class ProducedRollIntakeConcurrencyTests(ProducedRollFixtures, TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_different_request_keys_cannot_document_the_same_tag_twice(self):
        start = Barrier(2)

        def receive():
            close_old_connections()
            try:
                start.wait(timeout=10)
                return receive_material_inventory(self.payload, user=self.user, idempotency_key=str(uuid4()))
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = [future.result(timeout=30) for future in [executor.submit(receive), executor.submit(receive)]]
        self.assertEqual({result["created_count"] for result in results}, {0, 1})
        self.assertEqual(results[0]["id"], results[1]["id"])
        self.assertEqual(RawMaterialInventory.objects.filter(source_roll_tag=self.tag).count(), 1)
