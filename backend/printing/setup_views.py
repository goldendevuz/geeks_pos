from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import StoreSettings


class SetupStatusView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        obj = StoreSettings.get_solo()
        shop_mode = (obj.shop_mode or "").strip() or None
        default_gender = (obj.default_clothing_gender or "").strip() or None
        return Response(
            {
                "setup_completed": bool(obj.setup_completed),
                "shop_mode": shop_mode,
                "default_clothing_gender": default_gender,
            }
        )


class SetupCompleteView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        obj = StoreSettings.get_solo()
        if obj.setup_completed:
            return Response(
                {
                    "code": "SETUP_ALREADY_DONE",
                    "detail": "Setup already completed.",
                },
                status=400,
            )
        shop_mode = (request.data.get("shop_mode") or "").strip()
        valid = {c[0] for c in StoreSettings.ShopMode.choices}
        if shop_mode not in valid:
            return Response(
                {
                    "code": "INVALID_SHOP_MODE",
                    "detail": f"shop_mode must be one of: {', '.join(sorted(valid))}",
                },
                status=400,
            )
        obj.shop_mode = shop_mode
        obj.setup_completed = True
        obj.save(update_fields=["shop_mode", "setup_completed", "updated_at"])
        return Response(
            {
                "setup_completed": True,
                "shop_mode": obj.shop_mode,
                "default_clothing_gender": (obj.default_clothing_gender or "").strip() or None,
            }
        )
