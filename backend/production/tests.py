import json
from decimal import Decimal
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIRequestFactory

from materials.models import CoaterRollTag, MaterialMasterType, MaterialSpec, MaterialUsage, RawMaterialInventory
from tooling.models import FlexDie, Press, Supplier, ToolingLocation

from .models import (
    Customer,
    CustomerAddress,
    CustomerContact,
    CustomerInteraction,
    CustomerInteractionHistory,
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
    QuoteRecord,
)
from users.auth import CompanyUserTokenAuthentication, create_company_user_token
from users.models import CompanyRole, CompanyUser


SECURE_REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "users.auth.CompanyUserTokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "users.auth.HasCompanyResourceAccess",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
}


@override_settings(
    API_AUTH_REQUIRED=True,
    BLOCK_LEGACY_DEFAULT_ADMIN_PASSWORD=True,
    REST_FRAMEWORK=SECURE_REST_FRAMEWORK,
)
class ApiAuthSecurityTests(TestCase):
    def setUp(self):
        self.role, _ = CompanyRole.objects.get_or_create(name="Admin", defaults={"allowed_resource_keys": ["*"]})
        self.user = CompanyUser(username="secure-admin", name="Secure Admin", role=self.role, active=True)
        self.user.set_password("StrongPass7&")
        self.user.save()

    def test_api_requires_signed_company_user_token(self):
        factory = APIRequestFactory()
        authenticator = CompanyUserTokenAuthentication()
        self.assertIsNone(authenticator.authenticate(factory.get("/api/company-users/")))
        self.assertEqual(authenticator.authenticate_header(factory.get("/api/company-users/")), "Bearer")

        sign_in = self.client.post(
            reverse("company-sign-in"),
            {"username": "secure-admin", "password": "StrongPass7&"},
            content_type="application/json",
        )
        self.assertEqual(sign_in.status_code, 200, sign_in.content)
        token = sign_in.json()["token"]

        request = factory.get("/api/company-users/", HTTP_AUTHORIZATION=f"Bearer {token}")
        authenticated_user, _token = authenticator.authenticate(request)
        self.assertEqual(authenticated_user.pk, self.user.pk)

    def test_inactive_user_token_returns_auth_failure(self):
        token = create_company_user_token(self.user)
        self.user.active = False
        self.user.save(update_fields=["active"])

        response = self.client.get(reverse("company-user-list"), HTTP_AUTHORIZATION=f"Bearer {token}")

        self.assertEqual(response.status_code, 401, response.content)
        self.assertEqual(response["WWW-Authenticate"], "Bearer")
        self.assertIn("no longer active", response.json()["detail"])

    def test_legacy_default_admin_password_is_blocked(self):
        legacy_password = "Blue" "labels7&"
        admin, _ = CompanyUser.objects.get_or_create(username="admin", defaults={"name": "Admin", "role": self.role})
        admin.role = self.role
        admin.active = True
        admin.set_password(legacy_password)
        admin.save()

        response = self.client.post(
            reverse("company-sign-in"),
            {"username": "admin", "password": legacy_password},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("legacy default admin password is blocked", response.json()["error"])

    def test_non_admin_company_access_payloads_are_scoped_to_self(self):
        csr_role = CompanyRole.objects.create(name="CSRT", allowed_resource_keys=["job-tickets", "customers"])
        shipping_role = CompanyRole.objects.create(name="Shipping", allowed_resource_keys=["finished-inventory"])
        rachel = CompanyUser(username="rachel", name="Rachel", role=csr_role, active=True, default_landing_page="customers")
        rachel.set_password("StrongPass7&")
        rachel.save()
        other_user = CompanyUser(username="other-user", name="Other User", role=shipping_role, active=True)
        other_user.set_password("StrongPass7&")
        other_user.save()

        def results(payload):
            return payload.get("results", payload) if isinstance(payload, dict) else payload

        rachel_sign_in = self.client.post(
            reverse("company-sign-in"),
            {"username": "rachel", "password": "StrongPass7&"},
            content_type="application/json",
        )
        self.assertEqual(rachel_sign_in.status_code, 200, rachel_sign_in.content)
        rachel_payload = rachel_sign_in.json()
        self.assertEqual(rachel_payload["user"]["defaultLandingPage"], "customers")
        self.assertEqual([user["username"] for user in rachel_payload["users"]], ["rachel"])
        self.assertEqual([role["name"] for role in rachel_payload["roles"]], ["CSRT"])

        auth_header = f"Bearer {rachel_payload['token']}"
        preference_response = self.client.patch(
            reverse("company-user-detail", args=[rachel.pk]),
            data=json.dumps({
                "defaultLandingPage": "job-tickets",
                "pinnedMenuPages": ["customers", "job-tickets"],
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=auth_header,
        )
        self.assertEqual(preference_response.status_code, 200, preference_response.content)
        self.assertEqual(preference_response.json()["defaultLandingPage"], "job-tickets")
        self.assertEqual(preference_response.json()["pinnedMenuPages"], ["customers", "job-tickets"])
        rachel.refresh_from_db()
        self.assertEqual(rachel.default_landing_page, "job-tickets")
        self.assertEqual(rachel.pinned_menu_pages, ["customers", "job-tickets"])

        other_preference_response = self.client.patch(
            reverse("company-user-detail", args=[other_user.pk]),
            data=json.dumps({"defaultLandingPage": "finished-inventory"}),
            content_type="application/json",
            HTTP_AUTHORIZATION=auth_header,
        )
        self.assertEqual(other_preference_response.status_code, 403, other_preference_response.content)

        users_response = self.client.get(reverse("company-user-list"), HTTP_AUTHORIZATION=auth_header)
        roles_response = self.client.get(reverse("company-role-list"), HTTP_AUTHORIZATION=auth_header)
        self.assertEqual(users_response.status_code, 200, users_response.content)
        self.assertEqual(roles_response.status_code, 200, roles_response.content)
        self.assertEqual([user["username"] for user in results(users_response.json())], ["rachel"])
        self.assertEqual([role["name"] for role in results(roles_response.json())], ["CSRT"])

        admin_sign_in = self.client.post(
            reverse("company-sign-in"),
            {"username": "secure-admin", "password": "StrongPass7&"},
            content_type="application/json",
        )
        self.assertEqual(admin_sign_in.status_code, 200, admin_sign_in.content)
        admin_payload = admin_sign_in.json()
        self.assertIn("rachel", {user["username"] for user in admin_payload["users"]})
        self.assertIn("other-user", {user["username"] for user in admin_payload["users"]})
        self.assertIn("CSRT", {role["name"] for role in admin_payload["roles"]})
        self.assertIn("Shipping", {role["name"] for role in admin_payload["roles"]})

    def test_csr_can_load_production_schedule_startup_endpoints(self):
        csr_role = CompanyRole.objects.create(
            name="CSR Startup",
            allowed_resource_keys=[
                "quote-calculator",
                "customers",
                "job-tickets",
                "production-schedule",
                "customer-orders",
                "footage-reports",
            ],
        )
        rachel = CompanyUser(username="rachel-csr", name="Rachel CSR", role=csr_role, active=True)
        rachel.set_password("StrongPass7&")
        rachel.save()

        sign_in = self.client.post(
            reverse("company-sign-in"),
            {"username": "rachel-csr", "password": "StrongPass7&"},
            content_type="application/json",
        )
        self.assertEqual(sign_in.status_code, 200, sign_in.content)
        auth_header = f"Bearer {sign_in.json()['token']}"

        for label, path in [
            ("schedule", "/api/production-schedule/?page_size=15"),
            ("job tickets", "/api/job-tickets/?page_size=1000"),
            ("raw materials", "/api/raw-materials/?material_type=coated_stock&page_size=1000"),
            ("recipe options", "/api/recipe-options/?page_size=1000"),
            ("box inventory", "/api/box-inventory/?page_size=250"),
            ("core inventory", "/api/core-inventory/?page_size=250"),
            ("message threads", f"/api/message-threads/?viewer={rachel.pk}&page_size=100"),
            ("current user", "/api/company-users/?page_size=500"),
            ("current role", "/api/company-roles/?page_size=100"),
        ]:
            response = self.client.get(path, HTTP_AUTHORIZATION=auth_header)
            self.assertEqual(response.status_code, 200, f"{label}: {response.content!r}")

    def test_job_ticket_image_preview_does_not_expose_public_storage_url(self):
        image_role = CompanyRole.objects.create(
            name="Image Viewer",
            allowed_resource_keys=["job-tickets", "job-ticket-images"],
        )
        no_image_role = CompanyRole.objects.create(
            name="Ticket Only",
            allowed_resource_keys=["job-tickets"],
        )
        image_user = CompanyUser(username="image-viewer", name="Image Viewer", role=image_role, active=True)
        image_user.set_password("StrongPass7&")
        image_user.save()
        ticket_user = CompanyUser(username="ticket-only", name="Ticket Only", role=no_image_role, active=True)
        ticket_user.set_password("StrongPass7&")
        ticket_user.save()
        ticket = JobTicket.objects.create(
            ticket_number="JT-PRIVATE-IMAGE",
            job_name="Private Image Job",
            product_code="TSM-PRIVATE",
            customer_name="Private Customer",
            general_image=SimpleUploadedFile(
                "private-artwork.gif",
                b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;",
                content_type="image/gif",
            ),
            general_image_name="Private Artwork",
        )

        detail = self.client.get(
            reverse("job-ticket-detail", args=[ticket.pk]),
            HTTP_AUTHORIZATION=f"Bearer {create_company_user_token(image_user)}",
        )
        self.assertEqual(detail.status_code, 200, detail.content)
        image_url = detail.json()["job_images"][0]["url"]
        self.assertIn(f"/api/job-tickets/{ticket.pk}/images/general/preview/", image_url)
        self.assertNotIn("/media/", image_url)
        self.assertNotIn("private-artwork.gif", image_url)

        unauthenticated = self.client.get(reverse("job-ticket-image-preview", args=[ticket.pk, "general"]))
        self.assertEqual(unauthenticated.status_code, 401, unauthenticated.content)

        denied = self.client.get(
            reverse("job-ticket-image-preview", args=[ticket.pk, "general"]),
            HTTP_AUTHORIZATION=f"Bearer {create_company_user_token(ticket_user)}",
        )
        self.assertEqual(denied.status_code, 403, denied.content)

        allowed = self.client.get(
            reverse("job-ticket-image-preview", args=[ticket.pk, "general"]),
            HTTP_AUTHORIZATION=f"Bearer {create_company_user_token(image_user)}",
        )
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed["Content-Type"], "image/gif")
        self.assertIn('filename="Private Artwork.gif"', allowed["Content-Disposition"])
        self.assertTrue(b"".join(allowed.streaming_content).startswith(b"GIF89a"))


class DataImportToolingTests(TestCase):
    def test_legacy_flex_die_export_imports_flex_and_rotary_records(self):
        csv_text = "\n".join([
            "Row ID,Number,SizeAcross,SizeAround,LabelRepeat,ColSpace,CornerRadius,NoAcross,NoAround,LinerCaliper,FaceStock,Gear,Manufacturer,SerialNumber,Shape,Cut Position,Tooling Status,Description,ColSpace,Semi Rotary,Active",
            "RID-FLEX,FD-13-100,3,4,4.125,0.125,0.0625,2,1,40,Paper,99,Wilson Tool,FC123,RCR,Liner,In House (David's Dr),Legacy flex note,,false,true",
            "RID-FD-SEMI,FD-13R-009,6.5,12,12.125,0.125,0,2,1,40,Paper,97,Flex Supplier,MOD20-09-40133,RCR,Liner,In House (David's Dr),Semi Rotary,true,true",
            "RID-ROT,RD-13-009,6.5,12,12.125,0.125,0,2,1,40,Paper,97,Rotary Supplier,ROT20-09-40133,RCR,Liner,In House (David's Dr),Rotary die,,true",
            "RID-NAMELESS,,6.5,12,12.125,0.125,0,2,1,40,Paper,97,Unused Supplier,NO-NAME,RCR,Liner,In House (David's Dr),No visible shelf name,,true",
        ])
        upload = SimpleUploadedFile("legacy-flex-dies.csv", csv_text.encode("utf-8"), content_type="text/csv")

        response = self.client.post(
            reverse("data-import-csv", args=["flex_dies"]),
            {"file": upload, "dry_run": "false"},
        )

        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        self.assertEqual(payload["created"], 3)
        self.assertEqual(payload["skipped"], 1)
        self.assertEqual(payload["warning_count"], 2)

        flex_die = FlexDie.objects.get(name="FD-13-100")
        self.assertEqual(flex_die.tooling_kind, "flex_die")
        self.assertEqual(flex_die.supplier.name, "Wilson Tool")
        self.assertEqual(flex_die.label_width_inches, Decimal("3"))
        self.assertEqual(flex_die.gap_across_inches, Decimal("0.125"))
        self.assertEqual(flex_die.current_location.name, "In House (David's Dr)")
        self.assertIn("Legacy flex note", flex_die.notes)

        semi_rotary_named_fd = FlexDie.objects.get(name="FD-13R-009")
        self.assertEqual(semi_rotary_named_fd.tooling_kind, "flex_die")
        self.assertEqual(semi_rotary_named_fd.supplier.name, "Flex Supplier")

        rotary_die = FlexDie.objects.get(name="RD-13-009")
        self.assertEqual(rotary_die.tooling_kind, "rotary_die")
        self.assertEqual(rotary_die.supplier.name, "Rotary Supplier")
        self.assertEqual(rotary_die.gear, 97)

        self.assertTrue(Supplier.objects.filter(name="Wilson Tool").exists())
        self.assertFalse(FlexDie.objects.filter(name="RID-NAMELESS").exists())


class CustomerInteractionTests(TestCase):
    def setUp(self):
        self.role = CompanyRole.objects.create(name="Customer CRM", allowed_resource_keys=["customers", "customer-orders", "job-tickets"])
        self.user = CompanyUser.objects.create(username="customer-crm", name="Customer CRM", role=self.role, active=True)
        self.user.set_password("StrongPass7&")
        self.user.save()
        self.auth_header = f"Bearer {create_company_user_token(self.user)}"

    def make_customer_job(self):
        customer = Customer.objects.create(name="BCL Test", customer_code="BCL", account_owner="Missy")
        ticket = JobTicket.objects.create(
            ticket_number="JT-CRM-001",
            job_name="BCL Label Run",
            product_code="BCL-001",
            customer=customer,
            customer_name=customer.name,
        )
        schedule = ProductionSchedule.objects.create(
            job_ticket=ticket,
            customer=customer,
            quantity_to_ship=Decimal("2500"),
            scheduled_by="CSR",
        )
        order = CustomerOrder.objects.get(schedule_entry=schedule)
        quote = QuoteRecord.objects.create(
            external_id="crm-quote-001",
            quote_number="Q-CRM-001",
            customer=customer,
            job_ticket=ticket,
            job_ticket_number=ticket.ticket_number,
            customer_name=customer.name,
            job_name=ticket.job_name,
            product_code=ticket.product_code,
            form={"quantity": 2500},
            pricing={"sellPrice": 1250},
        )
        return customer, ticket, order, quote

    def test_customer_interaction_links_email_to_customer_order_job_and_quote(self):
        customer, ticket, order, quote = self.make_customer_job()
        occurred_at = timezone.now()

        response = self.client.post(
            reverse("customer-interaction-list"),
            {
                "customer": customer.id,
                "customer_order": order.id,
                "job_ticket": ticket.id,
                "quote": quote.id,
                "interaction_type": "email",
                "status": "waiting_customer",
                "subject": "BCL artwork approval",
                "body": "Customer needs to approve the latest artwork before scheduling.",
                "email_from": "csr@example.com",
                "email_to": "buyer@example.com",
                "email_url": "https://mail.example.com/thread/bcl-artwork",
                "occurred_at": occurred_at.isoformat(),
                "follow_up_date": timezone.localdate().isoformat(),
                "created_by": "Rachel",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["customer_name"], customer.name)
        self.assertEqual(data["order_number"], order.order_number)
        self.assertEqual(data["job_ticket_number"], ticket.ticket_number)
        self.assertEqual(data["quote_number"], quote.quote_number)

        interaction = CustomerInteraction.objects.get()
        self.assertEqual(interaction.customer, customer)
        self.assertEqual(interaction.customer_order, order)
        self.assertEqual(interaction.job_ticket, ticket)
        self.assertEqual(interaction.quote, quote)

        customer.refresh_from_db()
        self.assertIsNotNone(customer.last_contacted_at)

        list_response = self.client.get(reverse("customer-interaction-list"), {"customer": customer.id}, HTTP_AUTHORIZATION=self.auth_header)
        self.assertEqual(list_response.status_code, 200, list_response.content)
        results = list_response.json().get("results", list_response.json())
        self.assertEqual(len(results), 1)

    def test_customer_interaction_rejects_linked_record_from_another_customer(self):
        _, ticket, _, _ = self.make_customer_job()
        other_customer = Customer.objects.create(name="Other Customer")

        response = self.client.post(
            reverse("customer-interaction-list"),
            {
                "customer": other_customer.id,
                "job_ticket": ticket.id,
                "interaction_type": "job_comment",
                "status": "open",
                "subject": "Wrong customer",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("job_ticket", response.json())

    def test_customer_follow_up_accepts_multiple_jobs_and_quote_external_ids(self):
        customer, ticket, _, quote = self.make_customer_job()
        second_ticket = JobTicket.objects.create(
            ticket_number="JT-CRM-002",
            job_name="BCL Reorder",
            product_code="BCL-002",
            customer=customer,
            customer_name=customer.name,
        )
        second_quote = QuoteRecord.objects.create(
            external_id="crm-quote-002",
            quote_number="Q-CRM-002",
            customer=customer,
            job_ticket=second_ticket,
            job_ticket_number=second_ticket.ticket_number,
            customer_name=customer.name,
            job_name=second_ticket.job_name,
            product_code=second_ticket.product_code,
        )

        response = self.client.post(
            reverse("customer-interaction-list"),
            {
                "customer": customer.id,
                "related_job_tickets": [ticket.id, second_ticket.id],
                "quote": quote.external_id,
                "related_quotes": [quote.external_id, second_quote.external_id],
                "interaction_type": "call",
                "status": "open",
                "subject": "Review linked reorder work",
                "body": "Customer asked for an update on multiple open items.",
                "contact_first_name": "Avery",
                "contact_last_name": "Buyer",
                "contact_email": "avery@example.com",
                "contact_company": customer.name,
                "action_summary": "created follow-up",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(data["quote"], quote.external_id)
        self.assertEqual(set(data["related_quotes"]), {quote.external_id, second_quote.external_id})
        self.assertEqual(set(data["related_job_tickets"]), {ticket.id, second_ticket.id})
        self.assertEqual(len(data["related_quote_details"]), 2)
        self.assertEqual(len(data["related_job_ticket_details"]), 2)
        self.assertEqual(len(data["history_entries"]), 1)

        interaction = CustomerInteraction.objects.get(subject="Review linked reorder work")
        self.assertEqual(interaction.job_ticket, ticket)
        self.assertEqual(interaction.quote, quote)
        self.assertEqual(interaction.related_job_tickets.count(), 2)
        self.assertEqual(interaction.related_quotes.count(), 2)

        quote_response = self.client.get(
            reverse("customer-interaction-list"),
            {"quote": second_quote.external_id},
            HTTP_AUTHORIZATION=self.auth_header,
        )
        self.assertEqual(quote_response.status_code, 200, quote_response.content)
        self.assertEqual(len(quote_response.json().get("results", quote_response.json())), 1)

    def test_customer_follow_up_update_logs_history(self):
        customer, ticket, _, _ = self.make_customer_job()
        interaction = CustomerInteraction.objects.create(
            customer=customer,
            job_ticket=ticket,
            interaction_type="call",
            status="open",
            subject="Initial follow-up",
            body="Call the buyer.",
            created_by="Rachel",
        )

        response = self.client.patch(
            reverse("customer-interaction-detail", args=[interaction.id]),
            {
                "status": "waiting_customer",
                "body": "Left voicemail and emailed details.",
                "contact_first_name": "Avery",
                "contact_last_name": "Buyer",
                "action_summary": "updated notes and status",
                "updated_by": "Rachel",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 200, response.content)
        interaction.refresh_from_db()
        history = CustomerInteractionHistory.objects.filter(interaction=interaction)
        self.assertEqual(history.count(), 1)
        entry = history.first()
        self.assertEqual(entry.summary, "updated notes and status")
        self.assertEqual(entry.performed_by, "Rachel")
        self.assertIn("status", entry.changes)
        self.assertEqual(response.json()["history_entries"][0]["summary"], "updated notes and status")

    def test_customer_follow_up_promotes_new_contact_and_address_to_customer(self):
        customer, ticket, _, _ = self.make_customer_job()

        response = self.client.post(
            reverse("customer-interaction-list"),
            {
                "customer": customer.id,
                "job_ticket": ticket.id,
                "interaction_type": "call",
                "status": "open",
                "subject": "New shipping contact",
                "body": "Add Morgan for shipping follow-ups.",
                "contact_matches_customer": False,
                "contact_first_name": "Morgan",
                "contact_last_name": "Lee",
                "contact_role": "Shipping Manager",
                "contact_email": "morgan@example.com",
                "contact_phone": "555-0101",
                "contact_company": "BCL Warehouse",
                "address_matches_customer": False,
                "address_label": "Warehouse",
                "address_line_1": "25 Dock Road",
                "city": "Dayton",
                "state": "OH",
                "postal_code": "45402",
                "country": "USA",
                "action_summary": "created shipping follow-up",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 201, response.content)
        interaction = CustomerInteraction.objects.get(subject="New shipping contact")
        contact = CustomerContact.objects.get(customer=customer, email="morgan@example.com")
        address = CustomerAddress.objects.get(customer=customer, address_line_1="25 Dock Road")
        self.assertEqual(contact.role, "Shipping Manager")
        self.assertEqual(contact.phone, "555-0101")
        self.assertEqual(address.label, "Warehouse")
        self.assertEqual(interaction.customer_contact, contact)
        self.assertEqual(interaction.customer_address, address)
        data = response.json()
        self.assertEqual(data["customer_contact"], contact.id)
        self.assertEqual(data["customer_address"], address.id)
        self.assertEqual(data["customer_contact_detail"]["role"], "Shipping Manager")
        self.assertEqual(data["customer_address_detail"]["city"], "Dayton")

    def test_customer_follow_up_reuses_existing_contact_and_address(self):
        customer, ticket, _, _ = self.make_customer_job()
        contact = CustomerContact.objects.create(
            customer=customer,
            first_name="Morgan",
            last_name="Lee",
            email="morgan@example.com",
            is_primary=True,
        )
        address = CustomerAddress.objects.create(
            customer=customer,
            label="Warehouse",
            address_line_1="25 Dock Road",
            city="Dayton",
            state="OH",
            postal_code="45402",
            country="USA",
            is_primary=True,
        )

        response = self.client.post(
            reverse("customer-interaction-list"),
            {
                "customer": customer.id,
                "job_ticket": ticket.id,
                "customer_contact": contact.id,
                "customer_address": address.id,
                "interaction_type": "email",
                "status": "waiting_customer",
                "subject": "Warehouse check",
                "body": "Sent warehouse confirmation.",
                "contact_first_name": "Morgan",
                "contact_last_name": "Lee",
                "contact_role": "Shipping Manager",
                "contact_email": "morgan@example.com",
                "address_label": "Warehouse",
                "address_line_1": "25 Dock Road",
                "city": "Dayton",
                "state": "OH",
                "postal_code": "45402",
                "country": "USA",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(CustomerContact.objects.filter(customer=customer).count(), 1)
        self.assertEqual(CustomerAddress.objects.filter(customer=customer).count(), 1)
        contact.refresh_from_db()
        self.assertEqual(contact.role, "Shipping Manager")
        self.assertEqual(response.json()["customer_contact"], contact.id)
        self.assertEqual(response.json()["customer_address"], address.id)

    def test_customer_list_returns_saved_contacts_and_addresses(self):
        customer, _, _, _ = self.make_customer_job()
        CustomerContact.objects.create(
            customer=customer,
            first_name="Avery",
            last_name="Buyer",
            email="avery@example.com",
            is_primary=True,
        )
        CustomerAddress.objects.create(
            customer=customer,
            label="Office",
            address_line_1="10 Main Street",
            city="Dayton",
            state="OH",
            is_primary=True,
        )

        response = self.client.get(reverse("customer-list"), HTTP_AUTHORIZATION=self.auth_header)

        self.assertEqual(response.status_code, 200, response.content)
        rows = response.json().get("results", response.json())
        data = next(row for row in rows if row["id"] == customer.id)
        self.assertEqual(data["contacts"][0]["email"], "avery@example.com")
        self.assertEqual(data["addresses"][0]["address_line_1"], "10 Main Street")

    def test_customer_create_accepts_primary_contact_and_address(self):
        response = self.client.post(
            reverse("customer-list"),
            data=json.dumps({
                "name": "Nested Customer",
                "customer_code": "NC-001",
                "account_owner": "Rachel",
                "crm_stage": "prospect",
                "next_follow_up": "2026-09-01",
                "primary_contact": {
                    "first_name": "Avery",
                    "last_name": "Buyer",
                    "role": "Purchasing",
                    "email": "avery@example.com",
                    "phone": "555-0100",
                    "company": "Nested Customer",
                    "notes": "Primary buyer",
                },
                "primary_address": {
                    "label": "Office",
                    "address_line_1": "10 Main Street",
                    "city": "Dayton",
                    "state": "OH",
                    "postal_code": "45402",
                    "country": "USA",
                },
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        customer = Customer.objects.get(name="Nested Customer")
        contact = CustomerContact.objects.get(customer=customer)
        address = CustomerAddress.objects.get(customer=customer)
        self.assertTrue(contact.is_primary)
        self.assertTrue(address.is_primary)
        self.assertEqual(customer.contact_name, "Avery Buyer")
        self.assertEqual(customer.email, "avery@example.com")
        self.assertEqual(customer.address_line_1, "10 Main Street")
        self.assertEqual(data["contacts"][0]["role"], "Purchasing")
        self.assertEqual(data["addresses"][0]["label"], "Office")

    def test_customer_update_edits_existing_primary_contact_and_address(self):
        customer, _, _, _ = self.make_customer_job()
        contact = CustomerContact.objects.create(customer=customer, first_name="Avery", last_name="Buyer", email="avery@example.com", is_primary=True)
        address = CustomerAddress.objects.create(customer=customer, label="Office", address_line_1="10 Main Street", city="Dayton", is_primary=True)

        response = self.client.patch(
            reverse("customer-detail", args=[customer.id]),
            data=json.dumps({
                "account_owner": "Missy",
                "primary_contact": {
                    "id": contact.id,
                    "first_name": "Avery",
                    "last_name": "Buyer",
                    "role": "Senior Buyer",
                    "email": "avery.new@example.com",
                    "phone": "555-0200",
                    "company": customer.name,
                },
                "primary_address": {
                    "id": address.id,
                    "label": "Warehouse",
                    "address_line_1": "25 Dock Road",
                    "city": "Dayton",
                    "state": "OH",
                    "postal_code": "45404",
                    "country": "USA",
                },
            }),
            content_type="application/json",
            HTTP_AUTHORIZATION=self.auth_header,
        )

        self.assertEqual(response.status_code, 200, response.content)
        customer.refresh_from_db()
        contact.refresh_from_db()
        address.refresh_from_db()
        self.assertEqual(customer.account_owner, "Missy")
        self.assertEqual(customer.email, "avery.new@example.com")
        self.assertEqual(customer.phone, "555-0200")
        self.assertEqual(customer.address_line_1, "25 Dock Road")
        self.assertEqual(contact.role, "Senior Buyer")
        self.assertEqual(address.label, "Warehouse")
        self.assertEqual(CustomerContact.objects.filter(customer=customer).count(), 1)
        self.assertEqual(CustomerAddress.objects.filter(customer=customer).count(), 1)


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
        ticket.job_notes = "Run this job with the operator setup note."
        ticket.save(update_fields=["job_notes"])
        schedule = ProductionSchedule.objects.create(
            job_ticket=ticket,
            quantity_to_ship=10,
            quantity_to_stock=5,
            scheduled_by="Tester",
            notes="CSR context for this scheduled run.",
        )

        order = CustomerOrder.objects.get(schedule_entry=schedule)

        self.assertRegex(order.order_number, r"^ORD\d{6}-\d{4}$")
        self.assertEqual(order.job_ticket, ticket)
        self.assertEqual(order.operator_note, ticket.job_notes)

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

    def test_move_item_merges_into_matching_finished_inventory(self):
        ticket = self.make_ticket()
        source_location = ToolingLocation.objects.create(
            name="Finished A1",
            code="FIN-A1",
            inventory_scope="finished_product",
        )
        destination_location = ToolingLocation.objects.create(
            name="Finished B1",
            code="FIN-B1",
            inventory_scope="finished_product",
        )
        source = FinishedInventory.objects.create(
            name="Test job",
            sku="TSM-100",
            job_ticket=ticket,
            quantity=Decimal("4"),
            unit="carton",
            location=source_location,
        )
        destination = FinishedInventory.objects.create(
            name="Test job",
            sku="TSM-100",
            job_ticket=ticket,
            quantity=Decimal("3"),
            unit="carton",
            location=destination_location,
        )

        response = self.client.post(
            reverse("finished-inventory-move-item", args=[source.id]),
            {
                "quantity": "4",
                "location": destination_location.id,
                "moved_by": "Warehouse",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        source.refresh_from_db()
        destination.refresh_from_db()
        self.assertEqual(source.quantity, Decimal("0"))
        self.assertEqual(source.status, "moved")
        self.assertEqual(destination.quantity, Decimal("7"))
        self.assertTrue(response.json()["merged"])
        self.assertFalse(response.json()["mixed"])
        self.assertTrue(MaterialUsage.objects.filter(finished_inventory=destination, usage_type="adjustment").exists())

    def test_move_item_to_location_with_different_item_reports_mixed(self):
        source_ticket = self.make_ticket(ticket_number="JT-101", product_code="TSM-101")
        other_ticket = self.make_ticket(ticket_number="JT-102", product_code="TSM-102")
        source_location = ToolingLocation.objects.create(
            name="Finished A2",
            code="FIN-A2",
            inventory_scope="finished_product",
        )
        destination_location = ToolingLocation.objects.create(
            name="Finished C1",
            code="FIN-C1",
            inventory_scope="finished_product",
        )
        source = FinishedInventory.objects.create(
            name="Item One",
            sku="TSM-101",
            job_ticket=source_ticket,
            quantity=Decimal("5"),
            unit="carton",
            location=source_location,
        )
        FinishedInventory.objects.create(
            name="Item Two",
            sku="TSM-102",
            job_ticket=other_ticket,
            quantity=Decimal("2"),
            unit="carton",
            location=destination_location,
        )

        response = self.client.post(
            reverse("finished-inventory-move-item", args=[source.id]),
            {
                "quantity": "5",
                "location": destination_location.id,
                "moved_by": "Warehouse",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200, response.content)
        source.refresh_from_db()
        self.assertEqual(source.location, destination_location)
        self.assertEqual(source.quantity, Decimal("5"))
        self.assertEqual(source.status, "available")
        self.assertFalse(response.json()["merged"])
        self.assertTrue(response.json()["mixed"])
        self.assertIn("mixed skid", response.json()["completed"])


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
            "shift_end": "2026-05-28T02:20:00-04:00",
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


class EtiDeviceSettingsTests(TestCase):
    class FirebaseResponse:
        status = 200

        def __init__(self, body=b"null"):
            self.body = body

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self):
            return self.body

    def setUp(self):
        self.admin_role, _ = CompanyRole.objects.get_or_create(name="Admin")
        self.admin = CompanyUser.objects.create(
            username="settings-admin",
            name="Settings Admin",
            password_hash="unused",
            role=self.admin_role,
        )
        self.headers = {
            "HTTP_X_COMPANY_USER_ID": str(self.admin.id),
            "HTTP_X_COMPANY_USERNAME": self.admin.username,
        }

    def test_non_admin_cannot_read_device_settings(self):
        production_role, _ = CompanyRole.objects.get_or_create(name="Production")
        operator = CompanyUser.objects.create(
            username="operator",
            name="Operator",
            password_hash="unused",
            role=production_role,
        )

        with patch("production.views.urlopen") as mocked_urlopen:
            response = self.client.get(
                reverse("eti-device-settings"),
                HTTP_X_COMPANY_USER_ID=str(operator.id),
                HTTP_X_COMPANY_USERNAME=operator.username,
            )

        self.assertEqual(response.status_code, 403, response.content)
        mocked_urlopen.assert_not_called()

    def test_browser_preflight_allows_admin_identity_headers(self):
        response = self.client.options(
            reverse("eti-device-settings"),
            HTTP_ORIGIN="https://tri-state-media-front-end.onrender.com",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="x-company-user-id,x-company-username",
        )

        self.assertEqual(response.status_code, 200, response.content)
        allowed_headers = response.headers.get("access-control-allow-headers", "").lower()
        self.assertIn("x-company-user-id", allowed_headers)
        self.assertIn("x-company-username", allowed_headers)

    def test_admin_reads_firebase_settings_merged_with_defaults(self):
        firebase_body = json.dumps({
            "wheelDiameterInches": 4.25,
            "speedSendSeconds": 90,
        }).encode("utf-8")

        with patch("production.views.urlopen", return_value=self.FirebaseResponse(firebase_body)) as mocked_urlopen:
            response = self.client.get(reverse("eti-device-settings"), **self.headers)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["settings"]["wheelDiameterInches"], 4.25)
        self.assertEqual(response.json()["settings"]["speedSendSeconds"], 90)
        self.assertEqual(response.json()["settings"]["footageSendSeconds"], 300)
        firebase_request = mocked_urlopen.call_args.args[0]
        self.assertEqual(firebase_request.get_method(), "GET")
        self.assertTrue(firebase_request.full_url.endswith("/ETI_DEVICE_SETTINGS.json"))

    def test_admin_saves_validated_device_settings(self):
        payload = {
            "wheelDiameterInches": 3.5,
            "pulsesPerRevolution": 2,
            "settingsCheckSeconds": 240,
            "speedSendSeconds": 120,
            "footageSendSeconds": 480,
            "resetEnabled": True,
            "resetHour": 3,
            "resetMinute": 15,
        }

        with patch("production.views.urlopen", return_value=self.FirebaseResponse()) as mocked_urlopen:
            response = self.client.put(
                reverse("eti-device-settings"),
                payload,
                content_type="application/json",
                **self.headers,
            )

        self.assertEqual(response.status_code, 200, response.content)
        firebase_request = mocked_urlopen.call_args.args[0]
        self.assertEqual(firebase_request.get_method(), "PUT")
        self.assertIn("/ETI_DEVICE_SETTINGS.json?print=silent", firebase_request.full_url)
        body = json.loads(firebase_request.data.decode("utf-8"))
        self.assertEqual(body["wheelDiameterInches"], 3.5)
        self.assertEqual(body["footageSendSeconds"], 480)
        self.assertTrue(body["resetEnabled"])
        self.assertEqual(body["updatedBy"], "Settings Admin")

    def test_invalid_device_setting_does_not_reach_firebase(self):
        with patch("production.views.urlopen") as mocked_urlopen:
            response = self.client.put(
                reverse("eti-device-settings"),
                {
                    "wheelDiameterInches": 0,
                    "pulsesPerRevolution": 1,
                    "settingsCheckSeconds": 300,
                    "speedSendSeconds": 120,
                    "footageSendSeconds": 300,
                    "resetEnabled": False,
                    "resetHour": 3,
                    "resetMinute": 0,
                },
                content_type="application/json",
                **self.headers,
            )

        self.assertEqual(response.status_code, 400, response.content)
        mocked_urlopen.assert_not_called()


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


class LiveFootageRelayTests(TestCase):
    class FirebaseResponse:
        status = 204

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

    def test_speed_relay_forwards_device_health_to_firebase(self):
        payload = {
            "currentSpeed": 247,
            "timestamp": 1782760000,
            "device": {
                "wifi": True,
                "lastHttp": -1,
                "lastMessage": "Connection refused",
            },
        }

        with patch("production.views.urlopen", return_value=self.FirebaseResponse()) as mocked_urlopen:
            response = self.client.put(
                reverse("live-footage-relay", args=["eti", "speed"]),
                payload,
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200, response.content)
        firebase_request = mocked_urlopen.call_args.args[0]
        self.assertEqual(firebase_request.get_method(), "PUT")
        body = json.loads(firebase_request.data.decode("utf-8"))
        self.assertEqual(body["currentSpeed"], 247)
        self.assertEqual(body["device"]["lastMessage"], "Connection refused")

    def test_relay_maps_all_esp32_press_nodes(self):
        cases = [
            ("18azt", "speed", "put", "/18Aztech_CURRENT_SPEED.json?print=silent"),
            ("18azt", "daily", "post", "/18Aztech_SPEED.json?print=silent"),
            ("17nil", "speed", "put", "/17Nilpeter_CURRENT_SPEED.json?print=silent"),
            ("17nil", "daily", "post", "/17Nilpeter_SPEED.json?print=silent"),
        ]

        for press, kind, method, expected_path in cases:
            with self.subTest(press=press, kind=kind):
                payload = {"currentSpeed": 100, "timestamp": 1782760000} if kind == "speed" else {"footage": 12.5, "timestamp": 1782760000}
                with patch("production.views.urlopen", return_value=self.FirebaseResponse()) as mocked_urlopen:
                    request_method = getattr(self.client, method)
                    response = request_method(
                        reverse("live-footage-relay", args=[press, kind]),
                        payload,
                        content_type="application/json",
                    )

                self.assertEqual(response.status_code, 200, response.content)
                firebase_request = mocked_urlopen.call_args.args[0]
                self.assertTrue(firebase_request.full_url.endswith(expected_path), firebase_request.full_url)


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
                "shift_start": "2026-07-01T05:00:00-04:00",
                "shift_end": "2026-07-02T02:20:00-04:00",
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

    def test_shift_report_accepts_coater_schedule_without_job_ticket(self):
        press = Press.objects.create(name="ETI")
        material = MaterialSpec.objects.create(material_type="coated_stock", code="PM-40-2417", name="PM-40-2417")
        liner = MaterialSpec.objects.create(material_type="liner", code="40", name="40 Liner")
        face = MaterialSpec.objects.create(material_type="face", code="PM", name="PM Face")
        adhesive = MaterialSpec.objects.create(material_type="adhesive", code="2417", name="2417 Adhesive")
        silicone = MaterialSpec.objects.create(material_type="silicone", code="STD", name="Standard Silicone")
        coater_schedule = CoaterRollTag.objects.create(
            name="PM-40-2417",
            status="running",
            produced_material=material,
            liner=liner,
            face=face,
            adhesive=adhesive,
            silicone=silicone,
            length_feet=Decimal("100000"),
            press=press,
            log_inventory=False,
        )

        response = self.client.post(
            reverse("production-shift-report-list"),
            {
                "coater_schedule": coater_schedule.id,
                "press": press.id,
                "operator": "Levi",
                "suboperator": "Night Helper",
                "report_date": "2026-07-01",
                "shift_start": "2026-07-01T08:00:00-04:00",
                "shift_end": "2026-07-01T08:01:00-04:00",
                "total_footage": "5000",
                "good_footage": "5000",
                "material_footage": "5000",
                "outcome": "end_shift",
                "created_by": "Levi",
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["coater_schedule"], coater_schedule.id)
        self.assertEqual(body["coater_schedule_tag_number"], coater_schedule.tag_number)
        self.assertEqual(body["schedule_reference"], coater_schedule.tag_number)
        self.assertEqual(body["display_job_name"], "PM-40-2417")
        self.assertEqual(body["suboperator"], "Night Helper")


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
            "https://realtime-database-8bbe2-default-rtdb.firebaseio.com/TEST_PRESS_001/print_node.json",
            firebase_request.full_url,
        )
        self.assertEqual(
            response.json()["firebasePath"],
            "/TEST_PRESS_001/print_node/firebase-job-1",
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
