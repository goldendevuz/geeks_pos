import pytest
from decimal import Decimal

from django.contrib.auth.models import User

from catalog.models import Category, Product, ProductVariant
from sales.models import Sale, SaleRefund
from sales.services import complete_sale, return_sale_lines, void_sale


def _mk_user(username: str, role: str) -> User:
    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = role
    u.profile.save(update_fields=["role"])
    return u


def _mk_variant(*, barcode: str = "BC-VOID-PART", stock_qty: int = 10) -> ProductVariant:
    cat = Category.objects.create(name_uz="Kiyim", name_ru="Одежда")    prod = Product.objects.create(category=cat, name_uz="Kross", name_ru="Кросс")
    return ProductVariant.objects.create(
        product=prod,
        purchase_price=Decimal("100000.00"),
        list_price=Decimal("150000.00"),
        stock_qty=stock_qty,
        barcode=barcode)


@pytest.mark.django_db
def test_void_after_partial_return_restock_only_remaining_and_refund_rest():
    cashier = _mk_user("void_part_cashier", "CASHIER")
    variant = _mk_variant(stock_qty=5)
    sale = complete_sale(
        idempotency_key="void-part-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 3, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "450000.00"}],
        customer=None)
    variant.refresh_from_db()
    assert variant.stock_qty == 2

    return_sale_lines(
        sale=sale,
        user=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 2}],
        reason="partial")
    variant.refresh_from_db()
    assert variant.stock_qty == 4

    out = void_sale(sale=sale, user=cashier, reason="close rest")
    sale.refresh_from_db()
    variant.refresh_from_db()

    assert sale.status == Sale.Status.VOIDED
    assert variant.stock_qty == 5
    assert len(out["restocked_lines"]) == 1
    assert out["restocked_lines"][0]["qty"] == 1
    assert out["return_amount"] == "150000"
    assert len(out["refunds"]) == 1
    assert out["refunds"][0]["amount"] == "150000"
    assert SaleRefund.objects.filter(sale=sale).count() == 2


@pytest.mark.django_db
def test_void_fully_returned_sale_rejected():
    cashier = _mk_user("void_full_ret", "CASHIER")
    variant = _mk_variant(barcode="BC-VOID-FULL", stock_qty=5)
    sale = complete_sale(
        idempotency_key="void-full-ret-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None)
    return_sale_lines(
        sale=sale,
        user=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1}],
        reason="full")
    variant.refresh_from_db()
    stock_before_void = variant.stock_qty

    with pytest.raises(ValueError, match="fully returned"):
        void_sale(sale=sale, user=cashier, reason="already returned")
    variant.refresh_from_db()
    assert variant.stock_qty == stock_before_void
    sale.refresh_from_db()
    assert sale.status == Sale.Status.COMPLETED
