"""Shared variant text-search filters (barcode, model, brand/category, size, color)."""

from django.db.models import Q


def variant_text_search_q(query: str) -> Q:
    q = (query or "").strip()
    if not q:
        return Q()
    return (
        Q(barcode__icontains=q)
        | Q(product__name_uz__icontains=q)
        | Q(product__name_ru__icontains=q)
        | Q(product__category__name_uz__icontains=q)
        | Q(product__category__name_ru__icontains=q)
        | Q(size__label_uz__icontains=q)
        | Q(size__label_ru__icontains=q)
        | Q(size__value__icontains=q)
        | Q(color__label_uz__icontains=q)
        | Q(color__label_ru__icontains=q)
        | Q(color__value__icontains=q)
    )
