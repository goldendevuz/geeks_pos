import pytest
from decimal import Decimal
from django.utils import timezone

from integrations.models import IntegrationSettings, NotificationQueue
from integrations.services import run_auto_daily_z_report_if_due, send_z_report_multichannel


@pytest.mark.django_db
def test_whatsapp_zreport_uses_whatsapp_markdown_format(monkeypatch):
    settings = IntegrationSettings.get_solo()
    settings.telegram_bot_token = ""
    settings.telegram_chat_id = ""
    settings.whatsapp_provider = IntegrationSettings.WhatsAppProvider.GREEN_API
    settings.whatsapp_api_base = "https://example.org"
    settings.whatsapp_sender = "998901112233"
    settings.greenapi_instance_id = "123"
    settings.greenapi_api_token_instance = "tok"
    settings.save()

    captured = {}

    def _fake_post(url, payload, headers=None):
        captured["url"] = url
        captured["payload"] = payload
        return True, "ok"

    monkeypatch.setattr("integrations.services._post_json", _fake_post)
    out = send_z_report_multichannel(lang="uz", from_date=str(timezone.localdate()), to_date=str(timezone.localdate()))
    assert out["ok"] is True
    msg = str(captured["payload"]["message"])
    assert "*Z-Report*" in msg
    assert "- *Savdo summasi:*" in msg
    assert "- *Sof tushum:*" in msg


@pytest.mark.django_db
def test_zreport_whatsapp_values_include_correct_net_and_shares(monkeypatch):
    settings = IntegrationSettings.get_solo()
    settings.telegram_bot_token = ""
    settings.telegram_chat_id = ""
    settings.whatsapp_provider = IntegrationSettings.WhatsAppProvider.GREEN_API
    settings.whatsapp_api_base = "https://example.org"
    settings.whatsapp_sender = "998901112233"
    settings.greenapi_instance_id = "123"
    settings.greenapi_api_token_instance = "tok"
    settings.save()

    monkeypatch.setattr(
        "integrations.services.sales_metrics",
        lambda **_: {
            "date": "2026-04-25",
            "sales_count": 4,
            "sales_amount": Decimal("23200"),
            "cash_total": Decimal("20200"),
            "card_total": Decimal("0"),
            "debt_total": Decimal("3000"),
            "returned_count": 1,
            "returned_total": Decimal("4000"),
            "open_debt_total": Decimal("6200"),
        })

    captured = {}

    def _fake_post(url, payload, headers=None):
        captured["payload"] = payload
        return True, "ok"

    monkeypatch.setattr("integrations.services._post_json", _fake_post)
    out = send_z_report_multichannel(lang="ru", from_date="2026-04-25", to_date="2026-04-25")
    assert out["ok"] is True
    msg = str(captured["payload"]["message"])
    assert "19 200" in msg
    assert "17%" in msg
    assert "87%" in msg


@pytest.mark.django_db
def test_whatsapp_retriable_error_goes_to_queue(monkeypatch):
    settings = IntegrationSettings.get_solo()
    settings.telegram_bot_token = ""
    settings.telegram_chat_id = ""
    settings.whatsapp_provider = IntegrationSettings.WhatsAppProvider.GREEN_API
    settings.whatsapp_api_base = "https://example.org"
    settings.whatsapp_sender = "998901112233"
    settings.greenapi_instance_id = "123"
    settings.greenapi_api_token_instance = "tok"
    settings.save()

    monkeypatch.setattr("integrations.services._post_json", lambda *a, **k: (False, "HTTP 500"))
    out = send_z_report_multichannel(lang="uz", from_date=str(timezone.localdate()), to_date=str(timezone.localdate()))
    assert out["ok"] is True
    assert NotificationQueue.objects.filter(kind=NotificationQueue.Kind.Z_REPORT_WHATSAPP).exists()


@pytest.mark.django_db
def test_whatsapp_non_retriable_error_not_queued(monkeypatch):
    settings = IntegrationSettings.get_solo()
    settings.telegram_bot_token = ""
    settings.telegram_chat_id = ""
    settings.whatsapp_provider = IntegrationSettings.WhatsAppProvider.GREEN_API
    settings.whatsapp_api_base = "https://example.org"
    settings.whatsapp_sender = "998901112233"
    settings.greenapi_instance_id = "123"
    settings.greenapi_api_token_instance = "tok"
    settings.save()

    monkeypatch.setattr("integrations.services._post_json", lambda *a, **k: (False, "HTTP 400"))
    out = send_z_report_multichannel(lang="uz", from_date=str(timezone.localdate()), to_date=str(timezone.localdate()))
    assert out["ok"] is False
    assert not NotificationQueue.objects.filter(kind=NotificationQueue.Kind.Z_REPORT_WHATSAPP).exists()


@pytest.mark.django_db
def test_auto_z_report_runs_once_per_day(monkeypatch):
    called = {"n": 0}

    def _fake_send_daily_z_report(*, lang="uz"):
        called["n"] += 1
        return {"ok": True, "details": "ok", "channel_results": {}}

    monkeypatch.setattr("integrations.services.send_daily_z_report", _fake_send_daily_z_report)
    settings = IntegrationSettings.get_solo()
    settings.last_auto_z_report_date = None
    settings.save(update_fields=["last_auto_z_report_date"])

    first = run_auto_daily_z_report_if_due(now=timezone.localtime())
    second = run_auto_daily_z_report_if_due(now=timezone.localtime())

    assert first["ran"] is True
    assert second["ran"] is False
    assert called["n"] == 1
