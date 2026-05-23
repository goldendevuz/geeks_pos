import pytest
from decimal import Decimal

from django.contrib.auth.models import User
from rest_framework.test import APIClient

from expenses.models import ShopExpense


def _mk_user(username: str, role: str) -> User:
    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = role
    u.profile.save(update_fields=["role"])
    return u


@pytest.mark.django_db
def test_admin_can_update_and_delete_expense():
    admin = _mk_user("exp_admin", "ADMIN")
    cashier = _mk_user("exp_cashier", "CASHIER")
    row = ShopExpense.objects.create(
        recorded_by=cashier,
        amount=Decimal("50000"),
        category=ShopExpense.Category.OTHER,
        note="test",
    )
    api = APIClient()
    api.force_authenticate(user=admin)
    patch = api.patch(
        f"/api/expenses/{row.id}/",
        data={"amount": "75000", "note": "updated"},
        format="json",
    )
    assert patch.status_code == 200
    assert patch.json()["amount"] == "75000.00" or patch.json()["amount"] == "75000"
    delete = api.delete(f"/api/expenses/{row.id}/")
    assert delete.status_code == 204
    assert not ShopExpense.objects.filter(pk=row.id).exists()


@pytest.mark.django_db
def test_cashier_cannot_delete_expense():
    cashier = _mk_user("exp_cashier2", "CASHIER")
    row = ShopExpense.objects.create(
        recorded_by=cashier,
        amount=Decimal("10000"),
        category=ShopExpense.Category.SUPPLIES,
    )
    api = APIClient()
    api.force_authenticate(user=cashier)
    assert api.delete(f"/api/expenses/{row.id}/").status_code == 403
