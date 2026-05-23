from django.db import migrations, models


def mark_existing_setup_done(apps, schema_editor):
    StoreSettings = apps.get_model("printing", "StoreSettings")
    for obj in StoreSettings.objects.all():
        obj.setup_completed = True
        if not (obj.shop_mode or "").strip():
            obj.shop_mode = "FOOTWEAR_ONLY"
        obj.save(update_fields=["setup_completed", "shop_mode"])


class Migration(migrations.Migration):

    dependencies = [
        ("printing", "0005_storesettings_label_printer_port_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="storesettings",
            name="shop_mode",
            field=models.CharField(
                blank=True,
                choices=[
                    ("FOOTWEAR_ONLY", "Footwear only"),
                    ("CLOTHING_ONLY", "Clothing only"),
                    ("MIXED", "Mixed"),
                ],
                default="",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="storesettings",
            name="setup_completed",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="storesettings",
            name="default_clothing_gender",
            field=models.CharField(
                blank=True,
                choices=[("MALE", "Male"), ("FEMALE", "Female")],
                default="",
                max_length=16,
            ),
        ),
        migrations.RunPython(mark_existing_setup_done, migrations.RunPython.noop),
    ]
