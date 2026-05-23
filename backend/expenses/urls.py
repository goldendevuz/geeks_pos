from django.urls import path

from .views import ShopExpenseDetailView, ShopExpenseListCreateView

urlpatterns = [
    path("", ShopExpenseListCreateView.as_view()),
    path("<uuid:pk>/", ShopExpenseDetailView.as_view()),
]
