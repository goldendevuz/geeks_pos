#!/usr/bin/env python3
"""
Clear database and seed with appliance test data
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from catalog.models import Category, Product, ProductVariant
from printing.models import StoreSettings
from accounts.models import UserProfile, Role
from django.db import transaction

User = get_user_model()

def clear_all_data():
    """Clear all data from database"""
    print("🗑️  Clearing all data...")
    
    with transaction.atomic():
        # Clear related data first (in order of dependencies)
        from sales.models import Sale, SaleLine, SaleRefund
        from inventory.models import InventoryMovement, StocktakeSession, StocktakeLine
        from debt.models import Debt
        from expenses.models import ShopExpense
        from catalog.models import SerialNumber
        
        # Clear in dependency order (respect protected foreign keys)
        SaleRefund.objects.all().delete()
        Debt.objects.all().delete()  # Delete before Sale (protected FK)
        SaleLine.objects.all().delete()
        Sale.objects.all().delete()
        SerialNumber.objects.all().delete()
        InventoryMovement.objects.all().delete()
        StocktakeLine.objects.all().delete()
        StocktakeSession.objects.all().delete()
        ShopExpense.objects.all().delete()
        
        # Clear catalog data
        ProductVariant.objects.all().delete()
        Product.objects.all().delete()
        Category.objects.all().delete()
        
        # Clear users except superuser
        User.objects.filter(is_superuser=False).delete()
        
    print("✓ Database cleared")

def seed_appliance_data():
    """Seed database with appliance test data"""
    print("🌱 Seeding appliance data...")
    
    with transaction.atomic():
        # Create categories (brands)
        samsung = Category.objects.create(
            name_uz="Samsung",
            name_ru="Samsung"
        )
        lg = Category.objects.create(
            name_uz="LG",
            name_ru="LG"
        )
        bosch = Category.objects.create(
            name_uz="Bosch",
            name_ru="Bosch"
        )
        
        # Create products (appliances)
        # Samsung products
        samsung_fridge = Product.objects.create(
            category=samsung,
            name_uz="Muzlatgich",
            name_ru="Холодильник"
            # No custom name - it's optional
        )
        
        samsung_washer = Product.objects.create(
            category=samsung,
            name_uz="Kir yuvish mashinasi",
            name_ru="Стиральная машина"
        )
        
        samsung_tv = Product.objects.create(
            category=samsung,
            name_uz="Televizor",
            name_ru="Телевизор",
            custom_name_uz="55 dyuym QLED",
            custom_name_ru="55 дюймов QLED"
        )
        
        # LG products
        lg_fridge = Product.objects.create(
            category=lg,
            name_uz="Muzlatgich",
            name_ru="Холодильник",
            custom_name_uz="InstaView",
            custom_name_ru="InstaView"
        )
        
        lg_ac = Product.objects.create(
            category=lg,
            name_uz="Konditsioner",
            name_ru="Кондиционер",
            custom_name_uz="Inverter",
            custom_name_ru="Inverter"
        )
        
        # Bosch products
        bosch_dishwasher = Product.objects.create(
            category=bosch,
            name_uz="Idish yuvish mashinasi",
            name_ru="Посудомоечная машина",
            custom_name_uz="Serie 6",
            custom_name_ru="Serie 6"
        )
        
        # Create variants
        variants_data = [
            # Samsung Fridge
            {
                'product': samsung_fridge,
                'barcode': 'SAM-FRIDGE-001',
                'purchase_price': '4500000',
                'list_price': '5500000',
                'stock_qty': 5,
            },
            # Samsung Washer
            {
                'product': samsung_washer,
                'barcode': 'SAM-WASH-001',
                'purchase_price': '3200000',
                'list_price': '4000000',
                'stock_qty': 3,
            },
            # Samsung TV
            {
                'product': samsung_tv,
                'barcode': 'SAM-TV-55-001',
                'purchase_price': '6000000',
                'list_price': '7500000',
                'stock_qty': 4,
            },
            # LG Fridge
            {
                'product': lg_fridge,
                'barcode': 'LG-FRIDGE-001',
                'purchase_price': '5000000',
                'list_price': '6200000',
                'stock_qty': 2,
            },
            # LG AC
            {
                'product': lg_ac,
                'barcode': 'LG-AC-001',
                'purchase_price': '2800000',
                'list_price': '3500000',
                'stock_qty': 10,
            },
            # Bosch Dishwasher
            {
                'product': bosch_dishwasher,
                'barcode': 'BOSCH-DW-001',
                'purchase_price': '4000000',
                'list_price': '5000000',
                'stock_qty': 2,
            },
            # Samsung Muzlatgich (variant 2)
            {
                'product': samsung_fridge,
                'barcode': 'SAM-FRIDGE-002',
                'purchase_price': '3800000',
                'list_price': '4800000',
                'stock_qty': 3,
            },
            # LG Muzlatgich (variant 2)
            {
                'product': lg_fridge,
                'barcode': 'LG-FRIDGE-002',
                'purchase_price': '4500000',
                'list_price': '5700000',
                'stock_qty': 4,
            },
            # Samsung Washer (variant 2)
            {
                'product': samsung_washer,
                'barcode': 'SAM-WASH-002',
                'purchase_price': '2900000',
                'list_price': '3700000',
                'stock_qty': 2,
            },
            # LG AC (variant 2)
            {
                'product': lg_ac,
                'barcode': 'LG-AC-002',
                'purchase_price': '3200000',
                'list_price': '4000000',
                'stock_qty': 6,
            },
        ]
        
        for data in variants_data:
            ProductVariant.objects.create(**data)
        
        print(f"✓ Created {len(variants_data)} variants")
        
        # Create test users
        if not User.objects.filter(username='admin').exists():
            admin = User.objects.create_user(
                username='admin',
                password='admin123'
            )
            profile, _ = UserProfile.objects.get_or_create(user=admin)
            profile.role = Role.ADMIN
            profile.pin_enabled = True
            profile.pin_hash = make_password('1111')
            profile.save()
            print("✓ Created admin user (admin/admin123, PIN: 1111)")
        
        if not User.objects.filter(username='cashier').exists():
            cashier = User.objects.create_user(
                username='cashier',
                password='pass12345'
            )
            profile, _ = UserProfile.objects.get_or_create(user=cashier)
            profile.role = Role.CASHIER
            profile.pin_enabled = True
            profile.pin_hash = make_password('1111')
            profile.save()
            print("✓ Created cashier user (cashier/pass12345, PIN: 1111)")
        
        # Create a product WITHOUT list_price to test price entry at sale time
        if not ProductVariant.objects.filter(barcode='TEST-NO-PRICE-001').exists():
            test_product = Product.objects.create(
                category=samsung,
                name_uz="Test Mahsulot (Narxsiz)",
                name_ru="Тестовый товар (без цены)"
            )
            ProductVariant.objects.create(
                product=test_product,
                barcode='TEST-NO-PRICE-001',
                purchase_price='1000000',
                list_price=None,  # NO list_price - should prompt for price at sale time
                stock_qty=2  # LOW STOCK
            )
            print("✓ Created test product WITHOUT list_price (for price entry testing)")
        
        # Update store settings
        settings, _ = StoreSettings.objects.get_or_create(id=1)
        settings.brand_name = "Geeks Appliances"
        settings.phone = "+998 90 123 45 67"
        settings.address = "Toshkent, Chilonzor"
        settings.low_stock_threshold = 3
        settings.save()
        print("✓ Updated store settings")
    
    print("\n✅ Database seeded successfully!")
    print("\nTest users:")
    print("  Admin: PIN 1111")
    print("  Cashier: PIN 1111")
    print("\nTest products:")
    print("  - Samsung Side-by-Side Fridge (5.5M)")
    print("  - Samsung EcoBubble Washer (4M)")
    print("  - Samsung QLED 55\" TV (7.5M)")
    print("  - LG InstaView Fridge (6.2M)")
    print("  - LG Dual Inverter AC (3.5M)")
    print("  - Bosch Serie 6 Dishwasher (5M)")

if __name__ == '__main__':
    print("=" * 60)
    print("GEEKS POS - Clear & Seed Appliance Data")
    print("=" * 60)
    print()
    
    response = input("⚠️  This will DELETE ALL DATA. Continue? (yes/no): ")
    if response.lower() != 'yes':
        print("Cancelled.")
        exit(0)
    
    clear_all_data()
    seed_appliance_data()
    
    print("\n" + "=" * 60)
    print("Done! You can now test the system with appliance data.")
    print("=" * 60)
