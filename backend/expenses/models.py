import uuid

from django.conf import settings
from django.db import models


class ShopExpense(models.Model):
    class Category(models.TextChoices):
        RENT = "RENT", "Rent"
        UTILITIES = "UTILITIES", "Utilities"
        SUPPLIES = "SUPPLIES", "Supplies"
        SALARY = "SALARY", "Salary"
        OTHER = "OTHER", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recorded_at = models.DateTimeField(auto_now_add=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    category = models.CharField(max_length=32, choices=Category.choices, default=Category.OTHER)
    note = models.CharField(max_length=500, blank=True, default="")
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="shop_expenses",
    )

    class Meta:
        ordering = ["-recorded_at", "-id"]

    def __str__(self):
        return f"{self.amount} {self.category} @ {self.recorded_at:%Y-%m-%d}"
