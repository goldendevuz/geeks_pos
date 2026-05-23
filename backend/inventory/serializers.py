from rest_framework import serializers

from .models import StocktakeLine, StocktakeSession

from .models import InventoryMovement


class ReceiveSerializer(serializers.Serializer):
    variant_id = serializers.UUIDField()
    qty = serializers.IntegerField(min_value=1)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class AdjustSerializer(serializers.Serializer):
    variant_id = serializers.UUIDField()
    qty_delta = serializers.IntegerField()
    note = serializers.CharField(required=False, allow_blank=True, default="")


class StocktakeSessionCreateSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True, default="")


class StocktakeCountSerializer(serializers.Serializer):
    variant_id = serializers.UUIDField()
    counted_qty = serializers.IntegerField(min_value=0)


class StocktakeLineSerializer(serializers.ModelSerializer):
    product_name_uz = serializers.CharField(source="variant.product.name_uz", read_only=True)
    product_name_ru = serializers.CharField(source="variant.product.name_ru", read_only=True)
    product_name_uz_cyrillic = serializers.CharField(
        source="variant.product.name_uz_cyrillic", read_only=True, required=False, allow_null=True
    )
    product_custom_name_uz = serializers.CharField(
        source="variant.product.custom_name_uz", read_only=True, required=False, allow_null=True
    )
    product_custom_name_ru = serializers.CharField(
        source="variant.product.custom_name_ru", read_only=True, required=False, allow_null=True
    )
    product_custom_name_uz_cyrillic = serializers.CharField(
        source="variant.product.custom_name_uz_cyrillic", read_only=True, required=False, allow_null=True
    )
    category_name_uz = serializers.CharField(source="variant.product.category.name_uz", read_only=True)
    category_name_ru = serializers.CharField(source="variant.product.category.name_ru", read_only=True)
    barcode = serializers.CharField(source="variant.barcode", read_only=True)
    color = serializers.CharField(source="variant.product.color", read_only=True, required=False, allow_null=True)

    class Meta:
        model = StocktakeLine
        fields = [
            "id",
            "variant",
            "product_name_uz",
            "product_name_ru",
            "product_name_uz_cyrillic",
            "product_custom_name_uz",
            "product_custom_name_ru",
            "product_custom_name_uz_cyrillic",
            "category_name_uz",
            "category_name_ru",
            "barcode",
            "color",
            "expected_qty",
            "counted_qty",
            "variance_qty",
        ]


class StocktakeSessionSerializer(serializers.ModelSerializer):
    lines = StocktakeLineSerializer(many=True, read_only=True)

    class Meta:
        model = StocktakeSession
        fields = ["id", "status", "note", "created_at", "applied_at", "lines"]
