"""Low stock management and aggregation for home appliance inventory."""

from decimal import Decimal
from typing import Any
from django.db.models import Sum, Q, F, Count
from django.db.models.functions import Coalesce

from .models import ProductVariant, Product, Category


def get_low_stock_threshold() -> int:
    """Get configured low stock threshold from settings."""
    from printing.models import StoreSettings
    settings = StoreSettings.get_solo()
    return settings.low_stock_threshold


def get_low_stock_variants(threshold: int | None = None) -> list[dict[str, Any]]:
    """
    Get all variants with stock below threshold.
    
    Args:
        threshold: Stock threshold. If None, uses configured threshold.
        
    Returns:
        List of variant dicts with stock info, sorted by brand/model
    """
    if threshold is None:
        threshold = get_low_stock_threshold()
    
    variants = (
        ProductVariant.objects
        .select_related("product", "product__category")
        .filter(
            stock_qty__lt=threshold,
            is_active=True,
            deleted_at__isnull=True
        )
        .order_by("product__category__name_uz", "product__name_uz", "barcode")
    )
    
    result = []
    for v in variants:
        result.append({
            "variant_id": str(v.id),
            "barcode": v.barcode or "",
            "product_name_uz": v.product.name_uz,
            "product_name_ru": v.product.name_ru,
            "custom_name_uz": v.product.custom_name_uz or "",
            "custom_name_ru": v.product.custom_name_ru or "",
            "category_name_uz": v.product.category.name_uz,
            "category_name_ru": v.product.category.name_ru,
            "stock_qty": v.stock_qty,
            "purchase_price": str(v.purchase_price),
            "list_price": str(v.list_price) if v.list_price else None,
            "threshold": threshold,
        })
    
    return result


def get_low_stock_by_brand(threshold: int | None = None) -> list[dict[str, Any]]:
    """
    Get low stock aggregated by brand (category).
    
    Args:
        threshold: Stock threshold. If None, uses configured threshold.
        
    Returns:
        List of brand dicts with total stock and product count
    """
    if threshold is None:
        threshold = get_low_stock_threshold()
    
    # Get all variants below threshold
    low_stock_variants = (
        ProductVariant.objects
        .filter(
            stock_qty__lt=threshold,
            is_active=True,
            deleted_at__isnull=True
        )
        .values("product__category_id")
        .annotate(
            total_stock=Coalesce(Sum("stock_qty"), 0),
            product_count=Count("product", distinct=True),
            variant_count=Count("id")
        )
    )
    
    result = []
    for item in low_stock_variants:
        category = Category.objects.get(pk=item["product__category_id"])
        result.append({
            "category_id": str(category.id),
            "category_name_uz": category.name_uz,
            "category_name_ru": category.name_ru,
            "total_stock": item["total_stock"],
            "product_count": item["product_count"],
            "variant_count": item["variant_count"],
            "threshold": threshold,
        })
    
    return sorted(result, key=lambda x: x["category_name_uz"])


def get_low_stock_by_model(threshold: int | None = None) -> list[dict[str, Any]]:
    """
    Get low stock aggregated by model (product).
    
    Args:
        threshold: Stock threshold. If None, uses configured threshold.
        
    Returns:
        List of model dicts with total stock and variant count
    """
    if threshold is None:
        threshold = get_low_stock_threshold()
    
    # Get all variants below threshold, grouped by product
    low_stock_variants = (
        ProductVariant.objects
        .filter(
            stock_qty__lt=threshold,
            is_active=True,
            deleted_at__isnull=True
        )
        .values("product_id")
        .annotate(
            total_stock=Coalesce(Sum("stock_qty"), 0),
            variant_count=Count("id")
        )
    )
    
    result = []
    for item in low_stock_variants:
        product = Product.objects.select_related("category").get(pk=item["product_id"])
        result.append({
            "product_id": str(product.id),
            "product_name_uz": product.name_uz,
            "product_name_ru": product.name_ru,
            "custom_name_uz": product.custom_name_uz or "",
            "custom_name_ru": product.custom_name_ru or "",
            "category_name_uz": product.category.name_uz,
            "category_name_ru": product.category.name_ru,
            "total_stock": item["total_stock"],
            "variant_count": item["variant_count"],
            "threshold": threshold,
        })
    
    return sorted(result, key=lambda x: (x["category_name_uz"], x["product_name_uz"]))


def get_low_stock_summary(threshold: int | None = None) -> dict[str, Any]:
    """
    Get comprehensive low stock summary.
    
    Args:
        threshold: Stock threshold. If None, uses configured threshold.
        
    Returns:
        Dict with overall stats and breakdowns
    """
    if threshold is None:
        threshold = get_low_stock_threshold()
    
    variants = get_low_stock_variants(threshold)
    by_brand = get_low_stock_by_brand(threshold)
    by_model = get_low_stock_by_model(threshold)
    
    total_stock = sum(v["stock_qty"] for v in variants)
    
    return {
        "threshold": threshold,
        "total_low_stock_variants": len(variants),
        "total_low_stock_quantity": total_stock,
        "brands_affected": len(by_brand),
        "models_affected": len(by_model),
        "by_brand": by_brand,
        "by_model": by_model,
        "variants": variants,
    }
