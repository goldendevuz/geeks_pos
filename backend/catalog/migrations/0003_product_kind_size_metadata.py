from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("catalog", "0002_standard_colors"),
    ]

    operations = [
        migrations.AddField(
            model_name="size",
            name="age_band",
            field=models.CharField(
                blank=True,
                choices=[("children", "Children"), ("teen", "Teen"), ("adult", "Adult")],
                default="",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="size",
            name="gender",
            field=models.CharField(
                blank=True,
                choices=[("MALE", "Male"), ("FEMALE", "Female"), ("UNISEX", "Unisex")],
                default="",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="size",
            name="kind",
            field=models.CharField(
                blank=True,
                choices=[("FOOTWEAR", "Footwear"), ("CLOTHING", "Clothing")],
                default="",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="age_band",
            field=models.CharField(
                choices=[("children", "Children"), ("teen", "Teen"), ("adult", "Adult")],
                default="adult",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="gender",
            field=models.CharField(
                blank=True,
                choices=[("MALE", "Male"), ("FEMALE", "Female"), ("UNISEX", "Unisex")],
                default="",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="product",
            name="kind",
            field=models.CharField(
                choices=[("FOOTWEAR", "Footwear"), ("CLOTHING", "Clothing")],
                default="FOOTWEAR",
                max_length=16,
            ),
        ),
    ]
