from rest_framework import serializers

from .models import (
    Category,
    Product,
    ProductVariant,
    Supplier,
    SupplierTransaction,
    ProductSpecification,
    SerialNumber,
)


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name_uz", "name_ru", "sort_order", "deleted_at"]


class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = [
            "id",
            "category",
            "name_uz",
            "name_ru",
            "name_uz_cyrillic",
            "custom_name_uz",
            "custom_name_ru",
            "custom_name_uz_cyrillic",
            "is_active",
            "deleted_at",
            "created_at",
            "updated_at",
        ]


class ProductVariantSerializer(serializers.ModelSerializer):
    """Full product variant serializer for admin/owner catalog management."""
    product_name_uz = serializers.CharField(source="product.name_uz", read_only=True)
    product_name_ru = serializers.CharField(source="product.name_ru", read_only=True)
    product_custom_name_uz = serializers.CharField(source="product.custom_name_uz", read_only=True, required=False)
    product_custom_name_ru = serializers.CharField(source="product.custom_name_ru", read_only=True, required=False)
    category_name_uz = serializers.CharField(source="product.category.name_uz", read_only=True)
    category_name_ru = serializers.CharField(source="product.category.name_ru", read_only=True)

    class Meta:
        model = ProductVariant
        fields = [
            "id",
            "product",
            "product_name_uz",
            "product_name_ru",
            "product_custom_name_uz",
            "product_custom_name_ru",
            "category_name_uz",
            "category_name_ru",
            "barcode",
            "purchase_price",
            "list_price",
            "stock_qty",
            "show_price_on_label",
            "hide_selling_price",
            "is_active",
            "deleted_at",
            "created_at",
            "updated_at",
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
    product_custom_name_uz = serializers.CharField(source="product.custom_name_uz", read_only=True, required=False, allow_null=True)
    product_custom_name_ru = serializers.CharField(source="product.custom_name_ru", read_only=True, required=False, allow_null=True)
    category_name_uz = serializers.CharField(source="product.category.name_uz", read_only=True)
    category_name_ru = serializers.CharField(source="product.category.name_ru", read_only=True)

    class Meta:
        model = ProductVariant
        fields = [
            "id",
            "product",
            "product_name_uz",
            "product_name_ru",
            "product_custom_name_uz",
            "product_custom_name_ru",
            "category_name_uz",
            "category_name_ru",
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
    product_custom_name_uz = serializers.CharField(source="product.custom_name_uz", read_only=True, required=False, allow_null=True)
    product_custom_name_ru = serializers.CharField(source="product.custom_name_ru", read_only=True, required=False, allow_null=True)

    class Meta:
        model = ProductVariant
        fields = [
            "id",
            "product",
            "product_name_uz",
            "product_name_ru",
            "product_custom_name_uz",
            "product_custom_name_ru",
            "barcode",
            "list_price",
            "stock_qty",
            "is_active",
            "deleted_at",
            "hide_selling_price",
        ]


class SimpleBulkCreateSerializer(serializers.Serializer):
    """Simplified bulk create for home appliances - no size/color matrix."""
    product_id = serializers.UUIDField()
    purchase_price = serializers.DecimalField(max_digits=12, decimal_places=2)
    list_price = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    initial_qty = serializers.IntegerField(required=False, default=0, min_value=0)
    barcode = serializers.CharField(max_length=64, required=False, allow_blank=True)


class BulkGridCellSerializer(serializers.Serializer):
    """For home-appliance flow - no size/color required."""
    purchase_price = serializers.DecimalField(max_digits=12, decimal_places=2)
    list_price = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    initial_qty = serializers.IntegerField(required=False, default=0, min_value=0)
    barcode = serializers.CharField(max_length=64, required=False, allow_blank=True)


class BulkGridSerializer(serializers.Serializer):
    """Simplified grid for appliance products - single variant per product."""
    product_id = serializers.UUIDField()
    matrix = BulkGridCellSerializer(many=True)

    def validate_matrix(self, value):
        seen_barcodes: set[str] = set()
        for row in value:
            barcode = (row.get("barcode") or "").strip()
            # If barcode is provided, ensure barcode uniqueness in payload.
            if barcode:
                if barcode in seen_barcodes:
                    raise serializers.ValidationError("Duplicate barcode in matrix payload")
                seen_barcodes.add(barcode)
        return value


class PosPriceUpdateSerializer(serializers.Serializer):
    list_price = serializers.DecimalField(max_digits=12, decimal_places=2)


class SupplierSerializer(serializers.ModelSerializer):
    """Supplier management for accounts payable tracking."""
    
    class Meta:
        model = Supplier
        fields = [
            "id",
            "name_uz",
            "name_ru",
            "name_uz_cyrillic",
            "phone",
            "address_uz",
            "address_ru",
            "note",
            "is_active",
            "created_at",
            "updated_at",
        ]


class SupplierTransactionSerializer(serializers.ModelSerializer):
    """Track individual supplier transactions for debt/credit."""
    
    supplier_name_uz = serializers.CharField(source="supplier.name_uz", read_only=True)
    supplier_name_ru = serializers.CharField(source="supplier.name_ru", read_only=True)
    recorded_by_username = serializers.CharField(source="recorded_by.username", read_only=True, allow_null=True)

    class Meta:
        model = SupplierTransaction
        fields = [
            "id",
            "supplier",
            "supplier_name_uz",
            "supplier_name_ru",
            "type",
            "amount",
            "description_uz",
            "description_ru",
            "note",
            "recorded_by",
            "recorded_by_username",
            "created_at",
        ]
        read_only_fields = ["recorded_by_username"]


class SupplierBalanceSerializer(serializers.Serializer):
    """Read-only: supplier balance summary."""
    
    supplier_id = serializers.UUIDField()
    supplier_name_uz = serializers.CharField()
    supplier_name_ru = serializers.CharField()
    total_debt = serializers.DecimalField(max_digits=14, decimal_places=2)
    total_credit = serializers.DecimalField(max_digits=14, decimal_places=2)
    balance = serializers.DecimalField(max_digits=14, decimal_places=2)  # debt - credit


class ProductSpecificationSerializer(serializers.ModelSerializer):
    """Product specifications for appliances (capacity, power, dimensions, etc.)."""
    
    product_name_uz = serializers.CharField(source="product.name_uz", read_only=True)
    product_name_ru = serializers.CharField(source="product.name_ru", read_only=True)

    class Meta:
        model = ProductSpecification
        fields = [
            "id",
            "product",
            "product_name_uz",
            "product_name_ru",
            "capacity",
            "power_consumption",
            "voltage",
            "dimensions",
            "weight",
            "color_options",
            "energy_class",
            "additional_specs",
            "created_at",
            "updated_at",
        ]


class SerialNumberSerializer(serializers.ModelSerializer):
    """Serial number tracking for individual units with warranty information."""
    
    variant_barcode = serializers.CharField(source="variant.barcode", read_only=True)
    product_name_uz = serializers.CharField(source="variant.product.name_uz", read_only=True)
    product_name_ru = serializers.CharField(source="variant.product.name_ru", read_only=True)
    category_name_uz = serializers.CharField(source="variant.product.category.name_uz", read_only=True)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True, allow_null=True)
    is_under_warranty = serializers.SerializerMethodField()

    class Meta:
        model = SerialNumber
        fields = [
            "id",
            "variant",
            "variant_barcode",
            "product_name_uz",
            "product_name_ru",
            "category_name_uz",
            "serial_number",
            "status",
            "warranty_months",
            "purchase_date",
            "sale_date",
            "warranty_expiry_date",
            "sale_line",
            "notes",
            "is_under_warranty",
            "created_at",
            "updated_at",
            "created_by",
            "created_by_username",
        ]
        read_only_fields = ["warranty_expiry_date", "is_under_warranty"]

    def get_is_under_warranty(self, obj):
        return obj.is_under_warranty()

    def create(self, validated_data):
        instance = super().create(validated_data)
        instance.calculate_warranty_expiry()
        instance.save()
        return instance

    def update(self, instance, validated_data):
        instance = super().update(instance, validated_data)
        instance.calculate_warranty_expiry()
        instance.save()
        return instance


class SerialNumberCreateSerializer(serializers.Serializer):
    """Simplified serializer for creating serial numbers in bulk."""
    
    variant_id = serializers.UUIDField()
    serial_number = serializers.CharField(max_length=100)
    warranty_months = serializers.IntegerField(default=12, min_value=0)
    purchase_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class WarrantyExpiringSerializer(serializers.Serializer):
    """Read-only: products with warranties expiring soon."""
    
    serial_number_id = serializers.UUIDField()
    serial_number = serializers.CharField()
    variant_id = serializers.UUIDField()
    variant_barcode = serializers.CharField()
    product_name_uz = serializers.CharField()
    product_name_ru = serializers.CharField()
    category_name_uz = serializers.CharField()
    sale_date = serializers.DateField()
    warranty_expiry_date = serializers.DateField()
    days_until_expiry = serializers.IntegerField()
