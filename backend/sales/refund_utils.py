"""Vozvrat summasi va pul taqsimoti (naqd / karta / qarz)."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

from debt.models import Debt

from .models import Payment, Sale, SaleLine, SaleRefund

QUANT = Decimal("1")


def q_money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(QUANT, rounding=ROUND_HALF_UP)


def _grand_total_scale(sale: Sale, all_lines: list[SaleLine]) -> Decimal:
    """Chek chegirmasi (order_discount) line_total yig‘indisiga taqsimlangan."""
    lines_sum = sum((ln.line_total for ln in all_lines), Decimal("0"))
    if lines_sum <= 0:
        return Decimal("1")
    return Decimal(str(sale.grand_total or 0)) / lines_sum


def compute_return_amount(*, sale: Sale, lines: list[dict]) -> Decimal:
    """Qaytariladigan pozitsiyalar bo‘yicha chekdagi narx (og‘irlikli + grand_total scale)."""
    from .return_state import _sold_and_returned_maps

    all_lines = list(sale.lines.all())
    sold_by_variant, _, line_total_by_vid, _ = _sold_and_returned_maps(all_lines, sale)
    scale = _grand_total_scale(sale, all_lines)
    total = Decimal("0")
    for item in lines:
        vid = str(item["variant_id"])
        qty = int(item["qty"])
        sq = sold_by_variant.get(vid, 0)
        if sq <= 0 or qty <= 0:
            continue
        unit = (line_total_by_vid[vid] / Decimal(sq)) * scale
        total += unit * Decimal(qty)
    return q_money(total)


def _payments_in_by_method(sale: Sale) -> dict[str, Decimal]:
    out: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for p in Payment.objects.filter(sale=sale):
        out[p.method] += Decimal(str(p.amount))
    return out


def _refunds_out_by_method(sale: Sale) -> dict[str, Decimal]:
    out: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for r in SaleRefund.objects.filter(sale=sale):
        out[r.method] += Decimal(str(r.amount))
    return out


def refund_capacity_by_method(sale: Sale) -> dict[str, Decimal]:
    """Qolgan qaytarish mumkin bo‘lgan summa (usul bo‘yicha)."""
    paid_in = _payments_in_by_method(sale)
    refunded = _refunds_out_by_method(sale)
    cap: dict[str, Decimal] = {}
    for method in (Payment.Method.CASH, Payment.Method.CARD, Payment.Method.DEBT):
        base = paid_in.get(method, Decimal("0")) - refunded.get(method, Decimal("0"))
        cap[method] = q_money(max(base, Decimal("0")))

    debt = getattr(sale, "debt_record", None)
    if debt and debt.status == Debt.Status.OPEN:
        # Qarz qaytarish = majburiyatni kamaytirish (qolgan qarzdan oshmasin).
        debt_cap = q_money(debt.remaining_amount)
        cap[Payment.Method.DEBT] = min(cap[Payment.Method.DEBT], debt_cap)
    return cap


def refunds_already_list(sale: Sale) -> list[dict[str, str]]:
    rows = (
        SaleRefund.objects.filter(sale=sale)
        .order_by("created_at", "id")
        .values("method", "amount")
    )
    return [{"method": r["method"], "amount": str(r["amount"])} for r in rows]


def allocate_auto_refunds(*, sale: Sale, return_amount: Decimal) -> list[dict[str, str]]:
    """Original to‘lovlar ulushi bo‘yicha avtomatik taqsimlash."""
    return_amount = q_money(return_amount)
    if return_amount <= 0:
        raise ValueError("Return amount must be positive")

    cap = refund_capacity_by_method(sale)
    weights = {m: cap[m] for m in cap if cap[m] > 0}
    total_cap = sum(weights.values(), Decimal("0"))
    if total_cap <= 0:
        raise ValueError("No refundable payment balance for this sale")

    if return_amount > total_cap:
        raise ValueError("Return amount exceeds refundable balance")

    methods = [Payment.Method.CASH, Payment.Method.CARD, Payment.Method.DEBT]
    active = [m for m in methods if weights.get(m, Decimal("0")) > 0]
    refunds: list[dict[str, str]] = []
    remainder = return_amount
    for i, method in enumerate(active):
        if i == len(active) - 1:
            part = remainder
        else:
            share = weights[method] / total_cap
            part = q_money(return_amount * share)
            remainder -= part
        if part > 0:
            refunds.append({"method": method, "amount": str(part)})
    return refunds


def validate_manual_refunds(
    *,
    sale: Sale,
    return_amount: Decimal,
    refunds: list[dict],
) -> list[dict[str, str]]:
    return_amount = q_money(return_amount)
    cap = refund_capacity_by_method(sale)
    parsed: list[dict[str, str]] = []
    total = Decimal("0")
    for item in refunds:
        method = str(item.get("method") or "").upper()
        if method not in (Payment.Method.CASH, Payment.Method.CARD, Payment.Method.DEBT):
            raise ValueError(f"Invalid refund method: {method}")
        amt = q_money(Decimal(str(item.get("amount") or "0")))
        if amt <= 0:
            continue
        if amt > cap.get(method, Decimal("0")):
            raise ValueError(f"Refund {method} exceeds available balance")
        total += amt
        parsed.append({"method": method, "amount": str(amt)})
    if q_money(total) != return_amount:
        raise ValueError("Refund amounts must equal return merchandise total")
    if not parsed:
        raise ValueError("At least one refund line required")
    return parsed


def apply_sale_refunds(
    *,
    sale: Sale,
    user,
    refunds: list[dict[str, str]],
    reason: str = "",
) -> list[dict[str, str]]:
    """SaleRefund yozuvlari + ochiq qarzni kamaytirish."""
    created: list[dict[str, str]] = []
    debt = getattr(sale, "debt_record", None)
    debt_refund_total = Decimal("0")

    for item in refunds:
        method = item["method"]
        amt = q_money(Decimal(str(item["amount"])))
        if amt <= 0:
            continue
        SaleRefund.objects.create(
            sale=sale,
            method=method,
            amount=amt,
            created_by=user,
            reason=reason[:500],
        )
        created.append({"method": method, "amount": str(amt)})
        if method == Payment.Method.DEBT:
            debt_refund_total += amt

    if debt_refund_total > 0 and debt and debt.status == Debt.Status.OPEN:
        new_total = q_money(max(debt.paid_amount, debt.total_amount - debt_refund_total))
        debt.total_amount = new_total
        debt.remaining_amount = q_money(max(Decimal("0"), new_total - debt.paid_amount))
        if debt.remaining_amount <= 0:
            debt.status = Debt.Status.PAID
            debt.remaining_amount = Decimal("0")
        debt.save(update_fields=["total_amount", "remaining_amount", "status", "updated_at"])

    return created


def preview_refund_split(*, sale: Sale, return_amount: Decimal) -> dict[str, str]:
    """Tanlangan qaytarish summasi uchun taxminiy taqsimot."""
    try:
        rows = allocate_auto_refunds(sale=sale, return_amount=return_amount)
    except ValueError:
        rows = []
    out = {"CASH": "0", "CARD": "0", "DEBT": "0", "total": str(q_money(return_amount))}
    for r in rows:
        out[r["method"]] = r["amount"]
    return out
