import uuid

from django.conf import settings
from django.db import models


class Category(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name_uz = models.CharField(max_length=255)
    name_ru = models.CharField(max_length=255)
    sort_order = models.PositiveIntegerField(default=0)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name_plural = "categories"
        ordering = ["sort_order", "name_uz"]


class Product(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, related_name="products"
    )
    name_uz = models.CharField(max_length=255)
    name_ru = models.CharField(max_length=255)
    name_uz_cyrillic = models.CharField(max_length=255, null=True, blank=True)
    custom_name_uz = models.CharField(max_length=255, null=True, blank=True)
    custom_name_ru = models.CharField(max_length=255, null=True, blank=True)
    custom_name_uz_cyrillic = models.CharField(max_length=255, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name_uz"]


class ProductVariant(models.Model):
    """
    Simplified product variant for home appliance retail.
    Each variant represents a unique product (identified by barcode).
    No size/color dimensions - products are identified by brand and model only.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(
        Product, on_delete=models.CASCADE, related_name="variants"
    )
    barcode = models.CharField(max_length=64, null=True, blank=True, unique=True)
    purchase_price = models.DecimalField(max_digits=12, decimal_places=2)
    list_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    stock_qty = models.PositiveIntegerField(default=0)
    show_price_on_label = models.BooleanField(default=True)
    hide_selling_price = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=models.Q(stock_qty__gte=0),
                name="variant_stock_non_negative",
            ),
        ]
        indexes = [
            models.Index(fields=["product", "is_active"]),
            models.Index(fields=["barcode"]),
            models.Index(fields=["stock_qty"]),
        ]

    def __str__(self):
        return f"{self.product.name_uz} ({self.barcode})"

    def save(self, *args, **kwargs):
        if self.pk is None:
            self.pk = uuid.uuid4()
        if not self.barcode:
            from .barcodes import allocate_unique_barcode

            self.barcode = allocate_unique_barcode(self)
        super().save(*args, **kwargs)


class Supplier(models.Model):
    """Supplier/Provider information for accounts payable tracking."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name_uz = models.CharField(max_length=255)
    name_ru = models.CharField(max_length=255)
    contact_person = models.CharField(max_length=255, null=True, blank=True)
    phone = models.CharField(max_length=20, null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    address = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name_uz"]

    def __str__(self):
        return self.name_uz


class SupplierTransaction(models.Model):
    """Track supplier debt and credit transactions for accountability."""
    class Type(models.TextChoices):
        PURCHASE = "PURCHASE", "Purchase (Debt)"
        PAYMENT = "PAYMENT", "Payment (Reduces Debt)"
        RETURN = "RETURN", "Return (Credit)"
        CREDIT_MEMO = "CREDIT_MEMO", "Credit Memo"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    supplier = models.ForeignKey(
        Supplier, on_delete=models.PROTECT, related_name="transactions"
    )
    type = models.CharField(max_length=16, choices=Type.choices)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    description_uz = models.CharField(max_length=500, blank=True)
    description_ru = models.CharField(max_length=500, blank=True)
    note = models.TextField(blank=True)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="supplier_transactions"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["supplier", "-created_at"]),
            models.Index(fields=["type", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.supplier.name_uz} - {self.get_type_display()} - {self.amount}"


class ProductSpecification(models.Model):
    """Store technical specifications for appliances (capacity, power, dimensions, etc.)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.OneToOneField(
        Product, on_delete=models.CASCADE, related_name="specifications"
    )
    # Common appliance specifications
    capacity = models.CharField(max_length=100, blank=True, help_text="e.g., 330L, 7kg")
    power_consumption = models.CharField(max_length=100, blank=True, help_text="e.g., 150W, 2.5kW")
    voltage = models.CharField(max_length=50, blank=True, help_text="e.g., 220V, 110-240V")
    dimensions = models.CharField(max_length=100, blank=True, help_text="e.g., 60x65x185cm")
    weight = models.CharField(max_length=50, blank=True, help_text="e.g., 65kg")
    color_options = models.CharField(max_length=200, blank=True, help_text="e.g., White, Silver, Black")
    energy_class = models.CharField(max_length=20, blank=True, help_text="e.g., A++, A+, B")
    # Flexible JSON field for additional specs
    additional_specs = models.JSONField(default=dict, blank=True, help_text="Additional specifications as key-value pairs")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Product Specification"
        verbose_name_plural = "Product Specifications"

    def __str__(self):
        return f"Specs for {self.product.name_uz}"


class SerialNumber(models.Model):
    """Track individual unit serial numbers for warranty and service tracking."""
    class Status(models.TextChoices):
        IN_STOCK = "IN_STOCK", "In Stock"
        SOLD = "SOLD", "Sold"
        RETURNED = "RETURNED", "Returned"
        DEFECTIVE = "DEFECTIVE", "Defective"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    variant = models.ForeignKey(
        ProductVariant, on_delete=models.PROTECT, related_name="serial_numbers"
    )
    serial_number = models.CharField(max_length=100, unique=True, db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.IN_STOCK)
    # Warranty tracking
    warranty_months = models.PositiveIntegerField(default=12, help_text="Warranty period in months")
    purchase_date = models.DateField(null=True, blank=True, help_text="Date purchased from supplier")
    sale_date = models.DateField(null=True, blank=True, help_text="Date sold to customer")
    warranty_expiry_date = models.DateField(null=True, blank=True, help_text="Calculated warranty expiry date")
    # References
    sale_line = models.ForeignKey(
        "sales.SaleLine", on_delete=models.SET_NULL, null=True, blank=True, related_name="serial_numbers"
    )
    # Additional tracking
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="created_serial_numbers"
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["variant", "status"]),
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["warranty_expiry_date"]),
            models.Index(fields=["sale_date"]),
        ]

    def __str__(self):
        return f"{self.serial_number} - {self.variant.product.name_uz}"

    def calculate_warranty_expiry(self):
        """Calculate warranty expiry date based on sale date and warranty months."""
        if self.sale_date and self.warranty_months:
            from dateutil.relativedelta import relativedelta
            self.warranty_expiry_date = self.sale_date + relativedelta(months=self.warranty_months)
        return self.warranty_expiry_date

    def is_under_warranty(self):
        """Check if the product is still under warranty."""
        if not self.warranty_expiry_date:
            return False
        from django.utils import timezone
        return timezone.now().date() <= self.warranty_expiry_date
