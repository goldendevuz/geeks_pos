import pytest
from decimal import Decimal

from django.contrib.auth.models import User
from django.db.models import Sum

from catalog.models import Category, Color, Product, ProductVariant, Size
from sales.refund_utils import compute_return_amount
from sales.services import complete_sale, return_sale_lines


def _mk_user(username: str) -> User:
    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = "CASHIER"
    u.profile.save(update_fields=["role"])
    return u


def _mk_variant() -> ProductVariant:
    cat = Category.objects.create(name_uz="K", name_ru="K")
    sz = Size.objects.create(value="42", label_uz="42", label_ru="42", sort_order=1)
    col = Color.objects.create(value="B", label_uz="Q", label_ru="Q", sort_order=1)
    prod = Product.objects.create(category=cat, name_uz="P", name_ru="P")
    return ProductVariant.objects.create(
        product=prod,
        size=sz,
        color=col,
        purchase_price=Decimal("100000"),
        list_price=Decimal("150000"),
        stock_qty=10,
        barcode="BC-ORD-DISC",
    )


@pytest.mark.django_db
def test_return_amount_scales_with_order_discount():
    cashier = _mk_user("ord_disc_cashier")
    variant = _mk_variant()
    sale = complete_sale(
        idempotency_key="ord-disc-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 2, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "250000"}],
        customer=None,
        order_discount=Decimal("50000"),
        expected_grand_total=Decimal("250000"),
    )
    assert sale.grand_total == Decimal("250000")
    lines = [{"variant_id": str(variant.id), "qty": 2}]
    assert compute_return_amount(sale=sale, lines=lines) == Decimal("250000")

    return_sale_lines(
        sale=sale,
        user=cashier,
        lines=lines,
        reason="full with order discount",
    )
    assert sale.refunds.aggregate(t=Sum("amount"))["t"] == Decimal("250000")
