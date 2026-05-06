import { fetchReceiptEscpos, fetchReceiptPlain } from '../api'
import { listInstalledPrinters, printRawBase64 } from './tauriPrint'

type PrintKind = 'receipt' | 'label'

type DispatchOptions = {
  payloadBase64: string
  kind: PrintKind
  settings: PrinterSettingsLike | null
}

type PrinterSettingsLike = {
  receipt_printer_name?: string
  receipt_printer_port?: string
  label_printer_name?: string
  label_printer_port?: string
}

const RECEIPT_FALLBACK_MODEL = 'XP-80C'
const LABEL_FALLBACK_MODEL = 'XP-365B'

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function findByNameOrModel(printers: string[], expected: string): string | null {
  const needle = normalize(expected)
  if (!needle) return null
  const exact = printers.find((p) => normalize(p) === needle)
  if (exact) return exact
  const partial = printers.find((p) => normalize(p).includes(needle))
  return partial ?? null
}

function chooseConfiguredName(kind: PrintKind, settings: PrinterSettingsLike | null): string {
  if (kind === 'receipt') return (settings?.receipt_printer_name || '').trim()
  return (settings?.label_printer_name || '').trim()
}

function chooseConfiguredPort(kind: PrintKind, settings: PrinterSettingsLike | null): string {
  if (kind === 'receipt') return (settings?.receipt_printer_port || '').trim()
  return (settings?.label_printer_port || '').trim()
}

function fallbackModel(kind: PrintKind): string {
  return kind === 'receipt' ? RECEIPT_FALLBACK_MODEL : LABEL_FALLBACK_MODEL
}

/** Windows queue name used for the job (for toasts / support). */
export async function dispatchPrint({ payloadBase64, kind, settings }: DispatchOptions): Promise<string> {
  const configured = chooseConfiguredName(kind, settings)
  const configuredPort = chooseConfiguredPort(kind, settings)
  const printers = await listInstalledPrinters()

  // Empty OS printer list: strict if nothing configured (avoid silent default spooler),
  // soft path when a name is set in store settings (still try that queue).
  if (printers.length === 0) {
    if (configured) {
      try {
        await printRawBase64(payloadBase64, configured)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err || '')
        throw new Error(`Printer navbatiga yuborilmadi (${configured}): ${detail}`)
      }
      return configured
    }
    const what = kind === 'receipt' ? 'chek' : 'yorliq'
    throw new Error(
      `Printer ulanmagan: Windows ro'yxati bo'sh va dukon sozlamalarida ${what} printeri ko'rsatilmagan.`,
    )
  }

  let chosen: string | null = null

  // Prefer explicit queue name from settings; port hint is secondary (avoids wrong USB match).
  chosen = findByNameOrModel(printers, configured)
  if (!chosen && configuredPort) {
    const byPort = printers.find((p) => normalize(p).includes(normalize(configuredPort)))
    if (byPort) chosen = byPort
  }
  if (!chosen) {
    chosen = findByNameOrModel(printers, fallbackModel(kind))
  }

  if (!chosen) {
    const missing = configured || fallbackModel(kind)
    throw new Error(`Printer ulanmagan: ${missing}`)
  }

  try {
    await printRawBase64(payloadBase64, chosen)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err || '')
    throw new Error(`Printer navbatiga yuborilmadi (${chosen}): ${detail}`)
  }
  return chosen
}

export async function dispatchReceipt(payloadBase64: string, settings: PrinterSettingsLike | null): Promise<string> {
  return dispatchPrint({ payloadBase64, kind: 'receipt', settings })
}

export async function dispatchLabel(payloadBase64: string, settings: PrinterSettingsLike | null): Promise<string> {
  return dispatchPrint({ payloadBase64, kind: 'label', settings })
}

export type PrintReceiptResult = { kind: 'escpos'; printer: string } | { kind: 'plain' }

/** Fetch ESC/POS from API and print, or plain-text + Notepad fallback. */
export async function printReceiptWithFallback(
  saleId: string,
  settings: PrinterSettingsLike | null,
): Promise<PrintReceiptResult> {
  const b64 = await fetchReceiptEscpos(saleId)
  if (b64 && b64.trim().length > 0) {
    const printer = await dispatchReceipt(b64, settings)
    return { kind: 'escpos', printer }
  }
  const plain = await fetchReceiptPlain(saleId)
  if (plain && plain.trim().length > 0) {
    const { invoke } = await import('@tauri-apps/api/tauri')
    await invoke('print_plain', { text: plain })
    return { kind: 'plain' }
  }
  throw new Error(
    "Printer ulanmagan: chek ma'lumoti yuklanmadi (server ESC/POS yoki matn qaytarmadi).",
  )
}
