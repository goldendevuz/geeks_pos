from rest_framework import serializers

from .models import ShopExpense


class ShopExpenseSerializer(serializers.ModelSerializer):
    cashier_username = serializers.CharField(source="recorded_by.username", read_only=True)

    class Meta:
        model = ShopExpense
        fields = ["id", "recorded_at", "amount", "category", "note", "cashier_username", "recorded_by"]
        read_only_fields = ["id", "recorded_at", "cashier_username", "recorded_by"]

    def update(self, instance, validated_data):
        validated_data.pop("recorded_by", None)
        return super().update(instance, validated_data)

    def validate_amount(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError("amount must be positive.")
        return value

    def create(self, validated_data):
        validated_data["recorded_by"] = self.context["request"].user
        return super().create(validated_data)

