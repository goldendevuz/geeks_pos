import os
import re
import logging
from decimal import Decimal, ROUND_HALF_UP

from .models import StoreSettings

logger = logging.getLogger(__name__)


def _normalize_lang(lang: str | None) -> str:
    v = (lang or "uz").lower()
    if v.startswith("ky"):
        return "ky"
    return "ru" if v.startswith("ru") else "uz"


def resolve_receipt_store_lang(settings: StoreSettings, request_lang: str | None) -> str:
    """
    Chek sarlavha va qator matnlari tili: sozlamadagi receipt_lang (uz|ru|ky),
    bo'sh bo'lsa — HTTP Accept-Language (UI) bo'yicha _normalize_lang.
    """
    raw = (getattr(settings, "receipt_lang", None) or "").strip().lower()
    if raw in ("uz", "ru", "ky"):
        return raw
    if raw.startswith("ky"):
        return "ky"
    if raw.startswith("ru"):
        return "ru"
    if raw.startswith("uz"):
        return "uz"
    return _normalize_lang(request_lang)


def _receipt_variant_texts(receipt_lang: str, product) -> str:
    """Get product name for receipt - supports custom names for appliances."""
    rl = _normalize_lang(receipt_lang)
    if rl == "uz":
        # Try custom name first, fallback to regular name
        custom = (getattr(product, "custom_name_uz", None) or "").strip()
        name = custom or (getattr(product, "name_uz", None) or getattr(product, "name_ru", None) or "").strip()
    elif rl == "ru":
        custom = (getattr(product, "custom_name_ru", None) or "").strip()
        name = custom or (getattr(product, "name_ru", None) or getattr(product, "name_uz", None) or "").strip()
    else:
        custom = (getattr(product, "custom_name_ru", None) or "").strip()
        name = custom or (getattr(product, "name_ru", None) or getattr(product, "name_uz", None) or "").strip()
    return _strip_cjk(name)


def _labels(lang: str) -> dict[str, str]:
    normalized = _normalize_lang(lang)
    if normalized == "ru":
        return {
            "tel": "Тел",
            "address": "Адрес",
            "sale": "Продажа",
            "time": "Время",
            "cashier": "Кассир",
            "subtotal": "Подытог",
            "discount": "Скидка",
            "total": "ИТОГ",
            "footer": "Спасибо!",
            "method.CASH": "Наличные",
            "method.CARD": "Карта",
            "method.DEBT": "Долг",
        }
    if normalized == "ky":
        return {
            "tel": "Тел",
            "address": "Дарек",
            "sale": "Сатуу",
            "time": "Убакыт",
            "cashier": "Кассир",
            "subtotal": "Аралык жыйынтык",
            "discount": "Женилдик",
            "total": "ЖАЛПЫ",
            "footer": "Рахмат!",
            "method.CASH": "Нак акча",
            "method.CARD": "Карта",
            "method.DEBT": "Карыз",
        }
    return {
        "tel": "Tel",
        "address": "Manzil",
        "sale": "Savdo",
        "time": "Vaqt",
        "cashier": "Kassir",
        "subtotal": "Oraliq jami",
        "discount": "Chegirma",
        "total": "JAMI",
        "footer": "Rahmat!",
        "method.CASH": "Naqd",
        "method.CARD": "Karta",
        "method.DEBT": "Nasiya",
    }


def round_som(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def transliterate_uz(text: str) -> str:
    """CP866 fallback transliteration for Uzbek apostrophe letters."""
    out = text or ""
    apostrophes = ("\u2018", "\u2019", "\u02bb", "\u02bc", "\u201b", "`")
    for ch in apostrophes:
        out = out.replace(f"o{ch}", "o'")
        out = out.replace(f"g{ch}", "g'")
        out = out.replace(f"O{ch}", "O'")
        out = out.replace(f"G{ch}", "G'")

    # Optional Uzbek Cyrillic fallback for old printer encodings.
    cyr_map = {
        "ў": "o'",
        "Ў": "O'",
        "ғ": "g'",
        "Ғ": "G'",
        "ш": "sh",
        "Ш": "Sh",
        "ч": "ch",
        "Ч": "Ch",
    }
    for src, dst in cyr_map.items():
        out = out.replace(src, dst)
    return out


def _line_80mm(left: str, right: str, width: int = 42) -> str:
    left = left[: width - 1]
    right = right[: width - 1]
    spaces = max(1, width - len(left) - len(right))
    return f"{left}{' ' * spaces}{right}"


def _format_amount(v) -> str:
    return str(int(round_som(v)))


def _strip_cjk(text: str) -> str:
    # Remove Chinese/Japanese ideographs that thermal printer codepages typically cannot render.
    return re.sub(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", "", text or "").strip()


def _strip_control(text: str) -> str:
    # Keep printable text only (plus common whitespace separators).
    return "".join(ch for ch in (text or "") if ch == "\n" or ch == "\t" or ord(ch) >= 32)


def _wrap_text(text: str, width: int) -> list[str]:
    clean = _strip_control(_strip_cjk(text or "")).strip()
    if not clean:
        return []
    words = clean.split()
    if not words:
        return []
    out: list[str] = []
    line = ""
    for w in words:
        if len(w) > width:
            if line:
                out.append(line)
                line = ""
            for i in range(0, len(w), width):
                out.append(w[i : i + width])
            continue
        candidate = w if not line else f"{line} {w}"
        if len(candidate) <= width:
            line = candidate
        else:
            out.append(line)
            line = w
    if line:
        out.append(line)
    return out


def sale_to_receipt_dict(sale, *, lang: str = "uz") -> dict:
    settings = StoreSettings.get_solo()
    store_lang = resolve_receipt_store_lang(settings, lang)
    lines_out = []
    for line in sale.lines.select_related("variant__product"):
        v = line.variant
        nm = _receipt_variant_texts(store_lang, v.product)
        lines_out.append(
            {
                "name": nm,
                "barcode": v.barcode,
                "qty": line.qty,
                "unit": _format_amount(line.net_unit_price),
                "total": _format_amount(line.line_total),
            }
        )
    pays = [{"method": p.method, "amount": _format_amount(p.amount)} for p in sale.payments.all()]

    return {
        "store": {
            "brand_name": settings.brand_name,
            "phone": settings.phone,
            "address": settings.address,
            "footer_note": settings.footer_note,
            "transliterate_uz": settings.transliterate_uz,
            "encoding": settings.encoding,
            "lang": store_lang,
            "receipt_width": settings.receipt_width or "58mm",
            "receipt_printer_name": settings.receipt_printer_name or "",
            "receipt_printer_type": settings.receipt_printer_type,
            "label_printer_name": settings.label_printer_name or "",
            "label_printer_type": settings.label_printer_type,
        },
        "sale_id": str(sale.id),
        "public_sale_no": sale.public_sale_no or str(sale.id)[:8],
        "completed_at": sale.completed_at.isoformat(),
        "cashier": sale.cashier.username,
        "lines": lines_out,
        "subtotal": _format_amount(sale.subtotal),
        "discount_total": _format_amount(sale.discount_total),
        "grand_total": _format_amount(sale.grand_total),
        "payments": pays,
    }


def _normalize_text(text: str, translit: bool) -> str:
    text = _strip_control(_strip_cjk(text or ""))
    if translit:
        text = transliterate_uz(text)
    return text


def receipt_plain_text(receipt: dict) -> str:
    store = receipt.get("store", {})
    lang = _normalize_lang(store.get("lang", "uz"))
    # Do not Latinize Cyrillic receipt bodies for RU/KY label sets.
    translit = bool(store.get("transliterate_uz", True)) and lang not in ("ru", "ky")
    labels = _labels(lang)

    def t(v: str) -> str:
        return _normalize_text(v, translit)

    buf = []
    width = 42 if store.get("receipt_width") == "80mm" else 34
    brand = t(store.get("brand_name", "GEEKS POS"))
    buf.append(brand)
    if store.get("address"):
        for row in _wrap_text(f"{labels['address']}: {t(store['address'])}", width):
            buf.append(row)
    if store.get("phone"):
        buf.append(f"{labels['tel']}: {t(store['phone'])}")
    buf.append(_line_80mm(labels["sale"], str(receipt.get("public_sale_no") or receipt["sale_id"][:8]), width=width))
    buf.append(_line_80mm(labels["time"], receipt["completed_at"][:19], width=width))
    buf.append(_line_80mm(labels["cashier"], t(receipt["cashier"]), width=width))
    buf.append("-" * width)

    for ln in receipt["lines"]:
        title = t(ln['name'])
        wrapped = _wrap_text(title, width)
        if wrapped:
            buf.extend(wrapped)
        else:
            buf.append(title[:width])
        buf.append(_line_80mm(f"{ln['qty']} x {ln['unit']}", ln["total"], width=width))

    buf.append("-" * width)
    buf.append(_line_80mm(labels["subtotal"], receipt["subtotal"], width=width))
    buf.append(_line_80mm(labels["discount"], receipt["discount_total"], width=width))
    buf.append(_line_80mm(labels["total"], receipt["grand_total"], width=width))
    for p in receipt["payments"]:
        method_label = labels.get(f"method.{p['method']}", p["method"])
        buf.append(_line_80mm(t(method_label), p["amount"], width=width))
    buf.append("-" * width)
    footer = t(store.get("footer_note") or labels["footer"])
    if footer:
        buf.append(footer)
    buf.append("")
    buf.append("--- CUT HERE ---")
    buf.append("")
    return "\n".join(buf)


def _load_logo_bw(settings: StoreSettings):
    from PIL import Image
    resample = getattr(Image, "Resampling", Image).LANCZOS

    if not settings.logo:
        return None
    try:
        img = Image.open(settings.logo.path)
    except Exception:
        return None

    # Normalize to grayscale first.
    img = img.convert("L")

    # Keep logo compact and avoid dark "smearing" on thermal paper.
    is_80 = (getattr(settings, "receipt_width", "") or "").strip().lower() == "80mm"
    max_width = 500 if is_80 else 340
    max_height = 170 if is_80 else 120

    if img.width > max_width:
        ratio = max_width / float(img.width)
        img = img.resize((max_width, max(1, int(img.height * ratio))), resample)
    if img.height > max_height:
        ratio = max_height / float(img.height)
        img = img.resize((max(1, int(img.width * ratio)), max_height), resample)

    # Slightly lighter threshold reduces black blobs on low-cost thermal heads.
    threshold = 225
    img = img.point(lambda x: 255 if x > threshold else 0, mode="1")
    return img


def _load_receipt_font(size: int):
    from PIL import ImageFont

    candidates = [
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibri.ttf",
        r"C:\Windows\Fonts\tahoma.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        try:
            font = ImageFont.truetype(path, size=size)
            logger.info("Receipt bitmap font selected: %s", path)
            return font
        except Exception:
            continue
    logger.warning("Receipt bitmap fallback font selected (ImageFont.load_default)")
    return ImageFont.load_default()


def _receipt_text_images(text: str, *, receipt_width: str | None):
    """
    Render receipt body as one or more bitmap images to avoid printer codepage/charset issues.
    """
    from PIL import Image, ImageDraw

    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if not lines:
        lines = [""]

    is_80 = (receipt_width or "").strip().lower() == "80mm"
    width_px = 560 if is_80 else 420
    font_size = 26 if is_80 else 22
    side_pad = 10
    top_pad = 8
    line_gap = 8
    max_chunk_height_px = 1100 if is_80 else 900

    font = _load_receipt_font(font_size)
    probe = Image.new("L", (32, 32), color=255)
    draw_probe = ImageDraw.Draw(probe)
    bbox = draw_probe.textbbox((0, 0), "Ag", font=font)
    glyph_h = max(12, bbox[3] - bbox[1])
    line_h = max(20, glyph_h + line_gap)

    lines_per_chunk = max(1, (max_chunk_height_px - (top_pad * 2)) // line_h)
    chunks: list[list[str]] = []
    for i in range(0, len(lines), lines_per_chunk):
        chunks.append(lines[i : i + lines_per_chunk])
    if not chunks:
        chunks = [[""]]

    images = []
    for chunk_lines in chunks:
        height_px = top_pad * 2 + (len(chunk_lines) * line_h)
        img = Image.new("L", (width_px, max(64, height_px)), color=255)
        draw = ImageDraw.Draw(img)
        y = top_pad
        for ln in chunk_lines:
            draw.text((side_pad, y), ln, fill=0, font=font)
            y += line_h
        images.append(img.point(lambda x: 255 if x > 180 else 0, mode="1"))
    return images


def _choose_receipt_codepage(*, lang: str, settings: StoreSettings) -> str:
    forced = (os.environ.get("FORCE_RECEIPT_CODEPAGE", "") or "").strip().upper()
    if forced in {"CP866", "CP1251"}:
        return forced
    if lang in {"ru", "ky"}:
        return "CP1251"
    return (settings.encoding or "CP866").strip().upper()


def _emit_text_manual_encoded(printer: object, text: str, codepage: str) -> bool:
    """
    Encode text manually and write raw bytes (fallback for firmware/codepage quirks).
    """
    raw = getattr(printer, "_raw", None)
    if not callable(raw):
        return False
    py_enc = "cp1251" if codepage == "CP1251" else "cp866"
    try:
        payload = (text or "").encode(py_enc, errors="replace")
        raw(payload)
        return True
    except Exception:
        return False


def _escpos_release(printer: object) -> None:
    """Close python-escpos printer handle (Dummy buffers or real USB/File backends)."""
    close = getattr(printer, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass


def receipt_escpos_bytes(receipt: dict) -> bytes:
    from escpos.printer import Dummy

    settings = StoreSettings.get_solo()

    p = Dummy()
    try:
        try:
            p.hw("INIT")
            lang = _normalize_lang(receipt.get("store", {}).get("lang", "ru"))
            codepage = _choose_receipt_codepage(lang=lang, settings=settings)
            p.charcode(codepage)
        except Exception:
            try:
                p.charcode("CP1251")
            except Exception:
                try:
                    p.charcode("CP866")
                except Exception:
                    pass

        logo = _load_logo_bw(settings)
        if logo is not None:
            try:
                p.set(align="center")
                p.image(logo)
                p.text("\n")
            except Exception:
                pass

        plain = receipt_plain_text(
            {
                **receipt,
                "store": {
                    **receipt.get("store", {}),
                    "transliterate_uz": settings.transliterate_uz,
                },
            }
        )
        render_mode = (os.environ.get("RECEIPT_RENDER_MODE", "text") or "text").strip().lower()
        manual_encode = (os.environ.get("RECEIPT_MANUAL_ENCODE", "0") or "0").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        if render_mode == "image":
            # Optional mode: bitmap body to bypass codepage issues on some models.
            body_imgs = _receipt_text_images(
                plain,
                receipt_width=receipt.get("store", {}).get("receipt_width", "58mm"),
            )
            try:
                p.set(align="center")
            except Exception:
                pass
            for idx, body_img in enumerate(body_imgs):
                p.image(body_img)
                if idx < len(body_imgs) - 1:
                    p.text("\n")
        else:
            # Safer default for broader ESC/POS compatibility.
            plain_lines = plain.split("\n")
            brand_heading = plain_lines[0] if plain_lines else ""
            plain_body = "\n".join(plain_lines[1:]) if len(plain_lines) > 1 else ""

            try:
                p.set(align="center", bold=True, double_width=True, double_height=True)
            except Exception:
                try:
                    p.set(align="center", bold=True)
                except Exception:
                    p.set(align="center")
            p.text(f"{brand_heading}\n\n")
            try:
                p.set(align="left", bold=False, double_width=False, double_height=False)
            except Exception:
                try:
                    p.set(align="left", bold=False)
                except Exception:
                    p.set(align="left")
            if manual_encode:
                done = _emit_text_manual_encoded(
                    p,
                    plain_body,
                    _choose_receipt_codepage(
                        lang=_normalize_lang(receipt.get("store", {}).get("lang", "ru")),
                        settings=settings,
                    ),
                )
                if not done:
                    p.text(plain_body)
            else:
                p.text(plain_body)
        try:
            p.cut(mode="PART")
        except Exception:
            p.text("\n\n")
        return p.output
    finally:
        _escpos_release(p)


def _label_escpos_cols(size: str) -> int:
    s = (size or "40x30").strip().lower()
    if s == "58mm":
        return 42
    if s == "50x40":
        return 40
    if s == "40x30":
        return 28
    return 32


def _label_escpos_barcode_height(size: str) -> int:
    s = (size or "40x30").strip().lower()
    if s == "40x50":
        return 108
    if s in ("50x40", "58mm"):
        return 88
    if s == "40x30":
        return 50
    return 72


def label_escpos_bytes(*, variant, size: str = "40x30", copies: int = 1) -> bytes:
    from escpos.printer import Dummy

    settings = StoreSettings.get_solo()
    p = Dummy()
    try:
        try:
            p.hw("INIT")
            p.charcode((settings.encoding or "cp866").upper())
        except Exception:
            try:
                p.charcode("CP866")
            except Exception:
                pass

        cols = _label_escpos_cols(size)
        cat = ""
        c = getattr(variant.product, "category", None)
        if c is not None:
            cat = (getattr(c, "name_uz", None) or "").strip()
        brand_src = (settings.brand_name or "").strip() or cat
        brand = brand_src[:cols]
        model = (variant.product.name_uz or "")[:cols]
        price = _format_amount(variant.list_price)
        bc_h = _label_escpos_barcode_height(size)
        skey = (size or "40x30").strip().lower()
        bc_w = 2 if skey == "40x30" else 3
        for _ in range(max(1, int(copies))):
            p.set(align="center", width=1, height=1)
            p.text(f"{brand}\n")
            if skey == "40x30":
                p.set(align="center", width=1, height=1)
            else:
                p.set(align="center", width=2, height=2)
            p.text(f"{model}\n")
            p.set(align="center")
            # Avoid python-escpos profile warning on Dummy() printers where media.width.pixel is unset.
            try:
                p.barcode(
                    variant.barcode or "",
                    "CODE128",
                    height=bc_h,
                    width=bc_w,
                    pos="BELOW",
                    check=False,
                    align_ct=False,
                )
            except Exception:
                p.barcode(
                    variant.barcode or "",
                    "CODE39",
                    height=bc_h,
                    width=bc_w,
                    pos="BELOW",
                    check=False,
                    align_ct=False,
                )
            p.text("\n")
            if skey == "40x30":
                p.set(align="center", width=1, height=2)
            else:
                p.set(align="center", width=2, height=2)
            p.text(f"{price}\n")
        try:
            p.cut(mode="PART")
        except Exception:
            p.text("\n\n")
        return p.output
    finally:
        _escpos_release(p)
