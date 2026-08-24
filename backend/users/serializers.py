from rest_framework import serializers

from .constants import QUOTE_COMPANY_CHOICES
from .models import CompanyRole, CompanyUser


class CompanyRoleSerializer(serializers.ModelSerializer):
    allowedResourceKeys = serializers.JSONField(source="allowed_resource_keys")
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = CompanyRole
        fields = ["id", "name", "description", "allowedResourceKeys", "locked", "createdAt"]


class CompanyUserSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source="role.name")
    quoteCompany = serializers.ChoiceField(source="quote_company", choices=QUOTE_COMPANY_CHOICES, required=False)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = CompanyUser
        fields = ["id", "username", "password", "name", "role", "quoteCompany", "active", "createdAt"]

    def create(self, validated_data):
        password = validated_data.pop("password", "")
        role_data = validated_data.pop("role", {})
        role_name = role_data.get("name") or "CSR"
        role = CompanyRole.objects.get(name=role_name)
        user = CompanyUser(role=role, **validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", "")
        role_data = validated_data.pop("role", None)
        if role_data:
            instance.role = CompanyRole.objects.get(name=role_data.get("name"))
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance
