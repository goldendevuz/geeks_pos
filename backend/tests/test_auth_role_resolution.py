import pytest
from django.contrib.auth.models import User


@pytest.mark.django_db
def test_me_returns_owner_for_superuser(client):
    u = User.objects.create_superuser(
        username="root_role_test",
        email="root@test.local",
        password="pass12345")
    client.force_login(u)
    resp = client.get("/api/auth/me/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "OWNER"


@pytest.mark.django_db
def test_me_normalizes_profile_role_to_uppercase(client):
    u = User.objects.create_user(username="admin_case_test", password="pass12345")
    u.profile.role = "admin"
    u.profile.save(update_fields=["role"])
    client.force_login(u)
    resp = client.get("/api/auth/me/")
    assert resp.status_code == 200
    assert resp.json()["role"] == "ADMIN"
