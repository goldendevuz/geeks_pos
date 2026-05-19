from django.urls import path

from .views import ShopExpenseListCreateView

urlpatterns = [
    path("", ShopExpenseListCreateView.as_view()),
]
