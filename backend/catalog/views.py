from rest_framework import generics, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import ValidationError
from django.db.models import Q
from django.utils import timezone
import logging

from core.audit import log_audit
from core.permissions import IsAdminOrOwner, IsCashier

from .models import Category, Product, ProductVariant, Supplier, SupplierTransaction
from .serializers import (
    BulkGridSerializer,
    CashierStockRowSerializer,
    CategorySerializer,
    PosPriceUpdateSerializer,
    PosProductVariantSerializer,
    ProductSerializer,
    ProductVariantSerializer,
    SupplierSerializer,
    SupplierTransactionSerializer,
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


class CategoryDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def perform_destroy(self, instance):
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["deleted_at"])


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
            "product", "product__category"
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
        qs = ProductVariant.objects.select_related("product", "product__category")
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
            ProductVariant.objects.select_related("product")
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
    """Text search for POS (cashier): name, brand/model via product, barcode."""

    permission_classes = [IsAuthenticated, IsCashier]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"results": []})
        limit = min(int(request.query_params.get("limit") or 30), 50)
        qs = (
            ProductVariant.objects.select_related("product", "product__category")
            .filter(is_active=True, deleted_at__isnull=True)
            .filter(variant_text_search_q(q))
            .order_by("product__name_uz", "barcode")[:limit]
        )
        return Response({"results": PosProductVariantSerializer(qs, many=True).data})


class PosVariantByProductView(APIView):
    """All active variants for a product — simplified for appliances (no color filter)."""

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
        
        qs = (
            ProductVariant.objects.select_related("product")
            .filter(product_id=raw_pid, is_active=True, deleted_at__isnull=True)
            .order_by("barcode")
        )
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
    queryset = ProductVariant.objects.select_related("product")
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
            variant = ProductVariant.objects.select_related("product").get(pk=pk)
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


# ============================================================================
# Supplier Management Endpoints
# ============================================================================


class SupplierListCreateView(generics.ListCreateAPIView):
    """List all suppliers or create a new supplier."""
    queryset = Supplier.objects.filter(is_active=True).order_by("name_uz")
    serializer_class = SupplierSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    pagination_class = CatalogPagination


class SupplierDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update, or soft-delete a supplier."""
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()


class SupplierTransactionListView(generics.ListCreateAPIView):
    """List transactions for a supplier or record a new transaction."""
    serializer_class = SupplierTransactionSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    pagination_class = CatalogPagination
    
    def get_queryset(self):
        supplier_id = self.kwargs.get("supplier_id")
        return SupplierTransaction.objects.filter(supplier_id=supplier_id).order_by("-created_at")
    
    def perform_create(self, serializer):
        supplier_id = self.kwargs.get("supplier_id")
        try:
            supplier = Supplier.objects.get(id=supplier_id)
            serializer.save(supplier=supplier, recorded_by=self.request.user)
        except Supplier.DoesNotExist:
            raise ValidationError({"detail": f"Supplier with ID {supplier_id} not found"})
    
    def create(self, request, *args, **kwargs):
        """Override to provide better error messages."""
        try:
            return super().create(request, *args, **kwargs)
        except ValidationError as e:
            return Response({"code": "VALIDATION_ERROR", "detail": str(e)}, status=400)
        except Exception as e:
            logger = logging.getLogger(__name__)
            logger.error(f"Error creating supplier transaction: {e}")
            return Response({"code": "TRANSACTION_ERROR", "detail": str(e)}, status=400)


class SupplierBalanceView(APIView):
    """Get balance summary for all suppliers."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get(self, request):
        from .supplier_services import get_all_suppliers_balance
        from .serializers import SupplierBalanceSerializer
        
        balances = get_all_suppliers_balance()
        serializer = SupplierBalanceSerializer(balances, many=True)
        return Response(serializer.data)


class SingleSupplierBalanceView(APIView):
    """Get balance for a specific supplier."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get(self, request, supplier_id):
        from .supplier_services import get_supplier_balance
        from .serializers import SupplierBalanceSerializer
        
        try:
            supplier = Supplier.objects.get(id=supplier_id)
        except Supplier.DoesNotExist:
            return Response({"code": "SUPPLIER_NOT_FOUND", "detail": "Supplier not found."}, status=404)
        
        balance_info = get_supplier_balance(supplier_id)
        data = {
            "supplier_id": supplier.id,
            "supplier_name_uz": supplier.name_uz,
            "supplier_name_ru": supplier.name_ru,
            **balance_info,
        }
        serializer = SupplierBalanceSerializer(data)
        return Response(serializer.data)


class LowStockListView(APIView):
    """Get all products with low stock, with optional filtering."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get(self, request):
        from .low_stock import get_low_stock_summary
        
        # Get aggregation type from query params
        aggregation = request.query_params.get("aggregation", "summary").lower()
        # summary, variants, by_brand, by_model
        
        summary = get_low_stock_summary()
        
        if aggregation == "variants":
            return Response({"results": summary["variants"]})
        elif aggregation == "by_brand":
            return Response({"results": summary["by_brand"]})
        elif aggregation == "by_model":
            return Response({"results": summary["by_model"]})
        else:
            # Default: summary
            return Response(summary)


class LowStockByBrandView(APIView):
    """Get low stock aggregated by brand (category)."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get(self, request):
        from .low_stock import get_low_stock_by_brand
        
        results = get_low_stock_by_brand()
        return Response({"results": results})


class LowStockByModelView(APIView):
    """Get low stock aggregated by model (product)."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get(self, request):
        from .low_stock import get_low_stock_by_model
        
        results = get_low_stock_by_model()
        return Response({"results": results})


# ============================================================================
# Phase 4: Product Specifications Endpoints
# ============================================================================


class ProductSpecificationView(APIView):
    """Get or update product specifications."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get(self, request, product_id):
        from .specification_services import get_specification
        from .serializers import ProductSpecificationSerializer
        
        spec = get_specification(product_id)
        if not spec:
            return Response({"code": "SPEC_NOT_FOUND", "detail": "Specifications not found."}, status=404)
        
        serializer = ProductSpecificationSerializer(spec)
        return Response(serializer.data)
    
    def put(self, request, product_id):
        from .specification_services import update_specification
        from .serializers import ProductSpecificationSerializer
        
        try:
            Product.objects.get(id=product_id)
        except Product.DoesNotExist:
            return Response({"code": "PRODUCT_NOT_FOUND", "detail": "Product not found."}, status=404)
        
        spec = update_specification(product_id, **request.data)
        serializer = ProductSpecificationSerializer(spec)
        
        log_audit(
            event_type="product_spec_updated",
            actor=request.user.username if request.user else None,
            entity_id=str(product_id),
            payload={"specifications": request.data},
        )
        
        return Response(serializer.data)
    
    def delete(self, request, product_id):
        from .specification_services import delete_specification
        
        deleted = delete_specification(product_id)
        if not deleted:
            return Response({"code": "SPEC_NOT_FOUND", "detail": "Specifications not found."}, status=404)
        
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProductSpecificationListView(generics.ListAPIView):
    """List all product specifications."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    pagination_class = CatalogPagination
    
    def get(self, request):
        from .models import ProductSpecification
        from .serializers import ProductSpecificationSerializer
        
        qs = ProductSpecification.objects.select_related('product__category').order_by('product__name_uz')
        
        # Optional filters
        energy_class = request.query_params.get('energy_class')
        if energy_class:
            qs = qs.filter(energy_class__iexact=energy_class)
        
        capacity = request.query_params.get('capacity')
        if capacity:
            qs = qs.filter(capacity__icontains=capacity)
        
        serializer = ProductSpecificationSerializer(qs, many=True)
        return Response({"results": serializer.data})


class ProductsWithoutSpecsView(APIView):
    """Get all products that don't have specifications defined."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get(self, request):
        from .specification_services import get_products_without_specifications
        
        products = get_products_without_specifications()
        serializer = ProductSerializer(products, many=True)
        return Response({"results": serializer.data})


class SpecificationSummaryView(APIView):
    """Get summary statistics for product specifications."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get(self, request):
        from .specification_services import get_specification_summary
        
        summary = get_specification_summary()
        return Response(summary)


# ============================================================================
# Phase 4: Serial Number & Warranty Tracking Endpoints
# ============================================================================


class SerialNumberListCreateView(generics.ListCreateAPIView):
    """List serial numbers or create a new one."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    pagination_class = CatalogPagination
    
    def get_queryset(self):
        from .models import SerialNumber
        from .serial_services import search_serial_numbers
        
        # Get filter parameters
        query = self.request.query_params.get('q')
        status_filter = self.request.query_params.get('status')
        variant_id = self.request.query_params.get('variant_id')
        product_id = self.request.query_params.get('product_id')
        category_id = self.request.query_params.get('category_id')
        warranty_status = self.request.query_params.get('warranty_status')
        
        return search_serial_numbers(
            query=query,
            status=status_filter,
            variant_id=variant_id,
            product_id=product_id,
            category_id=category_id,
            warranty_status=warranty_status
        )
    
    def get_serializer_class(self):
        from .serializers import SerialNumberSerializer
        return SerialNumberSerializer
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class SerialNumberDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update, or delete a serial number."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get_queryset(self):
        from .models import SerialNumber
        return SerialNumber.objects.select_related('variant__product__category', 'sale_line__sale')
    
    def get_serializer_class(self):
        from .serializers import SerialNumberSerializer
        return SerialNumberSerializer


class SerialNumberBulkCreateView(APIView):
    """Bulk create serial numbers for a variant."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def post(self, request):
        from .serial_services import bulk_create_serial_numbers
        from .serializers import SerialNumberCreateSerializer, SerialNumberSerializer
        
        serializer = SerialNumberCreateSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        
        # Group by variant_id for efficient bulk creation
        by_variant = {}
        for item in serializer.validated_data:
            variant_id = str(item['variant_id'])
            if variant_id not in by_variant:
                by_variant[variant_id] = {
                    'serial_numbers': [],
                    'warranty_months': item.get('warranty_months', 12),
                    'purchase_date': item.get('purchase_date'),
                    'notes': item.get('notes', '')
                }
            by_variant[variant_id]['serial_numbers'].append(item['serial_number'])
        
        created_all = []
        for variant_id, data in by_variant.items():
            created = bulk_create_serial_numbers(
                variant_id=variant_id,
                serial_numbers=data['serial_numbers'],
                warranty_months=data['warranty_months'],
                purchase_date=data['purchase_date'],
                user_id=str(request.user.id)
            )
            created_all.extend(created)
        
        log_audit(
            event_type="serial_numbers_bulk_created",
            actor=request.user.username if request.user else None,
            entity_id=None,
            payload={"count": len(created_all)},
        )
        
        result_serializer = SerialNumberSerializer(created_all, many=True)
        return Response(result_serializer.data, status=status.HTTP_201_CREATED)


class SerialNumberByCodeView(APIView):
    """Look up a serial number by its code."""
    permission_classes = [IsAuthenticated, IsCashier]
    
    def get(self, request):
        from .serial_services import get_serial_number_by_code
        from .serializers import SerialNumberSerializer
        
        code = request.query_params.get('code', '').strip()
        if not code:
            return Response({"code": "CODE_REQUIRED", "detail": "Serial number code is required."}, status=400)
        
        serial = get_serial_number_by_code(code)
        if not serial:
            return Response({"code": "SERIAL_NOT_FOUND", "detail": "Serial number not found."}, status=404)
        
        serializer = SerialNumberSerializer(serial)
        return Response(serializer.data)


class WarrantiesExpiringView(APIView):
    """Get warranties expiring within a specified number of days."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get(self, request):
        from .serial_services import get_warranties_expiring_soon
        from .serializers import WarrantyExpiringSerializer
        
        days = int(request.query_params.get('days', 30))
        results = get_warranties_expiring_soon(days=days)
        serializer = WarrantyExpiringSerializer(results, many=True)
        return Response({"results": serializer.data, "days": days})


class WarrantiesExpiredView(APIView):
    """Get warranties that expired within the last N days."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get(self, request):
        from .serial_services import get_expired_warranties
        
        days_ago = int(request.query_params.get('days_ago', 30))
        results = get_expired_warranties(days_ago=days_ago)
        return Response({"results": results, "days_ago": days_ago})


class SerialNumberStatsView(APIView):
    """Get overall statistics for serial number tracking."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def get(self, request):
        from .serial_services import get_serial_number_stats
        
        stats = get_serial_number_stats()
        return Response(stats)


class MarkSerialAsSoldView(APIView):
    """Mark a serial number as sold (used during sale completion)."""
    permission_classes = [IsAuthenticated, IsCashier]
    
    def post(self, request, serial_id):
        from .serial_services import mark_serial_as_sold
        from .serializers import SerialNumberSerializer
        
        sale_line_id = request.data.get('sale_line_id')
        sale_date = request.data.get('sale_date')
        
        if not sale_line_id:
            return Response({"code": "SALE_LINE_REQUIRED", "detail": "sale_line_id is required."}, status=400)
        
        try:
            serial = mark_serial_as_sold(serial_id, sale_line_id, sale_date)
            serializer = SerialNumberSerializer(serial)
            return Response(serializer.data)
        except Exception as e:
            return Response({"code": "ERROR", "detail": str(e)}, status=400)


class MarkSerialAsReturnedView(APIView):
    """Mark a serial number as returned."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def post(self, request, serial_id):
        from .serial_services import mark_serial_as_returned
        from .serializers import SerialNumberSerializer
        
        try:
            serial = mark_serial_as_returned(serial_id)
            serializer = SerialNumberSerializer(serial)
            return Response(serializer.data)
        except Exception as e:
            return Response({"code": "ERROR", "detail": str(e)}, status=400)


class MarkSerialAsDefectiveView(APIView):
    """Mark a serial number as defective."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]
    
    def post(self, request, serial_id):
        from .serial_services import mark_serial_as_defective
        from .serializers import SerialNumberSerializer
        
        notes = request.data.get('notes', '')
        
        try:
            serial = mark_serial_as_defective(serial_id, notes)
            serializer = SerialNumberSerializer(serial)
            return Response(serializer.data)
        except Exception as e:
            return Response({"code": "ERROR", "detail": str(e)}, status=400)
