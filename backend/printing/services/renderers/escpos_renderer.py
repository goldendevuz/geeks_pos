from __future__ import annotations

from typing import Any

from printing.receipt import label_escpos_bytes, receipt_escpos_bytes


class EscposRenderer:
    def __init__(self, *, kind: str):
        self.kind = kind

    def render_receipt(self, *, receipt_dto: dict[str, Any], settings) -> bytes:
        return receipt_escpos_bytes(receipt_dto)

    def render_label(self, *, label_payload: dict[str, Any], settings) -> bytes:
        variant = label_payload["variant"]
        size = label_payload.get("size", "40x30")
        copies = int(label_payload.get("copies", 1) or 1)
        return label_escpos_bytes(
            variant=variant,
            size=size,
            copies=copies,
            show_price=label_payload.get("show_price"),
        )
