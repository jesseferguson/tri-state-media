from django.contrib.auth.hashers import check_password, make_password
from django.db import models

from .constants import QUOTE_COMPANY_CHOICES


class CompanyRole(models.Model):
    name = models.CharField(max_length=80, unique=True)
    description = models.CharField(max_length=255, blank=True)
    allowed_resource_keys = models.JSONField(default=list, blank=True)
    locked = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "production_companyrole"
        ordering = ["name"]

    def __str__(self):
        return self.name


class CompanyUser(models.Model):
    username = models.CharField(max_length=80, unique=True)
    name = models.CharField(max_length=150)
    password_hash = models.CharField(max_length=255)
    role = models.ForeignKey(CompanyRole, on_delete=models.PROTECT, related_name="users")
    quote_company = models.CharField(max_length=40, choices=QUOTE_COMPANY_CHOICES, default="tri_state_media")
    default_landing_page = models.CharField(max_length=120, blank=True, default="")
    pinned_menu_pages = models.JSONField(default=list, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "production_companyuser"
        ordering = ["name", "username"]

    def __str__(self):
        return f"{self.name} / {self.username}"

    @property
    def is_authenticated(self):
        return True

    def get_username(self):
        return self.username

    def get_full_name(self):
        return self.name or self.username

    def set_password(self, raw_password):
        self.password_hash = make_password(raw_password)

    def check_password(self, raw_password):
        return check_password(raw_password, self.password_hash)
