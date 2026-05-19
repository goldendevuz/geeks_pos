from decimal import Decimal

from rest_framework import serializers

from .models import Sale


class SaleLineInSerializer(serializers.Serializer):
    variant_id = serializers.UUIDField()
    qty = serializers.IntegerField(min_value=1)
    line_discount = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        required=False,
        default=Decimal("0"),
    )


class PaymentInSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=["CASH", "CARD", "DEBT"])
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)


class CustomerInSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    name = serializers.CharField(required=False, allow_blank=True)
    phone_normalized = serializers.CharField(required=False, allow_blank=True)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class CompleteSaleSerializer(serializers.Serializer):
    lines = SaleLineInSerializer(many=True)
    payments = PaymentInSerializer(many=True)
    order_discount = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, default=Decimal("0")
    )
    expected_grand_total = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False
    )
    customer = CustomerInSerializer(required=False, allow_null=True)
    debt_due_date = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class SaleHistorySerializer(serializers.ModelSerializer):
    cashier_username = serializers.CharField(source="cashier.username", read_only=True)
    return_status = serializers.SerializerMethodField()
    refund_total = serializers.SerializerMethodField()
    can_void = serializers.SerializerMethodField()

    class Meta:
        model = Sale
        fields = [
            "id",
            "public_sale_no",
            "status",
            "cashier_username",
            "completed_at",
            "subtotal",
            "discount_total",
            "grand_total",
            "return_status",
            "refund_total",
            "can_void",
        ]

    def _meta_for(self, obj: Sale) -> dict:
        meta_map = self.context.get("return_meta") or {}
        return meta_map.get(str(obj.id), {})

    def get_return_status(self, obj: Sale) -> str:
        return self._meta_for(obj).get("return_status", "none")

    def get_refund_total(self, obj: Sale) -> str:
        return self._meta_for(obj).get("refund_total", "0")

    def get_can_void(self, obj: Sale) -> bool:
        if obj.status == Sale.Status.VOIDED:
            return False
        return bool(self._meta_for(obj).get("can_void", obj.status == Sale.Status.COMPLETED))


class VoidSaleSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class ReturnLineSerializer(serializers.Serializer):
    variant_id = serializers.UUIDField()
    qty = serializers.IntegerField(min_value=1)


class RefundLineSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=["CASH", "CARD", "DEBT"])
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))


class SaleReturnSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")
    lines = ReturnLineSerializer(many=True)
    auto_refund = serializers.BooleanField(required=False, default=True)
    skip_refund = serializers.BooleanField(required=False, default=False)
    refunds = RefundLineSerializer(many=True, required=False)
