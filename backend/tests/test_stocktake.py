import uuid
from decimal import Decimal

import pytest
from django.contrib.auth.models import User

from catalog.models import Category, Product, ProductVariant
from inventory.models import InventoryMovement
from inventory.services import apply_movement, apply_stocktake, create_stocktake_session, set_stocktake_count


@pytest.fixture
def admin_user(db):
    u = User.objects.create_user(username="stockadmin", password="pass12345")
    u.profile.role = "ADMIN"
    u.profile.save()
    return u


@pytest.fixture
def variant(db, admin_user):
    cat = Category.objects.create(name_uz=f"Kiyim-{uuid.uuid4()}", name_ru="Одежда")    col = Color.objects.create(value=f"BLACK-{uuid.uuid4()}", label_uz="Qora", label_ru="Черный", sort_order=1)
    prod = Product.objects.create(category=cat, name_uz=f"Kross-{uuid.uuid4()}", name_ru="Кросс")
    v = ProductVariant.objects.create(
        product=prod,
        purchase_price=Decimal("100000.00"),
        list_price=Decimal("150000.00"),
        stock_qty=0)
    apply_movement(
        variant=v,
        qty_delta=5,
        movement_type=InventoryMovement.Type.IN,
        user=admin_user,
        note="seed")
    v.refresh_from_db()
    return v


@pytest.mark.django_db
def test_stocktake_apply_adjusts_stock(admin_user, variant):
    session = create_stocktake_session(user=admin_user, note="daily")
    set_stocktake_count(session=session, variant=variant, counted_qty=3, user=admin_user)
    apply_stocktake(session=session, user=admin_user)
    variant.refresh_from_db()
    session.refresh_from_db()
    assert session.status == "APPLIED"
    assert variant.stock_qty == 3
