# Generated manually for SaleRefund

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0004_sale_sales_sale_complet_f623d7_idx_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SaleRefund",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "method",
                    models.CharField(
                        choices=[
                            ("CASH", "Cash"),
                            ("CARD", "Card"),
                            ("DEBT", "Debt"),
                        ],
                        max_length=16,
                    ),
                ),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("reason", models.CharField(blank=True, default="", max_length=500)),
                (
                    "created_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="sale_refunds",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "sale",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="refunds",
                        to="sales.sale",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="salerefund",
            index=models.Index(fields=["created_at"], name="sales_saler_created_6e8f0a_idx"),
        ),
        migrations.AddIndex(
            model_name="salerefund",
            index=models.Index(fields=["sale", "created_at"], name="sales_saler_sale_id_8c4b2d_idx"),
        ),
        migrations.AddIndex(
            model_name="salerefund",
            index=models.Index(fields=["method", "created_at"], name="sales_saler_method_91a3bc_idx"),
        ),
    ]
