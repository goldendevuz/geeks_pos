import pytest
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APIClient

from catalog.models import Category, Color, Product, ProductVariant, Size
from sales.models import SaleRefund
from sales.services import complete_sale


def _mk_user(username: str, role: str) -> User:
    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = role
    u.profile.save(update_fields=["role"])
    return u


def _mk_variant(*, barcode: str = "BC-RETURN-TEST", stock_qty: int = 10) -> ProductVariant:
    cat = Category.objects.create(name_uz="Kiyim", name_ru="Одежда")
    sz = Size.objects.create(value="42", label_uz="42", label_ru="42", sort_order=1)
    col = Color.objects.create(value="BLACK-R", label_uz="Qora", label_ru="Черный", sort_order=1)
    prod = Product.objects.create(category=cat, name_uz="Keta", name_ru="Кеды")
    return ProductVariant.objects.create(
        product=prod,
        size=sz,
        color=col,
        purchase_price=Decimal("100000.00"),
        list_price=Decimal("150000.00"),
        stock_qty=stock_qty,
        barcode=barcode,
    )


@pytest.mark.django_db
def test_sale_return_search_by_barcode_and_qty_guard():
    cashier = _mk_user("ret_cashier_main", "CASHIER")
    variant = _mk_variant(barcode="BC-QTY-GUARD")
    sale = complete_sale(
        idempotency_key="ret-qty-sale-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 2, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "300000.00"}],
        customer=None,
    )
    api = APIClient()
    api.force_authenticate(user=cashier)
    sr = api.get("/api/sales/search/return/?q=BC-QTY-GUARD")
    assert sr.status_code == 200
    assert any(row["sale_id"] == str(sale.id) for row in sr.json()["results"])

    rl = api.get(f"/api/sales/{sale.id}/return-lines/")
    assert rl.status_code == 200
    body = rl.json()
    assert len(body["lines"]) == 1
    vid = body["lines"][0]["variant_id"]

    over = api.post(
        f"/api/sales/{sale.id}/return/",
        data={"lines": [{"variant_id": vid, "qty": 5}], "reason": "too many"},
        format="json",
    )
    assert over.status_code == 400

    ok = api.post(
        f"/api/sales/{sale.id}/return/",
        data={"lines": [{"variant_id": vid, "qty": 1}], "reason": "partial"},
        format="json",
    )
    assert ok.status_code == 200

    over2 = api.post(
        f"/api/sales/{sale.id}/return/",
        data={"lines": [{"variant_id": vid, "qty": 2}], "reason": "second"},
        format="json",
    )
    assert over2.status_code == 400


@pytest.mark.django_db
def test_sale_return_search_hides_fully_returned_sale():
    cashier = _mk_user("ret_search_hide", "CASHIER")
    variant = _mk_variant(barcode="BC-FULL-HIDE")
    sale = complete_sale(
        idempotency_key="ret-full-hide-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None,
    )
    api = APIClient()
    api.force_authenticate(user=cashier)
    rl = api.get(f"/api/sales/{sale.id}/return-lines/")
    vid = rl.json()["lines"][0]["variant_id"]
    ret = api.post(
        f"/api/sales/{sale.id}/return/",
        data={"lines": [{"variant_id": vid, "qty": 1}], "reason": "full"},
        format="json",
    )
    assert ret.status_code == 200

    sr = api.get("/api/sales/search/return/?q=BC-FULL-HIDE")
    assert sr.status_code == 200
    assert not any(row["sale_id"] == str(sale.id) for row in sr.json()["results"])

    body = api.get(f"/api/sales/{sale.id}/return-lines/").json()
    assert body["return_state"] == "fully_returned"
    assert body["lines"] == []


@pytest.mark.django_db
def test_return_lines_blocked_for_other_cashier():
    a = _mk_user("ret_owner_cashier", "CASHIER")
    b = _mk_user("ret_other_cashier", "CASHIER")
    variant = _mk_variant(barcode="BC-X-403")
    sale = complete_sale(
        idempotency_key="ret-x-403",
        cashier=a,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None,
    )
    api = APIClient()
    api.force_authenticate(user=b)
    assert api.get(f"/api/sales/{sale.id}/return-lines/").status_code == 403


@pytest.mark.django_db
def test_sale_return_search_and_lines_include_extended_fields():
    cashier = _mk_user("ret_cashier_detail", "CASHIER")
    variant = _mk_variant(barcode="BC-DETAIL-1", stock_qty=7)
    sale = complete_sale(
        idempotency_key="ret-detail-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 2, "line_discount": "0"}],
        payments=[{"method": "CARD", "amount": "300000.00"}],
        customer=None,
    )
    api = APIClient()
    api.force_authenticate(user=cashier)
    sr = api.get("/api/sales/search/return/?q=BC-DETAIL-1")
    assert sr.status_code == 200
    hits = sr.json()["results"]
    row = next((h for h in hits if h["sale_id"] == str(sale.id)), None)
    assert row is not None
    assert row["subtotal"]
    assert row["grand_total"]
    assert isinstance(row["payments"], list)
    assert any(p["method"] == "CARD" for p in row["payments"])
    assert row["preview_lines"]
    pl0 = row["preview_lines"][0]
    assert pl0["barcode"] == "BC-DETAIL-1"
    assert pl0["qty"] == 2
    assert "list_unit_price" in pl0
    variant.refresh_from_db()
    assert pl0["stock_qty"] == variant.stock_qty

    rl = api.get(f"/api/sales/{sale.id}/return-lines/")
    assert rl.status_code == 200
    body = rl.json()
    assert body["payments"]
    assert body["grand_total"]
    ln0 = body["lines"][0]
    assert ln0["remaining_qty"] == 2
    assert "line_total_sold" in ln0
    assert "stock_qty" in ln0
    assert ln0["category_name_uz"]


@pytest.mark.django_db
def test_sale_return_creates_cash_refund_and_net_dashboard():
    cashier = _mk_user("ret_refund_cash", "CASHIER")
    variant = _mk_variant(barcode="BC-REFUND-CASH")
    sale = complete_sale(
        idempotency_key="ret-refund-cash-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 2, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "300000.00"}],
        customer=None,
    )
    api = APIClient()
    api.force_authenticate(user=cashier)
    rl = api.get(f"/api/sales/{sale.id}/return-lines/")
    vid = rl.json()["lines"][0]["variant_id"]
    assert rl.json()["refund_capacity"]["CASH"] == "300000"

    ok = api.post(
        f"/api/sales/{sale.id}/return/",
        data={"lines": [{"variant_id": vid, "qty": 1}], "reason": "refund test", "auto_refund": True},
        format="json",
    )
    assert ok.status_code == 200
    body = ok.json()
    assert body["return_amount"] == "150000"
    assert len(body["refunds"]) == 1
    assert body["refunds"][0]["method"] == "CASH"
    assert SaleRefund.objects.filter(sale=sale).count() == 1

    from reports.services import sales_metrics

    m = sales_metrics()
    assert m["today_refund_cash"] == Decimal("150000")
    assert m["today_cash_total"] == Decimal("150000")


@pytest.mark.django_db
def test_sale_return_manual_refund_must_match_amount():
    cashier = _mk_user("ret_refund_manual", "CASHIER")
    variant = _mk_variant(barcode="BC-REFUND-MAN")
    sale = complete_sale(
        idempotency_key="ret-refund-man-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None,
    )
    api = APIClient()
    api.force_authenticate(user=cashier)
    vid = api.get(f"/api/sales/{sale.id}/return-lines/").json()["lines"][0]["variant_id"]
    bad = api.post(
        f"/api/sales/{sale.id}/return/",
        data={
            "lines": [{"variant_id": vid, "qty": 1}],
            "auto_refund": False,
            "refunds": [{"method": "CASH", "amount": "100000"}],
        },
        format="json",
    )
    assert bad.status_code == 400
    assert bad.json()["code"] == "RETURN_REFUND_MISMATCH"

