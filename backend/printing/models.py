import uuid

from django.db import models


class StoreSettings(models.Model):
    class PrinterType(models.TextChoices):
        ESC_POS = "ESC_POS", "ESC/POS"
        TSPL = "TSPL", "TSPL"

    class ShopMode(models.TextChoices):
        FOOTWEAR_ONLY = "FOOTWEAR_ONLY", "Footwear only"
        CLOTHING_ONLY = "CLOTHING_ONLY", "Clothing only"
        MIXED = "MIXED", "Mixed"

    class ClothingGender(models.TextChoices):
        MALE = "MALE", "Male"
        FEMALE = "FEMALE", "Female"

    """Singleton-style store metadata for receipt header."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    brand_name = models.CharField(max_length=255, default="Geeks POS")
    phone = models.CharField(max_length=64, blank=True, default="")
    address = models.CharField(max_length=500, blank=True, default="")
    footer_note = models.CharField(max_length=500, blank=True, default="Rahmat!")
    logo = models.ImageField(upload_to="store_logos/", null=True, blank=True)

    # Printer language / encoding behavior
    encoding = models.CharField(max_length=32, default="cp866")
    transliterate_uz = models.BooleanField(default=True)
    # Chek matnlari tili: '' (avto — Accept-Language), yoki uz | ru | ky.
    receipt_lang = models.CharField(max_length=8, blank=True, default="")
    receipt_printer_name = models.CharField(max_length=255, blank=True, default="")
    receipt_printer_type = models.CharField(
        max_length=16,
        choices=PrinterType.choices,
        default=PrinterType.ESC_POS,
    )
    # Optional Windows port hint (e.g. USB001) for routing when multiple printers share model names.
    receipt_printer_port = models.CharField(max_length=64, blank=True, default="")
    label_printer_name = models.CharField(max_length=255, blank=True, default="")
    label_printer_type = models.CharField(
        max_length=16,
        choices=PrinterType.choices,
        default=PrinterType.TSPL,
    )
    # Optional Windows port hint (e.g. USB002) for label printer.
    label_printer_port = models.CharField(max_length=64, blank=True, default="")
    receipt_width = models.CharField(max_length=8, default="58mm")
    auto_print_on_sale = models.BooleanField(default=True)
    scanner_mode = models.CharField(max_length=16, default="keyboard")
    scanner_prefix = models.CharField(max_length=16, blank=True, default="")
    scanner_suffix = models.CharField(max_length=16, blank=True, default="\t")
    lock_timeout_minutes = models.PositiveSmallIntegerField(default=5)

    shop_mode = models.CharField(
        max_length=32,
        choices=ShopMode.choices,
        blank=True,
        default="",
    )
    setup_completed = models.BooleanField(default=False)
    default_clothing_gender = models.CharField(
        max_length=16,
        choices=ClothingGender.choices,
        blank=True,
        default="",
    )

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Store settings"
        verbose_name_plural = "Store settings"

    def __str__(self):
        return self.brand_name

    @classmethod
    def get_solo(cls):
        obj = cls.objects.order_by("updated_at").first()
        if obj:
            return obj
        return cls.objects.create(brand_name="Geeks POS")
