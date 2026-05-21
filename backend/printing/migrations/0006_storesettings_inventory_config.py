# Generated migration for Phase 3 - Inventory & Pricing Configuration

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('printing', '0005_storesettings_label_printer_port_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='storesettings',
            name='low_stock_threshold',
            field=models.PositiveIntegerField(default=2, help_text='Minimum stock quantity before product is considered low stock'),
        ),
        migrations.AddField(
            model_name='storesettings',
            name='show_price_on_labels_default',
            field=models.BooleanField(default=True, help_text='Whether to display price on printed labels by default'),
        ),
        migrations.AddField(
            model_name='storesettings',
            name='show_selling_price_in_catalog',
            field=models.BooleanField(default=True, help_text='Whether to display selling price in catalog and POS'),
        ),
    ]
