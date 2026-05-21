import uuid
from decimal import Decimal

import pytest
from django.contrib.auth.models import User

from catalog.models import Category, Product, ProductVariant
from debt.models import Customer, Debt
from core.exceptions import DebtPolicyError
from debt.services import record_debt_payment
from sales.models import Payment, Sale
from sales.services import complete_sale


@pytest.fixture
def cashier(db):
    u = User.objects.create_user(username="c2", password="pass12345")
    return u


@pytest.fixture
def customer(db):
    return Customer.objects.create(
        name="Ali", phone_normalized="998901112233", note=""
    )


@pytest.mark.django_db
def test_debt_created_on_debt_payment(cashier, customer):
    cat = Category.objects.create(name_uz="A", name_ru="A")
    prod = Product.objects.create(category=cat, name_uz="P", name_ru="P")
    v = ProductVariant(
        product=prod,
        purchase_price=Decimal("10"),
        list_price=Decimal("100"),
        stock_qty=0)
    v.save()
    from inventory.models import InventoryMovement
    from inventory.services import apply_movement

    apply_movement(
        variant=v,
        qty_delta=10,
        movement_type=InventoryMovement.Type.IN,
        user=cashier,
        note="")
    key = str(uuid.uuid4())
    sale = complete_sale(
        idempotency_key=key,
        cashier=cashier,
        lines=[{"variant_id": str(v.id), "qty": 1, "line_discount": "0"}],
        payments=[
            {"method": "CASH", "amount": "50.00"},
            {"method": "DEBT", "amount": "50.00"},
        ],
        customer={
            "name": customer.name,
            "phone_normalized": customer.phone_normalized,
        })
    d = Debt.objects.get(originating_sale=sale)
    assert d.remaining_amount == Decimal("50.00")
    record_debt_payment(customer=customer, amount=Decimal("20.00"), user=cashier)
    d.refresh_from_db()
    assert d.paid_amount == Decimal("20.00")
    assert d.remaining_amount == Decimal("30.00")


@pytest.mark.django_db
def test_debt_fifo_across_multiple_sales(cashier, customer):
    cat = Category.objects.create(name_uz="A", name_ru="A")
    sz = Size.objects.create(value="42", label_uz="42", label_ru="42")
    col = Color.objects.create(value="B", label_uz="Qora", label_ru="Черный")
    prod = Product.objects.create(category=cat, name_uz="P2", name_ru="P2")
    v = ProductVariant(
        product=prod,
        size=sz,
        color=col,
        purchase_price=Decimal("10"),
        list_price=Decimal("100"),
        stock_qty=0)
    v.save()
    from inventory.models import InventoryMovement
    from inventory.services import apply_movement

    apply_movement(
        variant=v,
        qty_delta=20,
        movement_type=InventoryMovement.Type.IN,
        user=cashier,
        note="")

    s1 = complete_sale(
        idempotency_key=str(uuid.uuid4()),
        cashier=cashier,
        lines=[{"variant_id": str(v.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "DEBT", "amount": "100.00"}],
        customer={"name": customer.name, "phone_normalized": customer.phone_normalized})
    s2 = complete_sale(
        idempotency_key=str(uuid.uuid4()),
        cashier=cashier,
        lines=[{"variant_id": str(v.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "DEBT", "amount": "100.00"}],
        customer={"name": customer.name, "phone_normalized": customer.phone_normalized})

    d1 = Debt.objects.get(originating_sale=s1)
    d2 = Debt.objects.get(originating_sale=s2)
    assert d1.created_at <= d2.created_at

    touched = record_debt_payment(customer=customer, amount=Decimal("130.00"), user=cashier)
    d1.refresh_from_db()
    d2.refresh_from_db()

    assert [d.id for d in touched] == [d1.id, d2.id]
    assert d1.status == Debt.Status.PAID
    assert d1.remaining_amount == Decimal("0.00")
    assert d2.status == Debt.Status.OPEN
    assert d2.remaining_amount == Decimal("70.00")


@pytest.mark.django_db
def test_debt_payment_overpay_rejected(cashier, customer):
    cat = Category.objects.create(name_uz="A3", name_ru="A3")
    sz = Size.objects.create(value="43", label_uz="43", label_ru="43")
    col = Color.objects.create(value="R", label_uz="Qizil", label_ru="Красный")
    prod = Product.objects.create(category=cat, name_uz="P3", name_ru="P3")
    v = ProductVariant(
        product=prod,
        size=sz,
        color=col,
        purchase_price=Decimal("10"),
        list_price=Decimal("100"),
        stock_qty=0)
    v.save()
    from inventory.models import InventoryMovement
    from inventory.services import apply_movement

    apply_movement(
        variant=v,
        qty_delta=10,
        movement_type=InventoryMovement.Type.IN,
        user=cashier,
        note="")

    s = complete_sale(
        idempotency_key=str(uuid.uuid4()),
        cashier=cashier,
        lines=[{"variant_id": str(v.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "DEBT", "amount": "100.00"}],
        customer={"name": customer.name, "phone_normalized": customer.phone_normalized})
    d = Debt.objects.get(originating_sale=s)
    with pytest.raises(DebtPolicyError):
        record_debt_payment(customer=customer, amount=Decimal("1000.00"), user=cashier)
    d.refresh_from_db()
    assert d.remaining_amount == Decimal("100.00")
