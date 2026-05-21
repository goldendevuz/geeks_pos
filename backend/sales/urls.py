from django.urls import path

from .views import (
    CompleteSaleView,
    SaleDetailView,
    SaleHistoryExportCsvView,
    SaleHistoryExportXlsxView,
    SaleHistoryView,
    SaleLinePriceEditView,
    SaleReturnLinesView,
    SaleReturnView,
    SaleSearchForReturnView,
    SaleVoidView,
)

urlpatterns = [
    path("", SaleHistoryView.as_view()),
    path("export/csv/", SaleHistoryExportCsvView.as_view()),
    path("export/xlsx/", SaleHistoryExportXlsxView.as_view()),
    path("complete/", CompleteSaleView.as_view()),
    path("search/return/", SaleSearchForReturnView.as_view()),
    path("<uuid:pk>/void/", SaleVoidView.as_view()),
    path("<uuid:pk>/return-lines/", SaleReturnLinesView.as_view()),
    path("<uuid:pk>/return/", SaleReturnView.as_view()),
    path("<uuid:sale_id>/line/<uuid:line_id>/price/", SaleLinePriceEditView.as_view()),
    path("<uuid:pk>/", SaleDetailView.as_view()),
]
