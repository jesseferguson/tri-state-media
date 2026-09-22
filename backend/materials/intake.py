"""Validate and receive a batch of identical physical rolls or containers."""

import hashlib
import json
from decimal import Decimal
from uuid import UUID

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.renderers import JSONRenderer

from .models import MaterialIntakeReceipt, MaterialMasterType, MaterialRack, MaterialSpec, RawMaterialInventory
from .serializers import RawMaterialInventorySerializer
from .services import MaterialWorkflowError


class IntakeMaterialSerializer(serializers.ModelSerializer):
    master_type_code = serializers.CharField(max_length=50, required=False, allow_blank=True)
    master_type = serializers.PrimaryKeyRelatedField(
        queryset=MaterialMasterType.objects.filter(is_active=True), required=False, allow_null=True,
    )
    liner_material = serializers.PrimaryKeyRelatedField(
        queryset=MaterialSpec.objects.filter(material_type="liner", is_active=True),
        required=False, allow_null=True,
    )
    adhesive_material = serializers.PrimaryKeyRelatedField(
        queryset=MaterialSpec.objects.filter(material_type="adhesive", is_active=True),
        required=False, allow_null=True,
    )

    class Meta:
        model = MaterialSpec
        fields = [
            "material_type", "master_type", "master_type_code", "name", "company",
            "material_family", "supplier", "liner_material", "adhesive_material", "code", "notes",
        ]
        extra_kwargs = {"name": {"required": False, "allow_blank": True}}

    def validate(self, attrs):
        master_type = attrs.get("master_type")
        master_type_code = attrs.get("master_type_code", "").upper()
        attrs["master_type_code"] = master_type_code
        if attrs["material_type"] == "coated_stock":
            if not master_type and master_type_code:
                master_type = MaterialMasterType.objects.filter(code__iexact=master_type_code).first()
                if master_type and not master_type.is_active:
                    raise serializers.ValidationError({"master_type_code": "This material type is inactive."})
                attrs["master_type"] = master_type
            if not master_type and not master_type_code:
                raise serializers.ValidationError({"master_type": "Select the finished material type, such as PMDT."})
        name = attrs.get("name") or (master_type.code if master_type else master_type_code)
        if not name:
            raise serializers.ValidationError({"name": "Enter the material name or type."})
        attrs["name"] = name
        try:
            attrs["material_family"] = self.fields["material_family"].run_validation(
                attrs.get("material_family") or name
            )
        except serializers.ValidationError as error:
            raise serializers.ValidationError({"material_family": error.detail}) from error
        return attrs

    def create(self, validated_data):
        master_type_code = validated_data.pop("master_type_code", "")
        if validated_data["material_type"] == "coated_stock" and not validated_data.get("master_type"):
            master_type, _ = MaterialMasterType.objects.get_or_create(
                code=master_type_code, defaults={"name": master_type_code},
            )
            validated_data["master_type"] = master_type

        # Missing component choices must not accidentally match a different recipe.
        lookup = {
            "material_type": validated_data["material_type"],
            "name__iexact": validated_data["name"],
            "company__iexact": validated_data.get("company", ""),
            "master_type": validated_data.get("master_type"),
            "liner_material": validated_data.get("liner_material"),
            "adhesive_material": validated_data.get("adhesive_material"),
        }
        material = MaterialSpec.objects.filter(**lookup).first()
        if material and not material.is_active:
            raise serializers.ValidationError({
                "create_material": {"name": ["This material already exists but is inactive. Reactivate it before receiving stock."]},
            })
        return material or MaterialSpec.objects.create(**validated_data)


class MaterialIntakeSerializer(RawMaterialInventorySerializer):
    material = serializers.PrimaryKeyRelatedField(
        queryset=MaterialSpec.objects.filter(is_active=True), required=False, allow_null=True,
    )
    create_material = IntakeMaterialSerializer(required=False, allow_null=True)
    roll_count = serializers.IntegerField(min_value=1, max_value=500, default=1)
    direct_rack = serializers.PrimaryKeyRelatedField(
        queryset=MaterialRack.objects.filter(status="active"), required=False, allow_null=True,
    )
    unit = serializers.ChoiceField(choices=RawMaterialInventory.UNIT_CHOICES, default="lf")
    inventory_origin = serializers.ChoiceField(choices=RawMaterialInventory.ORIGIN_CHOICES, default="legacy")
    received_date = serializers.DateField(required=False, allow_null=True)

    class Meta:
        model = RawMaterialInventory
        fields = [
            "material", "create_material", "roll_count", "supplier", "lot_number", "width_inches",
            "length_feet", "quantity", "weight_lbs", "unit", "inventory_origin", "received_date",
            "direct_rack", "location", "notes",
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if not attrs.get("material") and not attrs.get("create_material"):
            raise serializers.ValidationError({"material": "Select or create a material."})
        if attrs.get("material") and attrs.get("create_material"):
            raise serializers.ValidationError({"material": "Select an existing material or create a new one."})

        material = attrs.get("material")
        material_type = material.material_type if material else attrs["create_material"]["material_type"]
        requires_width = material_type in {"face", "liner", "coated_stock"} or attrs["unit"] in {"lf", "roll"}
        if requires_width and attrs.get("width_inches") is None:
            raise serializers.ValidationError({"width_inches": "Enter the roll width in inches."})

        amount_field = "length_feet" if attrs["unit"] == "lf" else "quantity"
        amount = attrs.get(amount_field)
        if amount is None or amount <= 0:
            raise serializers.ValidationError({amount_field: "Enter an amount greater than zero."})
        # Quantity and footage must agree, including their shared precision limit.
        try:
            attrs["quantity"] = self.fields["quantity"].run_validation(amount)
        except serializers.ValidationError as error:
            raise serializers.ValidationError({amount_field: error.detail}) from error
        if attrs["unit"] != "lf":
            attrs["length_feet"] = None
        for field in ["width_inches", "weight_lbs"]:
            if attrs.get(field) is not None and attrs[field] <= Decimal("0"):
                raise serializers.ValidationError({field: "Enter an amount greater than zero or leave this blank."})

        location = attrs.get("location")
        rack = attrs.get("direct_rack")
        if location and rack:
            raise serializers.ValidationError({"location": "Choose a floor location or a rack, not both."})
        if location and not location.is_active:
            raise serializers.ValidationError({"location": "Choose an active location."})
        if rack and rack.location_id and not rack.location.is_active:
            raise serializers.ValidationError({"direct_rack": "Choose a rack in an active location."})
        attrs["received_date"] = attrs.get("received_date") or timezone.localdate()
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        material_data = validated_data.pop("create_material", None)
        roll_count = validated_data.pop("roll_count")
        material = validated_data.pop("material", None)
        if material is None:
            material = self.fields["create_material"].create(material_data)
        validated_data["material"] = material
        if "supplier" not in validated_data:
            validated_data["supplier"] = material.supplier

        user = self.context["user"]
        created = []
        for _ in range(roll_count):
            inventory = RawMaterialInventory(**validated_data, status="available", is_active=True)
            inventory.save(inherit_material_supplier=False)
            inventory.movement_history.filter(action_type="roll_registered").update(
                actor_name=user.name or user.username,
                actor_user_id=str(user.pk),
                source="manual",
                notes=f"Material added through manual intake ({inventory.get_inventory_origin_display()}).",
            )
            created.append(inventory)
        return created


def receive_material_inventory(data, *, user, idempotency_key=None):
    """Commit stock and its replay response together; reserve keys using a DB constraint."""
    key = None
    request_hash = None
    if idempotency_key is not None:
        try:
            key = UUID(idempotency_key)
        except (ValueError, TypeError, AttributeError) as error:
            raise serializers.ValidationError({"idempotency_key": "Use a valid UUID for Idempotency-Key."}) from error
        try:
            canonical_data = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        except (TypeError, ValueError) as error:
            raise serializers.ValidationError({"detail": "Send the material receipt as JSON."}) from error
        request_hash = hashlib.sha256(canonical_data.encode("utf-8")).hexdigest()

    with transaction.atomic():
        receipt = None
        if key is not None:
            # A concurrent insert waits on the unique constraint. get_or_create then
            # returns the committed receipt, or creates one if the other attempt rolled back.
            receipt, is_new = MaterialIntakeReceipt.objects.get_or_create(
                user=user, idempotency_key=key, defaults={"request_hash": request_hash},
            )
            if not is_new:
                if receipt.request_hash != request_hash:
                    raise MaterialWorkflowError(
                        "This submission key was already used for different material details. Start a new submission.",
                        code="intake_request_conflict", status_code=409,
                    )
                return receipt.response

        serializer = MaterialIntakeSerializer(data=data, context={"user": user})
        serializer.is_valid(raise_exception=True)
        created = serializer.save()
        response_data = dict(RawMaterialInventorySerializer(created[0]).data)
        response_data["created_count"] = len(created)
        response_data["created_inventory"] = RawMaterialInventorySerializer(created, many=True).data
        response_data["total_received"] = created[0].quantity * len(created)
        if receipt is not None:
            # Store the same JSON values the API renders, including decimal totals.
            receipt.response = json.loads(JSONRenderer().render(response_data))
            receipt.save(update_fields=["response"])
            return receipt.response
        return response_data
