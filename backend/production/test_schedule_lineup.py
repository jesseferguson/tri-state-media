from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.db import close_old_connections
from django.test import TestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.urls import reverse
from rest_framework.exceptions import APIException

from materials.models import CoaterRollTag, MaterialSpec, MaterialUsage, RawMaterialInventory
from tooling.models import Press
from users.auth import create_company_user_token
from users.models import CompanyRole, CompanyUser

from .models import CustomerOrder, CustomerOrderEvent, JobTicket, JobTicketEvent, ProductionSchedule
from .schedule_lineup import ReorderLineupSerializer, _save_lineup_position, reorder_press_lineup


class LineupFixtures:
    def setUp(self):
        role, _ = CompanyRole.objects.get_or_create(name="Lineup Scheduler", defaults={"allowed_resource_keys": ["production-schedule"]})
        self.user = CompanyUser.objects.create(username="lineup-scheduler", name="Lineup Scheduler", password_hash="test", role=role)
        self.headers = {"HTTP_X_COMPANY_USER_ID": str(self.user.pk), "HTTP_X_COMPANY_USERNAME": self.user.username}
        self.press = Press.objects.create(name="Lineup Press")
        self.other_press = Press.objects.create(name="Other Press")
        self.ticket = JobTicket.objects.create(ticket_number="LINEUP-1", job_name="Lineup Job")
        self.product = ProductionSchedule.objects.create(job_ticket=self.ticket, press=self.press, press_sequence=1, status="scheduled")
        self.held = ProductionSchedule.objects.create(job_ticket=self.ticket, press=self.press, press_sequence=3, status="on_hold", hold_reasons=["material"], hold_notes="Waiting for material")
        components = {
            kind: MaterialSpec.objects.create(material_type=kind, name=f"Lineup {kind}")
            for kind in ["face", "liner", "adhesive", "silicone"]
        }
        self.material = CoaterRollTag.objects.create(name="Material Run", press=self.press, press_sequence=2, status="scheduled", log_inventory=False, **components)
        self.held_material = CoaterRollTag.objects.create(name="Held Material", press=self.press, press_sequence=4, status="on_hold", log_inventory=False, **components)
        self.original = [
            {"kind": "product", "id": self.product.pk, "press_sequence": 1},
            {"kind": "material", "id": self.material.pk, "press_sequence": 2},
            {"kind": "product", "id": self.held.pk, "press_sequence": 3},
            {"kind": "material", "id": self.held_material.pk, "press_sequence": 4},
        ]

    def payload(self, entries=None):
        return {
            "press": self.press.pk,
            "items": [{"kind": item["kind"], "id": item["id"]} for item in (entries or list(reversed(self.original)))],
            "expected_items": self.original,
        }

    def receive(self, data=None, *, headers=None):
        return self.client.post(
            reverse("production-schedule-reorder-lineup"), self.payload() if data is None else data,
            content_type="application/json", **(self.headers if headers is None else headers),
        )

    def positions(self):
        for row in [self.product, self.material, self.held, self.held_material]:
            row.refresh_from_db()
        return [self.product.press_sequence, self.material.press_sequence, self.held.press_sequence, self.held_material.press_sequence]


@override_settings(API_AUTH_REQUIRED=False)
class PressLineupReorderTests(LineupFixtures, TestCase):
    def test_mixed_lineup_reorders_atomically_including_both_held_kinds(self):
        held_at = self.held.held_at
        response = self.receive()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["updated_count"], 4)
        self.assertEqual(self.positions(), [4, 3, 2, 1])
        self.assertEqual(self.held.status, "on_hold")
        self.assertEqual(self.held.hold_reasons, ["material"])
        self.assertEqual(self.held.hold_notes, "Waiting for material")
        self.assertEqual(self.held.held_at, held_at)
        self.assertEqual(self.held_material.status, "on_hold")
        self.assertEqual(CustomerOrder.objects.get(schedule_entry=self.product).press_sequence, 4)
        event = JobTicketEvent.objects.filter(job_ticket=self.ticket, event_type="schedule_updated").first()
        self.assertEqual(event.performed_by, self.user.name)

    def test_hidden_or_new_work_and_stale_sequences_require_refresh(self):
        incomplete = self.original[:-1]
        response = self.receive({**self.payload(incomplete), "expected_items": incomplete})
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "lineup_changed")
        self.assertEqual(self.positions(), [1, 2, 3, 4])
        ProductionSchedule.objects.filter(pk=self.product.pk).update(press_sequence=99)
        response = self.receive()
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(self.positions(), [99, 2, 3, 4])

    def test_completed_and_child_roll_records_are_not_part_of_active_lineup(self):
        completed = ProductionSchedule.objects.create(job_ticket=self.ticket, press=self.press, press_sequence=50, status="complete")
        child = CoaterRollTag.objects.create(
            name="Physical roll", press=self.press, press_sequence=60, status="scheduled", source_schedule=self.material,
            log_inventory=False, face=self.material.face, liner=self.material.liner, adhesive=self.material.adhesive, silicone=self.material.silicone,
        )
        response = self.receive()
        self.assertEqual(response.status_code, 200, response.content)
        completed.refresh_from_db()
        child.refresh_from_db()
        self.assertEqual(completed.press_sequence, 50)
        self.assertEqual(child.press_sequence, 60)

    def test_wrong_press_or_duplicate_items_cannot_be_saved(self):
        wrong_press = self.receive({**self.payload(), "press": self.other_press.pk})
        self.assertEqual(wrong_press.status_code, 409, wrong_press.content)
        duplicated = self.original + [self.original[0]]
        duplicate = self.receive({**self.payload(duplicated), "expected_items": duplicated})
        self.assertEqual(duplicate.status_code, 400, duplicate.content)
        self.assertEqual(self.positions(), [1, 2, 3, 4])

    def test_write_failure_rolls_back_positions_customer_orders_and_history(self):
        baseline_events = (JobTicketEvent.objects.count(), CustomerOrderEvent.objects.count())
        calls = 0

        def fail_second(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("Lineup save failed")
            return _save_lineup_position(*args, **kwargs)

        reordered = [self.original[2], self.original[0], self.original[1], self.original[3]]
        with patch("production.schedule_lineup._save_lineup_position", side_effect=fail_second):
            with self.assertRaisesMessage(RuntimeError, "Lineup save failed"):
                self.receive(self.payload(reordered))
        self.assertEqual(self.positions(), [1, 2, 3, 4])
        self.assertEqual(CustomerOrder.objects.get(schedule_entry=self.held).press_sequence, 3)
        self.assertEqual(baseline_events, (JobTicketEvent.objects.count(), CustomerOrderEvent.objects.count()))

    def test_position_only_changes_do_not_apply_dynamic_hold_or_consume_material(self):
        self.ticket.print_method = "dynamic"
        self.ticket.save()
        component = RawMaterialInventory.objects.create(material=self.material.face, unit="lf", quantity=1000, length_feet=1000)
        CoaterRollTag.objects.filter(pk=self.material.pk).update(status="running", face_inventory=component, length_feet=100)
        response = self.receive()
        self.assertEqual(response.status_code, 200, response.content)
        self.product.refresh_from_db()
        component.refresh_from_db()
        self.assertEqual(self.product.status, "scheduled")
        self.assertEqual(self.product.hold_reasons, [])
        self.assertEqual(component.quantity, 1000)
        self.assertEqual(MaterialUsage.objects.count(), 0)

    def test_inactive_press_with_current_work_can_be_arranged(self):
        self.press.is_active = False
        self.press.save()
        response = self.receive()
        self.assertEqual(response.status_code, 200, response.content)

    def test_unverified_and_inactive_users_cannot_reorder(self):
        self.assertEqual(self.receive(headers={}).status_code, 403)
        self.user.active = False
        self.user.save()
        self.assertEqual(self.receive().status_code, 403)
        self.assertEqual(self.positions(), [1, 2, 3, 4])

    @override_settings(API_AUTH_REQUIRED=True)
    def test_real_authentication_and_resource_permissions_are_required(self):
        self.assertIn(self.receive().status_code, [401, 403])
        token = create_company_user_token(self.user)
        self.assertEqual(self.receive(headers={"HTTP_AUTHORIZATION": f"Bearer {token}"}).status_code, 200)
        self.user.role.allowed_resource_keys = ["materials"]
        self.user.role.save()
        forbidden = self.receive(headers={"HTTP_AUTHORIZATION": f"Bearer {token}"})
        self.assertEqual(forbidden.status_code, 403, forbidden.content)


class PressLineupConcurrencyTests(LineupFixtures, TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_competing_reorders_cannot_silently_overwrite_each_other(self):
        serializer = ReorderLineupSerializer(data=self.payload())
        serializer.is_valid(raise_exception=True)
        start = Barrier(2)

        def reorder():
            close_old_connections()
            try:
                start.wait(timeout=10)
                reorder_press_lineup(serializer.validated_data, user=self.user)
                return 200
            except APIException as error:
                return error.status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = [future.result(timeout=30) for future in [executor.submit(reorder), executor.submit(reorder)]]
        self.assertEqual(sorted(results), [200, 409])
