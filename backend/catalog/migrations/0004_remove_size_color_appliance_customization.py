# Generated migration for appliance customization - removes size/color models

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('catalog', '0003_supplier_suppliertransaction_and_more'),
    ]

    operations = [
        # Remove size and color foreign keys from ProductVariant
        migrations.RemoveField(
            model_name='productvariant',
            name='size',
        ),
        migrations.RemoveField(
            model_name='productvariant',
            name='color',
        ),
        # Delete Size and Color models
        migrations.DeleteModel(
            name='Size',
        ),
        migrations.DeleteModel(
            name='Color',
        ),
    ]
