import type { Variant } from '../api'

/** Brend (category), model (product), barcode, o'lcham, rang bo'yicha moslik. */
export function variantMatchesSearch(v: Variant, needle: string): boolean {
  const n = needle.trim().toLowerCase()
  if (!n) return true
  const parts = [
    v.barcode,
    v.product_name_uz,
    v.product_name_ru,
    v.category_name_uz,
    v.category_name_ru,
    v.size_label_uz,
    v.size_label_ru,
    v.color_label_uz,
    v.color_label_ru,
  ]
  return parts.some((p) => (p ?? '').toLowerCase().includes(n))
}

export function filterVariantsForPicker(variants: Variant[], q: string, max = 18): Variant[] {
  const needle = q.trim()
  const base = variants.filter((v) => v.is_active && v.deleted_at == null)
  if (needle.length < 1) return base.slice(0, max)
  return base.filter((v) => variantMatchesSearch(v, needle)).slice(0, max)
}

export type StocktakeSearchLine = {
  barcode?: string | null
  product_name_uz?: string
  product_name_ru?: string
  category_name_uz?: string
  category_name_ru?: string
}

export function stocktakeLineMatchesSearch(ln: StocktakeSearchLine, needle: string): boolean {
  const n = needle.trim().toLowerCase()
  if (!n) return true
  const parts = [
    ln.barcode,
    ln.product_name_uz,
    ln.product_name_ru,
    ln.category_name_uz,
    ln.category_name_ru,
  ]
  return parts.some((p) => (p ?? '').toLowerCase().includes(n))
}
