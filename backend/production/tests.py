from decimal import Decimal

from django.test import TestCase
from django.urls import reverse

from .models import CustomerOrder, CustomerOrderEvent, FinishedInventory, JobTicket, JobTicketEvent, LiveFootageArchive, Message, MessageThread, ProductionSchedule


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
