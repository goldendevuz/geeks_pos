import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from catalog.models import Category, Product, ProductKind, Size
from catalog.size_presets import clothing_size_values, footwear_numeric_values
from printing.models import StoreSettings


def _mk_user(username: str, role: str) -> User:
    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = role
    u.profile.save(update_fields=["role"])
    return u


def _owner_client():
    client = APIClient()
    client.force_authenticate(user=_mk_user("owner_cloth", "OWNER"))
    return client


@pytest.mark.django_db
def test_clothing_size_presets():
    kids = clothing_size_values("children", "MALE")
    assert "104" in kids
    assert "152" in kids
    adult_m = clothing_size_values("adult", "MALE")
    assert "3XL" in adult_m
    adult_f = clothing_size_values("adult", "FEMALE")
    assert "XS" in adult_f
    shoes = footwear_numeric_values("adult")
    assert shoes[0] == "40"
    assert shoes[-1] == "45"


@pytest.mark.django_db
def test_create_clothing_product_requires_gender():
    StoreSettings.objects.all().delete()
    StoreSettings.objects.create(
        brand_name="Shop",
        setup_completed=True,
        shop_mode=StoreSettings.ShopMode.CLOTHING_ONLY,
    )
    cat = Category.objects.create(name_uz="B", name_ru="B")
    client = _owner_client()

    r = client.post(
        "/api/catalog/products/",
        {"category": str(cat.id), "name_uz": "Ko'ylak", "name_ru": "Платье"},
        format="json",
    )
    assert r.status_code == 400

    r2 = client.post(
        "/api/catalog/products/",
        {
            "category": str(cat.id),
            "name_uz": "Ko'ylak",
            "name_ru": "Платье",
            "kind": ProductKind.CLOTHING,
            "gender": "FEMALE",
            "age_band": "adult",
        },
        format="json",
    )
    assert r2.status_code == 201
    prod = Product.objects.get(pk=r2.json()["id"])
    assert prod.kind == ProductKind.CLOTHING
    assert prod.gender == "FEMALE"


@pytest.mark.django_db
def test_create_size_with_metadata():
    client = _owner_client()
    r = client.post(
        "/api/catalog/sizes/",
        {
            "value": "M",
            "label_uz": "M",
            "label_ru": "M",
            "sort_order": 10,
            "kind": "CLOTHING",
            "age_band": "adult",
            "gender": "MALE",
        },
        format="json",
    )
    assert r.status_code == 201
    sz = Size.objects.get(pk=r.json()["id"])
    assert sz.kind == "CLOTHING"
    assert sz.age_band == "adult"
    assert sz.gender == "MALE"


@pytest.mark.django_db
def test_footwear_product_default_kind():
    StoreSettings.objects.all().delete()
    StoreSettings.objects.create(
        brand_name="Shop",
        setup_completed=True,
        shop_mode=StoreSettings.ShopMode.FOOTWEAR_ONLY,
    )
    cat = Category.objects.create(name_uz="B", name_ru="B")
    client = _owner_client()
    r = client.post(
        "/api/catalog/products/",
        {"category": str(cat.id), "name_uz": "Kross", "name_ru": "Кросс"},
        format="json",
    )
    assert r.status_code == 201
    prod = Product.objects.get(pk=r.json()["id"])
    assert prod.kind == ProductKind.FOOTWEAR
    assert prod.gender == ""
