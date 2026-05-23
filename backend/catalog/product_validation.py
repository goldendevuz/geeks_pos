from rest_framework import serializers

from printing.models import StoreSettings

from .models import ClothingGender, ProductKind


def apply_product_kind_defaults(attrs: dict, instance=None) -> dict:
    settings = StoreSettings.get_solo()
    shop_mode = (settings.shop_mode or "").strip()

    kind = (attrs.get("kind") or (instance.kind if instance else "") or "").strip()
    if not kind:
        if shop_mode == StoreSettings.ShopMode.CLOTHING_ONLY:
            kind = ProductKind.CLOTHING
        else:
            kind = ProductKind.FOOTWEAR
        attrs["kind"] = kind

    gender = (attrs.get("gender") if "gender" in attrs else (instance.gender if instance else "")) or ""
    gender = gender.strip() if isinstance(gender, str) else ""

    if kind == ProductKind.FOOTWEAR:
        attrs["gender"] = ""
    elif kind == ProductKind.CLOTHING:
        default_g = (settings.default_clothing_gender or "").strip()
        if not gender and default_g:
            gender = default_g
        if not gender:
            raise serializers.ValidationError(
                {"gender": "Gender is required for clothing products."}
            )
        attrs["gender"] = gender

    return attrs
