import pytest
from django.test import Client

from printing.models import StoreSettings


@pytest.fixture
def api():
    return Client()


@pytest.mark.django_db
def test_setup_status_before_complete(api):
    StoreSettings.objects.all().delete()
    StoreSettings.objects.create(brand_name="Test", setup_completed=False, shop_mode="")

    r = api.get("/api/setup/status/")
    assert r.status_code == 200
    data = r.json()
    assert data["setup_completed"] is False
    assert data["shop_mode"] is None


@pytest.mark.django_db
def test_setup_complete_once(api):
    StoreSettings.objects.all().delete()
    StoreSettings.objects.create(brand_name="Test", setup_completed=False, shop_mode="")

    r = api.post(
        "/api/setup/complete/",
        data={"shop_mode": "CLOTHING_ONLY"},
        content_type="application/json",
    )
    assert r.status_code == 200
    assert r.json()["shop_mode"] == "CLOTHING_ONLY"
    assert r.json()["setup_completed"] is True

    obj = StoreSettings.get_solo()
    assert obj.shop_mode == "CLOTHING_ONLY"
    assert obj.setup_completed is True

    r2 = api.post(
        "/api/setup/complete/",
        data={"shop_mode": "MIXED"},
        content_type="application/json",
    )
    assert r2.status_code == 400
    assert r2.json()["code"] == "SETUP_ALREADY_DONE"


@pytest.mark.django_db
def test_setup_complete_invalid_mode(api):
    StoreSettings.objects.all().delete()
    StoreSettings.objects.create(brand_name="Test", setup_completed=False, shop_mode="")

    r = api.post(
        "/api/setup/complete/",
        data={"shop_mode": "INVALID"},
        content_type="application/json",
    )
    assert r.status_code == 400
    assert r.json()["code"] == "INVALID_SHOP_MODE"
