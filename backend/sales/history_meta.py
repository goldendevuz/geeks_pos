"""Savdo tarixi: vozvrat holati va void mumkinligi (batch)."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Sum

from .models import Sale, SaleLine, SaleRefund
from .return_state import remaining_return_units_by_sale_ids

QUANT = Decimal("1")


def _q_money(value) -> str:
    return str(Decimal(str(value or 0)).quantize(QUANT, rounding=ROUND_HALF_UP))


def build_history_return_meta(sales: list[Sale]) -> dict[str, dict]:
    if not sales:
        return {}
    sale_ids = [s.id for s in sales]
    remaining_by_sale = remaining_return_units_by_sale_ids(sale_ids)
    sold_units: dict[str, int] = {}
    for row in SaleLine.objects.filter(sale_id__in=sale_ids).values("sale_id").annotate(t=Sum("qty")):
        sold_units[str(row["sale_id"])] = int(row["t"] or 0)

    refund_by_sale: dict[str, Decimal] = {}
    for row in SaleRefund.objects.filter(sale_id__in=sale_ids).values("sale_id").annotate(t=Sum("amount")):
        refund_by_sale[str(row["sale_id"])] = Decimal(str(row["t"] or 0))

    out: dict[str, dict] = {}
    for sale in sales:
        sid = str(sale.id)
        sold = sold_units.get(sid, 0)
        rem = remaining_by_sale.get(sid, 0)
        refund_total = refund_by_sale.get(sid, Decimal("0"))

        if sold <= 0:
            return_status = "none"
        elif rem <= 0:
            return_status = "full"
        elif rem < sold:
            return_status = "partial"
        else:
            return_status = "none"

        can_void = sale.status == Sale.Status.COMPLETED and rem > 0

        out[sid] = {
            "return_status": return_status,
            "refund_total": _q_money(refund_total),
            "can_void": can_void,
        }
    return out
