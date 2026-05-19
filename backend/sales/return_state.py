"""Vozvrat: sotilgan / qaytgan / qoldiq qty — qidiruv va return-lines uchun umumiy hisob."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any
from uuid import UUID

from inventory.models import InventoryMovement

from .models import Sale, SaleLine

VOID_RESTOCK_NOTE_PREFIXES = ("Void sale restock", "Void remaining restock")


def is_void_restock_note(note: str | None) -> bool:
    n = (note or "").strip()
    return any(n.startswith(p) for p in VOID_RESTOCK_NOTE_PREFIXES)


def _sold_and_returned_maps(all_lines: list[SaleLine], sale: Sale) -> tuple[dict[str, int], dict[str, int], dict[str, Decimal], dict[str, SaleLine]]:
    sold_by_variant: dict[str, int] = {}
    line_total_by_vid: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    first_line_by_vid: dict[str, SaleLine] = {}
    for ln in all_lines:
        k = str(ln.variant_id)
        sold_by_variant[k] = sold_by_variant.get(k, 0) + int(ln.qty)
        line_total_by_vid[k] += ln.line_total
        if k not in first_line_by_vid:
            first_line_by_vid[k] = ln

    returned_by_variant: dict[str, int] = {}
    for mv in InventoryMovement.objects.filter(ref_sale=sale, type=InventoryMovement.Type.RETURN):
        vid = str(mv.variant_id)
        returned_by_variant[vid] = returned_by_variant.get(vid, 0) + max(0, int(mv.qty_delta or 0))

    return sold_by_variant, returned_by_variant, line_total_by_vid, first_line_by_vid


def remaining_return_units_by_sale_ids(sale_ids: list[UUID]) -> dict[str, int]:
    """Har bir sale_id uchun qaytarish mumkin bo‘lgan jami dona."""
    if not sale_ids:
        return {}
    sold: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for ln in SaleLine.objects.filter(sale_id__in=sale_ids).values("sale_id", "variant_id", "qty"):
        sold[str(ln["sale_id"])][str(ln["variant_id"])] += int(ln["qty"])

    returned: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for mv in InventoryMovement.objects.filter(
        ref_sale_id__in=sale_ids,
        type=InventoryMovement.Type.RETURN,
    ).values("ref_sale_id", "variant_id", "qty_delta"):
        returned[str(mv["ref_sale_id"])][str(mv["variant_id"])] += max(0, int(mv["qty_delta"] or 0))

    out: dict[str, int] = {}
    for sid in sale_ids:
        sid_s = str(sid)
        total = 0
        for vid, sq in sold[sid_s].items():
            rem = sq - returned[sid_s].get(vid, 0)
            if rem > 0:
                total += rem
        out[sid_s] = total
    return out


def sale_return_state(*, has_sale_lines: bool, total_remaining: int) -> str:
    if not has_sale_lines:
        return "no_lines"
    if total_remaining <= 0:
        return "fully_returned"
    return "returnable"


def build_return_eligible_lines(sale: Sale, all_lines: list[SaleLine] | None = None) -> tuple[list[dict[str, Any]], str, int]:
    """Qaytarish formasi qatorlari + holat."""
    all_lines = all_lines if all_lines is not None else list(sale.lines.all())
    if not all_lines:
        return [], sale_return_state(has_sale_lines=False, total_remaining=0), 0

    sold_by_variant, returned_by_variant, line_total_by_vid, first_line_by_vid = _sold_and_returned_maps(
        all_lines, sale
    )

    rows: list[dict[str, Any]] = []
    total_remaining = 0
    for vid, sq in sorted(sold_by_variant.items(), key=lambda x: x[0]):
        rq = returned_by_variant.get(vid, 0)
        rem = sq - rq
        if rem <= 0:
            continue
        total_remaining += rem
        line = first_line_by_vid.get(vid)
        if not line:
            continue
        v = line.variant
        prod = v.product
        cat = getattr(prod, "category", None)
        rows.append(
            {
                "variant_id": vid,
                "barcode": v.barcode or "",
                "product_name_uz": getattr(prod, "name_uz", "") or "",
                "product_name_ru": getattr(prod, "name_ru", "") or "",
                "category_name_uz": (getattr(cat, "name_uz", "") or "") if cat else "",
                "category_name_ru": (getattr(cat, "name_ru", "") or "") if cat else "",
                "size_label_uz": getattr(v.size, "label_uz", "") or "",
                "size_label_ru": getattr(v.size, "label_ru", "") or "",
                "color_label_uz": getattr(v.color, "label_uz", "") or "",
                "color_label_ru": getattr(v.color, "label_ru", "") or "",
                "sold_qty": sq,
                "returned_qty": rq,
                "remaining_qty": rem,
                "list_unit_price": str(line.list_unit_price),
                "net_unit_price": str(line.net_unit_price),
                "line_discount": str(line.line_discount),
                "line_total_sold": str(line_total_by_vid[vid]),
                "stock_qty": int(v.stock_qty or 0),
            }
        )

    state = sale_return_state(has_sale_lines=True, total_remaining=total_remaining)
    return rows, state, total_remaining


def remaining_return_line_payloads(sale: Sale, all_lines: list[SaleLine] | None = None) -> list[dict[str, Any]]:
    """Aqlli void / qolgan mahsulot: variant_id + qty."""
    all_lines = all_lines if all_lines is not None else list(sale.lines.all())
    sold_by_variant, returned_by_variant, _, _ = _sold_and_returned_maps(all_lines, sale)
    out: list[dict[str, Any]] = []
    for vid, sq in sold_by_variant.items():
        rem = sq - returned_by_variant.get(vid, 0)
        if rem > 0:
            out.append({"variant_id": vid, "qty": rem})
    return out
