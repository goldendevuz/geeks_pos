from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from accounts.models import Role, UserProfile
from core.permissions import IsCashier

from .models import ShopExpense
from .serializers import ShopExpenseSerializer


def _is_admin_or_owner(user) -> bool:
    if getattr(user, "is_superuser", False):
        return True
    profile = getattr(user, "profile", None)
    return isinstance(profile, UserProfile) and profile.role in (Role.ADMIN, Role.OWNER)


class ShopExpenseListCreateView(generics.ListCreateAPIView):
    """
    Owners/admins see all expenses; cashiers see only their own rows.
    Cashiers may POST (withdrawal / outgoing cash).
    """

    serializer_class = ShopExpenseSerializer
    permission_classes = [IsAuthenticated, IsCashier]

    def get_queryset(self):
        qs = ShopExpense.objects.select_related("recorded_by").all()
        if not _is_admin_or_owner(self.request.user):
            qs = qs.filter(recorded_by_id=self.request.user.id)
        from_date = (self.request.query_params.get("from") or "").strip()
        to_date = (self.request.query_params.get("to") or "").strip()
        if from_date:
            qs = qs.filter(recorded_at__date__gte=from_date)
        if to_date:
            qs = qs.filter(recorded_at__date__lte=to_date)
        return qs.order_by("-recorded_at")
