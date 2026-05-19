import pytest
from django.contrib.auth.models import User

from catalog.models import Category, Color, Product, ProductVariant, Size
from catalog.search import variant_text_search_q


@pytest.mark.django_db
def test_variant_text_search_matches_category_name(client):
  User.objects.create_user(username="owner", password="x")
  cat = Category.objects.create(name_uz="Nike Brend", name_ru="Nike")
  prod = Product.objects.create(category=cat, name_uz="Air Max", name_ru="Air Max")
  size = Size.objects.create(value="42", label_uz="42", label_ru="42")
  color = Color.objects.create(value="blk", label_uz="Qora", label_ru="Чёрный")
  ProductVariant.objects.create(
      product=prod,
      size=size,
      color=color,
      barcode="900001",
      purchase_price="10000",
      list_price="15000",
      stock_qty=3,
  )
  qs = ProductVariant.objects.filter(variant_text_search_q("Nike"))
  assert qs.count() == 1
  qs2 = ProductVariant.objects.filter(variant_text_search_q("Air"))
  assert qs2.count() == 1
