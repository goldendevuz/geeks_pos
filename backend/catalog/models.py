import uuid

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


class ProductKind(models.TextChoices):
    FOOTWEAR = "FOOTWEAR", "Footwear"
    CLOTHING = "CLOTHING", "Clothing"


class ClothingGender(models.TextChoices):
    MALE = "MALE", "Male"
    FEMALE = "FEMALE", "Female"
    UNISEX = "UNISEX", "Unisex"


class AgeBand(models.TextChoices):
    CHILDREN = "children", "Children"
    TEEN = "teen", "Teen"
    ADULT = "adult", "Adult"


class Size(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    value = models.CharField(max_length=32)
    label_uz = models.CharField(max_length=64)
    label_ru = models.CharField(max_length=64)
    sort_order = models.PositiveIntegerField(default=0)
    kind = models.CharField(
        max_length=16,
        choices=ProductKind.choices,
        blank=True,
        default="",
    )
    age_band = models.CharField(
        max_length=16,
        choices=AgeBand.choices,
        blank=True,
        default="",
    )
    gender = models.CharField(
        max_length=16,
        choices=ClothingGender.choices,
        blank=True,
        default="",
    )

    class Meta:
        ordering = ["sort_order", "value"]


class Color(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    value = models.CharField(max_length=32)
    label_uz = models.CharField(max_length=64)
    label_ru = models.CharField(max_length=64)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "value"]


class Product(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, related_name="products"
    )
    name_uz = models.CharField(max_length=255)
    name_ru = models.CharField(max_length=255)
    kind = models.CharField(
        max_length=16,
        choices=ProductKind.choices,
        default=ProductKind.FOOTWEAR,
    )
    gender = models.CharField(
        max_length=16,
        choices=ClothingGender.choices,
        blank=True,
        default="",
    )
    age_band = models.CharField(
        max_length=16,
        choices=AgeBand.choices,
        default=AgeBand.ADULT,
    )
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["name_uz"]


class ProductVariant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(
        Product, on_delete=models.CASCADE, related_name="variants"
    )
    size = models.ForeignKey(Size, on_delete=models.PROTECT)
    color = models.ForeignKey(Color, on_delete=models.PROTECT)
    barcode = models.CharField(max_length=64, null=True, blank=True, unique=True)
    purchase_price = models.DecimalField(max_digits=12, decimal_places=2)
    list_price = models.DecimalField(max_digits=12, decimal_places=2)
    stock_qty = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["product", "size", "color"],
                name="uniq_product_size_color",
            ),
            models.CheckConstraint(
                check=models.Q(stock_qty__gte=0),
                name="variant_stock_non_negative",
            ),
        ]
        indexes = [
            models.Index(fields=["product", "is_active"]),
        ]

    def __str__(self):
        return f"{self.product.name_uz} / {self.color.value} / {self.size.value}"

    def save(self, *args, **kwargs):
        if self.pk is None:
            self.pk = uuid.uuid4()
        if not self.barcode:
            from .barcodes import allocate_unique_barcode

            self.barcode = allocate_unique_barcode(self)
        super().save(*args, **kwargs)
