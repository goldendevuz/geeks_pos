import i18n from '../i18n'

export function toIntAmount(value: string | number | null | undefined): number {
  const n = Number(String(value ?? '0').replace(',', '.'))
  if (!Number.isFinite(n)) return 0
  return Math.round(n)
}

function resolveLang(lang?: string): string {
  return (lang || i18n.language || 'uz').toLowerCase()
}

function moneyLocale(lang?: string): string {
  return resolveLang(lang).startsWith('ru') ? 'ru-RU' : 'uz-UZ'
}

function currencySuffix(lang?: string): string {
  return resolveLang(lang).startsWith('ru') ? '\u00a0сум' : "\u00a0so'm"
}

/** Format integer money with locale grouping and currency suffix (UZ/RU from i18n). */
export function formatMoney(value: string | number | null | undefined, lang?: string): string {
  const formatted = new Intl.NumberFormat(moneyLocale(lang), {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(toIntAmount(value))
  return `${formatted}${currencySuffix(lang)}`
}

export function netMoney(grand: string | number | undefined, refund: string | number | undefined, lang?: string): string {
  return formatMoney(toIntAmount(grand) - toIntAmount(refund), lang)
}
