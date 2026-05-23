import {
  pickCategoryName,
  pickCustomName,
  pickProductName,
} from './localizedName'

/** Bilingual snapshot stored on cart lines for language switching. */
export type CartNameFields = {
  category_name_uz?: string
  category_name_ru?: string
  product_name_uz?: string
  product_name_ru?: string
  product_name_uz_cyrillic?: string | null
  product_custom_name_uz?: string | null
  product_custom_name_ru?: string | null
  product_custom_name_uz_cyrillic?: string | null
}

export function cartNameFieldsFromVariant(v: CartNameFields): CartNameFields {
  return {
    category_name_uz: v.category_name_uz,
    category_name_ru: v.category_name_ru,
    product_name_uz: v.product_name_uz,
    product_name_ru: v.product_name_ru,
    product_name_uz_cyrillic: v.product_name_uz_cyrillic,
    product_custom_name_uz: v.product_custom_name_uz,
    product_custom_name_ru: v.product_custom_name_ru,
    product_custom_name_uz_cyrillic: v.product_custom_name_uz_cyrillic,
  }
}

export function formatPosCartLineName(fields: CartNameFields, lang?: string): string {
  const brand = pickCategoryName(fields, lang)
  const custom = pickCustomName(fields, lang)
  const model = pickProductName(fields, lang)
  const title = (custom || model).trim()
  return [brand, title].filter(Boolean).join(' ')
}
