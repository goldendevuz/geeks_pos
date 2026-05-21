import pytest
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APIClient

from catalog.models import Category, Product, ProductVariant
from sales.models import Sale
from sales.services import complete_sale, return_sale_lines


def _mk_user(username: str, role: str) -> User:
    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = role
    u.profile.save(update_fields=["role"])
    return u


def _mk_variant() -> ProductVariant:
    cat = Category.objects.create(name_uz="K", name_ru="K")    prod = Product.objects.create(category=cat, name_uz="P", name_ru="P")
    return ProductVariant.objects.create(
        product=prod,
        purchase_price=Decimal("100000"),
        list_price=Decimal("150000"),
        stock_qty=10,
        barcode="BC-HIST-META")


@pytest.mark.django_db
def test_sale_history_includes_return_status_and_can_void():
    owner = _mk_user("hist_meta_owner", "OWNER")
    cashier = _mk_user("hist_meta_cash", "CASHIER")
    variant = _mk_variant()
    sale = complete_sale(
        idempotency_key="hist-meta-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 2, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "300000"}],
        customer=None)
    return_sale_lines(
        sale=sale,
        user=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1}],
        reason="partial")

    api = APIClient()
    api.force_authenticate(user=owner)
    r = api.get("/api/sales/")
    assert r.status_code == 200
    row = next(x for x in r.json()["results"] if x["id"] == str(sale.id))
    assert row["return_status"] == "partial"
    assert row["can_void"] is True
    assert Decimal(row["refund_total"]) == Decimal("150000")

    return_sale_lines(
        sale=sale,
        user=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1}],
        reason="finish")
    r2 = api.get("/api/sales/")
    row2 = next(x for x in r2.json()["results"] if x["id"] == str(sale.id))
    assert row2["return_status"] == "full"
    assert row2["can_void"] is False
