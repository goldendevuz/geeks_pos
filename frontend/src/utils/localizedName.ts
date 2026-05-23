import i18n from '../i18n'

export type DisplayLang = 'uz' | 'uz-cyrl' | 'ru'

export function resolveDisplayLang(lang?: string): DisplayLang {
  const l = (lang || i18n.language || 'uz').toLowerCase()
  if (l.startsWith('ru')) return 'ru'
  if (l.includes('cyrl')) return 'uz-cyrl'
  return 'uz'
}

export function isLangRu(lang?: string): boolean {
  return resolveDisplayLang(lang) === 'ru'
}

type BilingualFields = {
  name_uz?: string | null
  name_ru?: string | null
  name_uz_cyrillic?: string | null
}

export function pickBilingualName(item: BilingualFields, lang?: string): string {
  const mode = resolveDisplayLang(lang)
  const uz = (item.name_uz ?? '').trim()
  const ru = (item.name_ru ?? '').trim()
  const cy = (item.name_uz_cyrillic ?? '').trim()
  if (mode === 'ru') return ru || uz
  if (mode === 'uz-cyrl') return cy || uz || ru
  return uz || ru
}

export function pickProductName(
  v: {
    product_name_uz?: string
    product_name_ru?: string
    product_name_uz_cyrillic?: string | null
  },
  lang?: string,
): string {
  return pickBilingualName(
    {
      name_uz: v.product_name_uz,
      name_ru: v.product_name_ru,
      name_uz_cyrillic: v.product_name_uz_cyrillic,
    },
    lang,
  )
}

export function pickCategoryName(
  v: { category_name_uz?: string; category_name_ru?: string },
  lang?: string,
): string {
  return pickBilingualName({ name_uz: v.category_name_uz, name_ru: v.category_name_ru }, lang)
}

export function pickCustomName(
  v: {
    product_custom_name_uz?: string | null
    product_custom_name_ru?: string | null
    product_custom_name_uz_cyrillic?: string | null
  },
  lang?: string,
): string {
  const mode = resolveDisplayLang(lang)
  const uz = (v.product_custom_name_uz ?? '').trim()
  const ru = (v.product_custom_name_ru ?? '').trim()
  const cy = (v.product_custom_name_uz_cyrillic ?? '').trim()
  if (mode === 'ru') return ru || uz
  if (mode === 'uz-cyrl') return cy || uz || ru
  return uz || ru
}

export function dateLocale(lang?: string): string {
  const mode = resolveDisplayLang(lang)
  if (mode === 'ru') return 'ru-RU'
  return 'uz-UZ'
}
