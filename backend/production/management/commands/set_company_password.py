import os

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth.password_validation import validate_password

from production.models import CompanyUser


class Command(BaseCommand):
    help = "Reset a CompanyUser password used by the production app sign-in screen."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--password", dest="password", help="New password. COMPANY_USER_PASSWORD is used if omitted.")
        parser.add_argument("--activate", action="store_true", help="Reactivate the user while resetting the password.")

    def handle(self, *args, **options):
        username = str(options["username"]).strip()
        password = options.get("password") or os.environ.get("COMPANY_USER_PASSWORD")
        if not password:
            raise CommandError("Provide --password or set COMPANY_USER_PASSWORD.")

        try:
            user = CompanyUser.objects.select_related("role").get(username__iexact=username)
        except CompanyUser.DoesNotExist as error:
            raise CommandError(f"Company user '{username}' was not found.") from error

        try:
            validate_password(password)
        except ValidationError as error:
            raise CommandError(" ".join(error.messages)) from error

        user.set_password(password)
        update_fields = ["password_hash", "updated_at"]
        if options["activate"] and not user.active:
            user.active = True
            update_fields.append("active")
        user.save(update_fields=update_fields)

        self.stdout.write(self.style.SUCCESS(f"Password reset for {user.username}."))
