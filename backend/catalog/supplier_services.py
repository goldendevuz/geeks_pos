"""Business logic for supplier debt tracking and management."""

from decimal import Decimal
from typing import Optional
from django.db.models import Sum, DecimalField, Q
from django.db.models.functions import Coalesce

from .models import Supplier, SupplierTransaction


def get_supplier_balance(supplier_id: str) -> dict[str, Decimal]:
    """
    Calculate total debt and credit for a supplier.
    
    Args:
        supplier_id: UUID of the supplier
        
    Returns:
        Dictionary with keys: total_debt, total_credit, balance
        balance = total_debt - total_credit (positive means debt owed to supplier)
    """
    supplier = Supplier.objects.filter(id=supplier_id).first()
    if not supplier:
        return {"total_debt": Decimal("0"), "total_credit": Decimal("0"), "balance": Decimal("0")}
    
    # Calculate debt (purchases and unpaid)
    debt_sum = (
        SupplierTransaction.objects
        .filter(
            supplier_id=supplier_id,
            type__in=[SupplierTransaction.Type.PURCHASE, SupplierTransaction.Type.CREDIT_MEMO]
        )
        .aggregate(total=Coalesce(Sum("amount"), Decimal("0"), output_field=DecimalField()))
    )["total"]
    
    # Calculate credit (payments and returns)
    credit_sum = (
        SupplierTransaction.objects
        .filter(
            supplier_id=supplier_id,
            type__in=[SupplierTransaction.Type.PAYMENT, SupplierTransaction.Type.RETURN]
        )
        .aggregate(total=Coalesce(Sum("amount"), Decimal("0"), output_field=DecimalField()))
    )["total"]
    
    balance = debt_sum - credit_sum
    
    return {
        "total_debt": debt_sum,
        "total_credit": credit_sum,
        "balance": balance,
    }


def get_all_suppliers_balance() -> list[dict]:
    """
    Get balance summary for all active suppliers.
    
    Returns:
        List of dictionaries with supplier info and balance totals
    """
    suppliers = Supplier.objects.filter(is_active=True)
    results = []
    
    for supplier in suppliers:
        balance_info = get_supplier_balance(str(supplier.id))
        results.append({
            "supplier_id": supplier.id,
            "supplier_name_uz": supplier.name_uz,
            "supplier_name_ru": supplier.name_ru,
            "total_debt": balance_info["total_debt"],
            "total_credit": balance_info["total_credit"],
            "balance": balance_info["balance"],
        })
    
    # Sort by balance (most debt first)
    results.sort(key=lambda x: x["balance"], reverse=True)
    return results


def record_supplier_transaction(
    supplier_id: str,
    transaction_type: str,
    amount: Decimal,
    description_uz: str = "",
    description_ru: str = "",
    note: str = "",
    recorded_by=None
) -> Optional[SupplierTransaction]:
    """
    Create a new supplier transaction.
    
    Args:
        supplier_id: UUID of supplier
        transaction_type: One of PURCHASE, PAYMENT, RETURN, CREDIT_MEMO
        amount: Transaction amount
        description_uz: Description in Uzbek
        description_ru: Description in Russian
        note: Additional notes
        recorded_by: User who recorded the transaction
        
    Returns:
        Created SupplierTransaction or None if supplier not found
    """
    supplier = Supplier.objects.filter(id=supplier_id).first()
    if not supplier:
        return None
    
    transaction = SupplierTransaction.objects.create(
        supplier=supplier,
        type=transaction_type,
        amount=amount,
        description_uz=description_uz,
        description_ru=description_ru,
        note=note,
        recorded_by=recorded_by,
    )
    
    return transaction


def get_supplier_transaction_history(supplier_id: str, limit: int = 100) -> list[SupplierTransaction]:
    """Get recent transaction history for a supplier."""
    return SupplierTransaction.objects.filter(
        supplier_id=supplier_id
    ).order_by("-created_at")[:limit]
