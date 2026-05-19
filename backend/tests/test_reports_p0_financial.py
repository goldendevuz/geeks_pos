"""P0 moliyaviy KPI: returned_total scale, void + qisman vozvrat."""

import pytest
from decimal import Decimal

from django.contrib.auth.models import User

from catalog.models import Category, Color, Product, ProductVariant, Size
from reports.services import sales_metrics
from sales.models import Sale
from sales.services import complete_sale, return_sale_lines, void_sale


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
        barcode="BC-P0-MET",
    )


@pytest.mark.django_db
def test_returned_total_matches_refund_with_order_discount():
    cashier = _mk_user("p0_ord_disc")
    variant = _mk_variant()
    sale = complete_sale(
        idempotency_key="p0-ord-disc",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 2, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "250000"}],
        customer=None,
        order_discount=Decimal("50000"),
        expected_grand_total=Decimal("250000"),
    )
    return_sale_lines(
        sale=sale,
        user=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1}],
        reason="half",
    )
    m = sales_metrics()
    assert str(m["returned_total"]) == "125000"


@pytest.mark.django_db
def test_gross_profit_stable_after_partial_return_then_void():
    cashier = _mk_user("p0_void_part")
    variant = _mk_variant()
    sale = complete_sale(
        idempotency_key="p0-void-part",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 3, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "450000"}],
        customer=None,
    )
    before = sales_metrics()
    assert str(before["gross_profit"]) == "150000"
    assert str(before["sales_amount"]) == "450000"

    return_sale_lines(
        sale=sale,
        user=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 2}],
        reason="partial",
    )
    mid = sales_metrics()
    assert str(mid["sales_amount"]) == "450000"
    assert str(mid["returned_total"]) == "300000"

    void_sale(sale=sale, user=cashier, reason="close")
    sale.refresh_from_db()
    assert sale.status == Sale.Status.VOIDED

    after = sales_metrics()
    assert str(after["sales_amount"]) == "0"
    assert str(after["returned_total"]) == "0"
    assert str(after["gross_profit"]) == "0"
    assert str(after["net_sales_approx"]) == "0"
