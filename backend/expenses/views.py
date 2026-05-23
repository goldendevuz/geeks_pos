from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated

from accounts.models import Role, UserProfile
from core.permissions import IsAdminOrOwner, IsCashier

from .models import ShopExpense
from .serializers import ShopExpenseSerializer


def _is_admin_or_owner(user) -> bool:
    if getattr(user, "is_superuser", False):
        return True
    profile = getattr(user, "profile", None)
    return isinstance(profile, UserProfile) and profile.role in (Role.ADMIN, Role.OWNER)


class ShopExpensePagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


class ShopExpenseListCreateView(generics.ListCreateAPIView):
    """
    Owners/admins see all expenses; cashiers see only their own rows.
    Cashiers may POST (withdrawal / outgoing cash).
    """

    serializer_class = ShopExpenseSerializer
    permission_classes = [IsAuthenticated, IsCashier]
    pagination_class = ShopExpensePagination

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


class ShopExpenseDetailView(generics.RetrieveUpdateAPIView):
    """Owners/admins may edit any expense; cashiers only their own."""

    serializer_class = ShopExpenseSerializer
    permission_classes = [IsAuthenticated, IsCashier]
    lookup_field = "pk"

    def get_queryset(self):
        qs = ShopExpense.objects.select_related("recorded_by").all()
        if not _is_admin_or_owner(self.request.user):
            qs = qs.filter(recorded_by_id=self.request.user.id)
        return qs


from rest_framework.response import Response
from rest_framework.views import APIView


class ShiftExpenseSummaryView(APIView):
    """Get expense summary for a specific shift."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def get(self, request, shift_id):
        from .services import get_shift_summary

        summary = get_shift_summary(shift_id)
        if "error" in summary:
            return Response({"code": "SHIFT_NOT_FOUND", "detail": summary["error"]}, status=404)

        return Response(summary)


class AllShiftsSummaryView(APIView):
    """Get summary of recent shifts with expenses."""
    permission_classes = [IsAuthenticated, IsAdminOrOwner]

    def get(self, request):
        from .services import get_all_shifts_summary

        limit = min(int(request.query_params.get("limit", 10)), 50)
        summaries = get_all_shifts_summary(limit=limit)

        return Response({"results": summaries})
