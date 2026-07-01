import json
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from materials.models import CoaterRollTag, MaterialMasterType, MaterialSpec, MaterialUsage, RawMaterialInventory
from tooling.models import Press

from .models import (
    CustomerOrder,
    CustomerOrderEvent,
    FinishedInventory,
    JobTicket,
    JobTicketEvent,
    LiveFootageArchive,
    LocalLiveFootageReading,
    Message,
    MessageThread,
    ProductionMaterialAssignment,
    ProductionSchedule,
)


class FinishedInventoryOrderWorkflowTests(TestCase):
    def make_ticket(self, ticket_number="JT-100", product_code="TSM-100"):
        return JobTicket.objects.create(
            ticket_number=ticket_number,
            job_name="Test job",
            product_code=product_code,
            customer_name="Test Customer",
            face_type="Poly",
            liner_type="40",
            labels_per_unit=1000,
            units_per_carton=6,
        )

    def test_schedule_creates_short_order_number(self):
        ticket = self.make_ticket()
        schedule = ProductionSchedule.objects.create(
            job_ticket=ticket,
            quantity_to_ship=10,
            quantity_to_stock=5,
            scheduled_by="Tester",
        )

        order = CustomerOrder.objects.get(schedule_entry=schedule)

        self.assertRegex(order.order_number, r"^ORD\d{6}-\d{4}$")
        self.assertEqual(order.job_ticket, ticket)

    def test_receive_order_creates_linked_finished_inventory(self):
        ticket = self.make_ticket()
        schedule = ProductionSchedule.objects.create(job_ticket=ticket, quantity_to_stock=12)
        order = CustomerOrder.objects.get(schedule_entry=schedule)

        response = self.client.post(
            reverse("finished-inventory-receive-order"),
            {
                "order_number": order.order_number,
                "quantity": "12",
                "location": "Shipping A1",
                "received_by": "Shipping",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        item = FinishedInventory.objects.get()
        self.assertEqual(item.customer_order, order)
        self.assertEqual(item.job_ticket, ticket)
        self.assertEqual(item.order_number, order.order_number)
        self.assertEqual(item.quantity, Decimal("12"))
        self.assertEqual(item.location.name, "Shipping A1")
        self.assertTrue(CustomerOrderEvent.objects.filter(order=order, event_type="finished_inventory_received").exists())

    def test_receive_order_allows_manual_ticket_lookup_without_order_number(self):
        ticket = self.make_ticket(product_code="CLO-000-001")

        response = self.client.post(
            reverse("finished-inventory-receive-order"),
            {
                "ticket_lookup": "CLO-000-001",
                "quantity": "3",
                "location": "Rack 2",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        item = FinishedInventory.objects.get()
        self.assertIsNone(item.customer_order)
        self.assertEqual(item.job_ticket, ticket)
        self.assertEqual(item.quantity, Decimal("3"))


class JobTicketHistoryTests(TestCase):
    def test_patch_logs_actor_and_changed_fields(self):
        ticket = JobTicket.objects.create(
            ticket_number="JT-HIST-1",
            job_name="Old job",
            product_code="TSM-HIST-1",
            customer_name="Test Customer",
        )
        JobTicketEvent.objects.all().delete()

        response = self.client.patch(
            reverse("job-ticket-detail", args=[ticket.id]),
            {
                "job_name": "New job",
                "description": "Updated instructions",
                "performed_by": "Alex Operator",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        ticket.refresh_from_db()
        self.assertEqual(ticket.job_name, "Old job")
        self.assertEqual(ticket.description, "")

        event = JobTicketEvent.objects.get(job_ticket=ticket)
        self.assertEqual(event.event_type, "updated")
        self.assertEqual(event.performed_by, "Alex Operator")
        self.assertEqual(event.details["changes"][0]["field"], "job_name")
        self.assertEqual(event.details["changes"][0]["from"], "Old job")
        self.assertEqual(event.details["changes"][0]["to"], "New job")
        self.assertTrue(any(change["field"] == "description" for change in event.details["changes"]))
        self.assertEqual(event.details["approval"]["status"], "pending")
        self.assertEqual(event.details["pending_action"], "job_ticket_update")
        self.assertEqual(event.details["pending_payload"]["job_name"], "New job")
        self.assertEqual(event.details["pending_payload"]["description"], "Updated instructions")

        approval_response = self.client.post(
            reverse("job-ticket-event-approve", args=[event.id]),
            {
                "performed_by": "Manager",
            },
            content_type="application/json",
        )

        self.assertEqual(approval_response.status_code, 200, approval_response.content)
        ticket.refresh_from_db()
        self.assertEqual(ticket.job_name, "New job")
        self.assertEqual(ticket.description, "Updated instructions")
        event.refresh_from_db()
        self.assertEqual(event.details["approval"]["status"], "approved")
        self.assertEqual(event.details["approval"]["reviewed_by"], "Manager")

    def test_schedule_is_blocked_while_ticket_change_is_pending(self):
        ticket = JobTicket.objects.create(
            ticket_number="JT-HIST-2",
            job_name="Pending job",
            product_code="TSM-HIST-2",
            customer_name="Test Customer",
        )
        JobTicketEvent.objects.create(
            job_ticket=ticket,
            event_type="updated",
            summary="Alex requested a change.",
            performed_by="Alex Operator",
            details={
                "changes": [{"field": "job_name", "label": "Job Name", "from": "Pending job", "to": "Changed"}],
                "pending_action": "job_ticket_update",
                "pending_payload": {"job_name": "Changed"},
                "approval": {"status": "pending", "requested_by": "Alex Operator"},
            },
        )

        response = self.client.post(
            reverse("production-schedule-list"),
            {
                "job_ticket": ticket.id,
                "quantity_to_ship": "10",
                "quantity_to_stock": "0",
                "scheduled_by": "Scheduler",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("pending change request", str(response.json()["job_ticket"]))


class MessageWorkflowTests(TestCase):
    def test_threads_show_unread_count_and_mark_read(self):
        thread = MessageThread.objects.create(
            title="Quote approval",
            participant_user_ids=["1", "2"],
            participant_names=["CSR", "Manager"],
            created_by_user_id="1",
            created_by_name="CSR",
        )
        message = Message.objects.create(
            thread=thread,
            sender_user_id="2",
            sender_name="Manager",
            body="Please check the margin.",
            read_by_user_ids=["2"],
        )

        response = self.client.get(reverse("message-thread-list"), {"viewer": "1"})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["results"][0]["unreadCount"], 1)

        mark_read_response = self.client.post(
            reverse("message-thread-mark-read", args=[thread.id]),
            {"viewer": "1"},
            content_type="application/json",
        )

        self.assertEqual(mark_read_response.status_code, 200, mark_read_response.content)
        message.refresh_from_db()
        self.assertIn("1", message.read_by_user_ids)


class LiveFootageArchiveTests(TestCase):
    def archive_payload(self, total="12345.6"):
        return {
            "shift_date": "2026-05-27",
            "shift_start": "2026-05-27T05:00:00-04:00",
            "shift_end": "2026-05-28T02:59:00-04:00",
            "total_footage": total,
            "goal_footage": "400000",
            "press_totals": [
                {"key": "ETI", "name": "ETI", "total": 10000},
                {"key": "13NIL", "name": "13 Nilpeter", "total": 2345.6},
            ],
        }

    def test_archive_shift_creates_daily_live_footage_record(self):
        response = self.client.post(
            reverse("live-footage-archive-archive-shift"),
            self.archive_payload(),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        archive = LiveFootageArchive.objects.get(shift_date="2026-05-27")
        self.assertEqual(archive.total_footage, Decimal("12345.60"))
        self.assertEqual(archive.goal_footage, Decimal("400000.00"))
        self.assertEqual(archive.press_totals[0]["key"], "ETI")

    def test_archive_shift_keeps_higher_existing_total(self):
        self.client.post(
            reverse("live-footage-archive-archive-shift"),
            self.archive_payload(total="15000"),
            content_type="application/json",
        )
        response = self.client.post(
            reverse("live-footage-archive-archive-shift"),
            self.archive_payload(total="12000"),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        archive = LiveFootageArchive.objects.get(shift_date="2026-05-27")
        self.assertEqual(archive.total_footage, Decimal("15000.00"))


class LocalLiveFootageTests(TestCase):
    def test_local_relay_saves_speed_and_footage_without_firebase(self):
        speed_response = self.client.put(
            reverse("local-live-footage-relay", args=["eti", "speed"]),
            {"currentSpeed": 123, "timestamp": 1782760000},
            content_type="application/json",
        )
        footage_response = self.client.post(
            reverse("local-live-footage-relay", args=["eti", "daily"]),
            {"footage": 42.5, "timestamp": 1782760015},
            content_type="application/json",
        )

        self.assertEqual(speed_response.status_code, 200, speed_response.content)
        self.assertEqual(footage_response.status_code, 200, footage_response.content)
        self.assertEqual(LocalLiveFootageReading.objects.count(), 2)
        self.assertEqual(LocalLiveFootageReading.objects.get(kind="speed").speed_fpm, 123)
        self.assertEqual(LocalLiveFootageReading.objects.get(kind="footage").footage, Decimal("42.50"))

    def test_local_snapshot_returns_database_values(self):
        LocalLiveFootageReading.objects.create(press_key="ETI", press_name="ETI", kind="speed", speed_fpm=88)
        LocalLiveFootageReading.objects.create(press_key="ETI", press_name="ETI", kind="footage", footage=Decimal("12.50"))

        response = self.client.get(reverse("local-live-footage-snapshot"))

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["mode"], "local_database_only")
        eti = next(row for row in response.json()["presses"] if row["key"] == "ETI")
        self.assertEqual(eti["speed"], 88)
        self.assertEqual(eti["totalFootage"], 12.5)


class ScheduledMaterialWorkflowTests(TestCase):
    def setUp(self):
        self.master = MaterialMasterType.objects.create(code="PM", name="PM")
        self.other_master = MaterialMasterType.objects.create(code="PET", name="PET")
        self.material = MaterialSpec.objects.create(
            material_type="coated_stock",
            code="PM-40-3180",
            name="PM",
            master_type=self.master,
        )
        self.other_material = MaterialSpec.objects.create(
            material_type="coated_stock",
            code="PET-40-3180",
            name="PET",
            master_type=self.other_master,
        )
        face = MaterialSpec.objects.create(material_type="face", code="FACE-TEST", name="Face")
        liner = MaterialSpec.objects.create(material_type="liner", code="LINER-TEST", name="Liner")
        adhesive = MaterialSpec.objects.create(material_type="adhesive", code="ADH-TEST", name="Adhesive")
        silicone = MaterialSpec.objects.create(material_type="silicone", code="SIL-TEST", name="Silicone")
        self.roll_tag = CoaterRollTag.objects.create(
            name="PM roll",
            status="complete",
            liner=liner,
            face=face,
            adhesive=adhesive,
            silicone=silicone,
            produced_material=self.material,
            result_lot_number="LOT-TSM-100",
            result_serial_number="CRT-100",
            width_inches=Decimal("12.75"),
            length_feet=Decimal("10000"),
            log_inventory=False,
        )
        self.tsm_inventory = RawMaterialInventory.objects.create(
            material=self.material,
            serial_number="CRT-100",
            lot_number="LOT-TSM-100",
            width_inches=Decimal("12.75"),
            length_feet=Decimal("10000"),
            quantity=Decimal("10000"),
            source_roll_tag=self.roll_tag,
        )
        self.purchased_inventory = RawMaterialInventory.objects.create(
            material=self.material,
            serial_number="PURCHASED-100",
            lot_number="SUPPLIER-LOT",
            width_inches=Decimal("12.75"),
            length_feet=Decimal("25000"),
            quantity=Decimal("25000"),
        )
        self.wrong_inventory = RawMaterialInventory.objects.create(
            material=self.other_material,
            serial_number="PET-ROLL-1",
            lot_number="PET-LOT-1",
            length_feet=Decimal("5000"),
            quantity=Decimal("5000"),
        )
        self.ticket = JobTicket.objects.create(
            ticket_number="JT-MAT-1",
            job_name="PM job",
            product_code="PM-4-65-R",
            material_master_type=self.master,
        )
        self.schedule = ProductionSchedule.objects.create(
            job_ticket=self.ticket,
            target_footage=Decimal("20000"),
            scheduled_by="Scheduler",
        )

    def test_scanner_only_accepts_compatible_tsm_roll(self):
        response = self.client.get(
            reverse("production-material-assignment-scan-roll"),
            {"production_schedule": self.schedule.id, "scan": "LOT-TSM-100"},
        )
        wrong_response = self.client.get(
            reverse("production-material-assignment-scan-roll"),
            {"production_schedule": self.schedule.id, "scan": "PET-ROLL-1"},
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["inventory"]["id"], self.tsm_inventory.id)
        self.assertEqual(wrong_response.status_code, 409, wrong_response.content)

    def test_purchased_roll_requires_five_digit_carton_stamp(self):
        bad = self.client.post(
            reverse("production-material-assignment-list"),
            {
                "production_schedule": self.schedule.id,
                "inventory": self.purchased_inventory.id,
                "source_type": "outsourced",
                "carton_lot_code": "1234",
            },
            content_type="application/json",
        )
        good = self.client.post(
            reverse("production-material-assignment-list"),
            {
                "production_schedule": self.schedule.id,
                "inventory": self.purchased_inventory.id,
                "source_type": "outsourced",
                "carton_lot_code": "12345",
            },
            content_type="application/json",
        )

        self.assertEqual(bad.status_code, 400, bad.content)
        self.assertEqual(good.status_code, 201, good.content)

    def test_partial_use_adds_buffer_and_bad_roll_goes_on_hold(self):
        assignment = ProductionMaterialAssignment.objects.create(
            production_schedule=self.schedule,
            inventory=self.tsm_inventory,
            source_type="tsm",
            assigned_by="Operator",
        )
        partial = self.client.post(
            reverse("production-material-assignment-record-usage", args=[assignment.id]),
            {"mode": "partial", "footage_used": "1000", "used_by": "Operator"},
            content_type="application/json",
        )
        bad = self.client.post(
            reverse("production-material-assignment-record-usage", args=[assignment.id]),
            {
                "mode": "partial",
                "footage_used": "100",
                "mark_bad": True,
                "notes": "Coating streak made the remaining roll unrunnable.",
                "used_by": "Operator",
            },
            content_type="application/json",
        )

        self.assertEqual(partial.status_code, 200, partial.content)
        self.assertEqual(Decimal(str(partial.json()["deducted_footage"])), Decimal("1030.000"))
        self.assertEqual(bad.status_code, 200, bad.content)
        self.tsm_inventory.refresh_from_db()
        assignment.refresh_from_db()
        self.assertEqual(self.tsm_inventory.status, "on_hold")
        self.assertEqual(assignment.status, "rejected")
        self.assertTrue(MaterialUsage.objects.filter(inventory=self.tsm_inventory, usage_type="qc_issue").exists())

    def test_shift_report_updates_schedule_handoff_progress(self):
        response = self.client.post(
            reverse("production-shift-report-list"),
            {
                "production_schedule": self.schedule.id,
                "operator": "Levi",
                "report_date": "2026-07-01",
                "shift_start": "2026-07-01T03:00:00-04:00",
                "shift_end": "2026-07-02T03:00:00-04:00",
                "total_footage": "8500",
                "good_footage": "8000",
                "material_footage": "8755",
                "outcome": "end_shift",
                "created_by": "Levi",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.schedule.refresh_from_db()
        self.assertEqual(self.schedule.actual_footage, Decimal("8000"))
        self.assertEqual(self.schedule.status, "running")
        detail = self.client.get(reverse("production-schedule-detail", args=[self.schedule.id]))
        self.assertEqual(Decimal(str(detail.json()["footage_remaining"])), Decimal("12000"))
        self.assertEqual(Decimal(str(detail.json()["reported_waste_footage"])), Decimal("500"))


class JobTicketPrintQueueTests(TestCase):
    class FirebaseResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return b'{"name":"firebase-job-1"}'

    def test_queue_print_label_posts_legacy_payload_to_firebase(self):
        ticket = JobTicket.objects.create(
            ticket_number="JT-PRINT",
            job_name="PM-2-1-R",
            product_code="TSM-PRINT",
            customer_name="Abe Tech",
            description="2 x 1 PM Label",
            carton_label_part_number="PM-2-1-R",
            carton_label_description_a="2 x 1 PM Label",
            carton_label_finishing_1="1000 labels/roll",
            carton_label_finishing_2="4000 labels/carton",
        )
        press = Press.objects.create(
            name="ETI",
            printer_ip="192.168.1.55",
            printer_queue_key="ETI",
            printer_speed="7",
            printer_darkness="12",
        )

        with patch("production.views.urlopen", return_value=self.FirebaseResponse()) as mocked_urlopen:
            response = self.client.post(
                reverse("job-ticket-queue-print-label", args=[ticket.id]),
                {
                    "press": press.id,
                    "template": "BARCODE",
                    "total": 2,
                    "lot_number": "LOT-1",
                    "starting_number": "100",
                    "ending_number": "199",
                    "po": "PO-77",
                    "printer_ip": "192.168.1.88",
                    "printer_port": 9101,
                    "speed": "8",
                    "darkness": "14",
                    "save_printer_settings": True,
                    "performed_by": "Shipping",
                },
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 201, response.content)
        firebase_request = mocked_urlopen.call_args.args[0]
        self.assertIn(
            "https://realtime-database-8bbe2-default-rtdb.firebaseio.com/TEST_PRINT_SERVER_JOBS/SHARED.json",
            firebase_request.full_url,
        )
        self.assertEqual(
            response.json()["firebasePath"],
            "/TEST_PRINT_SERVER_JOBS/SHARED/firebase-job-1",
        )
        body = json.loads(firebase_request.data.decode("utf-8"))
        self.assertEqual(body["TYPE"], "BARCODE")
        self.assertEqual(body["Printer"], "192.168.1.88")
        self.assertEqual(body["Printer Port"], 9101)
        self.assertEqual(body["SPEED"], "8")
        self.assertEqual(body["DARKNESS"], "14")
        self.assertEqual(body["line"], "PM-2-1-R")
        self.assertEqual(body["Starting Number"], "100")
        self.assertEqual(body["Ending Number"], "199")
        press.refresh_from_db()
        self.assertEqual(press.printer_ip, "192.168.1.88")
        self.assertEqual(press.printer_port, 9101)
        self.assertEqual(press.printer_speed, "8")
        self.assertEqual(press.printer_darkness, "14")
        self.assertTrue(response.json()["printerSettingsSaved"])
        self.assertTrue(JobTicketEvent.objects.filter(job_ticket=ticket, event_type="print_queued").exists())

    def test_unique_dow_carton_label_uses_saved_ticket_format(self):
        ticket = JobTicket.objects.create(
            ticket_number="JT-DOW",
            job_name="DOW-ROLL",
            product_code="DOW-100",
            customer_name="DOW",
            description="DOW carton product",
            carton_label_is_unique=True,
            carton_label_format="dow_carton",
        )
        press = Press.objects.create(
            name="13 Aztech",
            printer_ip="192.168.1.90",
            printer_queue_key="13_Aztech",
        )

        with patch("production.views.urlopen", return_value=self.FirebaseResponse()) as mocked_urlopen:
            response = self.client.post(
                reverse("job-ticket-queue-print-label", args=[ticket.id]),
                {
                    "press": press.id,
                    "lot_number": "LOT-DOW-42",
                    "po": "PO-88110",
                },
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 201, response.content)
        firebase_request = mocked_urlopen.call_args.args[0]
        body = json.loads(firebase_request.data.decode("utf-8"))
        self.assertEqual(body["TYPE"], "DOWCARTONLABEL")
        self.assertEqual(body["Lot Number"], "LOT-DOW-42")
        self.assertEqual(body["PO"], "PO-88110")
