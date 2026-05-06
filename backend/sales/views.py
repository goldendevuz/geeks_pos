from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from django.http import HttpResponse
from django.db.models import Q
from django.utils import timezone
from datetime import datetime, time, timedelta
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
from printing.receipt import sale_to_receipt_dict

from .serializers import (
    CompleteSaleSerializer,
    SaleHistorySerializer,
    SaleReturnSerializer,
    VoidSaleSerializer,
)
from .services import complete_sale, return_sale_lines, void_sale
from .models import Sale


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
                "cashier",
                "completed_at",
                "subtotal",
                "discount_total",
                "grand_total",
            ]
        )
        for s in qs:
            writer.writerow(
                [
                    str(s.id),
                    s.public_sale_no,
                    s.status,
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
                "cashier",
                "completed_at",
                "subtotal",
                "discount_total",
                "grand_total",
            ]
        )
        for s in qs:
            ws.append(
                [
                    str(s.id),
                    s.public_sale_no,
                    s.status,
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
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request, pk):
        try:
            sale = Sale.objects.prefetch_related("lines").get(pk=pk)
        except Sale.DoesNotExist:
            return Response({"code": "SALE_NOT_FOUND", "detail": "Sale not found."}, status=404)
        ser = VoidSaleSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        voided = void_sale(
            sale=sale,
            user=request.user,
            reason=ser.validated_data.get("reason") or "",
        )
        return Response(
            {
                "sale_id": str(voided.id),
                "status": voided.status,
                "note": voided.note,
            }
        )


class SaleReturnView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request, pk):
        try:
            sale = Sale.objects.prefetch_related("lines").get(pk=pk)
        except Sale.DoesNotExist:
            return Response({"code": "SALE_NOT_FOUND", "detail": "Sale not found."}, status=404)
        ser = SaleReturnSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            out = return_sale_lines(
                sale=sale,
                user=request.user,
                lines=[dict(x) for x in ser.validated_data["lines"]],
                reason=ser.validated_data.get("reason") or "",
            )
            return Response(out)
        except ValueError as e:
            return Response({"code": "RETURN_FAILED", "detail": str(e)}, status=400)
