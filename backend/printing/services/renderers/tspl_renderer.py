from __future__ import annotations

from decimal import Decimal
from typing import Any


def _tspl_literal(s: str, *, max_len: int) -> str:
    """ASCII-only single-line text safe inside TSPL double-quoted segments."""
    t = (s or "").replace('"', " ").replace("\r", " ").replace("\n", " ").strip()
    if len(t) > max_len:
        t = t[: max_len].rstrip()
    out = t.encode("ascii", errors="ignore").decode("ascii")
    return out if out else "-"


def _tspl_dimensions_mm(size_key: str) -> tuple[int, int]:
    k = (size_key or "40x30").strip().lower()
    if k == "58mm":
        return 58, 40
    if k == "40x50":
        return 40, 50
    if k == "50x40":
        return 50, 40
    if k == "40x30":
        return 40, 30
    return 40, 30


def _estimate_code128_width_dots(barcode: str, nar: int, wide: int) -> int:
    """
    Conservative width estimate for TSPL CODE128 (narrow nar, wide multiplier wide).
    Over-estimates slightly so centered x leaves margin and avoids clipping.
    """
    L = max(len(barcode.strip() or "0"), 1)
    # Symbol + quiet zones (printer-dependent); keep upper bound safe.
    modules = 28 + L * 12
    w_mul = max(1, min(4, int(wide)))
    return int(modules * max(1, nar) * (0.55 + 0.12 * w_mul))


def _text_width_dots(s: str, *, char_dots: int) -> int:
    return max(1, len(s)) * char_dots


def _tspl_layout_centered(
    *,
    w_mm: int,
    h_mm: int,
    barcode: str,
) -> dict[str, Any]:
    """
    Vertically centered stack on the physical label; horizontally centered TEXT/BARCODE.
    Priority: barcode is the largest element; size/color small on top; price under barcode.
    """
    w_dots = w_mm * 8
    h_dots = h_mm * 8
    margin = 6
    gap_small = 4
    # Space under bars for CODE128 human-readable digits (printer-dependent).
    gap_after_bc = 28

    # Top line: size / color — small font "1", scale 1x1
    sc_font = "1"
    sc_char = 8
    sc_line_h = 14

    # Price under barcode — readable but smaller than barcode height
    price_font = "2"
    price_char = 10
    price_line_h = 22

    inner_w = max(16, w_dots - 2 * margin)
    inner_h = max(32, h_dots - 2 * margin)

    # Reserve top + bottom text bands; remaining height = barcode
    reserved_top = sc_line_h + gap_small
    reserved_bottom = gap_after_bc + price_line_h + 4
    bc_h = inner_h - reserved_top - reserved_bottom
    bc_h = max(32, min(bc_h, inner_h - 20))
    # TSPL BARCODE height is in dots; cap so tiny labels still print
    bc_h = min(bc_h, 220)

    # Pick narrow/wide so barcode fits inner_w (maximize nar for "biggest barcode")
    best_nar, best_wide = 1, 2
    for wide in (3, 2, 1):
        for nar in range(6, 0, -1):
            if _estimate_code128_width_dots(barcode, nar, wide) <= inner_w:
                best_nar, best_wide = nar, wide
                break
        if best_nar > 1 or _estimate_code128_width_dots(barcode, best_nar, best_wide) <= inner_w:
            break

    bc_w_est = _estimate_code128_width_dots(barcode, best_nar, best_wide)
    x_bc = margin + max(0, (inner_w - bc_w_est) // 2)

    # Vertical block: center the whole stack in label coordinates (margin box)
    stack_h = sc_line_h + gap_small + bc_h + gap_after_bc + price_line_h
    y0 = margin + max(0, (inner_h - stack_h) // 2)

    y_sc = y0
    y_bc = y_sc + sc_line_h + gap_small
    y_price = y_bc + bc_h + gap_after_bc

    return {
        "w_dots": w_dots,
        "h_dots": h_dots,
        "sc_font": sc_font,
        "sc_xmul": 1,
        "sc_ymul": 1,
        "sc_char": sc_char,
        "y_sc": y_sc,
        "price_font": price_font,
        "price_xmul": 1,
        "price_ymul": 1,
        "price_char": price_char,
        "y_price": y_price,
        "x_bc": x_bc,
        "y_bc": y_bc,
        "bc_h": bc_h,
        "nar": best_nar,
        "wide": best_wide,
    }


class TsplRenderer:
    def __init__(self, *, kind: str):
        self.kind = kind

    def _money(self, value: Any) -> str:
        return f"{Decimal(str(value)).quantize(Decimal('1')):,}".replace(",", " ")

    def render_receipt(self, *, receipt_dto: dict[str, Any], settings) -> bytes:
        # Fallback for unsupported receipt TSPL: emit plain text bytes.
        lines = [
            settings.brand_name,
            str(receipt_dto.get("sale_id", "")),
            self._money(receipt_dto.get("grand_total", 0)),
        ]
        return ("\n".join(lines) + "\n").encode("utf-8", errors="ignore")

    def render_label(self, *, label_payload: dict[str, Any], settings) -> bytes:
        variant = label_payload["variant"]
        size_key = (label_payload.get("size") or "40x30").strip()
        copies = max(1, min(200, int(label_payload.get("copies") or 1)))

        barcode = (variant.barcode or "").strip() or "0"
        size_color = _tspl_literal(
            f"{variant.size.label_uz} / {variant.color.label_uz}".strip(),
            max_len=36,
        )
        price = _tspl_literal(f"{self._money(variant.list_price)} СОМ", max_len=22)

        w_mm, h_mm = _tspl_dimensions_mm(size_key)
        lay = _tspl_layout_centered(w_mm=w_mm, h_mm=h_mm, barcode=barcode)
        w_dots = lay["w_dots"]

        x_sc = max(
            8,
            (w_dots - _text_width_dots(size_color, char_dots=lay["sc_char"])) // 2,
        )
        x_price = max(
            8,
            (w_dots - _text_width_dots(price, char_dots=lay["price_char"])) // 2,
        )

        header = [
            f"SIZE {w_mm} mm,{h_mm} mm",
            "GAP 2 mm,0 mm",
            "DIRECTION 1",
        ]
        blocks: list[str] = []
        for _ in range(copies):
            blocks.extend(
                [
                    "CLS",
                    # Small: only size / color (centered)
                    f'TEXT {x_sc},{lay["y_sc"]},"{lay["sc_font"]}",0,{lay["sc_xmul"]},{lay["sc_ymul"]},"{size_color}"',
                    # Largest element: CODE128, human-readable under bars
                    f'BARCODE {lay["x_bc"]},{lay["y_bc"]},"128",{lay["bc_h"]},1,0,{lay["nar"]},{lay["wide"]},"{barcode}"',
                    # Price under barcode (centered)
                    f'TEXT {x_price},{lay["y_price"]},"{lay["price_font"]}",0,{lay["price_xmul"]},{lay["price_ymul"]},"{price}"',
                    "PRINT 1,1",
                ]
            )

        tspl = header + blocks
        return ("\r\n".join(tspl) + "\r\n").encode("ascii", errors="ignore")
