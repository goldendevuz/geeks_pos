from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time
from decimal import Decimal, ROUND_HALF_UP

from django.contrib.auth import get_user_model
from django.db.models import Count, DecimalField, ExpressionWrapper, F, Sum
from django.utils import timezone

from catalog.models import ProductVariant
from debt.models import Debt
from inventory.models import InventoryMovement
from sales.models import Payment, Sale, SaleLine, SaleRefund

ROUND_UNIT = Decimal("1")


def q_money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(ROUND_UNIT, rounding=ROUND_HALF_UP)


def _refund_sums(*, from_date: str | None = None, to_date: str | None = None, sale_ids=None):
    qs = SaleRefund.objects.all()
    if sale_ids is not None:
        qs = qs.filter(sale_id__in=sale_ids)
    if from_date:
        qs = qs.filter(created_at__date__gte=from_date)
    if to_date:
        qs = qs.filter(created_at__date__lte=to_date)
    cash = q_money(qs.filter(method=SaleRefund.Method.CASH).aggregate(t=Sum("amount"))["t"])
    card = q_money(qs.filter(method=SaleRefund.Method.CARD).aggregate(t=Sum("amount"))["t"])
    debt = q_money(qs.filter(method=SaleRefund.Method.DEBT).aggregate(t=Sum("amount"))["t"])
    total = q_money(cash + card + debt)
    return {"cash": cash, "card": card, "debt": debt, "total": total}


def _refund_sums_for_date(day):
    qs = SaleRefund.objects.filter(created_at__date=day)
    cash = q_money(qs.filter(method=SaleRefund.Method.CASH).aggregate(t=Sum("amount"))["t"])
    card = q_money(qs.filter(method=SaleRefund.Method.CARD).aggregate(t=Sum("amount"))["t"])
    debt = q_money(qs.filter(method=SaleRefund.Method.DEBT).aggregate(t=Sum("amount"))["t"])
    return cash, card, debt


def _merchandise_return_movements_qs(**filters):
    """Vozvrat (Partial return) — void restock va bekor qilingan chek harakatlarini hisobga olmaydi."""
    qs = InventoryMovement.objects.filter(type=InventoryMovement.Type.RETURN, **filters)
    qs = qs.exclude(note__startswith="Void sale restock").exclude(note__startswith="Void remaining restock")
    return qs.exclude(ref_sale__status=Sale.Status.VOIDED)


def _returned_amounts_from_movement_rows(movements: list[dict]) -> tuple[Decimal, Decimal]:
    """Qaytgan tushum — compute_return_amount bilan bir xil (chek chegirmasi); COGS — o‘rtacha tannarx."""
    from sales.models import Sale as SaleModel
    from sales.refund_utils import compute_return_amount

    returned_total_raw = Decimal("0")
    returned_cogs_raw = Decimal("0")
    if not movements:
        return returned_total_raw, returned_cogs_raw

    qty_by_key: dict[tuple[str, str], int] = defaultdict(int)
    for m in movements:
        sid = m.get("ref_sale_id")
        vid = m.get("variant_id")
        if not sid or not vid:
            continue
        key = (str(sid), str(vid))
        qty_by_key[key] += max(int(m.get("qty_delta") or 0), 0)

    sale_ids = {sid for sid, _ in qty_by_key}
    weighted_purchase_unit: dict[tuple[str, str], Decimal] = {}
    if sale_ids:
        acc = defaultdict(lambda: {"sum_purchase": Decimal("0"), "sum_qty": 0})
        for ln in SaleLine.objects.filter(sale_id__in=sale_ids).values(
            "sale_id", "variant_id", "qty", "purchase_unit_cost"
        ):
            qty_ln = int(ln["qty"] or 0)
            if qty_ln <= 0:
                continue
            k = (str(ln["sale_id"]), str(ln["variant_id"]))
            acc[k]["sum_purchase"] += Decimal(str(ln["purchase_unit_cost"] or 0)) * qty_ln
            acc[k]["sum_qty"] += qty_ln
        for k, v in acc.items():
            if v["sum_qty"] > 0:
                weighted_purchase_unit[k] = v["sum_purchase"] / Decimal(v["sum_qty"])

    for key, qty_ret in qty_by_key.items():
        if qty_ret <= 0:
            continue
        returned_cogs_raw += weighted_purchase_unit.get(key, Decimal("0")) * Decimal(qty_ret)

    lines_by_sale: dict[str, list[dict]] = defaultdict(list)
    for (sid, vid), qty in qty_by_key.items():
        if qty <= 0:
            continue
        lines_by_sale[sid].append({"variant_id": vid, "qty": qty})

    for sid, lines in lines_by_sale.items():
        try:
            sale = SaleModel.objects.prefetch_related("lines").get(pk=sid)
        except SaleModel.DoesNotExist:
            continue
        returned_total_raw += compute_return_amount(sale=sale, lines=lines)

    return returned_total_raw, returned_cogs_raw


def sales_metrics(*, from_date: str | None = None, to_date: str | None = None):
    completed = Sale.objects.select_related("cashier").filter(status=Sale.Status.COMPLETED)
    voided = Sale.objects.select_related("cashier").filter(status=Sale.Status.VOIDED)
    if from_date:
        completed = completed.filter(completed_at__date__gte=from_date)
        voided = voided.filter(completed_at__date__gte=from_date)
    if to_date:
        completed = completed.filter(completed_at__date__lte=to_date)
        voided = voided.filter(completed_at__date__lte=to_date)

    sales_count = completed.count()
    sales_amount = q_money(completed.aggregate(total=Sum("grand_total"))["total"])
    total_discounts = q_money(completed.aggregate(total=Sum("discount_total"))["total"])

    cogs_raw = SaleLine.objects.filter(sale__in=completed).aggregate(
        t=Sum(
            ExpressionWrapper(
                F("qty") * F("purchase_unit_cost"),
                output_field=DecimalField(max_digits=18, decimal_places=2),
            )
        )
    )["t"]
    cogs_total = q_money(cogs_raw)

    today = timezone.localdate()
    today_completed = Sale.objects.filter(status=Sale.Status.COMPLETED, completed_at__date=today)
    today_sales_amount = q_money(today_completed.aggregate(total=Sum("grand_total"))["total"])
    today_cash_in = q_money(
        Payment.objects.filter(sale__in=today_completed, method=Payment.Method.CASH).aggregate(total=Sum("amount"))["total"]
    )
    today_card_in = q_money(
        Payment.objects.filter(sale__in=today_completed, method=Payment.Method.CARD).aggregate(total=Sum("amount"))["total"]
    )
    today_debt_in = q_money(
        Payment.objects.filter(sale__in=today_completed, method=Payment.Method.DEBT).aggregate(total=Sum("amount"))["total"]
    )
    today_refund_cash, today_refund_card, today_refund_debt = _refund_sums_for_date(today)
    today_cash_total = q_money(today_cash_in - today_refund_cash)
    today_card_total = q_money(today_card_in - today_refund_card)
    today_debt_total = q_money(today_debt_in - today_refund_debt)
    avg_check = q_money((sales_amount / sales_count) if sales_count else 0)
    void_count = voided.count()
    return_filters: dict = {}
    if from_date:
        return_filters["created_at__date__gte"] = from_date
    if to_date:
        return_filters["created_at__date__lte"] = to_date
    return_movements = _merchandise_return_movements_qs(**return_filters)
    returned_count = return_movements.values("ref_sale_id").distinct().count()
    movements = list(return_movements.values("ref_sale_id", "variant_id", "qty_delta"))
    returned_total_raw, returned_cogs_raw = _returned_amounts_from_movement_rows(movements)
    returned_total = q_money(returned_total_raw)
    returned_cogs = q_money(returned_cogs_raw)
    # Qaytarishlar marjadan ayiriladi: (qaytgan tushum − qaytgan tannarx).
    gross_profit = q_money(
        Decimal(str(sales_amount))
        - Decimal(str(cogs_total))
        - returned_total_raw
        + returned_cogs_raw
    )

    cash_in = q_money(
        Payment.objects.filter(sale__in=completed, method=Payment.Method.CASH).aggregate(total=Sum("amount"))["total"]
    )
    card_in = q_money(
        Payment.objects.filter(sale__in=completed, method=Payment.Method.CARD).aggregate(total=Sum("amount"))["total"]
    )
    debt_in = q_money(
        Payment.objects.filter(sale__in=completed, method=Payment.Method.DEBT).aggregate(total=Sum("amount"))["total"]
    )
    period_refunds = _refund_sums(from_date=from_date, to_date=to_date)
    cash_total = q_money(cash_in - period_refunds["cash"])
    card_total = q_money(card_in - period_refunds["card"])
    debt_total = q_money(debt_in - period_refunds["debt"])
    refund_total = period_refunds["total"]

    top_cashiers = (
        completed.values("cashier__username")
        .annotate(total_sales=Count("id"), total_amount=Sum("grand_total"))
        .order_by("-total_amount")[:5]
    )

    open_debts = Debt.objects.filter(status=Debt.Status.OPEN)
    open_debt_count = open_debts.count()
    open_debt_total = q_money(open_debts.aggregate(total=Sum("remaining_amount"))["total"])

    inventory_qs = ProductVariant.objects.filter(deleted_at__isnull=True)
    inventory_items = inventory_qs.aggregate(total=Sum("stock_qty"))["total"] or 0
    inventory_purchase_value = q_money(
        inventory_qs.aggregate(
            total=Sum(
                ExpressionWrapper(
                    F("stock_qty") * F("purchase_price"),
                    output_field=DecimalField(max_digits=16, decimal_places=2),
                )
            )
        )["total"]
    )
    inventory_sale_value = q_money(
        inventory_qs.aggregate(
            total=Sum(
                ExpressionWrapper(
                    F("stock_qty") * F("list_price"),
                    output_field=DecimalField(max_digits=16, decimal_places=2),
                )
            )
        )["total"]
    )

    sold_lines = SaleLine.objects.select_related("variant__product__category", "sale").filter(
        sale__status=Sale.Status.COMPLETED
    )
    if from_date:
        sold_lines = sold_lines.filter(sale__completed_at__date__gte=from_date)
    if to_date:
        sold_lines = sold_lines.filter(sale__completed_at__date__lte=to_date)
    top_products = (
        sold_lines.values("variant__product__name_uz")
        .annotate(total_qty=Sum("qty"), total_sales=Sum("line_total"))
        .order_by("-total_qty")[:5]
    )
    top_brands = (
        sold_lines.values("variant__product__category__name_uz")
        .annotate(total_qty=Sum("qty"), total_sales=Sum("line_total"))
        .order_by("-total_qty")[:5]
    )
    low_products = (
        sold_lines.values("variant__product__name_uz")
        .annotate(total_qty=Sum("qty"))
        .order_by("total_qty")[:5]
    )
    low_brands = (
        sold_lines.values("variant__product__category__name_uz")
        .annotate(total_qty=Sum("qty"))
        .order_by("total_qty")[:5]
    )

    # --- Today's operational KPI (cards) ---
    today_sales_count = today_completed.count()
    today_items_sold_qty = int(
        SaleLine.objects.filter(sale__in=today_completed).aggregate(total=Sum("qty"))["total"] or 0
    )

    mv_return_today = _merchandise_return_movements_qs(created_at__date=today)
    today_return_move_count = mv_return_today.count()
    today_return_qty = sum(max(int(q or 0), 0) for q in mv_return_today.values_list("qty_delta", flat=True))

    today_void_count = Sale.objects.filter(status=Sale.Status.VOIDED, completed_at__date=today).count()

    from expenses.models import ShopExpense

    exp_qs = ShopExpense.objects.all()
    if from_date:
        exp_qs = exp_qs.filter(recorded_at__date__gte=from_date)
    if to_date:
        exp_qs = exp_qs.filter(recorded_at__date__lte=to_date)
    expense_total = q_money(exp_qs.aggregate(t=Sum("amount"))["t"])
    today_expense_total = q_money(
        ShopExpense.objects.filter(recorded_at__date=today).aggregate(t=Sum("amount"))["t"]
    )

    today_cogs_raw = SaleLine.objects.filter(sale__in=today_completed).aggregate(
        t=Sum(
            ExpressionWrapper(
                F("qty") * F("purchase_unit_cost"),
                output_field=DecimalField(max_digits=18, decimal_places=2),
            )
        )
    )["t"]
    today_cogs_total = q_money(today_cogs_raw)
    today_return_rows = list(mv_return_today.values("ref_sale_id", "variant_id", "qty_delta"))
    today_returned_total_raw, today_returned_cogs_raw = _returned_amounts_from_movement_rows(today_return_rows)
    today_gross_profit = q_money(
        Decimal(str(today_sales_amount))
        - Decimal(str(today_cogs_total))
        - today_returned_total_raw
        + today_returned_cogs_raw
    )
    today_operating_profit = q_money(today_gross_profit - today_expense_total)

    operating_profit = q_money(gross_profit - expense_total)
    net_sales_approx = q_money(sales_amount - returned_total)

    return {
        "sales_count": sales_count,
        "sales_amount": sales_amount,
        "today_sales_amount": today_sales_amount,
        "today_cash_total": today_cash_total,
        "today_card_total": today_card_total,
        "today_debt_total": today_debt_total,
        "today_refund_cash": today_refund_cash,
        "today_refund_card": today_refund_card,
        "today_refund_total": q_money(today_refund_cash + today_refund_card + today_refund_debt),
        "refund_total": refund_total,
        "today_sales_count": today_sales_count,
        "today_items_sold_qty": today_items_sold_qty,
        "today_return_move_count": today_return_move_count,
        "today_return_qty": today_return_qty,
        "today_void_count": today_void_count,
        "expense_total": expense_total,
        "today_expense_total": today_expense_total,
        "today_gross_profit": today_gross_profit,
        "today_operating_profit": today_operating_profit,
        "void_count": void_count,
        "avg_check": avg_check,
        "gross_profit": gross_profit,
        "total_discounts": total_discounts,
        "open_debt_count": open_debt_count,
        "open_debt_total": open_debt_total,
        "returned_count": returned_count,
        "returned_total": returned_total,
        "returned_cogs": returned_cogs,
        "cash_total": cash_total,
        "card_total": card_total,
        "debt_total": debt_total,
        "date": str(today),
        "top_cashiers": [
            {
                "cashier": row["cashier__username"] or "-",
                "sales_count": row["total_sales"],
                "sales_amount": q_money(row["total_amount"]),
            }
            for row in top_cashiers
        ],
        "inventory_items": int(inventory_items),
        "inventory_purchase_value": inventory_purchase_value,
        "inventory_sale_value": inventory_sale_value,
        "turnover_amount": sales_amount,
        "net_profit": operating_profit,
        "operating_profit": operating_profit,
        "net_sales_approx": net_sales_approx,
        "top_products": [
            {
                "name": row["variant__product__name_uz"] or "-",
                "qty": int(row["total_qty"] or 0),
                "sales_amount": q_money(row["total_sales"]),
            }
            for row in top_products
        ],
        "top_brands": [
            {
                "name": row["variant__product__category__name_uz"] or "-",
                "qty": int(row["total_qty"] or 0),
                "sales_amount": q_money(row["total_sales"]),
            }
            for row in top_brands
        ],
        "low_products": [
            {"name": row["variant__product__name_uz"] or "-", "qty": int(row["total_qty"] or 0)}
            for row in low_products
        ],
        "low_brands": [
            {"name": row["variant__product__category__name_uz"] or "-", "qty": int(row["total_qty"] or 0)}
            for row in low_brands
        ],
    }


def cashier_x_report_metrics(*, cashier_id, from_dt, to_dt):
    """
    Interim (X-style) totals for one cashier between datetimes (completed sales only).
    """
    User = get_user_model()
    try:
        cashier = User.objects.get(pk=cashier_id)
    except User.DoesNotExist:
        return None
    completed = Sale.objects.filter(
        status=Sale.Status.COMPLETED,
        cashier=cashier,
        completed_at__gte=from_dt,
        completed_at__lte=to_dt,
    )
    sales_count = completed.count()
    sales_amount = q_money(completed.aggregate(total=Sum("grand_total"))["total"])
    total_discounts = q_money(completed.aggregate(total=Sum("discount_total"))["total"])
    cash_in = q_money(
        Payment.objects.filter(sale__in=completed, method=Payment.Method.CASH).aggregate(total=Sum("amount"))["total"]
    )
    card_in = q_money(
        Payment.objects.filter(sale__in=completed, method=Payment.Method.CARD).aggregate(total=Sum("amount"))["total"]
    )
    debt_in = q_money(
        Payment.objects.filter(sale__in=completed, method=Payment.Method.DEBT).aggregate(total=Sum("amount"))["total"]
    )
    x_refunds = SaleRefund.objects.filter(
        sale__in=completed,
        created_at__gte=from_dt,
        created_at__lte=to_dt,
    )
    refund_cash = q_money(x_refunds.filter(method=SaleRefund.Method.CASH).aggregate(t=Sum("amount"))["t"])
    refund_card = q_money(x_refunds.filter(method=SaleRefund.Method.CARD).aggregate(t=Sum("amount"))["t"])
    refund_debt = q_money(x_refunds.filter(method=SaleRefund.Method.DEBT).aggregate(t=Sum("amount"))["t"])
    cash_total = q_money(cash_in - refund_cash)
    card_total = q_money(card_in - refund_card)
    debt_total = q_money(debt_in - refund_debt)
    avg_check = q_money((sales_amount / sales_count) if sales_count else 0)

    xcogs_raw = SaleLine.objects.filter(sale__in=completed).aggregate(
        t=Sum(
            ExpressionWrapper(
                F("qty") * F("purchase_unit_cost"),
                output_field=DecimalField(max_digits=18, decimal_places=2),
            )
        )
    )["t"]
    xcogs_total = q_money(xcogs_raw)
    completed_ids = list(completed.values_list("id", flat=True))
    x_movements = list(
        _merchandise_return_movements_qs(
            ref_sale_id__in=completed_ids,
            created_at__gte=from_dt,
            created_at__lte=to_dt,
        ).values("ref_sale_id", "variant_id", "qty_delta")
    )
    x_ret_total_raw, x_ret_cogs_raw = _returned_amounts_from_movement_rows(x_movements)
    x_gross_profit = q_money(
        Decimal(str(sales_amount)) - Decimal(str(xcogs_total)) - x_ret_total_raw + x_ret_cogs_raw
    )

    return {
        "cashier_username": cashier.username or "",
        "sales_count": sales_count,
        "sales_amount": str(sales_amount),
        "total_discounts": str(total_discounts),
        "cash_total": str(cash_total),
        "card_total": str(card_total),
        "debt_total": str(debt_total),
        "refund_cash": str(refund_cash),
        "refund_card": str(refund_card),
        "refund_debt": str(refund_debt),
        "refund_total": str(q_money(refund_cash + refund_card + refund_debt)),
        "avg_check": str(avg_check),
        "gross_profit": str(x_gross_profit),
        "range": {
            "from": timezone.localtime(from_dt).isoformat(),
            "to": timezone.localtime(to_dt).isoformat(),
        },
    }


def default_shift_window():
    """Local calendar day [00:00, now] as aware datetimes."""
    tz = timezone.get_current_timezone()
    today = timezone.localdate()
    start = timezone.make_aware(datetime.combine(today, time.min), tz)
    end = timezone.now()
    return start, end
