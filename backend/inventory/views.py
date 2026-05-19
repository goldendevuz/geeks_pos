from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils.dateparse import parse_datetime

from catalog.models import ProductVariant
from core.exceptions import InsufficientStock
from core.permissions import IsAdminOrOwner

from .models import InventoryMovement, StocktakeSession
from .serializers import (
    AdjustSerializer,
    ReceiveSerializer,
    StocktakeCountSerializer,
    StocktakeSessionCreateSerializer,
    StocktakeSessionSerializer,
)
from .services import (
    apply_movement,
    apply_stocktake,
    create_stocktake_session,
    set_stocktake_count,
)


class ReceiveView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request):
        ser = ReceiveSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            v = ProductVariant.objects.get(pk=ser.validated_data["variant_id"])
        except ProductVariant.DoesNotExist:
            return Response({"code": "VARIANT_NOT_FOUND", "detail": "Variant not found"}, status=404)
        apply_movement(
            variant=v,
            qty_delta=ser.validated_data["qty"],
            movement_type=InventoryMovement.Type.IN,
            user=request.user,
            note=ser.validated_data.get("note") or "",
        )
        v.refresh_from_db()
        return Response({"variant_id": str(v.id), "stock_qty": v.stock_qty})


class AdjustView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request):
        ser = AdjustSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            v = ProductVariant.objects.get(pk=ser.validated_data["variant_id"])
        except ProductVariant.DoesNotExist:
            return Response({"code": "VARIANT_NOT_FOUND", "detail": "Variant not found"}, status=404)
        delta = ser.validated_data["qty_delta"]
        try:
            apply_movement(
                variant=v,
                qty_delta=delta,
                movement_type=InventoryMovement.Type.ADJUST,
                user=request.user,
                note=ser.validated_data.get("note") or "",
            )
        except InsufficientStock as e:
            return Response({"code": e.code, "detail": str(e)}, status=409)
        v.refresh_from_db()
        return Response({"variant_id": str(v.id), "stock_qty": v.stock_qty})


class StocktakeSessionCreateView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request):
        ser = StocktakeSessionCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        session = create_stocktake_session(
            user=request.user, note=ser.validated_data.get("note") or ""
        )
        return Response(StocktakeSessionSerializer(session).data, status=201)


class StocktakeSessionDetailView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def get(self, request, session_id):
        try:
            session = StocktakeSession.objects.prefetch_related(
                "lines__variant__product__category"
            ).get(pk=session_id)
        except StocktakeSession.DoesNotExist:
            return Response({"code": "SESSION_NOT_FOUND", "detail": "Stocktake session not found"}, status=404)
        return Response(StocktakeSessionSerializer(session).data)


class StocktakeCountView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request, session_id):
        try:
            session = StocktakeSession.objects.get(pk=session_id)
        except StocktakeSession.DoesNotExist:
            return Response({"code": "SESSION_NOT_FOUND", "detail": "Stocktake session not found"}, status=404)
        ser = StocktakeCountSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            v = ProductVariant.objects.get(pk=ser.validated_data["variant_id"])
        except ProductVariant.DoesNotExist:
            return Response({"code": "VARIANT_NOT_FOUND", "detail": "Variant not found"}, status=404)
        line = set_stocktake_count(
            session=session,
            variant=v,
            counted_qty=ser.validated_data["counted_qty"],
            user=request.user,
        )
        return Response(
            {
                "session_id": str(session.id),
                "variant_id": str(v.id),
                "expected_qty": line.expected_qty,
                "counted_qty": line.counted_qty,
                "variance_qty": line.variance_qty,
            }
        )


class StocktakeApplyView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request, session_id):
        try:
            session = StocktakeSession.objects.get(pk=session_id)
        except StocktakeSession.DoesNotExist:
            return Response({"code": "SESSION_NOT_FOUND", "detail": "Stocktake session not found"}, status=404)
        session = apply_stocktake(session=session, user=request.user)
        return Response(
            {
                "session_id": str(session.id),
                "status": session.status,
                "applied_at": session.applied_at,
            }
        )


class StocktakeSessionListView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def get(self, request):
        status = request.query_params.get("status")
        qs = StocktakeSession.objects.order_by("-created_at")
        if status:
            qs = qs.filter(status=status)
        data = [
            {
                "id": str(s.id),
                "status": s.status,
                "note": s.note,
                "created_at": s.created_at,
                "applied_at": s.applied_at,
            }
            for s in qs[:50]
        ]
        return Response(data)


class StockEventsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        since_raw = (request.query_params.get("since") or "").strip()
        qs = InventoryMovement.objects.select_related("variant").filter(
            type__in=[
                InventoryMovement.Type.SALE,
                InventoryMovement.Type.RETURN,
                InventoryMovement.Type.ADJUST,
                InventoryMovement.Type.IN,
            ]
        )
        if since_raw:
            since_dt = parse_datetime(since_raw)
            if since_dt is not None:
                qs = qs.filter(created_at__gt=since_dt)
        rows = qs.order_by("created_at")[:200]
        data = [
            {
                "movement_id": str(m.id),
                "variant_id": str(m.variant_id),
                "qty_delta": m.qty_delta,
                "type": m.type,
                "stock_qty": m.variant.stock_qty,
                "created_at": m.created_at,
            }
            for m in rows
        ]
        return Response({"events": data})
