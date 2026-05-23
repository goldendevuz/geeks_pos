"""Size line presets for footwear (numeric) and clothing (EU kids cm + letter sizes)."""

from __future__ import annotations

from .models import AgeBand, ClothingGender, ProductKind

FOOTWEAR_SIZE_RANGES: dict[str, tuple[int, int]] = {
    AgeBand.CHILDREN: (31, 36),
    AgeBand.TEEN: (36, 41),
    AgeBand.ADULT: (40, 45),
}

_CLOTHING_CHILDREN = ["104", "110", "116", "122", "128", "134", "140", "146", "152"]
_CLOTHING_TEEN_MALE = ["XS", "S", "M", "L", "XL"]
_CLOTHING_TEEN_FEMALE = ["XS", "S", "M", "L", "XL"]
_CLOTHING_ADULT_MALE = ["S", "M", "L", "XL", "XXL", "3XL"]
_CLOTHING_ADULT_FEMALE = ["XS", "S", "M", "L", "XL", "XXL"]

CLOTHING_SIZE_VALUES: dict[tuple[str, str], list[str]] = {
    (AgeBand.CHILDREN, ClothingGender.MALE): list(_CLOTHING_CHILDREN),
    (AgeBand.CHILDREN, ClothingGender.FEMALE): list(_CLOTHING_CHILDREN),
    (AgeBand.CHILDREN, ClothingGender.UNISEX): list(_CLOTHING_CHILDREN),
    (AgeBand.TEEN, ClothingGender.MALE): list(_CLOTHING_TEEN_MALE),
    (AgeBand.TEEN, ClothingGender.FEMALE): list(_CLOTHING_TEEN_FEMALE),
    (AgeBand.TEEN, ClothingGender.UNISEX): list(_CLOTHING_TEEN_MALE),
    (AgeBand.ADULT, ClothingGender.MALE): list(_CLOTHING_ADULT_MALE),
    (AgeBand.ADULT, ClothingGender.FEMALE): list(_CLOTHING_ADULT_FEMALE),
    (AgeBand.ADULT, ClothingGender.UNISEX): list(_CLOTHING_ADULT_MALE),
}


def footwear_numeric_values(age_band: str) -> list[str]:
    band = age_band if age_band in FOOTWEAR_SIZE_RANGES else AgeBand.ADULT
    lo, hi = FOOTWEAR_SIZE_RANGES[band]
    return [str(v) for v in range(lo, hi + 1)]


def clothing_size_values(age_band: str, gender: str) -> list[str]:
    band = age_band if age_band in (AgeBand.CHILDREN, AgeBand.TEEN, AgeBand.ADULT) else AgeBand.ADULT
    valid_genders = {c[0] for c in ClothingGender.choices}
    g = gender if gender in valid_genders else ClothingGender.UNISEX
    if band == AgeBand.CHILDREN:
        g = ClothingGender.UNISEX
    return list(CLOTHING_SIZE_VALUES.get((band, g), CLOTHING_SIZE_VALUES[(AgeBand.ADULT, ClothingGender.MALE)]))


def size_sort_order(value: str, index: int) -> int:
    """Stable sort: numeric footwear by value, clothing by preset index."""
    if value.isdigit():
        return int(value)
    return 1000 + index


def is_legacy_footwear_size(size) -> bool:
    """Sizes created before metadata — numeric value, empty kind."""
    kind = (getattr(size, "kind", None) or "").strip()
    if kind == ProductKind.FOOTWEAR:
        return True
    if kind:
        return False
    return (size.value or "").strip().isdigit()
