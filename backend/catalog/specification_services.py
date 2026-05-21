"""
Service functions for product specifications management.
"""
from typing import Dict, Any, Optional, List

from .models import ProductSpecification, Product


def get_or_create_specification(product_id: str) -> ProductSpecification:
    """Get existing specification or create a new one for a product."""
    spec, created = ProductSpecification.objects.get_or_create(
        product_id=product_id,
        defaults={'additional_specs': {}}
    )
    return spec


def update_specification(
    product_id: str,
    capacity: str = None,
    power_consumption: str = None,
    voltage: str = None,
    dimensions: str = None,
    weight: str = None,
    color_options: str = None,
    energy_class: str = None,
    additional_specs: Dict[str, Any] = None
) -> ProductSpecification:
    """
    Update product specifications.
    
    Args:
        product_id: UUID of the product
        capacity: Product capacity (e.g., "330L", "7kg")
        power_consumption: Power consumption (e.g., "150W", "2.5kW")
        voltage: Voltage requirement (e.g., "220V", "110-240V")
        dimensions: Physical dimensions (e.g., "60x65x185cm")
        weight: Product weight (e.g., "65kg")
        color_options: Available colors (e.g., "White, Silver, Black")
        energy_class: Energy efficiency class (e.g., "A++", "A+")
        additional_specs: Additional specifications as key-value pairs
    
    Returns:
        Updated ProductSpecification object
    """
    spec = get_or_create_specification(product_id)
    
    if capacity is not None:
        spec.capacity = capacity
    if power_consumption is not None:
        spec.power_consumption = power_consumption
    if voltage is not None:
        spec.voltage = voltage
    if dimensions is not None:
        spec.dimensions = dimensions
    if weight is not None:
        spec.weight = weight
    if color_options is not None:
        spec.color_options = color_options
    if energy_class is not None:
        spec.energy_class = energy_class
    if additional_specs is not None:
        # Merge with existing additional specs
        current_specs = spec.additional_specs or {}
        current_specs.update(additional_specs)
        spec.additional_specs = current_specs
    
    spec.save()
    return spec


def get_specification(product_id: str) -> Optional[ProductSpecification]:
    """Get product specification by product ID."""
    try:
        return ProductSpecification.objects.select_related('product').get(product_id=product_id)
    except ProductSpecification.DoesNotExist:
        return None


def delete_specification(product_id: str) -> bool:
    """Delete product specification."""
    try:
        spec = ProductSpecification.objects.get(product_id=product_id)
        spec.delete()
        return True
    except ProductSpecification.DoesNotExist:
        return False


def search_by_specification(
    capacity: str = None,
    energy_class: str = None,
    color: str = None,
    min_power: float = None,
    max_power: float = None
) -> List[ProductSpecification]:
    """
    Search products by their specifications.
    
    Args:
        capacity: Filter by capacity (partial match)
        energy_class: Filter by energy class (exact match)
        color: Filter by color options (partial match)
        min_power: Minimum power consumption (requires parsing)
        max_power: Maximum power consumption (requires parsing)
    
    Returns:
        List of ProductSpecification objects matching the criteria
    """
    qs = ProductSpecification.objects.select_related('product__category')
    
    if capacity:
        qs = qs.filter(capacity__icontains=capacity)
    
    if energy_class:
        qs = qs.filter(energy_class__iexact=energy_class)
    
    if color:
        qs = qs.filter(color_options__icontains=color)
    
    # Note: Power filtering would require parsing the power_consumption string
    # This is a simplified implementation
    if min_power or max_power:
        # For now, just filter by presence of power_consumption
        qs = qs.exclude(power_consumption='')
    
    return list(qs)


def get_products_without_specifications() -> List[Product]:
    """Get all products that don't have specifications defined."""
    products_with_specs = ProductSpecification.objects.values_list('product_id', flat=True)
    return list(
        Product.objects.filter(is_active=True)
        .exclude(id__in=products_with_specs)
        .select_related('category')
    )


def bulk_update_specifications(specifications_data: List[Dict[str, Any]]) -> List[ProductSpecification]:
    """
    Bulk update or create specifications for multiple products.
    
    Args:
        specifications_data: List of dicts with product_id and specification fields
    
    Returns:
        List of updated/created ProductSpecification objects
    """
    results = []
    for spec_data in specifications_data:
        product_id = spec_data.pop('product_id')
        spec = update_specification(product_id, **spec_data)
        results.append(spec)
    
    return results


def get_specification_summary() -> Dict[str, Any]:
    """Get summary statistics for product specifications."""
    total_products = Product.objects.filter(is_active=True).count()
    products_with_specs = ProductSpecification.objects.count()
    products_without_specs = total_products - products_with_specs
    
    # Count by energy class
    energy_classes = ProductSpecification.objects.exclude(
        energy_class=''
    ).values_list('energy_class', flat=True)
    
    energy_class_counts = {}
    for ec in energy_classes:
        energy_class_counts[ec] = energy_class_counts.get(ec, 0) + 1
    
    return {
        'total_products': total_products,
        'products_with_specifications': products_with_specs,
        'products_without_specifications': products_without_specs,
        'completion_percentage': round((products_with_specs / total_products * 100) if total_products > 0 else 0, 2),
        'energy_class_distribution': energy_class_counts,
    }


def copy_specification(source_product_id: str, target_product_id: str) -> ProductSpecification:
    """
    Copy specifications from one product to another.
    
    Args:
        source_product_id: Product to copy from
        target_product_id: Product to copy to
    
    Returns:
        Created ProductSpecification for target product
    """
    source_spec = get_specification(source_product_id)
    if not source_spec:
        raise ValueError(f"Source product {source_product_id} has no specifications")
    
    # Delete existing target spec if any
    delete_specification(target_product_id)
    
    # Create new spec with copied data
    target_spec = ProductSpecification.objects.create(
        product_id=target_product_id,
        capacity=source_spec.capacity,
        power_consumption=source_spec.power_consumption,
        voltage=source_spec.voltage,
        dimensions=source_spec.dimensions,
        weight=source_spec.weight,
        color_options=source_spec.color_options,
        energy_class=source_spec.energy_class,
        additional_specs=source_spec.additional_specs.copy() if source_spec.additional_specs else {}
    )
    
    return target_spec
