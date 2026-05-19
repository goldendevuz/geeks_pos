from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from django.http import HttpResponse
from collections import defaultdict
from django.db.models import Q
from django.utils import timezone
from datetime import datetime, time, timedelta
from decimal import Decimal
import csv
from io import BytesIO

from core.exceptions import (
    DebtPolicyError,
    DomainError,
    InsufficientStock,
    InvalidPaymentSplit,
)
from core.permissions import IsCashier
from core.permissions import IsAdminOrOwner
from catalog.models import ProductVariant
from printing.receipt import sale_to_receipt_dict

from .models import Payment, Sale, SaleLine
from .serializers import (
    CompleteSaleSerializer,
    SaleHistorySerializer,
    SaleReturnSerializer,
    VoidSaleSerializer,
)
from .refund_utils import refund_capacity_by_method, refunds_already_list
from .history_meta import build_history_return_meta
from .return_state import build_return_eligible_lines, remaining_return_units_by_sale_ids
from .services import complete_sale, return_sale_lines, void_sale


def _request_lang(request) -> str:
    return (request.headers.get("Accept-Language") or "uz").split(",")[0]


def _return_preview_line_dict(ln: SaleLine) -> dict:
    """Vozvrat qidiruvi / qatorlar uchun sotilgan pozitsiya (variant + narx)."""
    v = ln.variant
    p = v.product
    cat = getattr(p, "category", None)
    sz = getattr(v, "size", None)
    col = getattr(v, "color", None)

    def _safe(obj, uz_attr: str, ru_attr: str) -> tuple[str, str]:
        if not obj:
            return ("", "")
        return (
            (getattr(obj, uz_attr, None) or "") or "",
            (getattr(obj, ru_attr, None) or "") or "",
        )

    cat_uz, cat_ru = _safe(cat, "name_uz", "name_ru")
    sz_uz, sz_ru = _safe(sz, "label_uz", "label_ru")
    col_uz, col_ru = _safe(col, "label_uz", "label_ru")

    return {
        "variant_id": str(v.id),
        "barcode": v.barcode or "",
        "category_name_uz": cat_uz,
        "category_name_ru": cat_ru,
        "product_name_uz": (getattr(p, "name_uz", None) or "") or "",
        "product_name_ru": (getattr(p, "name_ru", None) or "") or "",
        "size_label_uz": sz_uz,
        "size_label_ru": sz_ru,
        "color_label_uz": col_uz,
        "color_label_ru": col_ru,
        "qty": ln.qty,
        "list_unit_price": str(ln.list_unit_price),
        "net_unit_price": str(ln.net_unit_price),
        "line_discount": str(ln.line_discount),
        "line_total": str(ln.line_total),
        "stock_qty": int(v.stock_qty or 0),
    }


def _is_admin_or_owner(user) -> bool:
    if getattr(user, "is_superuser", False):
        return True
    profile = getattr(user, "profile", None)
    return getattr(profile, "role", None) in ("ADMIN", "OWNER")


def _has_sale_access(user, sale: Sale) -> bool:
    if _is_admin_or_owner(user):
        return True
    return sale.cashier_id == user.id


def _date_start(v: str):
    try:
        d = datetime.strptime(v, "%Y-%m-%d").date()
    except ValueError:
        return None
    return timezone.make_aware(datetime.combine(d, time.min), timezone.get_current_timezone())


def _date_end_exclusive(v: str):
    try:
        d = datetime.strptime(v, "%Y-%m-%d").date()
    except ValueError:
        return None
    dt = datetime.combine(d, time.min) + timedelta(days=1)
    return timezone.make_aware(dt, timezone.get_current_timezone())


class CompleteSaleView(APIView):
    permission_classes = [IsAuthenticated, IsCashier]

    def post(self, request):
        key = request.headers.get("Idempotency-Key") or request.data.get(
            "idempotency_key"
        )
        if not key:
            return Response({"code": "IDEMPOTENCY_REQUIRED"}, status=400)
        ser = CompleteSaleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        try:
            sale = complete_sale(
                idempotency_key=key.strip(),
                cashier=request.user,
                lines=[dict(l) for l in data["lines"]],
                payments=[dict(p) for p in data["payments"]],
                customer=data.get("customer"),
                order_discount=data.get("order_discount"),
                expected_grand_total=data.get("expected_grand_total"),
                debt_due_date=data.get("debt_due_date"),
                note=data.get("note") or "",
            )
        except InsufficientStock as e:
            return Response({"code": e.code, "detail": str(e)}, status=e.status_code)
        except InvalidPaymentSplit as e:
            return Response({"code": e.code, "detail": str(e)}, status=e.status_code)
        except DebtPolicyError as e:
            return Response({"code": e.code, "detail": str(e)}, status=e.status_code)
        except DomainError as e:
            return Response({"code": e.code, "detail": str(e)}, status=e.status_code)
        except ValueError as e:
            return Response({"code": "VALIDATION_ERROR", "detail": str(e)}, status=400)

        return Response(
            {
                "sale_id": str(sale.id),
                "public_sale_no": sale.public_sale_no,
                "grand_total": str(sale.grand_total),
                "receipt": sale_to_receipt_dict(sale, lang=_request_lang(request)),
            }
        )


class SaleDetailView(APIView):
    permission_classes = [IsAuthenticated, IsCashier]

    def get(self, request, pk):
        from .models import Sale

        try:
            sale = Sale.objects.select_related("cashier").prefetch_related(
                "lines__variant__product",
                "lines__variant__size",
                "lines__variant__color",
                "payments",
            ).get(
                pk=pk
            )
        except Sale.DoesNotExist:
            return Response({"code": "SALE_NOT_FOUND", "detail": "Sale not found."}, status=404)
        if not _has_sale_access(request.user, sale):
            return Response(
                {"code": "SALE_ACCESS_DENIED", "detail": "You do not have access to this sale."},
                status=403,
            )
        return Response(
            {
                "sale_id": str(sale.id),
                "public_sale_no": sale.public_sale_no,
                "receipt": sale_to_receipt_dict(sale, lang=_request_lang(request)),
            }
        )


class SaleHistoryView(generics.ListAPIView):
    queryset = Sale.objects.select_related("cashier").all()
    serializer_class = SaleHistorySerializer
    permission_classes = [IsAuthenticated, IsCashier]
    class HistoryPagination(PageNumberPagination):
        page_size = 20
        page_size_query_param = "page_size"
        max_page_size = 100

    pagination_class = HistoryPagination

    def get_queryset(self):
        qs = super().get_queryset()
        from_date = self.request.query_params.get("from")
        to_date = self.request.query_params.get("to")
        query = (self.request.query_params.get("q") or "").strip()
        if not _is_admin_or_owner(self.request.user):
            qs = qs.filter(cashier=self.request.user)
            # Default cashier view stays "today", but explicit from/to should override this default scope.
            if not from_date and not to_date:
                today = timezone.localdate()
                start_dt = timezone.make_aware(
                    datetime.combine(today, time.min), timezone.get_current_timezone()
                )
                qs = qs.filter(completed_at__gte=start_dt, completed_at__lt=start_dt + timedelta(days=1))
        if from_date:
            start_dt = _date_start(from_date)
            if start_dt is not None:
                qs = qs.filter(completed_at__gte=start_dt)
        if to_date:
            end_dt = _date_end_exclusive(to_date)
            if end_dt is not None:
                qs = qs.filter(completed_at__lt=end_dt)
        if query:
            qs = qs.filter(
                Q(public_sale_no__icontains=query)
                | Q(cashier__username__icontains=query)
                | Q(status__icontains=query)
            )
        return qs

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        sales = list(page) if page is not None else list(queryset)
        meta = build_history_return_meta(sales)
        serializer = self.get_serializer(
            sales,
            many=True,
            context={**self.get_serializer_context(), "return_meta": meta},
        )
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(serializer.data)


class SaleHistoryExportCsvView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def get(self, request):
        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")
        qs = Sale.objects.select_related("cashier").all()
        if from_date:
            start_dt = _date_start(from_date)
            if start_dt is not None:
                qs = qs.filter(completed_at__gte=start_dt)
        if to_date:
            end_dt = _date_end_exclusive(to_date)
            if end_dt is not None:
                qs = qs.filter(completed_at__lt=end_dt)

        resp = HttpResponse(content_type="text/csv")
        resp["Content-Disposition"] = 'attachment; filename="sales_history.csv"'
        writer = csv.writer(resp)
        writer.writerow(
            [
                "sale_id",
                "public_sale_no",
                "status",
                "return_status",
                "refund_total",
                "cashier",
                "completed_at",
                "subtotal",
                "discount_total",
                "grand_total",
            ]
        )
        sale_list = list(qs)
        meta = build_history_return_meta(sale_list)
        for s in sale_list:
            m = meta.get(str(s.id), {})
            writer.writerow(
                [
                    str(s.id),
                    s.public_sale_no,
                    s.status,
                    m.get("return_status", "none"),
                    m.get("refund_total", "0"),
                    s.cashier.username,
                    s.completed_at.isoformat(),
                    s.subtotal,
                    s.discount_total,
                    s.grand_total,
                ]
            )
        return resp


class SaleHistoryExportXlsxView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def get(self, request):
        from openpyxl import Workbook

        from_date = request.query_params.get("from")
        to_date = request.query_params.get("to")
        qs = Sale.objects.select_related("cashier").all()
        if from_date:
            start_dt = _date_start(from_date)
            if start_dt is not None:
                qs = qs.filter(completed_at__gte=start_dt)
        if to_date:
            end_dt = _date_end_exclusive(to_date)
            if end_dt is not None:
                qs = qs.filter(completed_at__lt=end_dt)

        wb = Workbook()
        ws = wb.active
        ws.title = "Sales"
        ws.append(
            [
                "sale_id",
                "public_sale_no",
                "status",
                "return_status",
                "refund_total",
                "cashier",
                "completed_at",
                "subtotal",
                "discount_total",
                "grand_total",
            ]
        )
        sale_list = list(qs)
        meta = build_history_return_meta(sale_list)
        for s in sale_list:
            m = meta.get(str(s.id), {})
            ws.append(
                [
                    str(s.id),
                    s.public_sale_no,
                    s.status,
                    m.get("return_status", "none"),
                    float(m.get("refund_total", "0")),
                    s.cashier.username,
                    s.completed_at.isoformat(),
                    float(s.subtotal),
                    float(s.discount_total),
                    float(s.grand_total),
                ]
            )
        out = BytesIO()
        wb.save(out)
        out.seek(0)
        resp = HttpResponse(
            out.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        resp["Content-Disposition"] = 'attachment; filename="sales_history.xlsx"'
        return resp


class SaleVoidView(APIView):
    permission_classes = [IsAuthenticated, IsCashier]

    def post(self, request, pk):
        try:
            sale = (
                Sale.objects.prefetch_related("lines", "payments", "refunds")
                .select_related("cashier", "debt_record")
                .get(pk=pk)
            )
        except Sale.DoesNotExist:
            return Response({"code": "SALE_NOT_FOUND", "detail": "Sale not found."}, status=404)
        if not _has_sale_access(request.user, sale):
            return Response(
                {"code": "SALE_ACCESS_DENIED", "detail": "You do not have access to this sale."},
                status=403,
            )
        ser = VoidSaleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            out = void_sale(
                sale=sale,
                user=request.user,
                reason=ser.validated_data.get("reason") or "",
            )
        except ValueError as e:
            msg = str(e)
            code = "VOID_NOT_ALLOWED" if "fully returned" in msg.lower() or "no remaining" in msg.lower() else "VOID_FAILED"
            return Response({"code": code, "detail": msg}, status=400)
        voided = out["sale"]
        return Response(
            {
                "sale_id": str(voided.id),
                "status": voided.status,
                "note": voided.note,
                "restocked_lines": out["restocked_lines"],
                "return_amount": out["return_amount"],
                "refunds": out["refunds"],
            }
        )


class SaleReturnView(APIView):
    permission_classes = [IsAuthenticated, IsCashier]

    def post(self, request, pk):
        try:
            sale = (
                Sale.objects.prefetch_related("lines", "payments", "refunds")
                .select_related("cashier", "debt_record")
                .get(pk=pk)
            )
        except Sale.DoesNotExist:
            return Response({"code": "SALE_NOT_FOUND", "detail": "Sale not found."}, status=404)
        if not _has_sale_access(request.user, sale):
            return Response(
                {"code": "SALE_ACCESS_DENIED", "detail": "You do not have access to this sale."},
                status=403,
            )
        ser = SaleReturnSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            vd = ser.validated_data
            out = return_sale_lines(
                sale=sale,
                user=request.user,
                lines=[dict(x) for x in vd["lines"]],
                reason=vd.get("reason") or "",
                refunds=[dict(x) for x in vd.get("refunds") or []],
                auto_refund=vd.get("auto_refund", True),
                skip_refund=vd.get("skip_refund", False),
            )
            return Response(out)
        except ValueError as e:
            msg = str(e)
            code = "RETURN_FAILED"
            if "Refund amounts must equal" in msg:
                code = "RETURN_REFUND_MISMATCH"
            elif "exceeds refundable" in msg or "No refundable" in msg:
                code = "RETURN_REFUND_EXCEEDS"
            return Response({"code": code, "detail": msg}, status=400)


class SaleSearchForReturnView(APIView):
    """Barcode or text / sale no — yakunlangan savdolarni qidirish (vozvrat uchun)."""

    permission_classes = [IsAuthenticated, IsCashier]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"results": []})
        qs = (
            Sale.objects.filter(status=Sale.Status.COMPLETED)
            .select_related("cashier")
            .order_by("-completed_at")
        )
        if not _is_admin_or_owner(request.user):
            qs = qs.filter(cashier=request.user)
        exact_barcode = ProductVariant.objects.filter(barcode=q, deleted_at__isnull=True).exists()
        if exact_barcode:
            qs = qs.filter(lines__variant__barcode=q).distinct()
        else:
            qs = qs.filter(
                Q(public_sale_no__icontains=q)
                | Q(lines__variant__barcode__icontains=q)
                | Q(lines__variant__product__name_uz__icontains=q)
                | Q(lines__variant__product__name_ru__icontains=q)
                | Q(lines__variant__product__category__name_uz__icontains=q)
                | Q(lines__variant__product__category__name_ru__icontains=q)
            ).distinct()

        sale_list = list(qs[:50])
        sale_ids = [s.id for s in sale_list]
        remaining_by_sale = remaining_return_units_by_sale_ids(sale_ids)
        sale_list = [s for s in sale_list if remaining_by_sale.get(str(s.id), 0) > 0][:25]
        sale_ids = [s.id for s in sale_list]
        preview_by_sale: dict[str, list[dict]] = defaultdict(list)
        pay_by_sale: dict[str, list[dict]] = defaultdict(list)
        if sale_ids:
            line_qs = (
                SaleLine.objects.filter(sale_id__in=sale_ids)
                .select_related("variant__product__category", "variant__color", "variant__size")
                .order_by("sale_id", "id")
            )
            for ln in line_qs:
                preview_by_sale[str(ln.sale_id)].append(_return_preview_line_dict(ln))

            for pay in Payment.objects.filter(sale_id__in=sale_ids).order_by("id"):
                pay_by_sale[str(pay.sale_id)].append({"method": pay.method, "amount": str(pay.amount)})

        out = []
        for s in sale_list:
            prev = list(preview_by_sale[str(s.id)])
            if exact_barcode:
                prev = [x for x in prev if x.get("barcode") == q]
            out.append(
                {
                    "sale_id": str(s.id),
                    "public_sale_no": s.public_sale_no,
                    "completed_at": s.completed_at.isoformat(),
                    "cashier_username": s.cashier.username,
                    "subtotal": str(s.subtotal),
                    "discount_total": str(s.discount_total),
                    "grand_total": str(s.grand_total),
                    "payments": list(pay_by_sale[str(s.id)]),
                    "preview_lines": prev,
                }
            )
        return Response({"results": out})


class SaleReturnLinesView(APIView):
    """Savdo satrlari: sotilgan, qaytgan, qoldiq qty (frontend vozvrat formasi uchun)."""

    permission_classes = [IsAuthenticated, IsCashier]

    def get(self, request, pk):
        try:
            sale = Sale.objects.prefetch_related(
                "payments",
                "refunds",
                "lines__variant__product__category",
                "lines__variant__color",
                "lines__variant__size",
            ).select_related("cashier", "debt_record").get(pk=pk)
        except Sale.DoesNotExist:
            return Response({"code": "SALE_NOT_FOUND", "detail": "Sale not found."}, status=404)
        if sale.status != Sale.Status.COMPLETED:
            return Response(
                {"code": "RETURN_NOT_COMPLETED", "detail": "Only completed sales can be returned."},
                status=400,
            )
        if not _has_sale_access(request.user, sale):
            return Response(
                {"code": "SALE_ACCESS_DENIED", "detail": "You do not have access to this sale."},
                status=403,
            )
        all_lines = list(sale.lines.all())
        rows, return_state, total_remaining_qty = build_return_eligible_lines(sale, all_lines)
        payments_out = [{"method": p.method, "amount": str(p.amount)} for p in sale.payments.all()]
        cap = refund_capacity_by_method(sale)
        return Response(
            {
                "sale_id": str(sale.id),
                "public_sale_no": sale.public_sale_no,
                "completed_at": sale.completed_at.isoformat(),
                "cashier_username": sale.cashier.username,
                "subtotal": str(sale.subtotal),
                "discount_total": str(sale.discount_total),
                "grand_total": str(sale.grand_total),
                "payments": payments_out,
                "refunds_already": refunds_already_list(sale),
                "refund_capacity": {k: str(v) for k, v in cap.items()},
                "return_state": return_state,
                "total_remaining_qty": total_remaining_qty,
                "lines": rows,
            }
        )
