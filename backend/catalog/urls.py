from django.urls import path

from . import views

urlpatterns = [
    path("categories/", views.CategoryListCreate.as_view()),
    path("categories/<uuid:pk>/", views.CategoryDetail.as_view()),
    path("products/", views.ProductListCreate.as_view()),
    path("products/<uuid:pk>/", views.ProductDetail.as_view()),
    path("variants/cashier-stock/", views.CashierStockListView.as_view()),
    path("variants/", views.ProductVariantListCreate.as_view()),
    path("variants/<uuid:pk>/", views.ProductVariantDetail.as_view()),
    path("variants/<uuid:pk>/pos-price/", views.PosVariantPriceView.as_view()),
    path("variants/by-barcode/", views.VariantByBarcodeView.as_view()),
    path("variants/pos-search/", views.PosVariantSearchView.as_view()),
    path("variants/pos-by-product/", views.PosVariantByProductView.as_view()),
    path("variants/bulk-grid/", views.BulkVariantGridView.as_view()),
    # Low stock endpoints
    path("low-stock/", views.LowStockListView.as_view()),
    path("low-stock/by-brand/", views.LowStockByBrandView.as_view()),
    path("low-stock/by-model/", views.LowStockByModelView.as_view()),
    # Supplier management endpoints
    path("suppliers/", views.SupplierListCreateView.as_view()),
    path("suppliers/<uuid:pk>/", views.SupplierDetailView.as_view()),
    path("suppliers/balances/", views.SupplierBalanceView.as_view()),
    path("suppliers/<uuid:supplier_id>/balance/", views.SingleSupplierBalanceView.as_view()),
    path("suppliers/<uuid:supplier_id>/transactions/", views.SupplierTransactionListView.as_view()),
    # Phase 4: Product Specifications endpoints
    path("products/<uuid:product_id>/specifications/", views.ProductSpecificationView.as_view()),
    path("specifications/", views.ProductSpecificationListView.as_view()),
    path("specifications/summary/", views.SpecificationSummaryView.as_view()),
    path("products/without-specs/", views.ProductsWithoutSpecsView.as_view()),
    # Phase 4: Serial Number & Warranty Tracking endpoints
    path("serial-numbers/", views.SerialNumberListCreateView.as_view()),
    path("serial-numbers/bulk/", views.SerialNumberBulkCreateView.as_view()),
    path("serial-numbers/by-code/", views.SerialNumberByCodeView.as_view()),
    path("serial-numbers/stats/", views.SerialNumberStatsView.as_view()),
    path("serial-numbers/<uuid:pk>/", views.SerialNumberDetailView.as_view()),
    path("serial-numbers/<uuid:serial_id>/mark-sold/", views.MarkSerialAsSoldView.as_view()),
    path("serial-numbers/<uuid:serial_id>/mark-returned/", views.MarkSerialAsReturnedView.as_view()),
    path("serial-numbers/<uuid:serial_id>/mark-defective/", views.MarkSerialAsDefectiveView.as_view()),
    # Warranty tracking endpoints
    path("warranties/expiring/", views.WarrantiesExpiringView.as_view()),
    path("warranties/expired/", views.WarrantiesExpiredView.as_view()),
]
