from rest_framework import generics, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Q
from django.utils import timezone

from core.audit import log_audit
from core.permissions import IsAdminOrOwner, IsCashier

from .models import Category, Color, Product, ProductVariant, Size
from .serializers import (
    BulkGridSerializer,
    CashierStockRowSerializer,
    CategorySerializer,
    ColorSerializer,
    PosPriceUpdateSerializer,
    PosProductVariantSerializer,
    ProductSerializer,
    ProductVariantSerializer,
    SizeSerializer,
)
from .search import variant_text_search_q
from .services import bulk_create_variant_grid


class CatalogPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 200


class CategoryListCreate(generics.ListCreateAPIView):
    queryset = Category.objects.filter(deleted_at__isnull=True)
    serializer_class = CategorySerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]


class SizeListCreate(generics.ListCreateAPIView):
    queryset = Size.objects.all()
    serializer_class = SizeSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]


class ColorListCreate(generics.ListCreateAPIView):
    queryset = Color.objects.all()
    serializer_class = ColorSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]


class CategoryDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def perform_destroy(self, instance):
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["deleted_at"])


class SizeDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Size.objects.all()
    serializer_class = SizeSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]


class ColorDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Color.objects.all()
    serializer_class = ColorSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]


class ProductListCreate(generics.ListCreateAPIView):
    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    pagination_class = CatalogPagination

    def get_queryset(self):
        include_deleted = self.request.query_params.get("include_deleted") == "1"
        query = (self.request.query_params.get("q") or "").strip()
        qs = Product.objects.all()
        if not include_deleted:
            qs = qs.filter(deleted_at__isnull=True)
        if query:
            qs = qs.filter(Q(name_uz__icontains=query) | Q(name_ru__icontains=query))
        return qs.order_by("name_uz")


class CashierStockListView(generics.ListAPIView):
    """Paginated variants for cashiers (read-only, no purchase_price); inactive rows included."""

    serializer_class = CashierStockRowSerializer
    permission_classes = [IsAuthenticated, IsCashier]
    pagination_class = CatalogPagination

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def get_queryset(self):
        query = (self.request.query_params.get("q") or "").strip()
        qs = ProductVariant.objects.select_related(
            "product", "product__category", "size", "color"
        ).filter(deleted_at__isnull=True)
        if query:
            qs = qs.filter(variant_text_search_q(query))
        return qs.order_by("product__name_uz", "barcode")


class ProductVariantListCreate(generics.ListCreateAPIView):
    serializer_class = ProductVariantSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    pagination_class = CatalogPagination

    def get_queryset(self):
        include_deleted = self.request.query_params.get("include_deleted") == "1"
        query = (self.request.query_params.get("q") or "").strip()
        qs = ProductVariant.objects.select_related("product", "product__category", "size", "color")
        if not include_deleted:
            qs = qs.filter(deleted_at__isnull=True)
        if query:
            qs = qs.filter(variant_text_search_q(query))

        cat_id = (self.request.query_params.get("category_id") or "").strip()
        prod_id = (self.request.query_params.get("product_id") or "").strip()
        if cat_id:
            qs = qs.filter(product__category_id=cat_id)
        if prod_id:
            qs = qs.filter(product_id=prod_id)

        ordering_param = (self.request.query_params.get("ordering") or "name").strip().lower()
        if ordering_param == "recent":
            return qs.order_by("-created_at", "-id")
        return qs.order_by("product__name_uz", "barcode")


class VariantByBarcodeView(APIView):
    permission_classes = [IsAuthenticated, IsCashier]

    def get(self, request):
        code = (request.query_params.get("code") or "").strip()
        if not code:
            return Response({"code": "BARCODE_EMPTY"}, status=400)
        v = (
            ProductVariant.objects.select_related("product", "size", "color")
            .filter(barcode=code, is_active=True, deleted_at__isnull=True)
            .first()
        )
        if not v:
            from core.exceptions import BarcodeNotFound

            return Response(
                {"code": BarcodeNotFound.code, "detail": "Barcode not found"},
                status=404,
            )
        return Response(PosProductVariantSerializer(v).data)


class PosVariantSearchView(APIView):
    """Text search for POS (cashier): name, brand/model via product, size, color, barcode."""

    permission_classes = [IsAuthenticated, IsCashier]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"results": []})
        limit = min(int(request.query_params.get("limit") or 30), 50)
        qs = (
            ProductVariant.objects.select_related("product", "product__category", "size", "color")
            .filter(is_active=True, deleted_at__isnull=True)
            .filter(variant_text_search_q(q))
            .order_by("product__name_uz", "barcode")[:limit]
        )
        return Response({"results": PosProductVariantSerializer(qs, many=True).data})


class PosVariantByProductView(APIView):
    """All active variants for a product (optional color) — POS stock matrix."""

    permission_classes = [IsAuthenticated, IsCashier]

    def get(self, request):
        from uuid import UUID

        raw_pid = (request.query_params.get("product_id") or "").strip()
        if not raw_pid:
            return Response({"code": "PRODUCT_ID_REQUIRED"}, status=400)
        try:
            UUID(raw_pid)
        except ValueError:
            return Response({"code": "INVALID_PRODUCT_ID"}, status=400)
        raw_cid = (request.query_params.get("color_id") or "").strip()
        qs = (
            ProductVariant.objects.select_related("product", "size", "color")
            .filter(product_id=raw_pid, is_active=True, deleted_at__isnull=True)
            .order_by("size__sort_order", "size__value", "color__sort_order", "barcode")
        )
        if raw_cid:
            try:
                UUID(raw_cid)
            except ValueError:
                return Response({"code": "INVALID_COLOR_ID"}, status=400)
            qs = qs.filter(color_id=raw_cid)
        return Response({"results": PosProductVariantSerializer(qs, many=True).data})


class BulkVariantGridView(APIView):
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def post(self, request):
        ser = BulkGridSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            product = Product.objects.get(pk=ser.validated_data["product_id"])
        except Product.DoesNotExist:
            return Response({"code": "PRODUCT_NOT_FOUND", "detail": "Product not found."}, status=404)
        created = bulk_create_variant_grid(
            product=product,
            matrix=[dict(c) for c in ser.validated_data["matrix"]],
            user=request.user,
        )
        return Response(
            ProductVariantSerializer(created, many=True).data,
            status=status.HTTP_201_CREATED,
        )


class ProductDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        hard = request.query_params.get("hard") == "1"
        has_refs = instance.variants.filter(
            Q(sale_lines__isnull=False) | Q(movements__isnull=False) | Q(stocktake_lines__isnull=False)
        ).exists()
        if hard and not has_refs:
            instance.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["deleted_at"])
        return Response({"code": "SOFT_DELETED_REFERENCED" if has_refs else "SOFT_DELETED"}, status=200)


class ProductVariantDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = ProductVariant.objects.select_related("product", "size", "color")
    serializer_class = ProductVariantSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        hard = request.query_params.get("hard") == "1"
        has_refs = (
            instance.sale_lines.exists()
            or instance.movements.exists()
            or instance.stocktake_lines.exists()
        )
        if hard and not has_refs:
            instance.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["deleted_at"])
        return Response({"code": "SOFT_DELETED_REFERENCED" if has_refs else "SOFT_DELETED"}, status=200)


class PosVariantPriceView(APIView):
    permission_classes = [IsAuthenticated, IsCashier]

    def post(self, request, pk):
        try:
            variant = ProductVariant.objects.select_related("product", "size", "color").get(pk=pk)
        except ProductVariant.DoesNotExist:
            return Response({"code": "VARIANT_NOT_FOUND", "detail": "Variant not found."}, status=404)
        ser = PosPriceUpdateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        old_price = variant.list_price
        variant.list_price = ser.validated_data["list_price"]
        variant.save(update_fields=["list_price", "updated_at"])
        log_audit(
            event_type="pos_price_updated",
            actor=request.user.username if request.user else None,
            entity_id=str(variant.id),
            payload={
                "old_price": str(old_price),
                "new_price": str(variant.list_price),
                "product_name": variant.product.name_uz,
                "barcode": variant.barcode,
            },
        )
        return Response(ProductVariantSerializer(variant).data)
