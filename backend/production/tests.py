from decimal import Decimal

from django.test import TestCase
from django.urls import reverse

from .models import CustomerOrder, CustomerOrderEvent, FinishedInventory, JobTicket, ProductionSchedule


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
