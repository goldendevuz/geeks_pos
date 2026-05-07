import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.utils import timezone

from printing.models import StoreSettings
from reports.services import sales_metrics, q_money

from .models import IntegrationSettings, NotificationQueue


class NotificationDeliveryError(ValueError):
    def __init__(self, message: str, *, retriable: bool):
        super().__init__(message)
        self.retriable = retriable


def _post_json(
    url: str,
    payload: dict,
    headers: dict[str, str] | None = None,
    *,
    require_ok_field: bool = False,
):
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if headers:
        for key, val in headers.items():
            req.add_header(key, val)
    try:
        with urlopen(req, timeout=15) as resp:  # nosec B310 - controlled admin config URL
            body = resp.read().decode("utf-8") if resp else ""
            if require_ok_field:
                try:
                    parsed = json.loads(body or "{}")
                except json.JSONDecodeError:
                    return False, "Invalid JSON response"
                if not bool(parsed.get("ok")):
                    detail = (
                        parsed.get("description")
                        or parsed.get("error")
                        or parsed.get("message")
                        or "ok=false"
                    )
                    return False, f"API ok=false: {detail}"
            return True, body
    except HTTPError as e:
        return False, f"HTTP {e.code}"
    except URLError as e:
        return False, str(e.reason)


def _norm_lang(lang: str | None) -> str:
    raw = (lang or "uz").lower()
    return "ru" if raw.startswith("ru") else "uz"


def _fmt_money(value) -> str:
    quantized = q_money(value)
    return f"{quantized:,}".replace(",", " ")


def _fmt_pct(value) -> str:
    pct = q_money(value)
    return f"{pct}%"


def _report_derived(metrics: dict) -> dict[str, object]:
    sales_amount = q_money(metrics.get("sales_amount"))
    returned_total = q_money(metrics.get("returned_total"))
    cash_total = q_money(metrics.get("cash_total"))
    card_total = q_money(metrics.get("card_total"))
    debt_total = q_money(metrics.get("debt_total"))
    net_sales = q_money(sales_amount - returned_total)

    if sales_amount > 0:
        cash_share = q_money((cash_total * 100) / sales_amount)
        card_share = q_money((card_total * 100) / sales_amount)
        debt_share = q_money((debt_total * 100) / sales_amount)
        return_share = q_money((returned_total * 100) / sales_amount)
    else:
        cash_share = q_money(0)
        card_share = q_money(0)
        debt_share = q_money(0)
        return_share = q_money(0)

    return {
        "net_sales": net_sales,
        "cash_share": cash_share,
        "card_share": card_share,
        "debt_share": debt_share,
        "return_share": return_share,
    }


def _build_z_report_text(*, metrics: dict, lang: str) -> str:
    d = _report_derived(metrics)
    if lang == "ru":
        return (
            f"Z-Report {metrics['date']}\n"
            f"Кратко: чистая выручка {_fmt_money(d['net_sales'])}; возвраты {_fmt_pct(d['return_share'])}\n\n"
            f"Продажи:\n"
            f"- Чеков: {metrics['sales_count']}\n"
            f"- Сумма продаж: {_fmt_money(metrics['sales_amount'])}\n\n"
            f"Оплаты:\n"
            f"- Наличные: {_fmt_money(metrics['cash_total'])} ({_fmt_pct(d['cash_share'])})\n"
            f"- Карта: {_fmt_money(metrics['card_total'])} ({_fmt_pct(d['card_share'])})\n"
            f"- Долг: {_fmt_money(metrics['debt_total'])} ({_fmt_pct(d['debt_share'])})\n\n"
            f"Возвраты:\n"
            f"- Чеков возврата: {metrics['returned_count']}\n"
            f"- Сумма возвратов: {_fmt_money(metrics['returned_total'])} ({_fmt_pct(d['return_share'])})\n\n"
            f"Итог дня:\n"
            f"- Чистая выручка: {_fmt_money(d['net_sales'])}\n"
            f"- Открытый долг: {_fmt_money(metrics['open_debt_total'])}"
        )
    return (
        f"Z-Report {metrics['date']}\n"
        f"Qisqa xulosa: sof tushum {_fmt_money(d['net_sales'])}; qaytish {_fmt_pct(d['return_share'])}\n\n"
        f"Savdo:\n"
        f"- Cheklar soni: {metrics['sales_count']}\n"
        f"- Savdo summasi: {_fmt_money(metrics['sales_amount'])}\n\n"
        f"To'lovlar:\n"
        f"- Naqd: {_fmt_money(metrics['cash_total'])} ({_fmt_pct(d['cash_share'])})\n"
        f"- Karta: {_fmt_money(metrics['card_total'])} ({_fmt_pct(d['card_share'])})\n"
        f"- Nasiya: {_fmt_money(metrics['debt_total'])} ({_fmt_pct(d['debt_share'])})\n\n"
        f"Qaytish:\n"
        f"- Qaytish cheklari: {metrics['returned_count']}\n"
        f"- Qaytish summasi: {_fmt_money(metrics['returned_total'])} ({_fmt_pct(d['return_share'])})\n\n"
        f"Kun yakuni:\n"
        f"- Sof tushum: {_fmt_money(d['net_sales'])}\n"
        f"- Ochiq qarz: {_fmt_money(metrics['open_debt_total'])}"
    )


def _build_z_report_whatsapp_text(*, metrics: dict, lang: str) -> str:
    d = _report_derived(metrics)
    if lang == "ru":
        return (
            f"*Z-Report* _{metrics['date']}_\n"
            f"*Кратко:* чистая выручка {_fmt_money(d['net_sales'])}; возвраты {_fmt_pct(d['return_share'])}\n"
            f"- *Продажи:* {metrics['sales_count']}\n"
            f"- *Сумма продаж:* {_fmt_money(metrics['sales_amount'])}\n"
            f"- Наличные: {_fmt_money(metrics['cash_total'])} ({_fmt_pct(d['cash_share'])})\n"
            f"- Карта: {_fmt_money(metrics['card_total'])} ({_fmt_pct(d['card_share'])})\n"
            f"- Долг: {_fmt_money(metrics['debt_total'])} ({_fmt_pct(d['debt_share'])})\n"
            f"- Возвраты: {metrics['returned_count']} / {_fmt_money(metrics['returned_total'])} ({_fmt_pct(d['return_share'])})\n"
            f"- *Чистая выручка:* {_fmt_money(d['net_sales'])}\n"
            f"- *Открытый долг:* {_fmt_money(metrics['open_debt_total'])}"
        )
    return (
        f"*Z-Report* _{metrics['date']}_\n"
        f"*Qisqa xulosa:* sof tushum {_fmt_money(d['net_sales'])}; qaytish {_fmt_pct(d['return_share'])}\n"
        f"- *Savdolar:* {metrics['sales_count']}\n"
        f"- *Savdo summasi:* {_fmt_money(metrics['sales_amount'])}\n"
        f"- Naqd: {_fmt_money(metrics['cash_total'])} ({_fmt_pct(d['cash_share'])})\n"
        f"- Karta: {_fmt_money(metrics['card_total'])} ({_fmt_pct(d['card_share'])})\n"
        f"- Nasiya: {_fmt_money(metrics['debt_total'])} ({_fmt_pct(d['debt_share'])})\n"
        f"- Qaytish: {metrics['returned_count']} / {_fmt_money(metrics['returned_total'])} ({_fmt_pct(d['return_share'])})\n"
        f"- *Sof tushum:* {_fmt_money(d['net_sales'])}\n"
        f"- *Ochiq qarz:* {_fmt_money(metrics['open_debt_total'])}"
    )


def _telegram_ready(settings: IntegrationSettings) -> bool:
    return bool(settings.telegram_bot_token and settings.telegram_chat_id)


def _whatsapp_ready(settings: IntegrationSettings) -> bool:
    if settings.whatsapp_provider == IntegrationSettings.WhatsAppProvider.GREEN_API:
        return bool(
            settings.whatsapp_api_base
            and settings.greenapi_instance_id
            and settings.greenapi_api_token_instance
            and settings.whatsapp_sender
        )
    return bool(settings.whatsapp_api_base and settings.whatsapp_api_token and settings.whatsapp_sender)


def _send_telegram_text(*, settings: IntegrationSettings, text: str):
    if not _telegram_ready(settings):
        raise ValueError("Telegram settings are incomplete")
    ok, details = _post_json(
        f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage",
        {"chat_id": settings.telegram_chat_id, "text": text},
        require_ok_field=True,
    )
    if not ok:
        retriable = "HTTP 4" not in details or "HTTP 429" in details
        raise NotificationDeliveryError(f"Telegram send failed: {details}", retriable=retriable)
    return details


def _send_whatsapp_text(*, settings: IntegrationSettings, text: str):
    if not _whatsapp_ready(settings):
        raise ValueError("WhatsApp settings are incomplete")
    if settings.whatsapp_provider == IntegrationSettings.WhatsAppProvider.GREEN_API:
        chat_id = settings.whatsapp_sender if "@c.us" in settings.whatsapp_sender else f"{settings.whatsapp_sender}@c.us"
        payload = {"chatId": chat_id, "message": text}
        url = (
            settings.whatsapp_api_base.rstrip("/")
            + f"/waInstance{settings.greenapi_instance_id}/sendMessage/{settings.greenapi_api_token_instance}"
        )
        ok, details = _post_json(url, payload)
    else:
        payload = {"to": settings.whatsapp_sender, "message": text, "sender": settings.whatsapp_sender}
        ok, details = _post_json(
            settings.whatsapp_api_base.rstrip("/") + "/messages/send",
            payload,
            headers={"Authorization": f"Bearer {settings.whatsapp_api_token}"},
        )
    if not ok:
        retriable = "HTTP 4" not in details or "HTTP 429" in details
        raise NotificationDeliveryError(f"WhatsApp send failed: {details}", retriable=retriable)
    return details


def _send_whatsapp_debt_reminder_now(
    *,
    settings: IntegrationSettings,
    phone: str,
    customer_name: str,
    amount: str,
    lang: str = "uz",
    debt_items: list[dict] | None = None,
    reminder_kind: str = "debt_reminder",
    payment_amount: str = "0",
    payment_time: str = "-",
    is_partial: bool = False,
    total_remaining: str = "0",
    store_name: str = "",
    store_phone: str = "",
):
    if not settings.whatsapp_api_base:
        raise ValueError("WhatsApp settings are incomplete")
    selected_lang = _norm_lang(lang)
    rows = debt_items or []
    if selected_lang == "ru":
        if reminder_kind == "repayment_update":
            lines = [
                f"Здравствуйте, {customer_name}.",
                "Платёж по задолженности принят.",
                f"Сумма платежа: {payment_amount}",
                f"Время платежа: {payment_time}",
                (
                    f"Статус: частичное погашение. Остаток долга: {total_remaining}"
                    if is_partial
                    else "Статус: задолженность погашена полностью."
                ),
                "",
            ]
        else:
            lines = [
                f"Здравствуйте, {customer_name}.",
                "Напоминание о задолженности по вашему магазину.",
                f"Сумма долга к оплате: {amount}",
                "",
            ]
        if rows:
            lines.append("Детали по долгам:")
            for idx, row in enumerate(rows, start=1):
                lines.extend(
                    [
                        f"{idx}) Продажа: {row.get('sale_no') or '-'}",
                        f"   Сумма покупки: {row.get('total_amount') or '-'}",
                        f"   Погашено сейчас: {row.get('paid_now') or '-'}",
                        f"   Осталось к оплате: {row.get('remaining_amount') or '-'}",
                        f"   Время покупки: {row.get('sale_time') or '-'}",
                        f"   Дата выдачи долга: {row.get('debt_created_at') or '-'}",
                        f"   Срок оплаты: {row.get('due_date') or '-'}",
                    ]
                )
        lines.append("")
        lines.append(
            "Спасибо за оплату!"
            if reminder_kind == "repayment_update"
            else "Пожалуйста, внесите оплату в ближайшее время. Спасибо!"
        )
        if store_name or store_phone:
            lines.append("")
            lines.append("Контакты магазина:")
            if store_name:
                lines.append(f"- Магазин: {store_name}")
            if store_phone:
                lines.append(f"- Телефон: {store_phone}")
    else:
        if reminder_kind == "repayment_update":
            lines = [
                f"Assalomu alaykum, {customer_name}.",
                "Qarz bo'yicha to'lov qabul qilindi.",
                f"To'langan summa: {payment_amount}",
                f"To'lov vaqti: {payment_time}",
                (
                    f"Holat: qisman yopildi. Qolgan qarz: {total_remaining}"
                    if is_partial
                    else "Holat: qarz to'liq yopildi."
                ),
                "",
            ]
        else:
            lines = [
                f"Assalomu alaykum, {customer_name}.",
                "Do'koningiz bo'yicha qarz eslatmasi.",
                f"To'lanishi kerak bo'lgan qarz summasi: {amount}",
                "",
            ]
        if rows:
            lines.append("Qarz tafsilotlari:")
            for idx, row in enumerate(rows, start=1):
                lines.extend(
                    [
                        f"{idx}) Savdo: {row.get('sale_no') or '-'}",
                        f"   Xarid summasi: {row.get('total_amount') or '-'}",
                        f"   Hozir yopilgan summa: {row.get('paid_now') or '-'}",
                        f"   Qolgan qarz: {row.get('remaining_amount') or '-'}",
                        f"   Xarid vaqti: {row.get('sale_time') or '-'}",
                        f"   Qarz berilgan vaqti: {row.get('debt_created_at') or '-'}",
                        f"   To'lov muddati: {row.get('due_date') or '-'}",
                    ]
                )
        lines.append("")
        lines.append(
            "To'lov uchun rahmat!"
            if reminder_kind == "repayment_update"
            else "Iltimos, qulay vaqtda to'lovni amalga oshiring. Rahmat!"
        )
        if store_name or store_phone:
            lines.append("")
            lines.append("Do'kon aloqa ma'lumotlari:")
            if store_name:
                lines.append(f"- Do'kon: {store_name}")
            if store_phone:
                lines.append(f"- Telefon: {store_phone}")
    message = "\n".join(lines)
    if settings.whatsapp_provider == IntegrationSettings.WhatsAppProvider.GREEN_API:
        if not settings.greenapi_instance_id or not settings.greenapi_api_token_instance:
            raise ValueError("GreenAPI settings are incomplete")
        chat_id = phone if "@c.us" in phone else f"{phone}@c.us"
        payload = {"chatId": chat_id, "message": message}
        url = (
            settings.whatsapp_api_base.rstrip("/")
            + f"/waInstance{settings.greenapi_instance_id}/sendMessage/{settings.greenapi_api_token_instance}"
        )
        ok, details = _post_json(url, payload)
    else:
        if not settings.whatsapp_api_token:
            raise ValueError("WhatsApp settings are incomplete")
        payload = {"to": phone, "message": message, "sender": settings.whatsapp_sender}
        ok, details = _post_json(
            settings.whatsapp_api_base.rstrip("/") + "/messages/send",
            payload,
            headers={"Authorization": f"Bearer {settings.whatsapp_api_token}"},
        )
    if not ok:
        retriable = "HTTP 4" not in details or "HTTP 429" in details
        raise NotificationDeliveryError(f"WhatsApp send failed: {details}", retriable=retriable)
    return details


def send_daily_z_report(*, lang: str = "uz"):
    today = str(timezone.localdate())
    return send_z_report_multichannel(lang=lang, from_date=today, to_date=today)


def _should_queue_after_telegram_error(exc: Exception) -> bool:
    if isinstance(exc, NotificationDeliveryError):
        return exc.retriable
    msg = str(exc).lower()
    return "incomplete" not in msg


def _should_queue_after_whatsapp_error(exc: Exception) -> bool:
    if isinstance(exc, NotificationDeliveryError):
        return exc.retriable
    msg = str(exc).lower()
    return "incomplete" not in msg and "settings are incomplete" not in msg


def send_z_report_multichannel(*, lang: str = "uz", from_date: str | None = None, to_date: str | None = None):
    from .notification_queue import enqueue

    settings = IntegrationSettings.get_solo()
    selected_lang = _norm_lang(lang)
    metrics = sales_metrics(from_date=from_date, to_date=to_date)
    text_telegram = _build_z_report_text(metrics=metrics, lang=selected_lang)
    text_whatsapp = _build_z_report_whatsapp_text(metrics=metrics, lang=selected_lang)

    channel_results: dict[str, dict[str, str | bool]] = {}
    use_telegram = _telegram_ready(settings)
    use_whatsapp = _whatsapp_ready(settings)
    if not use_telegram and not use_whatsapp:
        raise ValueError("No configured notification channels")

    if use_telegram:
        try:
            details = _send_telegram_text(settings=settings, text=text_telegram)
            channel_results["telegram"] = {"ok": True, "details": details, "queued": False}
        except ValueError as e:
            msg = str(e)
            if _should_queue_after_telegram_error(e):
                enqueue(
                    NotificationQueue.Kind.Z_REPORT_TELEGRAM,
                    {
                        "text": text_telegram,
                        "lang": selected_lang,
                        "from_date": from_date,
                        "to_date": to_date,
                    },
                )
                channel_results["telegram"] = {"ok": True, "details": msg, "queued": True}
            else:
                channel_results["telegram"] = {"ok": False, "details": msg, "queued": False}
    if use_whatsapp:
        try:
            details = _send_whatsapp_text(settings=settings, text=text_whatsapp)
            channel_results["whatsapp"] = {"ok": True, "details": details, "queued": False}
        except ValueError as e:
            msg = str(e)
            if _should_queue_after_whatsapp_error(e):
                enqueue(
                    NotificationQueue.Kind.Z_REPORT_WHATSAPP,
                    {
                        "text": text_whatsapp,
                        "lang": selected_lang,
                        "from_date": from_date,
                        "to_date": to_date,
                    },
                )
                channel_results["whatsapp"] = {"ok": True, "details": msg, "queued": True}
            else:
                channel_results["whatsapp"] = {"ok": False, "details": msg, "queued": False}

    ok = any(v.get("ok") for v in channel_results.values())
    details = "Sent successfully" if ok else "All channels failed"
    return {"ok": ok, "details": details, "channel_results": channel_results, "lang": selected_lang}


def send_whatsapp_reminder(
    *,
    phone: str,
    customer_name: str,
    amount: str,
    lang: str = "uz",
    debt_items: list[dict] | None = None,
    reminder_kind: str = "debt_reminder",
    payment_amount: str = "0",
    payment_time: str = "-",
    is_partial: bool = False,
    total_remaining: str = "0",
    store_name: str = "",
    store_phone: str = "",
):
    from .notification_queue import enqueue

    settings = IntegrationSettings.get_solo()
    store = StoreSettings.get_solo()
    resolved_store_name = (store_name or store.brand_name or "").strip()
    resolved_store_phone = (store_phone or store.phone or "").strip()
    try:
        details = _send_whatsapp_debt_reminder_now(
            settings=settings,
            phone=phone,
            customer_name=customer_name,
            amount=str(amount),
            lang=lang,
            debt_items=debt_items or [],
            reminder_kind=reminder_kind,
            payment_amount=payment_amount,
            payment_time=payment_time,
            is_partial=is_partial,
            total_remaining=total_remaining,
            store_name=resolved_store_name,
            store_phone=resolved_store_phone,
        )
        return {"ok": True, "details": details, "queued": False}
    except ValueError as e:
        msg = str(e)
        if not _should_queue_after_whatsapp_error(e):
            raise
        enqueue(
            NotificationQueue.Kind.WHATSAPP_DEBT_REMINDER,
            {
                "phone": phone,
                "customer_name": customer_name,
                "amount": str(amount),
                "lang": _norm_lang(lang),
                "debt_items": debt_items or [],
                "reminder_kind": reminder_kind,
                "payment_amount": str(payment_amount),
                "payment_time": str(payment_time),
                "is_partial": bool(is_partial),
                "total_remaining": str(total_remaining),
                "store_name": resolved_store_name,
                "store_phone": resolved_store_phone,
            },
        )
        return {"ok": True, "details": msg, "queued": True}


def run_auto_daily_z_report_if_due(*, now=None) -> dict:
    """
    Daily scheduler hook. Sends at most once per local day.
    Returns: {"ran": bool, "reason": str, ...}
    """
    ref_now = now or timezone.localtime()
    today = timezone.localdate()
    settings = IntegrationSettings.get_solo()
    if settings.last_auto_z_report_date == today:
        return {"ran": False, "reason": "already_sent"}
    out = send_daily_z_report(lang="uz")
    settings.last_auto_z_report_date = today
    settings.save(update_fields=["last_auto_z_report_date"])
    return {"ran": True, "reason": "sent", "result": out}
