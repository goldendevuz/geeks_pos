import traceback

from django.contrib import admin
from django.contrib.admin.sites import AlreadyRegistered
from django.db import models
from django.utils.html import format_html

from import_export import resources
from import_export.admin import ImportExportModelAdmin

from .models import UserProfile


def get_safe_fields(model):
    """
    Returns only safe model fields for admin usage.
    """
    safe_fields = []

    for field in model._meta.fields:
        # skip reverse relations and problematic fields
        if isinstance(field, models.ManyToManyField):
            continue

        safe_fields.append(field)

    return safe_fields


def register_model(model):
    print(f"REGISTERING ADMIN: {model.__name__}")

    safe_fields = get_safe_fields(model)

    field_names = [field.name for field in safe_fields]

    # =========================
    # Import Export Resource
    # =========================
    class Meta:
        model = model

    resource_class = type(
        f"{model.__name__}Resource",
        (resources.ModelResource,),
        {
            "Meta": Meta,
        },
    )

    # =========================
    # Dynamic methods
    # =========================
    admin_attrs = {
        "resource_classes": [resource_class],
        "list_display": [],
        "search_fields": [],
        "list_filter": [],
        "readonly_fields": [],
    }

    list_display = []

    for field in safe_fields:
        field_name = field.name

        # =========================
        # IMAGE FIELD
        # =========================
        if isinstance(field, models.ImageField):

            method_name = f"preview_{field_name}"

            def make_preview(name):
                def preview(self, obj):
                    value = getattr(obj, name)

                    if value and hasattr(value, "url"):
                        return format_html(
                            """
                            <a href="{}" target="_blank">
                                <img src="{}"
                                     style="
                                        width:70px;
                                        height:70px;
                                        object-fit:cover;
                                        border-radius:8px;
                                        border:1px solid #ddd;
                                     " />
                            </a>
                            """,
                            value.url,
                            value.url,
                        )

                    return "-"

                preview.short_description = name
                return preview

            admin_attrs[method_name] = make_preview(field_name)

            list_display.append(method_name)
            admin_attrs["readonly_fields"].append(method_name)

            continue

        # =========================
        # TEXT FIELD PREVIEW
        # =========================
        if isinstance(field, models.TextField):

            method_name = f"short_{field_name}"

            def make_short_text(name):
                def short_text(self, obj):
                    value = getattr(obj, name)

                    if not value:
                        return "-"

                    value = str(value)

                    if len(value) > 50:
                        return value[:50] + "..."

                    return value

                short_text.short_description = name
                return short_text

            admin_attrs[method_name] = make_short_text(field_name)

            list_display.append(method_name)

            continue

        # =========================
        # NORMAL FIELD
        # =========================
        list_display.append(field_name)

        # search fields
        if isinstance(
            field,
            (
                models.CharField,
                models.TextField,
                models.EmailField,
            ),
        ):
            admin_attrs["search_fields"].append(field_name)

        # filters
        if isinstance(
            field,
            (
                models.BooleanField,
                models.DateField,
                models.DateTimeField,
                models.ForeignKey,
            ),
        ):
            admin_attrs["list_filter"].append(field_name)

    # fallback
    if not list_display:
        list_display = ["__str__"]

    admin_attrs["list_display"] = list_display

    # =========================
    # Create admin class
    # =========================
    admin_class = type(
        f"{model.__name__}Admin",
        (ImportExportModelAdmin,),
        admin_attrs,
    )

    # =========================
    # Register model
    # =========================
    try:
        admin.site.register(model, admin_class)
        print(f"SUCCESS: {model.__name__}")

    except AlreadyRegistered:
        print(f"ALREADY REGISTERED: {model.__name__}")

    except Exception as e:
        print(f"FAILED: {model.__name__}")
        traceback.print_exc()
        raise e


# =========================
# MODELS
# =========================
registered_models = [
    UserProfile,
]

for model in registered_models:
    register_model(model)
