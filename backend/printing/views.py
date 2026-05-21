from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from types import SimpleNamespace

from catalog.models import ProductVariant
from core.permissions import IsAdminOrOwner, IsCashier
from sales.models import Sale

from .models import StoreSettings
from .receipt import receipt_plain_text, resolve_receipt_store_lang, sale_to_receipt_dict
from .services import PrinterFactory


def _escpos_bundle_error_response(exc: BaseException):
    return Response(
        {
            "code": "ESCPOS_BUNDLE_ERROR",
            "detail": str(exc),
        },
        status=503,
    )
from .serializers import (
    HardwareConfigSerializer,
    LabelQueueSerializer,
    LabelSingleSerializer,
    StoreSettingsSerializer,
)


def _request_lang(request) -> str:
    return (request.headers.get("Accept-Language") or "uz").split(",")[0]


def _is_admin_or_owner(user) -> bool:
    if getattr(user, "is_superuser", False):
        return True
    profile = getattr(user, "profile", None)
    return getattr(profile, "role", None) in ("ADMIN", "OWNER")


def _has_sale_access(user, sale: Sale) -> bool:
    if _is_admin_or_owner(user):
        return True
    return sale.cashier_id == user.id


class StoreSettingsView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        obj = StoreSettings.get_solo()
        return Response(StoreSettingsSerializer(obj, context={"request": request}).data)

    def put(self, request):
        obj = StoreSettings.get_solo()
        ser = StoreSettingsSerializer(obj, data=request.data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


class HardwareConfigView(APIView):
    permission_classes = [IsAuthenticated, IsCashier]

    def get(self, request):
        obj = StoreSettings.get_solo()
        return Response(HardwareConfigSerializer(obj).data)

    def patch(self, request):
        """Cashier/admin: printer + scanner hardware fields only (subset of StoreSettings)."""
        obj = StoreSettings.get_solo()
        ser = HardwareConfigSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        obj.refresh_from_db()
        return Response(HardwareConfigSerializer(obj).data)


class ReceiptPayloadView(APIView):
    permission_classes = [IsAuthenticated, IsCashier]

    def get(self, request, sale_id):
        try:
            sale = Sale.objects.select_related("cashier").prefetch_related("lines__variant__product", "payments").get(
                pk=sale_id
            )
        except Sale.DoesNotExist:
            return Response({"code": "SALE_NOT_FOUND", "detail": "Sale not found."}, status=404)
        if not _has_sale_access(request.user, sale):
            return Response(
                {"code": "SALE_ACCESS_DENIED", "detail": "You do not have access to this sale."},
                status=403,
            )
        dto = sale_to_receipt_dict(sale, lang=_request_lang(request))
        return Response(
            {
                "receipt": dto,
                "plain_text": receipt_plain_text(dto),
                "escpos_base64": None,
            }
        )


class ReceiptEscposView(APIView):
    permission_classes = [IsAuthenticated, IsCashier]

    def get(self, request, sale_id):
        try:
            sale = Sale.objects.select_related("cashier").prefetch_related("lines__variant__product", "payments").get(
                pk=sale_id
            )
        except Sale.DoesNotExist:
            return Response({"code": "SALE_NOT_FOUND", "detail": "Sale not found."}, status=404)
        if not _has_sale_access(request.user, sale):
            return Response(
                {"code": "SALE_ACCESS_DENIED", "detail": "You do not have access to this sale."},
                status=403,
            )
        dto = sale_to_receipt_dict(sale, lang=_request_lang(request))
        settings = StoreSettings.get_solo()
        try:
            raw = PrinterFactory.render_receipt(receipt_dto=dto, settings=settings)
        except (FileNotFoundError, OSError) as exc:
            return _escpos_bundle_error_response(exc)
        import base64

        return Response(
            {
                "receipt": dto,
                "raw_base64": base64.b64encode(raw).decode("ascii"),
                "escpos_base64": base64.b64encode(raw).decode("ascii"),
                "printer_name": settings.receipt_printer_name,
                "printer_type": settings.receipt_printer_type,
                "receipt_width": dto.get("store", {}).get("receipt_width", "58mm"),
            }
        )


class LabelEscposView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request):
        import base64

        ser = LabelSingleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        settings = StoreSettings.get_solo()
        try:
            v = ProductVariant.objects.select_related("product__category", "product").get(
                pk=ser.validated_data["variant_id"]
            )
        except ProductVariant.DoesNotExist:
            return Response({"code": "VARIANT_NOT_FOUND", "detail": "Variant not found."}, status=404)
        try:
            payload = PrinterFactory.render_label(
                label_payload={
                    "variant": v,
                    "size": ser.validated_data.get("size", "40x30"),
                    "copies": ser.validated_data.get("copies", 1),
                },
                settings=settings,
            )
        except (FileNotFoundError, OSError) as exc:
            return _escpos_bundle_error_response(exc)
        return Response(
            {
                "raw_base64": base64.b64encode(payload).decode("ascii"),
                "escpos_base64": base64.b64encode(payload).decode("ascii"),
                "printer_name": settings.label_printer_name,
                "printer_type": settings.label_printer_type,
                "size": ser.validated_data.get("size", "40x30"),
            }
        )


class LabelQueueEscposView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request):
        import base64

        ser = LabelQueueSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        size = ser.validated_data.get("size", "40x30")
        settings = StoreSettings.get_solo()
        out = []
        requested_ids = [str(item["variant_id"]) for item in ser.validated_data["items"]]
        variants = ProductVariant.objects.select_related("product__category", "product").filter(
            pk__in=requested_ids
        )
        by_id = {str(v.id): v for v in variants}
        missing = [vid for vid in requested_ids if vid not in by_id]
        if missing:
            return Response(
                {"code": "VARIANT_NOT_FOUND", "detail": f"Variant not found: {missing[0]}"},
                status=404,
            )
        for item in ser.validated_data["items"]:
            v = by_id[str(item["variant_id"])]
            try:
                payload = PrinterFactory.render_label(
                    label_payload={"variant": v, "size": size, "copies": item["copies"]},
                    settings=settings,
                )
            except (FileNotFoundError, OSError) as exc:
                return _escpos_bundle_error_response(exc)
            out.append(
                {
                    "variant_id": str(v.id),
                    "barcode": v.barcode,
                    "raw_base64": base64.b64encode(payload).decode("ascii"),
                    "escpos_base64": base64.b64encode(payload).decode("ascii"),
                }
            )
        return Response(
            {
                "items": out,
                "size": size,
                "printer_name": settings.label_printer_name,
                "printer_type": settings.label_printer_type,
            }
        )


class TestReceiptPrintView(APIView):
    permission_classes = [IsAuthenticated, IsCashier]

    def post(self, request):
        import base64

        settings = StoreSettings.get_solo()
        test_lang = resolve_receipt_store_lang(settings, request.headers.get("Accept-Language") or "uz")
        dto = {
            "sale_id": "TEST-RECEIPT",
            "completed_at": "",
            "cashier": "admin",
            "subtotal": "0",
            "discount_total": "0",
            "grand_total": "0",
            "payments": [{"method": "CASH", "amount": "0"}],
            "store": {
                "brand_name": settings.brand_name,
                "phone": settings.phone,
                "address": settings.address,
                "footer_note": settings.footer_note or "Сатып алганыңыз үчүн рахмат!",
                "transliterate_uz": settings.transliterate_uz,
                "encoding": settings.encoding,
                "lang": test_lang,
                "receipt_width": settings.receipt_width or "58mm",
                "receipt_printer_name": settings.receipt_printer_name or "",
                "receipt_printer_type": settings.receipt_printer_type,
                "label_printer_name": settings.label_printer_name or "",
                "label_printer_type": settings.label_printer_type,
            },
            "lines": [],
        }
        try:
            raw = PrinterFactory.render_receipt(receipt_dto=dto, settings=settings)
        except (FileNotFoundError, OSError) as exc:
            return _escpos_bundle_error_response(exc)
        encoded = base64.b64encode(raw).decode("ascii")
        return Response(
            {
                "raw_base64": encoded,
                "escpos_base64": encoded,
                "printer_name": settings.receipt_printer_name,
                "printer_type": settings.receipt_printer_type,
            }
        )


class TestLabelPrintView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request):
        import base64

        settings = StoreSettings.get_solo()
        variant = SimpleNamespace(
            barcode="TEST123456",
            list_price="100000",
            product=SimpleNamespace(name_uz="Demo", category=SimpleNamespace(name_uz="BrandCat")),
        )
        try:
            raw = PrinterFactory.render_label(
                label_payload={"variant": variant, "size": "40x30", "copies": 1},
                settings=settings,
            )
        except (FileNotFoundError, OSError) as exc:
            return _escpos_bundle_error_response(exc)
        encoded = base64.b64encode(raw).decode("ascii")
        return Response(
            {
                "raw_base64": encoded,
                "escpos_base64": encoded,
                "printer_name": settings.label_printer_name,
                "printer_type": settings.label_printer_type,
                "size": "40x30",
            }
        )
