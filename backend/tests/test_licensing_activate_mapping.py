import pytest
from django.test import override_settings
from rest_framework.test import APIClient


def _mk_user(username: str, role: str):
    from django.contrib.auth.models import User

    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = role
    u.profile.save(update_fields=["role"])
    return u


def _verify_ok_active():
    return {"status": "active", "hardware_bound": False, "license_type": "yearly", "store_name": "Store"}


def _activate_ok():
    return {"status": "active", "expires_at": "2027-01-15", "license_type": "yearly"}


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("status_code", "payload", "expected_code"),
    [
        (401, {"detail": "Authentication credentials were not provided."}, "LICENSE_AUTH_INVALID"),
        (403, {"detail": "Invalid X-CLIENT-KEY header."}, "LICENSE_CLIENT_KEY_INVALID"),
        (403, {"detail": "Hardware ID mismatch."}, "LICENSE_HARDWARE_MISMATCH"),
        (404, {"detail": "Invalid activation key."}, "LICENSE_KEY_INVALID"),
        (400, {"detail": "License is not active."}, "LICENSE_NOT_ACTIVE"),
        (429, {"detail": "Too many requests."}, "LICENSE_RATE_LIMITED"),
    ])
def test_activate_maps_upstream_errors_on_verify(monkeypatch, status_code, payload, expected_code):
    owner = _mk_user(f"owner_map_{expected_code.lower()}", "OWNER")
    client = APIClient()
    client.force_authenticate(user=owner)
    monkeypatch.setattr(
        "licensing.views.remote_verify_activation_key",
        lambda activation_key: (False, payload, status_code))

    def _no_activate(**kwargs):
        raise AssertionError("activate should not run when verify fails")

    monkeypatch.setattr("licensing.views.remote_activate", _no_activate)
    r = client.post(
        "/api/licensing/activate/",
        {"activation_key": "ACT-1", "hardware_id": "HW-1", "client_meta": {"os": "windows"}},
        format="json")
    assert r.status_code == status_code
    assert r.json()["code"] == expected_code


@pytest.mark.django_db
def test_activate_maps_upstream_errors_on_activate(monkeypatch):
    owner = _mk_user("owner_map_activate_err", "OWNER")
    client = APIClient()
    client.force_authenticate(user=owner)
    monkeypatch.setattr(
        "licensing.views.remote_verify_activation_key",
        lambda activation_key: (True, _verify_ok_active(), 200))
    monkeypatch.setattr(
        "licensing.views.remote_activate",
        lambda activation_key, hardware_id, client_meta=None: (
            False,
            {"detail": "Invalid activation key."},
            404))
    r = client.post(
        "/api/licensing/activate/",
        {"activation_key": "ACT-1", "hardware_id": "HW-1", "client_meta": {"os": "windows"}},
        format="json")
    assert r.status_code == 404
    assert r.json()["code"] == "LICENSE_KEY_INVALID"


@pytest.mark.django_db
def test_activate_maps_unreachable_to_502(monkeypatch):
    owner = _mk_user("owner_map_unreachable", "OWNER")
    client = APIClient()
    client.force_authenticate(user=owner)
    monkeypatch.setattr(
        "licensing.views.remote_verify_activation_key",
        lambda activation_key: (False, "timed out", 0))

    def _no_activate(**kwargs):
        raise AssertionError("activate should not run when verify unreachable")

    monkeypatch.setattr("licensing.views.remote_activate", _no_activate)
    r = client.post(
        "/api/licensing/activate/",
        {"activation_key": "ACT-1", "hardware_id": "HW-1", "client_meta": {"os": "windows"}},
        format="json")
    assert r.status_code == 502
    assert r.json()["code"] == "LICENSE_UPSTREAM_UNREACHABLE"


@pytest.mark.django_db
@override_settings(LICENSE_ENFORCEMENT=True)
def test_activate_success_verify_then_activate(monkeypatch):
    owner = _mk_user("owner_activate_ok", "OWNER")
    client = APIClient()
    client.force_authenticate(user=owner)
    monkeypatch.setattr(
        "licensing.views.remote_verify_activation_key",
        lambda activation_key: (True, _verify_ok_active(), 200))
    monkeypatch.setattr(
        "licensing.views.remote_activate",
        lambda activation_key, hardware_id, client_meta=None: (True, _activate_ok(), 200))
    r = client.post(
        "/api/licensing/activate/",
        {
            "activation_key": "ACT-1",
            "hardware_id": "22a895c8-47c6-45de-8340-72ec4bdb97a9",
            "client_meta": {},
        },
        format="json")
    assert r.status_code == 200
    body = r.json()
    assert body.get("valid") is True
    assert body.get("expires_at")


@pytest.mark.django_db
def test_activate_key_invalid_on_verify(monkeypatch):
    owner = _mk_user("owner_no_key", "OWNER")
    client = APIClient()
    client.force_authenticate(user=owner)
    monkeypatch.setattr(
        "licensing.views.remote_verify_activation_key",
        lambda activation_key: (True, {"detail": "Invalid activation key."}, 404))

    def _no_activate(**kwargs):
        raise AssertionError("activate should not run when verify returns 404")

    monkeypatch.setattr("licensing.views.remote_activate", _no_activate)
    r = client.post(
        "/api/licensing/activate/",
        {"activation_key": "WRONG-KEY", "hardware_id": "22a895c8-47c6-45de-8340-72ec4bdb97a9"},
        format="json")
    assert r.status_code == 404
    assert r.json()["code"] == "LICENSE_KEY_INVALID"


@pytest.mark.django_db
def test_activate_verify_not_active(monkeypatch):
    owner = _mk_user("owner_verify_expired", "OWNER")
    client = APIClient()
    client.force_authenticate(user=owner)
    monkeypatch.setattr(
        "licensing.views.remote_verify_activation_key",
        lambda activation_key: (True, {"status": "expired", "detail": "License expired"}, 200))

    def _no_activate(**kwargs):
        raise AssertionError("activate should not run when verify status is not active")

    monkeypatch.setattr("licensing.views.remote_activate", _no_activate)
    r = client.post(
        "/api/licensing/activate/",
        {"activation_key": "ACT-1", "hardware_id": "22a895c8-47c6-45de-8340-72ec4bdb97a9"},
        format="json")
    assert r.status_code == 400
    assert r.json()["code"] == "LICENSE_NOT_ACTIVE"


@pytest.mark.django_db
def test_activate_hardware_mismatch_on_activate(monkeypatch):
    owner = _mk_user("owner_hw_bad", "OWNER")
    client = APIClient()
    client.force_authenticate(user=owner)
    monkeypatch.setattr(
        "licensing.views.remote_verify_activation_key",
        lambda activation_key: (True, _verify_ok_active(), 200))
    monkeypatch.setattr(
        "licensing.views.remote_activate",
        lambda activation_key, hardware_id, client_meta=None: (
            False,
            {"detail": "Hardware ID mismatch."},
            403))
    r = client.post(
        "/api/licensing/activate/",
        {"activation_key": "ACT-1", "hardware_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"},
        format="json")
    assert r.status_code == 403
    assert r.json()["code"] == "LICENSE_HARDWARE_MISMATCH"


def _remote_payload_like_pos_geeksandijan():
    """Contract from pos.geeksandijan.uz: yearly active, end_date null, start_date set."""
    return {
        "exists": True,
        "status": "active",
        "license_type": "yearly",
        "start_date": "2026-04-29",
        "end_date": None,
        "store": {"id": 1, "name": "Kadam"},
        "hardware_bound": True,
    }


@pytest.mark.django_db
@override_settings(LICENSE_ENFORCEMENT=True)
def test_activate_success_yearly_null_end_date_uses_start_plus_year(monkeypatch):
    """Remote may omit expires_at/end_date; infer window from start_date + license_type."""
    owner = _mk_user("owner_yearly_null_end", "OWNER")
    client = APIClient()
    client.force_authenticate(user=owner)
    p = _remote_payload_like_pos_geeksandijan()
    monkeypatch.setattr(
        "licensing.views.remote_verify_activation_key",
        lambda activation_key: (True, dict(p), 200))
    monkeypatch.setattr(
        "licensing.views.remote_activate",
        lambda activation_key, hardware_id, client_meta=None: (True, dict(p), 200))
    r = client.post(
        "/api/licensing/activate/",
        {
            "activation_key": "ACT-1",
            "hardware_id": "22a895c8-47c6-45de-8340-72ec4bdb97a9",
            "client_meta": {},
        },
        format="json")
    assert r.status_code == 200
    body = r.json()
    assert body.get("valid") is True
    assert body.get("expires_at") == "2027-04-29"
