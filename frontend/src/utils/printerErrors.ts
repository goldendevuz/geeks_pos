import i18n from '../i18n'

/** Map legacy Uzbek hardcoded printer errors to i18n keys. */
export function translatePrinterError(raw: string): string {
  const msg = (raw || '').trim()
  if (!msg) return i18n.t('err.UNKNOWN')

  if (msg.includes("Windows ro'yxati") || msg.includes('Windows ro')) {
    return i18n.t('err.PRINTER_NOT_CONFIGURED_WINDOWS')
  }
  if (msg.includes('chek ma') || msg.includes('ESC/POS')) {
    return i18n.t('err.PRINTER_RECEIPT_PAYLOAD_EMPTY')
  }
  if (msg.startsWith('Printer ulanmagan:')) {
    const name = msg.replace(/^Printer ulanmagan:\s*/i, '').trim()
    return i18n.t('err.PRINTER_NOT_CONNECTED', { name })
  }
  if (msg.startsWith('Printer navbatiga yuborilmadi')) {
    const m = msg.match(/\(([^)]+)\)/)
    return i18n.t('err.PRINTER_QUEUE_FAILED', { printer: m?.[1]?.trim() ?? '' })
  }
  return msg
}

export function isPrinterError(raw: string): boolean {
  const m = (raw || '').trim()
  return (
    m.startsWith('Printer ulanmagan:') ||
    m.startsWith('Printer navbatiga yuborilmadi') ||
    m.includes("Windows ro'yxati")
  )
}
