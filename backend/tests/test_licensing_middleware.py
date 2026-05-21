import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from licensing.services import apply_activation_success


def _mk_user(username: str, role: str):
    from django.contrib.auth.models import User

    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = role
    u.profile.save(update_fields=["role"])
    return u


@pytest.mark.django_db
def test_health_always_allowed_under_license_enforcement(client):
    with override_settings(LICENSE_ENFORCEMENT=True):
        r = client.get("/api/health/")
    assert r.status_code == 200


@pytest.mark.django_db
def test_sales_complete_blocked_when_license_enforced_and_invalid(client):
    from catalog.models import Category, Product, ProductVariant
    from decimal import Decimal

    from licensing.models import LicenseState

    # --reuse-db can leave a valid LicenseState from other tests; start clean.
    LicenseState.objects.all().delete()

    cashier = _mk_user("cashier_lic", "CASHIER")
    cat = Category.objects.create(name_uz="K", name_ru="K")    prod = Product.objects.create(category=cat, name_uz="P", name_ru="P")
    variant = ProductVariant.objects.create(
        product=prod,
        purchase_price=Decimal("1"),
        list_price=Decimal("10"),
        stock_qty=5)
    client = APIClient()
    client.force_authenticate(user=cashier)

    with override_settings(LICENSE_ENFORCEMENT=True, LICENSE_DEMO_DAYS=0):
        r = client.post(
            "/api/sales/complete/",
            {
                "lines": [{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
                "payments": [{"method": "CASH", "amount": "10"}],
                "expected_grand_total": "10",
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="lic-block-1")
    assert r.status_code == 403
    assert r.json().get("code") == "LICENSE_EXPIRED"


@pytest.mark.django_db
def test_sales_complete_allowed_when_license_valid(client):
    from catalog.models import Category, Product, ProductVariant
    from decimal import Decimal

    cashier = _mk_user("cashier_lic_ok", "CASHIER")
    cat = Category.objects.create(name_uz="K2", name_ru="K2")    prod = Product.objects.create(category=cat, name_uz="P2", name_ru="P2")
    variant = ProductVariant.objects.create(
        product=prod,
        purchase_price=Decimal("1"),
        list_price=Decimal("10"),
        stock_qty=5)
    apply_activation_success(
        hardware_id="hw-test-1",
        license_key="KEY",
        expires_at_iso="2099-12-31",
        raw_json="{}")
    client = APIClient()
    client.force_authenticate(user=cashier)

    with override_settings(LICENSE_ENFORCEMENT=True):
        r = client.post(
            "/api/sales/complete/",
            {
                "lines": [{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
                "payments": [{"method": "CASH", "amount": "10"}],
                "expected_grand_total": "10",
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="lic-ok-1")
    assert r.status_code == 200


@pytest.mark.django_db
def test_licensing_status_authenticated(client):
    owner = _mk_user("owner_lic_status", "OWNER")
    client.force_login(owner)
    r = client.get("/api/licensing/status/")
    assert r.status_code == 200
    body = r.json()
    assert "enforcement" in body
    assert "valid" in body
