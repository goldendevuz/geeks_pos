"""Shared variant text-search filters (barcode, model, brand/category)."""

from django.db.models import Q


def variant_text_search_q(query: str) -> Q:
    """
    Search variants by barcode, product name, custom name, or brand/category.
    Optimized for home appliance retail (no size/color).
    """
    q = (query or "").strip()
    if not q:
        return Q()
    return (
        Q(barcode__icontains=q)
        | Q(product__name_uz__icontains=q)
        | Q(product__name_ru__icontains=q)
        | Q(product__custom_name_uz__icontains=q)
        | Q(product__custom_name_ru__icontains=q)
        | Q(product__category__name_uz__icontains=q)
        | Q(product__category__name_ru__icontains=q)
    )
