from django.contrib import admin

from .models import CompanyRole, CompanyUser


@admin.register(CompanyRole)
class CompanyRoleAdmin(admin.ModelAdmin):
    list_display = ("name", "description", "locked", "updated_at")
    list_filter = ("locked",)
    search_fields = ("name", "description", "allowed_resource_keys")
    readonly_fields = ("created_at", "updated_at")


@admin.register(CompanyUser)
class CompanyUserAdmin(admin.ModelAdmin):
    list_display = ("name", "username", "role", "quote_company", "default_landing_page", "active", "updated_at")
    list_filter = ("role", "quote_company", "active")
    search_fields = ("name", "username", "role__name", "pinned_menu_pages")
    autocomplete_fields = ("role",)
    readonly_fields = ("created_at", "updated_at")
