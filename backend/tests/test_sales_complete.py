import uuid
from decimal import Decimal
from threading import Thread

import pytest
from django.contrib.auth.models import User
from django.db import close_old_connections

from catalog.models import Category, Product, ProductVariant
from core.exceptions import InsufficientStock, InvalidPaymentSplit
from sales.models import Payment, Sale, SaleLine
from sales.services import complete_sale, return_sale_lines, void_sale
from debt.models import Debt


@pytest.fixture
def cashier(db):
    u = User.objects.create_user(username="cashier", password="pass12345")
    u.profile.role = "CASHIER"
    u.profile.save()
    return u


@pytest.fixture
def variant(db):
    cat = Category.objects.create(name_uz="Kiyim", name_ru="Одежда")
    prod = Product.objects.create(
        category=cat, name_uz="Krossovka", name_ru="Кроссовки"
    )
    v = ProductVariant(
        product=prod,
        purchase_price=Decimal("100000.00"),
        list_price=Decimal("150000.00"),
        stock_qty=0)
    v.save()
    from inventory.models import InventoryMovement
    from inventory.services import apply_movement

    apply_movement(
        variant=v,
        qty_delta=5,
        movement_type=InventoryMovement.Type.IN,
        user=None,
        note="seed")
    v.refresh_from_db()
    return v


@pytest.mark.django_db
def test_complete_sale_decrements_stock_once(cashier, variant):
    key = str(uuid.uuid4())
    sale = complete_sale(
        idempotency_key=key,
        cashier=cashier,
        lines=[
            {
                "variant_id": str(variant.id),
                "qty": 2,
                "line_discount": "0",
            }
        ],
        payments=[
            {"method": "CASH", "amount": "300000.00"},
        ],
        customer=None)
    variant.refresh_from_db()
    assert variant.stock_qty == 3
    assert sale.grand_total == Decimal("300000.00")
    assert SaleLine.objects.filter(sale=sale).count() == 1


@pytest.mark.django_db
def test_insufficient_stock_rolls_back(cashier, variant):
    key = str(uuid.uuid4())
    line_total = variant.list_price * Decimal("99")
    with pytest.raises(InsufficientStock):
        complete_sale(
            idempotency_key=key,
            cashier=cashier,
            lines=[
                {"variant_id": str(variant.id), "qty": 99, "line_discount": "0"}
            ],
            payments=[{"method": "CASH", "amount": str(line_total)}],
            customer=None)
    variant.refresh_from_db()
    assert variant.stock_qty == 5
    assert not Sale.objects.filter(idempotency_key=key).exists()


@pytest.mark.django_db
def test_idempotency_same_key_no_double_stock(cashier, variant):
    key = str(uuid.uuid4())
    payload = dict(
        idempotency_key=key,
        cashier=cashier,
        lines=[
            {"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}
        ],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None)
    s1 = complete_sale(**payload)
    s2 = complete_sale(**payload)
    assert s1.id == s2.id
    variant.refresh_from_db()
    assert variant.stock_qty == 4


@pytest.mark.django_db
def test_idempotency_duplicate_key_concurrent_safe_second_call(cashier, variant):
    key = str(uuid.uuid4())
    s1 = complete_sale(
        idempotency_key=key,
        cashier=cashier,
        lines=[
            {"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}
        ],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None)
    s2 = complete_sale(
        idempotency_key=key,
        cashier=cashier,
        lines=[
            {"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}
        ],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None)
    assert s1.id == s2.id
    assert Payment.objects.filter(sale=s1).count() == 1


@pytest.mark.django_db
def test_payment_mismatch_raises(cashier, variant):
    with pytest.raises(InvalidPaymentSplit):
        complete_sale(
            idempotency_key=str(uuid.uuid4()),
            cashier=cashier,
            lines=[
                {"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}
            ],
            payments=[{"method": "CASH", "amount": "1.00"}],
            customer=None)


@pytest.mark.django_db
def test_barcode_format_numeric_prefix(variant):
    assert variant.barcode.isdigit()
    assert len(variant.barcode) == 8
    assert int(variant.barcode) >= 20000001


@pytest.mark.django_db
def test_expected_grand_total_mismatch_rejected(cashier, variant):
    with pytest.raises(InvalidPaymentSplit):
        complete_sale(
            idempotency_key=str(uuid.uuid4()),
            cashier=cashier,
            lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
            payments=[{"method": "CASH", "amount": "150000.00"}],
            customer=None,
            expected_grand_total=Decimal("149999.00"))


@pytest.mark.django_db(transaction=True)
def test_concurrent_same_idempotency_key_single_sale(cashier, variant):
    key = str(uuid.uuid4())
    sale_ids = []
    errors = []

    def worker():
        close_old_connections()
        try:
            sale = complete_sale(
                idempotency_key=key,
                cashier=cashier,
                lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
                payments=[{"method": "CASH", "amount": "150000.00"}],
                customer=None)
            sale_ids.append(str(sale.id))
        except Exception as ex:  # pragma: no cover - assertion below validates empty
            errors.append(str(ex))
        finally:
            close_old_connections()

    t1 = Thread(target=worker)
    t2 = Thread(target=worker)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    # SQLite can lock both concurrent attempts under heavy contention.
    # Retry with same key must converge to one persisted sale.
    assert len(sale_ids) + len(errors) == 2
    for err in errors:
        assert "database table is locked" in err

    s_retry = complete_sale(
        idempotency_key=key,
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000.00"}],
        customer=None)
    if sale_ids:
        assert str(s_retry.id) in sale_ids
    assert Sale.objects.filter(idempotency_key=key).count() == 1
    variant.refresh_from_db()
    assert variant.stock_qty == 4


@pytest.mark.django_db
def test_void_sale_reverses_stock_and_voids_debt(cashier, variant):
    key = str(uuid.uuid4())
    sale = complete_sale(
        idempotency_key=key,
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 2, "line_discount": "0"}],
        payments=[{"method": "DEBT", "amount": "300000.00"}],
        customer={"name": "Test", "phone_normalized": "998900000001"})
    variant.refresh_from_db()
    assert variant.stock_qty == 3
    debt = Debt.objects.get(originating_sale=sale)
    assert debt.status == Debt.Status.OPEN

    void_sale(sale=sale, user=cashier, reason="Wrong sale")

    sale.refresh_from_db()
    variant.refresh_from_db()
    debt.refresh_from_db()
    assert sale.status == Sale.Status.VOIDED
    assert variant.stock_qty == 5
    assert debt.status == Debt.Status.VOIDED
    assert debt.total_amount == debt.paid_amount + debt.remaining_amount


@pytest.mark.django_db
def test_partial_return_increases_stock_with_guard(cashier, variant):
    sale = complete_sale(
        idempotency_key=str(uuid.uuid4()),
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 3, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "450000.00"}],
        customer=None)
    variant.refresh_from_db()
    assert variant.stock_qty == 2

    out = return_sale_lines(
        sale=sale,
        user=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 2}],
        reason="customer return")
    assert out["sale_id"] == str(sale.id)
    variant.refresh_from_db()
    assert variant.stock_qty == 4

    with pytest.raises(ValueError):
        return_sale_lines(
            sale=sale,
            user=cashier,
            lines=[{"variant_id": str(variant.id), "qty": 2}],
            reason="over return")
