import pytest
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient

from debt.models import Customer
from debt.models import Debt
from catalog.models import Category, Color, Product, ProductVariant, Size
from decimal import Decimal
from sales.models import Sale
from reports.services import sales_metrics
from inventory.models import InventoryMovement


def _mk_user(username: str, role: str) -> User:
    u = User.objects.create_user(username=username, password="pass12345")
    u.profile.role = role
    u.profile.save(update_fields=["role"])
    return u


def _mk_variant(stock_qty: int = 10) -> ProductVariant:
    cat = Category.objects.create(name_uz="Kiyim", name_ru="Одежда")
    sz = Size.objects.create(value="42", label_uz="42", label_ru="42", sort_order=1)
    col = Color.objects.create(value="BLACK-REP", label_uz="Qora", label_ru="Черный", sort_order=1)
    prod = Product.objects.create(category=cat, name_uz="Keta", name_ru="Кеды")
    return ProductVariant.objects.create(
        product=prod,
        size=sz,
        color=col,
        purchase_price=Decimal("100000.00"),
        list_price=Decimal("150000.00"),
        stock_qty=stock_qty,
    )


@pytest.mark.django_db
def test_reports_summary_forbidden_for_cashier(client):
    cashier = _mk_user("cashier_reports", "CASHIER")
    client.force_login(cashier)
    r = client.get("/api/reports/summary/")
    assert r.status_code == 403


@pytest.mark.django_db
def test_cashier_x_report_ok_for_cashier(client):
    cashier = _mk_user("cashier_xrep", "CASHIER")
    client.force_login(cashier)
    r = client.get("/api/reports/cashier-x/")
    assert r.status_code == 200
    j = r.json()
    assert "gross_profit" in j
    assert "cash_total" in j
    assert "card_total" in j
    assert "sales_count" in j
    assert j["cashier_username"] == cashier.username


@pytest.mark.django_db
def test_inventory_receive_adjust_forbidden_for_cashier(client):
    cashier = _mk_user("cashier_inv", "CASHIER")
    variant = _mk_variant()
    client.force_login(cashier)
    rec = client.post(
        "/api/inventory/receive/",
        data={"variant_id": str(variant.id), "qty": 1},
        content_type="application/json",
    )
    adj = client.post(
        "/api/inventory/adjust/",
        data={"variant_id": str(variant.id), "qty_delta": -1},
        content_type="application/json",
    )
    assert rec.status_code == 403
    assert adj.status_code == 403


@pytest.mark.django_db
def test_reports_summary_allowed_for_owner(client):
    owner = _mk_user("owner_reports", "OWNER")
    client.force_login(owner)
    r = client.get("/api/reports/summary/")
    assert r.status_code == 200
    body = r.json()
    assert "totals" in body
    assert "top_cashiers" in body
    assert "gross_profit" in body["totals"]
    assert "operating_profit" in body["totals"]
    assert "net_sales_approx" in body["totals"]
    assert "total_discounts" in body["totals"]


@pytest.mark.django_db
def test_order_discount_saved_in_sale(client):
    cashier = _mk_user("cashier_discount", "CASHIER")
    variant = _mk_variant()
    client.force_login(cashier)
    r = client.post(
        "/api/sales/complete/",
        data={
            "lines": [{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
            "payments": [{"method": "CASH", "amount": "140000"}],
            "order_discount": "10000",
            "expected_grand_total": "140000",
        },
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY="discount-case-1",
    )
    assert r.status_code == 200
    sale = Sale.objects.get(idempotency_key="discount-case-1")
    assert sale.discount_total == Decimal("10000")


@pytest.mark.django_db
def test_z_report_allowed_for_cashier(monkeypatch):
    cashier = _mk_user("cashier_z_ok", "CASHIER")
    api = APIClient()
    api.force_authenticate(user=cashier)
    monkeypatch.setattr(
        "integrations.views.send_daily_z_report",
        lambda **kwargs: {"ok": True, "channel_results": {"telegram": {"ok": True}}},
    )
    r = api.post("/api/integrations/z-report/send/", format="json")
    assert r.status_code == 200


@pytest.mark.django_db
def test_integration_settings_owner_allowed(client):
    owner = _mk_user("owner_integ", "OWNER")
    client.force_login(owner)
    r = client.put(
        "/api/integrations/settings/",
        data={
            "telegram_bot_token": "123:abc",
            "telegram_chat_id": "1",
            "whatsapp_api_base": "https://example.org",
            "whatsapp_api_token": "tok",
            "whatsapp_sender": "GEEKS",
        },
        content_type="application/json",
    )
    assert r.status_code == 200
    assert r.json()["telegram_chat_id"] == "1"


@pytest.mark.django_db
def test_integration_actions_owner_allowed_with_stub(client, monkeypatch):
    owner = _mk_user("owner_integ_actions", "OWNER")
    customer = Customer.objects.create(name="Ali", phone_normalized="998901112233")
    client.force_login(owner)

    monkeypatch.setattr(
        "integrations.views.send_daily_z_report",
        lambda **kwargs: {"ok": True, "details": "ok", "channel_results": {"telegram": {"ok": True}}},
    )
    captured = {}
    def _fake_reminder(**kwargs):
        captured.update(kwargs)
        return {"ok": True, "details": "ok"}
    monkeypatch.setattr("integrations.views.send_whatsapp_reminder", _fake_reminder)

    z = client.post("/api/integrations/telegram/send-z-report/", data={}, content_type="application/json")
    assert z.status_code == 200
    z2 = client.post("/api/integrations/z-report/send/", data={}, content_type="application/json")
    assert z2.status_code == 200

    w = client.post(
        "/api/integrations/whatsapp/remind/",
        data={"customer_id": str(customer.id), "amount": "120000"},
        HTTP_ACCEPT_LANGUAGE="ru",
        content_type="application/json",
    )
    assert w.status_code == 200
    assert captured.get("lang") == "ru"
    assert isinstance(captured.get("debt_items"), list)


@pytest.mark.django_db
def test_whatsapp_reminder_customer_not_found_controlled_error(client):
    owner = _mk_user("owner_integ_404", "OWNER")
    client.force_login(owner)
    r = client.post(
        "/api/integrations/whatsapp/remind/",
        data={"customer_id": "00000000-0000-0000-0000-000000000001", "amount": "1000"},
        content_type="application/json",
    )
    assert r.status_code == 404
    assert r.json()["code"] == "CUSTOMER_NOT_FOUND"


@pytest.mark.django_db
def test_whatsapp_reminder_message_includes_debt_details(client, monkeypatch):
    owner = _mk_user("owner_integ_debt_details", "OWNER")
    customer = Customer.objects.create(name="Ali", phone_normalized="998901112233")
    cashier = _mk_user("cashier_integ_debt_details", "CASHIER")
    variant = _mk_variant()
    sale = Sale.objects.create(
        idempotency_key="debt-reminder-sale-1",
        cashier=cashier,
        subtotal=Decimal("150000"),
        discount_total=Decimal("0"),
        grand_total=Decimal("150000"),
    )
    Debt.objects.create(
        customer=customer,
        originating_sale=sale,
        total_amount=Decimal("150000"),
        paid_amount=Decimal("0"),
        remaining_amount=Decimal("150000"),
        due_date=timezone.localdate() + timedelta(days=7),
        status=Debt.Status.OPEN,
    )
    client.force_login(owner)
    captured = {}
    def _fake_reminder(**kwargs):
        captured.update(kwargs)
        return {"ok": True, "details": "ok"}
    monkeypatch.setattr("integrations.views.send_whatsapp_reminder", _fake_reminder)
    r = client.post(
        "/api/integrations/whatsapp/remind/",
        data={"customer_id": str(customer.id), "amount": "150000"},
        content_type="application/json",
    )
    assert r.status_code == 200
    items = captured.get("debt_items")
    assert isinstance(items, list) and len(items) == 1
    first = items[0]
    assert first["sale_no"] in (sale.public_sale_no, str(sale.id)[:8])
    assert first["total_amount"] == "150000.00"
    assert first["remaining_amount"] == "150000.00"
    assert first["sale_time"] != "-"
    assert first["debt_created_at"] != "-"


@pytest.mark.django_db
def test_dashboard_financial_contract_completed_only_and_discount_aware(client):
    owner = _mk_user("owner_fin_contract", "OWNER")
    cashier = _mk_user("cashier_fin_contract", "CASHIER")
    variant = _mk_variant()
    client.force_login(cashier)
    r1 = client.post(
        "/api/sales/complete/",
        data={
            "lines": [{"variant_id": str(variant.id), "qty": 1, "line_discount": "10000"}],
            "payments": [{"method": "CASH", "amount": "140000"}],
            "expected_grand_total": "140000",
        },
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY="fin-contract-1",
    )
    assert r1.status_code == 200
    r2 = client.post(
        "/api/sales/complete/",
        data={
            "lines": [{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
            "payments": [{"method": "CASH", "amount": "150000"}],
            "expected_grand_total": "150000",
        },
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY="fin-contract-2",
    )
    assert r2.status_code == 200
    sale2 = r2.json()["sale_id"]
    client.force_login(owner)
    v = client.post(
        f"/api/sales/{sale2}/void/",
        data={"reason": "test-void"},
        content_type="application/json",
    )
    assert v.status_code == 200

    summary = client.get("/api/reports/summary/")
    assert summary.status_code == 200
    totals = summary.json()["totals"]
    assert totals["sales_count"] == 1
    assert totals["void_count"] == 1
    assert totals["sales_amount"] == "140000"
    assert totals["total_discounts"] == "10000"
    assert totals["gross_profit"] == "40000"
    assert totals["operating_profit"] == "40000"
    assert totals["net_profit"] == "40000"
    assert totals["net_sales_approx"] == "140000"


@pytest.mark.django_db
def test_sales_metrics_order_discount_margin_matches_grand_less_cogs():
    cashier = _mk_user("cashier_od_margin", "CASHIER")
    variant = _mk_variant(stock_qty=20)
    from sales.services import complete_sale

    complete_sale(
        idempotency_key="od-margin-sale",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "140000"}],
        customer=None,
        order_discount=Decimal("10000"),
        expected_grand_total=Decimal("140000"),
    )
    m = sales_metrics()
    assert str(m["gross_profit"]) == "40000"
    assert str(m["sales_amount"]) == "140000"


@pytest.mark.django_db
def test_today_operating_profit_subtracts_today_expenses():
    cashier = _mk_user("cashier_today_op", "CASHIER")
    owner = _mk_user("owner_today_op", "OWNER")
    variant = _mk_variant()
    from expenses.models import ShopExpense
    from sales.services import complete_sale

    complete_sale(
        idempotency_key="today-op-sale",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000"}],
        customer=None,
        expected_grand_total=Decimal("150000"),
    )
    ShopExpense.objects.create(
        amount=Decimal("8000.00"),
        category=ShopExpense.Category.OTHER,
        note="",
        recorded_by=owner,
    )
    m = sales_metrics()
    assert str(m["today_gross_profit"]) == "50000"
    assert str(m["today_operating_profit"]) == "42000"
    assert str(m["today_expense_total"]) == "8000"


@pytest.mark.django_db
def test_operating_profit_subtracts_expenses():
    cashier = _mk_user("cashier_oper_gp", "CASHIER")
    owner = _mk_user("owner_oper_gp", "OWNER")
    variant = _mk_variant()
    from expenses.models import ShopExpense
    from sales.services import complete_sale

    complete_sale(
        idempotency_key="oper-gp-sale",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000"}],
        customer=None,
        expected_grand_total=Decimal("150000"),
    )
    ShopExpense.objects.create(
        amount=Decimal("10000.00"),
        category=ShopExpense.Category.OTHER,
        note="",
        recorded_by=owner,
    )
    m = sales_metrics()
    assert str(m["gross_profit"]) == "50000"
    assert str(m["operating_profit"]) == "40000"
    assert str(m["net_profit"]) == "40000"


@pytest.mark.django_db
def test_returned_total_weighted_duplicate_variant():
    """Weighted line_total avg when same variant appears on two sale lines."""
    cashier = _mk_user("cashier_rt_weight", "CASHIER")
    variant = _mk_variant(stock_qty=20)
    from reports.services import q_money as q_money_rp
    from sales.services import complete_sale, return_sale_lines

    sale = complete_sale(
        idempotency_key="dup-var-sale",
        cashier=cashier,
        lines=[
            {"variant_id": str(variant.id), "qty": 1, "line_discount": "50000"},
            {"variant_id": str(variant.id), "qty": 1, "line_discount": "0"},
        ],
        payments=[{"method": "CASH", "amount": "250000"}],
        customer=None,
        order_discount=None,
        expected_grand_total=Decimal("250000"),
    )
    sale.refresh_from_db()
    assert sale.grand_total == Decimal("250000")

    ln_sum = sum(Decimal(str(l.line_total)) for l in sale.lines.all())
    return_sale_lines(sale=sale, user=cashier, lines=[{"variant_id": str(variant.id), "qty": 2}], reason="wt")

    m = sales_metrics()
    assert m["returned_total"] == q_money_rp(ln_sum)



@pytest.mark.django_db
def test_sales_metrics_parity_cash_card_debt(client):
    cashier = _mk_user("cashier_metrics", "CASHIER")
    variant = _mk_variant()
    client.force_login(cashier)
    r = client.post(
        "/api/sales/complete/",
        data={
            "lines": [{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
            "payments": [
                {"method": "CASH", "amount": "100000"},
                {"method": "CARD", "amount": "30000"},
                {"method": "DEBT", "amount": "20000"},
            ],
            "customer": {"name": "Metrics Customer", "phone_normalized": "998901010101"},
            "expected_grand_total": "150000",
        },
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY="metrics-pay-split",
    )
    assert r.status_code == 200
    m = sales_metrics()
    assert str(m["sales_amount"]) == "150000"
    assert str(m["cash_total"]) == "100000"
    assert str(m["card_total"]) == "30000"
    assert str(m["debt_total"]) == "20000"


@pytest.mark.django_db
def test_dashboard_summary_defaults_to_current_month(client):
    owner = _mk_user("owner_filter_default", "OWNER")
    cashier = _mk_user("cashier_filter_default", "CASHIER")
    variant = _mk_variant()
    client.force_login(cashier)
    r = client.post(
        "/api/sales/complete/",
        data={
            "lines": [{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
            "payments": [{"method": "CASH", "amount": "150000"}],
            "expected_grand_total": "150000",
        },
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY="filter-default-old-month",
    )
    assert r.status_code == 200
    sale = Sale.objects.get(idempotency_key="filter-default-old-month")
    last_month = timezone.now() - timedelta(days=35)
    Sale.objects.filter(id=sale.id).update(completed_at=last_month)

    client.force_login(owner)
    out = client.get("/api/reports/summary/")
    assert out.status_code == 200
    body = out.json()
    assert body["totals"]["sales_count"] == 0
    assert body["range"]["from"] is not None
    assert body["range"]["to"] is not None


@pytest.mark.django_db
def test_dashboard_summary_year_filter(client):
    owner = _mk_user("owner_filter_year", "OWNER")
    client.force_login(owner)
    out = client.get("/api/reports/summary/?year=2026")
    assert out.status_code == 200
    assert out.json()["range"]["year"] == "2026"


@pytest.mark.django_db
def test_sales_metrics_counts_real_returns_not_voids(client):
    owner = _mk_user("owner_ret_metrics", "OWNER")
    cashier = _mk_user("cashier_ret_metrics", "CASHIER")
    variant = _mk_variant()
    client.force_login(cashier)
    r = client.post(
        "/api/sales/complete/",
        data={
            "lines": [{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
            "payments": [{"method": "CASH", "amount": "150000"}],
            "expected_grand_total": "150000",
        },
        content_type="application/json",
        HTTP_IDEMPOTENCY_KEY="ret-metrics-1",
    )
    assert r.status_code == 200
    sale_id = r.json()["sale_id"]
    client.force_login(owner)
    rr = client.post(
        f"/api/sales/{sale_id}/return/",
        data={"lines": [{"variant_id": str(variant.id), "qty": 1}], "reason": "return"},
        content_type="application/json",
    )
    assert rr.status_code == 200
    m = sales_metrics()
    assert m["returned_count"] >= 1
    assert str(m["returned_total"]) == "150000"


@pytest.mark.django_db
def test_gross_profit_and_net_sales_after_full_return():
    """To'liq qaytariqdan keyin marja va taxminiy sof savdo nolga yaqinlashadi."""
    cashier = _mk_user("cashier_gp_ret", "CASHIER")
    variant = _mk_variant()
    from sales.services import complete_sale, return_sale_lines

    sale = complete_sale(
        idempotency_key="gp-ret-sale",
        cashier=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1, "line_discount": "0"}],
        payments=[{"method": "CASH", "amount": "150000"}],
        customer=None,
        expected_grand_total=Decimal("150000"),
    )
    before = sales_metrics()
    assert str(before["gross_profit"]) == "50000"
    assert str(before["net_sales_approx"]) == "150000"

    return_sale_lines(
        sale=sale,
        user=cashier,
        lines=[{"variant_id": str(variant.id), "qty": 1}],
        reason="full",
    )
    after = sales_metrics()
    assert str(after["returned_total"]) == "150000"
    assert str(after["returned_cogs"]) == "100000"
    assert str(after["gross_profit"]) == "0"
    assert str(after["net_sales_approx"]) == "0"
    assert after["today_return_move_count"] >= 1


@pytest.mark.django_db
def test_send_daily_z_report_uses_today_range(monkeypatch):
    captured: dict[str, str | None] = {}

    def _fake_metrics(*, from_date=None, to_date=None):
        captured["from_date"] = from_date
        captured["to_date"] = to_date
        return {
            "date": "2026-04-25",
            "sales_count": 0,
            "sales_amount": Decimal("0"),
            "cash_total": Decimal("0"),
            "card_total": Decimal("0"),
            "debt_total": Decimal("0"),
            "returned_count": 0,
            "returned_total": Decimal("0"),
            "open_debt_total": Decimal("0"),
        }

    monkeypatch.setattr("integrations.services.sales_metrics", _fake_metrics)
    monkeypatch.setattr("integrations.services._telegram_ready", lambda *_: True)
    monkeypatch.setattr("integrations.services._send_telegram_text", lambda **_: "ok")
    monkeypatch.setattr("integrations.services._whatsapp_ready", lambda *_: False)
    from integrations.services import send_daily_z_report

    out = send_daily_z_report(lang="uz")
    assert out["ok"] is True
    today = str(timezone.localdate())
    assert captured["from_date"] == today
    assert captured["to_date"] == today

