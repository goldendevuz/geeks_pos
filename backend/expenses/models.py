import uuid

from django.conf import settings
from django.db import models


class Shift(models.Model):
    """Cash register shift for cash tracking and reconciliation."""
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        CLOSED = "CLOSED", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cashier = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="shifts",
    )
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    opening_cash = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    closing_cash = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.OPEN)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ["-opened_at", "-id"]
        indexes = [
            models.Index(fields=["cashier", "status"]),
            models.Index(fields=["-opened_at"]),
        ]

    def __str__(self):
        return f"Shift {self.cashier.username} - {self.opened_at:%Y-%m-%d %H:%M}"


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
    related_shift = models.ForeignKey(
        Shift, on_delete=models.SET_NULL, null=True, blank=True, related_name="expenses"
    )

    class Meta:
        ordering = ["-recorded_at", "-id"]
        indexes = [
            models.Index(fields=["recorded_at"]),
            models.Index(fields=["related_shift", "-recorded_at"]),
        ]

    def __str__(self):
        return f"{self.amount} {self.category} @ {self.recorded_at:%Y-%m-%d}"
