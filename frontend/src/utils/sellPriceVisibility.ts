import type { StoreSettings } from '../api'

/** Settings → show selling price in catalog / POS lists (default on). */
export function showSellPriceInCatalog(settings: StoreSettings | null | undefined): boolean {
  return settings?.show_selling_price_in_catalog !== false
}

/** Settings → print sell price on stickers (default on). */
export function printSellPriceOnLabels(settings: StoreSettings | null | undefined): boolean {
  return settings?.show_price_on_labels_default !== false
}
