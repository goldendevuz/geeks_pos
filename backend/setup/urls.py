from django.urls import path

from printing.setup_views import SetupCompleteView, SetupStatusView

urlpatterns = [
    path("status/", SetupStatusView.as_view()),
    path("complete/", SetupCompleteView.as_view()),
]
