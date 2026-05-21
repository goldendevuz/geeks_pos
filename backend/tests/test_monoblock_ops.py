import base64
import uuid
from decimal import Decimal

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from catalog.models import Category, Product, ProductVariant


def _mk_user(username: str, role: str) -> User:
    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = role
    u.profile.save(update_fields=["role"])
    return u


def _mk_variant(stock_qty: int = 10) -> ProductVariant:
    cat = Category.objects.create(name_uz="Kiyim", name_ru="Одежда")    prod = Product.objects.create(category=cat, name_uz="Keta", name_ru="Кеды")
    return ProductVariant.objects.create(
        product=prod,
        purchase_price=Decimal("100000.00"),
        list_price=Decimal("150000.00"),
        stock_qty=stock_qty)


@pytest.mark.django_db
def test_barcode_lookup_excludes_purchase_price_for_cashier(client):
    cashier = _mk_user("cashier_barcode_hide", "CASHIER")
    variant = _mk_variant()
    variant.barcode = "MONO123"
    variant.save(update_fields=["barcode"])
    client.force_login(cashier)
    r = client.get("/api/catalog/variants/by-barcode/", data={"code": "MONO123"})
    assert r.status_code == 200
    body = r.json()
    assert "purchase_price" not in body
    assert body["list_price"] == "150000.00"


@pytest.mark.django_db
def test_pos_variant_search_for_cashier(client):
    cashier = _mk_user("cashier_search", "CASHIER")
    variant = _mk_variant()
    variant.barcode = "SRCH99"
    variant.save(update_fields=["barcode"])
    client.force_login(cashier)
    r = client.get("/api/catalog/variants/pos-search/", data={"q": "Keta"})
    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) >= 1
    assert "purchase_price" not in results[0]


@pytest.mark.django_db
def test_pos_variant_by_product_for_cashier(client):
    cashier = _mk_user("cashier_by_prod", "CASHIER")
    variant = _mk_variant()
    client.force_login(cashier)
    r = client.get(
        "/api/catalog/variants/pos-by-product/",
        data={"product_id": str(variant.product_id), "color_id": str(variant.color_id)})
    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) == 1
    assert "purchase_price" not in results[0]


@pytest.mark.django_db
def test_pos_price_update_allowed_for_cashier(client):
    cashier = _mk_user("cashier_pos_price", "CASHIER")
    variant = _mk_variant()
    client.force_login(cashier)
    r = client.post(
        f"/api/catalog/variants/{variant.id}/pos-price/",
        data={"list_price": "160000"},
        content_type="application/json")
    assert r.status_code == 200
    variant.refresh_from_db()
    assert variant.list_price == Decimal("160000")


@pytest.mark.django_db
def test_label_endpoints_owner_allowed(client):
    owner = _mk_user("owner_label", "OWNER")
    variant = _mk_variant()
    client.force_login(owner)
    single = client.post(
        "/api/printing/labels/escpos/",
        data={"variant_id": str(variant.id), "size": "40x30", "copies": 1},
        content_type="application/json")
    assert single.status_code == 200
    assert "escpos_base64" in single.json()

    queue = client.post(
        "/api/printing/labels/queue/escpos/",
        data={"size": "40x30", "items": [{"variant_id": str(variant.id), "copies": 2}]},
        content_type="application/json")
    assert queue.status_code == 200
    assert len(queue.json()["items"]) == 1


@pytest.mark.django_db
def test_hardware_config_visible_for_cashier(client):
    cashier = _mk_user("cashier_hw_cfg", "CASHIER")
    client.force_login(cashier)
    r = client.get("/api/printing/hardware-config/")
    assert r.status_code == 200
    body = r.json()
    assert "scanner_suffix" in body
    assert "auto_print_on_sale" in body


@pytest.mark.django_db
def test_hardware_config_patch_by_cashier(client):
    cashier = _mk_user("cashier_hw_patch", "CASHIER")
    client.force_login(cashier)
    r = client.patch(
        "/api/printing/hardware-config/",
        data={"receipt_printer_name": "PATCH-PRINTER-TEST"},
        content_type="application/json")
    assert r.status_code == 200
    assert r.json()["receipt_printer_name"] == "PATCH-PRINTER-TEST"


@pytest.mark.django_db
def test_cashier_stock_list_excludes_purchase_price():
    cashier = _mk_user("cashier_stock_list", "CASHIER")
    _mk_variant()
    api = APIClient()
    api.force_authenticate(user=cashier)
    r = api.get("/api/catalog/variants/cashier-stock/")
    assert r.status_code == 200
    body = r.json()
    assert "results" in body
    if body["results"]:
        row = body["results"][0]
        assert "purchase_price" not in row
        assert "stock_qty" in row


@pytest.mark.django_db
def test_owner_stock_list_includes_purchase_price():
    owner = _mk_user("owner_stock_list", "OWNER")
    _mk_variant()
    api = APIClient()
    api.force_authenticate(user=owner)
    r = api.get("/api/catalog/variants/cashier-stock/")
    assert r.status_code == 200
    body = r.json()
    assert "results" in body
    if body["results"]:
        row = body["results"][0]
        assert "purchase_price" in row
        assert "list_price" in row


@pytest.mark.django_db
def test_store_settings_save_hardware_fields_for_owner(client):
    owner = _mk_user("owner_hw_save", "OWNER")
    client.force_login(owner)
    r = client.put(
        "/api/printing/settings/",
        data={
            "receipt_printer_name": "EPSON TM-T20",
            "label_printer_name": "XPrinter XP-365B",
            "receipt_width": "80mm",
            "auto_print_on_sale": True,
            "scanner_mode": "keyboard",
            "scanner_prefix": "",
            "scanner_suffix": "\\t",
        },
        content_type="application/json")
    assert r.status_code == 200
    body = r.json()
    assert body["receipt_printer_name"] == "EPSON TM-T20"
    assert body["receipt_width"] == "80mm"


@pytest.mark.django_db
def test_label_endpoint_returns_variant_not_found_code(client):
    owner = _mk_user("owner_label_404", "OWNER")
    client.force_login(owner)
    missing_variant_id = str(uuid.uuid4())
    r = client.post(
        "/api/printing/labels/escpos/",
        data={"variant_id": missing_variant_id, "size": "40x30", "copies": 1},
        content_type="application/json")
    assert r.status_code == 404
    assert r.json()["code"] == "VARIANT_NOT_FOUND"


@pytest.mark.django_db
def test_bulk_grid_returns_product_not_found_code(client):
    owner = _mk_user("owner_bulk_404", "OWNER")
    variant = _mk_variant()
    client.force_login(owner)
    r = client.post(
        "/api/catalog/variants/bulk-grid/",
        data={
            "product_id": str(uuid.uuid4()),
            "matrix": [
                {
                    "size_id": str(variant.size_id),
                    "color_id": str(variant.color_id),
                    "purchase_price": "100000",
                    "list_price": "150000",
                    "initial_qty": 1,
                }
            ],
        },
        content_type="application/json")
    assert r.status_code == 404
    assert r.json()["code"] == "PRODUCT_NOT_FOUND"


@pytest.mark.django_db
def test_receipt_endpoints_return_sale_not_found_code(client):
    cashier = _mk_user("cashier_sale_404", "CASHIER")
    client.force_login(cashier)
    missing_sale_id = str(uuid.uuid4())
    plain = client.get(f"/api/printing/receipt/{missing_sale_id}/")
    escpos = client.get(f"/api/printing/receipt/{missing_sale_id}/escpos/")
    assert plain.status_code == 404
    assert escpos.status_code == 404
    assert plain.json()["code"] == "SALE_NOT_FOUND"
    assert escpos.json()["code"] == "SALE_NOT_FOUND"


@pytest.mark.django_db
def test_tspl_label_size_matches_request(client):
    owner = _mk_user("owner_tspl_size", "OWNER")
    variant = _mk_variant()
    client.force_login(owner)
    put = client.put(
        "/api/printing/settings/",
        data={"label_printer_type": "TSPL"},
        content_type="application/json")
    assert put.status_code == 200
    r50 = client.post(
        "/api/printing/labels/escpos/",
        data={"variant_id": str(variant.id), "size": "40x50", "copies": 1},
        content_type="application/json")
    assert r50.status_code == 200
    raw50 = base64.b64decode(r50.json()["raw_base64"]).decode("ascii", errors="ignore")
    assert "SIZE 40 mm,50 mm" in raw50
    assert raw50.index("CLS") < raw50.index("BARCODE")
    assert raw50.index("TEXT") < raw50.index("BARCODE")

    r58 = client.post(
        "/api/printing/labels/escpos/",
        data={"variant_id": str(variant.id), "size": "58mm", "copies": 1},
        content_type="application/json")
    assert r58.status_code == 200
    raw58 = base64.b64decode(r58.json()["raw_base64"]).decode("ascii", errors="ignore")
    assert "SIZE 58 mm,40 mm" in raw58

