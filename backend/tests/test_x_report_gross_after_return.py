import pytest
from decimal import Decimal

from django.contrib.auth.models import User
from django.utils import timezone

from catalog.models import Category, Color, Product, ProductVariant, Size
from reports.services import cashier_x_report_metrics, default_shift_window
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
        barcode="BC-X-GP",
    )


@pytest.mark.django_db
def test_x_report_gross_profit_zero_after_full_return():
    cashier = _mk_user("x_gp_cashier")
    variant = _mk_variant()
    sale = complete_sale(
        idempotency_key="x-gp-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000"}],
        customer=None,
    )
    return_sale_lines(
        sale=sale,
        user=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1}],
        reason="full",
    )
    start, end = default_shift_window()
    m = cashier_x_report_metrics(cashier_id=cashier.id, from_dt=start, to_dt=end)
    assert m is not None
    assert m["gross_profit"] == "0"
