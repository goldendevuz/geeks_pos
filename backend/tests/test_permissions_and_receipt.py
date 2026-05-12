from datetime import timedelta
from decimal import Decimal

import pytest
from django.contrib.auth.models import User
from django.utils import timezone

from debt.models import Customer
from sales.models import Sale
from sales.services import complete_sale
from catalog.models import Category, Color, Product, ProductVariant, Size
from printing.models import StoreSettings
from printing.receipt import round_som, sale_to_receipt_dict, transliterate_uz


def _mk_user(username: str, role: str) -> User:
    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = role
    u.profile.save(update_fields=["role"])
    return u


@pytest.mark.django_db
def test_catalog_requires_admin_or_owner(client):
    cashier = _mk_user("cashier_perm", "CASHIER")
    client.force_login(cashier)
    r = client.get("/api/catalog/categories/")
    assert r.status_code == 403


@pytest.mark.django_db
def test_catalog_owner_allowed(client):
    owner = _mk_user("owner_perm", "OWNER")
    client.force_login(owner)
    r = client.get("/api/catalog/categories/")
    assert r.status_code == 200


@pytest.mark.django_db
def test_barcode_endpoint_accessible_to_cashier(client):
    cashier = _mk_user("cashier_barcode", "CASHIER")
    client.force_login(cashier)
    r = client.get("/api/catalog/variants/by-barcode/?code=NOPE")
    # Endpoint can return not-found, but cashier must pass permission layer.
    assert r.status_code != 403


def _mk_variant(stock_qty: int = 10) -> ProductVariant:
    cat = Category.objects.create(name_uz="Kiyim", name_ru="Одежда")
    sz = Size.objects.create(value="42", label_uz="42", label_ru="42", sort_order=1)
    col = Color.objects.create(value="BLACK-PERM", label_uz="Qora", label_ru="Черный", sort_order=1)
    prod = Product.objects.create(category=cat, name_uz="Keta", name_ru="Кеды")
    return ProductVariant.objects.create(
        product=prod,
        size=sz,
        color=col,
        purchase_price=Decimal("100000.00"),
        list_price=Decimal("150000.00"),
        stock_qty=stock_qty,
    )


@pytest.mark.django_db
def test_debt_endpoints_cashier_allowed(client, monkeypatch):
    cashier = _mk_user("cashier_debt_perm", "CASHIER")
    client.force_login(cashier)
    variant = _mk_variant()
    complete_sale(
        idempotency_key="debt-perm-cashier",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "DEBT", "amount": "150000.00"}],
        customer={"name": "Ali", "phone_normalized": "998900000111"},
    )
    customer = Customer.objects.get(phone_normalized="998900000111")

    assert client.get("/api/debt/customers/search/?q=ali").status_code == 200
    assert client.get("/api/debt/debts/open/").status_code == 200
    assert (
        client.post(
            "/api/debt/customers/",
            data={"name": "Vali", "phone_normalized": "998900000222"},
            content_type="application/json",
        ).status_code
        == 201
    )
    assert (
        client.patch(
            f"/api/debt/customers/{customer.id}/",
            data={"name": "Ali2", "phone_normalized": "998900000111"},
            content_type="application/json",
        ).status_code
        == 200
    )
    monkeypatch.setattr("integrations.services.send_whatsapp_reminder", lambda **kwargs: {"ok": True})
    assert (
        client.post(
            "/api/debt/payments/",
            data={"customer_id": str(customer.id), "amount": "100"},
            content_type="application/json",
        ).status_code
        == 200
    )


@pytest.mark.django_db
def test_debt_endpoints_owner_allowed(client, monkeypatch):
    owner = _mk_user("owner_debt_perm", "OWNER")
    cashier = _mk_user("cashier_debt_origin", "CASHIER")
    client.force_login(owner)
    variant = _mk_variant()
    complete_sale(
        idempotency_key="debt-perm-owner",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "DEBT", "amount": "150000.00"}],
        customer={"name": "Aziza", "phone_normalized": "998900000333"},
    )
    customer = Customer.objects.get(phone_normalized="998900000333")

    assert client.get("/api/debt/customers/search/?q=azi").status_code == 200
    assert client.get("/api/debt/debts/open/").status_code == 200
    assert (
        client.post(
            "/api/debt/customers/",
            data={"name": "Nodira", "phone_normalized": "998900000444"},
            content_type="application/json",
        ).status_code
        == 201
    )
    assert (
        client.patch(
            f"/api/debt/customers/{customer.id}/",
            data={"name": "Aziza Updated", "phone_normalized": "998900000335"},
            content_type="application/json",
        ).status_code
        == 200
    )
    captured = {}
    def _fake_send_whatsapp_reminder(**kwargs):
        captured.update(kwargs)
        return {"ok": True, "details": "ok", "queued": False}
    monkeypatch.setattr("integrations.services.send_whatsapp_reminder", _fake_send_whatsapp_reminder)
    res = client.post(
        "/api/debt/payments/",
        data={"customer_id": str(customer.id), "amount": "100"},
        content_type="application/json",
        HTTP_ACCEPT_LANGUAGE="ru",
    )
    assert res.status_code == 200
    assert captured.get("reminder_kind") == "repayment_update"
    assert captured.get("lang") == "ru"
    assert captured.get("payment_amount") == "100.00"
    assert captured.get("is_partial") is True
    assert isinstance(captured.get("debt_items"), list) and len(captured["debt_items"]) >= 1


@pytest.mark.django_db
def test_sales_history_cashier_only_own_today(client):
    cashier = _mk_user("cashier_hist", "CASHIER")
    other = _mk_user("cashier_hist_other", "CASHIER")
    variant = _mk_variant()
    complete_sale(
        idempotency_key="hist-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None,
    )
    complete_sale(
        idempotency_key="hist-2",
        cashier=other,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None,
    )
    old_sale = complete_sale(
        idempotency_key="hist-3",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None,
    )
    Sale.objects.filter(pk=old_sale.pk).update(completed_at=timezone.now() - timedelta(days=1))

    client.force_login(cashier)
    resp = client.get("/api/sales/")
    assert resp.status_code == 200
    rows = resp.json()["results"]
    assert len(rows) == 1
    assert rows[0]["cashier_username"] == cashier.username


@pytest.mark.django_db
def test_sales_history_owner_sees_all(client):
    owner = _mk_user("owner_hist", "OWNER")
    cashier = _mk_user("cashier_hist_2", "CASHIER")
    other = _mk_user("cashier_hist_3", "CASHIER")
    variant = _mk_variant()
    complete_sale(
        idempotency_key="hist-owner-1",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None,
    )
    complete_sale(
        idempotency_key="hist-owner-2",
        cashier=other,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None,
    )
    client.force_login(owner)
    resp = client.get("/api/sales/")
    assert resp.status_code == 200
    assert len(resp.json()["results"]) >= 2


@pytest.mark.django_db
def test_sale_detail_and_receipt_block_cross_cashier_access(client):
    cashier = _mk_user("cashier_detail_1", "CASHIER")
    other = _mk_user("cashier_detail_2", "CASHIER")
    variant = _mk_variant()
    sale = complete_sale(
        idempotency_key="hist-detail-1",
        cashier=other,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None,
    )
    client.force_login(cashier)
    assert client.get(f"/api/sales/{sale.id}/").status_code == 403
    assert client.get(f"/api/printing/receipt/{sale.id}/").status_code == 403
    assert client.get(f"/api/printing/receipt/{sale.id}/escpos/").status_code == 403


def test_receipt_rounding_and_transliteration():
    assert round_som("10.49") == Decimal("10")
    assert round_som("10.50") == Decimal("11")
    assert transliterate_uz("o‘g‘il bola") == "o'g'il bola"
    assert transliterate_uz("Ғ Ш Ч ў ғ") == "G' Sh Ch o' g'"


@pytest.mark.django_db
def test_sale_receipt_dict_respects_receipt_lang_setting():
    cashier = _mk_user("cashier_receipt_lang", "CASHIER")
    variant = _mk_variant()
    sale = complete_sale(
        idempotency_key="receipt-lang-sale",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None,
    )
    settings = StoreSettings.get_solo()
    settings.receipt_lang = "uz"
    settings.save(update_fields=["receipt_lang"])
    dto = sale_to_receipt_dict(sale, lang="ru-RU,ru;q=0.9")
    assert dto["store"]["lang"] == "uz"
    assert dto["lines"][0]["name"] == "Keta"
    assert dto["lines"][0]["color"] == "Qora"

    settings.receipt_lang = "ru"
    settings.save(update_fields=["receipt_lang"])
    dto_ru = sale_to_receipt_dict(sale, lang="uz")
    assert dto_ru["store"]["lang"] == "ru"
    assert dto_ru["lines"][0]["name"] == "Кеды"
    assert dto_ru["lines"][0]["color"] == "Черный"

    settings.receipt_lang = "ky"
    settings.save(update_fields=["receipt_lang"])
    dto_ky = sale_to_receipt_dict(sale, lang="uz")
    assert dto_ky["store"]["lang"] == "ky"
    assert dto_ky["lines"][0]["name"] == "Кеды"

    settings.receipt_lang = ""
    settings.save(update_fields=["receipt_lang"])
    dto_auto = sale_to_receipt_dict(sale, lang="ru")
    assert dto_auto["store"]["lang"] == "ru"
    assert dto_auto["lines"][0]["name"] == "Кеды"
