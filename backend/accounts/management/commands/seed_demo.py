from decimal import Decimal

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from accounts.models import Role, UserProfile
from catalog.models import Category, Product, ProductVariant
from inventory.models import InventoryMovement
from inventory.services import apply_movement


class Command(BaseCommand):
    help = "Create demo cashier user and sample catalog (dev only)"

    def handle(self, *args, **options):
        u, created = User.objects.get_or_create(
            username="cashier",
            defaults={"email": "cashier@local"},
        )
        if created:
            u.set_password("pass12345")
            u.save()
        UserProfile.objects.update_or_create(
            user=u, defaults={"role": Role.CASHIER}
        )
        self.stdout.write(self.style.SUCCESS("User cashier / pass12345"))

        cat = Category.objects.filter(name_uz="Oyoq kiyim").first()
        if not cat:
            cat = Category.objects.create(
                name_uz="Oyoq kiyim",
                name_ru="Обувь",
                sort_order=1,
            )

        prod = Product.objects.filter(
            category=cat, name_uz="Namuna krossovka"
        ).first()
        if not prod:
            prod = Product.objects.create(
                category=cat,
                name_uz="Namuna krossovka",
                name_ru="Кроссовки",
                is_active=True,
            )

        v, vc = ProductVariant.objects.get_or_create(
            product=prod,
            defaults={
                "purchase_price": Decimal("200000.00"),
                "list_price": Decimal("350000.00"),
                "stock_qty": 0,
            },
        )
        if vc:
            v.save()
        if v.stock_qty == 0:
            apply_movement(
                variant=v,
                qty_delta=10,
                movement_type=InventoryMovement.Type.IN,
                user=u,
                note="seed",
            )
        v.refresh_from_db()
        self.stdout.write(
            self.style.SUCCESS(f"Variant barcode {v.barcode} stock {v.stock_qty}")
        )
