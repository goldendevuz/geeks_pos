from rest_framework import serializers

from .models import Category, Color, Product, ProductVariant, Size


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name_uz", "name_ru", "sort_order", "deleted_at"]


class SizeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Size
        fields = ["id", "value", "label_uz", "label_ru", "sort_order"]


class ColorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Color
        fields = ["id", "value", "label_uz", "label_ru", "sort_order"]


class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = [
            "id",
            "category",
            "name_uz",
            "name_ru",
            "is_active",
            "deleted_at",
        ]


class ProductVariantSerializer(serializers.ModelSerializer):
    product_name_uz = serializers.CharField(source="product.name_uz", read_only=True)
    product_name_ru = serializers.CharField(source="product.name_ru", read_only=True)
    category_name_uz = serializers.CharField(source="product.category.name_uz", read_only=True)
    category_name_ru = serializers.CharField(source="product.category.name_ru", read_only=True)
    size_label_uz = serializers.CharField(source="size.label_uz", read_only=True)
    size_label_ru = serializers.CharField(source="size.label_ru", read_only=True)
    color_label_uz = serializers.CharField(source="color.label_uz", read_only=True)
    color_label_ru = serializers.CharField(source="color.label_ru", read_only=True)

    class Meta:
        model = ProductVariant
        fields = [
            "id",
            "product",
            "product_name_uz",
            "product_name_ru",
            "category_name_uz",
            "category_name_ru",
            "size",
            "size_label_uz",
            "size_label_ru",
            "color",
            "color_label_uz",
            "color_label_ru",
            "barcode",
            "purchase_price",
            "list_price",
            "stock_qty",
            "is_active",
            "deleted_at",
        ]

    def update(self, instance, validated_data):
        # Stock is ledger-driven and must not be mutated from catalog edits.
        validated_data.pop("stock_qty", None)
        return super().update(instance, validated_data)


def _stock_row_show_purchase_price(request) -> bool:
    if not request or not getattr(request, "user", None) or not request.user.is_authenticated:
        return False
    from accounts.models import Role
    from accounts.views import _resolve_role

    return _resolve_role(request.user) in (Role.OWNER, Role.ADMIN)


class CashierStockRowSerializer(serializers.ModelSerializer):
    """Read-only catalog row for stock list; purchase_price only for owner/admin."""

    product_name_uz = serializers.CharField(source="product.name_uz", read_only=True)
    product_name_ru = serializers.CharField(source="product.name_ru", read_only=True)
    category_name_uz = serializers.CharField(source="product.category.name_uz", read_only=True)
    category_name_ru = serializers.CharField(source="product.category.name_ru", read_only=True)
    size_label_uz = serializers.CharField(source="size.label_uz", read_only=True)
    size_label_ru = serializers.CharField(source="size.label_ru", read_only=True)
    color_label_uz = serializers.CharField(source="color.label_uz", read_only=True)
    color_label_ru = serializers.CharField(source="color.label_ru", read_only=True)

    class Meta:
        model = ProductVariant
        fields = [
            "id",
            "product",
            "product_name_uz",
            "product_name_ru",
            "category_name_uz",
            "category_name_ru",
            "size",
            "size_label_uz",
            "size_label_ru",
            "color",
            "color_label_uz",
            "color_label_ru",
            "barcode",
            "list_price",
            "purchase_price",
            "stock_qty",
            "is_active",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if not _stock_row_show_purchase_price(request):
            data.pop("purchase_price", None)
        return data


class PosProductVariantSerializer(serializers.ModelSerializer):
    """POS / cashier: no purchase_price (financial field)."""

    product_name_uz = serializers.CharField(source="product.name_uz", read_only=True)
    product_name_ru = serializers.CharField(source="product.name_ru", read_only=True)
    size_label_uz = serializers.CharField(source="size.label_uz", read_only=True)
    size_label_ru = serializers.CharField(source="size.label_ru", read_only=True)
    color_label_uz = serializers.CharField(source="color.label_uz", read_only=True)
    color_label_ru = serializers.CharField(source="color.label_ru", read_only=True)

    class Meta:
        model = ProductVariant
        fields = [
            "id",
            "product",
            "product_name_uz",
            "product_name_ru",
            "size",
            "size_label_uz",
            "size_label_ru",
            "color",
            "color_label_uz",
            "color_label_ru",
            "barcode",
            "list_price",
            "stock_qty",
            "is_active",
            "deleted_at",
        ]


class BulkGridCellSerializer(serializers.Serializer):
    size_id = serializers.UUIDField()
    color_id = serializers.UUIDField()
    purchase_price = serializers.DecimalField(max_digits=12, decimal_places=2)
    list_price = serializers.DecimalField(max_digits=12, decimal_places=2)
    initial_qty = serializers.IntegerField(required=False, default=0, min_value=0)


class BulkGridSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    matrix = BulkGridCellSerializer(many=True)

    def validate_matrix(self, value):
        seen: set[tuple[str, str]] = set()
        for row in value:
            key = (str(row["size_id"]), str(row["color_id"]))
            if key in seen:
                raise serializers.ValidationError("Duplicate size/color pair in matrix payload.")
            seen.add(key)
        return value


class PosPriceUpdateSerializer(serializers.Serializer):
    list_price = serializers.DecimalField(max_digits=12, decimal_places=2)
