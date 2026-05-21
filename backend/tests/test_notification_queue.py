import pytest

from integrations.models import IntegrationSettings, NotificationQueue
from integrations.notification_queue import enqueue, flush_pending


def _mk_user(username: str, role: str):
    from django.contrib.auth.models import User

    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = role
    u.profile.save(update_fields=["role"])
    return u


@pytest.mark.django_db
def test_enqueue_and_flush_marks_sent(monkeypatch):
    owner = _mk_user("owner_nq", "OWNER")
    s = IntegrationSettings.get_solo()
    s.telegram_bot_token = "123:abc"
    s.telegram_chat_id = "1"
    s.save()

    enqueue(NotificationQueue.Kind.Z_REPORT_TELEGRAM, {"text": "hello queue"})

    monkeypatch.setattr(
        "integrations.services._post_json",
        lambda *a, **k: (True, "{}"))

    out = flush_pending(limit=10)
    assert out["sent"] >= 1
    row = NotificationQueue.objects.exclude(status=NotificationQueue.Status.PENDING).first()
    assert row is not None
    assert row.status == NotificationQueue.Status.SENT


@pytest.mark.django_db
def test_flush_internal_key_localhost(client, settings, monkeypatch):
    settings.INTERNAL_FLUSH_KEY = "test-flush-secret"
    _mk_user("owner_flush", "OWNER")
    s = IntegrationSettings.get_solo()
    s.telegram_bot_token = "123:abc"
    s.telegram_chat_id = "1"
    s.save()
    enqueue(NotificationQueue.Kind.Z_REPORT_TELEGRAM, {"text": "x"})
    monkeypatch.setattr("integrations.services._post_json", lambda *a, **k: (True, "{}"))

    r = client.post(
        "/api/integrations/notification-queue/flush/",
        data={},
        content_type="application/json",
        HTTP_X_INTERNAL_KEY="wrong")
    assert r.status_code in (401, 403)

    r2 = client.post(
        "/api/integrations/notification-queue/flush/",
        data={},
        content_type="application/json",
        HTTP_X_INTERNAL_KEY="test-flush-secret",
        REMOTE_ADDR="127.0.0.1")
    assert r2.status_code == 200


@pytest.mark.django_db
def test_flush_sync_report_event_type_matches_contract(monkeypatch):
    s = IntegrationSettings.get_solo()
    s.telegram_bot_token = "123:abc"
    s.telegram_chat_id = "1"
    s.save()

    enqueue(NotificationQueue.Kind.Z_REPORT_TELEGRAM, {"text": "hello queue"})
    monkeypatch.setattr("integrations.services._post_json", lambda *a, **k: (True, "{}"))

    from licensing.models import LicenseState

    lic = LicenseState.get_solo()
    lic.license_key = "ACT-1"
    lic.hardware_id = "HW-1"
    lic.save(update_fields=["license_key", "hardware_id"])

    captured: dict[str, object] = {}

    def _fake_sync(**kwargs):
        captured.update(kwargs)
        return True, {"ok": True}, 200

    monkeypatch.setattr("licensing.remote_client.remote_sync_report", _fake_sync)

    out = flush_pending(limit=10)
    assert out["sent"] >= 1
    assert captured["activation_key"] == "ACT-1"
    assert captured["hardware_id"] == "HW-1"
    events = captured["events"]
    assert isinstance(events, list) and len(events) == 1
    assert events[0]["event_type"] == "z_report_sync"
    assert events[0]["device_info"] == "POS-Windows"
