"""Expense management and shift integration services."""

from decimal import Decimal
from typing import Any
from django.db.models import Sum
from django.db.models.functions import Coalesce

from .models import ShopExpense, Shift


def get_shift_expenses_total(shift_id: str) -> Decimal:
    """
    Calculate total expenses for a shift.
    
    Args:
        shift_id: UUID of the shift
        
    Returns:
        Total expense amount for the shift
    """
    total = (
        ShopExpense.objects
        .filter(related_shift_id=shift_id)
        .aggregate(total=Coalesce(Sum("amount"), Decimal("0")))["total"]
    )
    return Decimal(str(total))


def get_shift_expenses_by_category(shift_id: str) -> dict[str, Decimal]:
    """
    Get expense breakdown by category for a shift.
    
    Args:
        shift_id: UUID of the shift
        
    Returns:
        Dict mapping category to total amount
    """
    expenses = (
        ShopExpense.objects
        .filter(related_shift_id=shift_id)
        .values("category")
        .annotate(total=Coalesce(Sum("amount"), Decimal("0")))
    )
    
    result = {}
    for exp in expenses:
        result[exp["category"]] = Decimal(str(exp["total"]))
    
    return result


def get_shift_summary(shift_id: str) -> dict[str, Any]:
    """
    Get comprehensive shift summary including cash and expenses.
    
    Args:
        shift_id: UUID of the shift
        
    Returns:
        Dict with shift info, cash totals, and expense breakdown
    """
    try:
        shift = Shift.objects.get(pk=shift_id)
    except Shift.DoesNotExist:
        return {"error": "Shift not found"}
    
    expenses_total = get_shift_expenses_total(shift_id)
    expenses_by_category = get_shift_expenses_by_category(shift_id)
    
    # Calculate expected closing cash
    # closing_cash = opening_cash + cash_sales - expenses
    # (Note: cash_sales would come from sales module)
    
    return {
        "shift_id": str(shift.id),
        "cashier_username": shift.cashier.username,
        "opened_at": shift.opened_at.isoformat(),
        "closed_at": shift.closed_at.isoformat() if shift.closed_at else None,
        "status": shift.status,
        "opening_cash": str(shift.opening_cash),
        "closing_cash": str(shift.closing_cash) if shift.closing_cash else None,
        "expenses_total": str(expenses_total),
        "expenses_by_category": {k: str(v) for k, v in expenses_by_category.items()},
        "note": shift.note,
    }


def get_all_shifts_summary(limit: int = 10) -> list[dict[str, Any]]:
    """
    Get summary of recent shifts.
    
    Args:
        limit: Number of recent shifts to return
        
    Returns:
        List of shift summaries
    """
    shifts = Shift.objects.order_by("-opened_at")[:limit]
    
    result = []
    for shift in shifts:
        expenses_total = get_shift_expenses_total(str(shift.id))
        result.append({
            "shift_id": str(shift.id),
            "cashier_username": shift.cashier.username,
            "opened_at": shift.opened_at.isoformat(),
            "closed_at": shift.closed_at.isoformat() if shift.closed_at else None,
            "status": shift.status,
            "opening_cash": str(shift.opening_cash),
            "closing_cash": str(shift.closing_cash) if shift.closing_cash else None,
            "expenses_total": str(expenses_total),
        })
    
    return result
