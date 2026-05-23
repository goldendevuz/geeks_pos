from django.urls import path

from .views import ShopExpenseDetailView, ShopExpenseListCreateView, ShiftExpenseSummaryView, AllShiftsSummaryView

urlpatterns = [
    path("", ShopExpenseListCreateView.as_view()),
    path("<uuid:pk>/", ShopExpenseDetailView.as_view()),
    path("shifts/summary/", AllShiftsSummaryView.as_view()),
    path("shifts/<uuid:shift_id>/summary/", ShiftExpenseSummaryView.as_view()),
]
