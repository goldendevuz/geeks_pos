import uuid

from django.db import models


class StoreSettings(models.Model):
    class PrinterType(models.TextChoices):
        ESC_POS = "ESC_POS", "ESC/POS"
        TSPL = "TSPL", "TSPL"

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
    
    # Inventory & Pricing Configuration
    low_stock_threshold = models.PositiveIntegerField(default=2, help_text="Minimum stock quantity before product is considered low stock")
    show_price_on_labels_default = models.BooleanField(default=True, help_text="Whether to display price on printed labels by default")
    show_selling_price_in_catalog = models.BooleanField(default=True, help_text="Whether to display selling price in catalog and POS")

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
