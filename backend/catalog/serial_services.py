"""
Service functions for serial number and warranty tracking.
"""
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Dict, Any, Optional

from django.db.models import Q, Count, F
from django.utils import timezone

from .models import SerialNumber, ProductVariant


def get_available_serial_numbers(variant_id: str) -> List[SerialNumber]:
    """Get all available (in stock) serial numbers for a variant."""
    return list(
        SerialNumber.objects.filter(
            variant_id=variant_id,
            status=SerialNumber.Status.IN_STOCK
        ).select_related('variant__product__category')
    )


def get_serial_number_by_code(serial_code: str) -> Optional[SerialNumber]:
    """Find a serial number by its code."""
    try:
        return SerialNumber.objects.select_related(
            'variant__product__category',
            'sale_line__sale'
        ).get(serial_number=serial_code)
    except SerialNumber.DoesNotExist:
        return None


def mark_serial_as_sold(serial_id: str, sale_line_id: str, sale_date: date = None) -> SerialNumber:
    """Mark a serial number as sold and calculate warranty expiry."""
    serial = SerialNumber.objects.get(id=serial_id)
    serial.status = SerialNumber.Status.SOLD
    serial.sale_line_id = sale_line_id
    serial.sale_date = sale_date or timezone.now().date()
    serial.calculate_warranty_expiry()
    serial.save()
    return serial


def mark_serial_as_returned(serial_id: str) -> SerialNumber:
    """Mark a serial number as returned (back in stock)."""
    serial = SerialNumber.objects.get(id=serial_id)
    serial.status = SerialNumber.Status.RETURNED
    serial.save()
    return serial


def mark_serial_as_defective(serial_id: str, notes: str = "") -> SerialNumber:
    """Mark a serial number as defective."""
    serial = SerialNumber.objects.get(id=serial_id)
    serial.status = SerialNumber.Status.DEFECTIVE
    if notes:
        serial.notes = f"{serial.notes}\n{notes}" if serial.notes else notes
    serial.save()
    return serial


def get_warranties_expiring_soon(days: int = 30) -> List[Dict[str, Any]]:
    """
    Get serial numbers with warranties expiring within the specified number of days.
    
    Args:
        days: Number of days to look ahead (default 30)
    
    Returns:
        List of dicts with serial number and warranty information
    """
    today = timezone.now().date()
    expiry_threshold = today + timedelta(days=days)
    
    serials = SerialNumber.objects.filter(
        status=SerialNumber.Status.SOLD,
        warranty_expiry_date__isnull=False,
        warranty_expiry_date__gte=today,
        warranty_expiry_date__lte=expiry_threshold
    ).select_related(
        'variant__product__category'
    ).order_by('warranty_expiry_date')
    
    results = []
    for serial in serials:
        days_until_expiry = (serial.warranty_expiry_date - today).days
        results.append({
            'serial_number_id': str(serial.id),
            'serial_number': serial.serial_number,
            'variant_id': str(serial.variant.id),
            'variant_barcode': serial.variant.barcode,
            'product_name_uz': serial.variant.product.name_uz,
            'product_name_ru': serial.variant.product.name_ru,
            'category_name_uz': serial.variant.product.category.name_uz,
            'sale_date': serial.sale_date,
            'warranty_expiry_date': serial.warranty_expiry_date,
            'days_until_expiry': days_until_expiry,
        })
    
    return results


def get_expired_warranties(days_ago: int = 30) -> List[Dict[str, Any]]:
    """
    Get serial numbers with warranties that expired within the last N days.
    
    Args:
        days_ago: Number of days to look back (default 30)
    
    Returns:
        List of dicts with serial number and warranty information
    """
    today = timezone.now().date()
    expiry_threshold = today - timedelta(days=days_ago)
    
    serials = SerialNumber.objects.filter(
        status=SerialNumber.Status.SOLD,
        warranty_expiry_date__isnull=False,
        warranty_expiry_date__lt=today,
        warranty_expiry_date__gte=expiry_threshold
    ).select_related(
        'variant__product__category'
    ).order_by('-warranty_expiry_date')
    
    results = []
    for serial in serials:
        days_since_expiry = (today - serial.warranty_expiry_date).days
        results.append({
            'serial_number_id': str(serial.id),
            'serial_number': serial.serial_number,
            'variant_id': str(serial.variant.id),
            'variant_barcode': serial.variant.barcode,
            'product_name_uz': serial.variant.product.name_uz,
            'product_name_ru': serial.variant.product.name_ru,
            'category_name_uz': serial.variant.product.category.name_uz,
            'sale_date': serial.sale_date,
            'warranty_expiry_date': serial.warranty_expiry_date,
            'days_since_expiry': days_since_expiry,
        })
    
    return results


def get_serial_number_stats() -> Dict[str, Any]:
    """Get overall statistics for serial number tracking."""
    total = SerialNumber.objects.count()
    by_status = SerialNumber.objects.values('status').annotate(count=Count('id'))
    
    today = timezone.now().date()
    under_warranty = SerialNumber.objects.filter(
        status=SerialNumber.Status.SOLD,
        warranty_expiry_date__isnull=False,
        warranty_expiry_date__gte=today
    ).count()
    
    expired_warranty = SerialNumber.objects.filter(
        status=SerialNumber.Status.SOLD,
        warranty_expiry_date__isnull=False,
        warranty_expiry_date__lt=today
    ).count()
    
    return {
        'total_serial_numbers': total,
        'by_status': {item['status']: item['count'] for item in by_status},
        'under_warranty': under_warranty,
        'expired_warranty': expired_warranty,
    }


def bulk_create_serial_numbers(
    variant_id: str,
    serial_numbers: List[str],
    warranty_months: int = 12,
    purchase_date: Optional[date] = None,
    user_id: Optional[str] = None
) -> List[SerialNumber]:
    """
    Create multiple serial numbers for a variant at once.
    
    Args:
        variant_id: UUID of the product variant
        serial_numbers: List of serial number strings
        warranty_months: Warranty period in months (default 12)
        purchase_date: Date purchased from supplier
        user_id: User creating the serial numbers
    
    Returns:
        List of created SerialNumber objects
    """
    variant = ProductVariant.objects.get(id=variant_id)
    
    serial_objects = []
    for serial_code in serial_numbers:
        serial_obj = SerialNumber(
            variant=variant,
            serial_number=serial_code.strip(),
            warranty_months=warranty_months,
            purchase_date=purchase_date,
            status=SerialNumber.Status.IN_STOCK,
            created_by_id=user_id
        )
        serial_objects.append(serial_obj)
    
    # Bulk create for efficiency
    created = SerialNumber.objects.bulk_create(serial_objects, ignore_conflicts=True)
    return created


def search_serial_numbers(
    query: str = None,
    status: str = None,
    variant_id: str = None,
    product_id: str = None,
    category_id: str = None,
    warranty_status: str = None  # 'active', 'expiring', 'expired'
) -> List[SerialNumber]:
    """
    Search serial numbers with various filters.
    
    Args:
        query: Search in serial number or product name
        status: Filter by status (IN_STOCK, SOLD, RETURNED, DEFECTIVE)
        variant_id: Filter by variant
        product_id: Filter by product
        category_id: Filter by category (brand)
        warranty_status: Filter by warranty status (active, expiring, expired)
    
    Returns:
        Filtered queryset of SerialNumber objects
    """
    qs = SerialNumber.objects.select_related(
        'variant__product__category',
        'sale_line__sale'
    )
    
    if query:
        qs = qs.filter(
            Q(serial_number__icontains=query) |
            Q(variant__product__name_uz__icontains=query) |
            Q(variant__product__name_ru__icontains=query) |
            Q(variant__barcode__icontains=query)
        )
    
    if status:
        qs = qs.filter(status=status)
    
    if variant_id:
        qs = qs.filter(variant_id=variant_id)
    
    if product_id:
        qs = qs.filter(variant__product_id=product_id)
    
    if category_id:
        qs = qs.filter(variant__product__category_id=category_id)
    
    if warranty_status:
        today = timezone.now().date()
        if warranty_status == 'active':
            qs = qs.filter(
                warranty_expiry_date__isnull=False,
                warranty_expiry_date__gte=today
            )
        elif warranty_status == 'expiring':
            expiry_threshold = today + timedelta(days=30)
            qs = qs.filter(
                warranty_expiry_date__isnull=False,
                warranty_expiry_date__gte=today,
                warranty_expiry_date__lte=expiry_threshold
            )
        elif warranty_status == 'expired':
            qs = qs.filter(
                warranty_expiry_date__isnull=False,
                warranty_expiry_date__lt=today
            )
    
    return list(qs.order_by('-created_at'))
