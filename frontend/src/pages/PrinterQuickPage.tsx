import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HardwareConfig } from '../api'
import { fetchHardwareConfig, patchHardwareConfig, testReceiptPrintPayload } from '../api'
import { listInstalledPrinters } from '../utils/tauriPrint'
import { isPrinterError, translatePrinterError } from '../utils/printerErrors'
import { dispatchReceipt } from '../utils/printingHub'
import { ActionToast } from '../components/ActionToast'

export function PrinterQuickPage() {
  const { t } = useTranslation()
  const [cfg, setCfg] = useState<HardwareConfig | null>(null)
  const [printers, setPrinters] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  async function reload() {
    setBusy(true)
    try {
      const [h, list] = await Promise.all([fetchHardwareConfig(), listInstalledPrinters().catch(() => [])])
      setCfg(h)
      setPrinters(list)
    } catch {
      setToast({ kind: 'err', msg: t('err.API_ERROR') })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  async function save(next: Partial<HardwareConfig>) {
    if (!cfg) return
    setBusy(true)
    try {
      const updated = await patchHardwareConfig(next)
      setCfg(updated)
      setToast({ kind: 'ok', msg: t('admin.cashier.printerSaved') })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('err.API_ERROR')
      setToast({ kind: 'err', msg })
    } finally {
      setBusy(false)
    }
  }

  async function testPrint() {
    setBusy(true)
    try {
      const payload = await testReceiptPrintPayload()
      const b64 = payload.raw_base64 || payload.escpos_base64
      await dispatchReceipt(b64, {
        receipt_printer_name: cfg?.receipt_printer_name || '',
        receipt_printer_port: cfg?.receipt_printer_port || '',
      })
      setToast({ kind: 'ok', msg: t('msg.printSent') })
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e || '')
      if (isPrinterError(raw)) {
        setToast({ kind: 'err', msg: translatePrinterError(raw) })
      } else {
        setToast({ kind: 'err', msg: t('msg.printFailed') })
      }
    } finally {
      setBusy(false)
    }
  }

  if (!cfg) {
    return (
      <div className="p-6 text-slate-400">
        {busy ? t('admin.common.loading') : t('err.API_ERROR')}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <h2 className="text-xl font-semibold">{t('admin.cashier.printerTitle')}</h2>
      <p className="text-sm text-slate-400">{t('admin.cashier.printerHint')}</p>
      {toast && (
        <ActionToast kind={toast.kind === 'ok' ? 'ok' : 'err'} message={toast.msg} onClose={() => setToast(null)} />
      )}
      <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <label className="block text-sm text-slate-400">
          {t('admin.settings.receiptPrinterName')}
          <select
            className="touch-btn mt-1 w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700"
            value={cfg.receipt_printer_name || ''}
            onChange={(e) => void save({ receipt_printer_name: e.target.value })}
            disabled={busy}
          >
            <option value="">{t('admin.settings.printerStatus.defaultReceipt')}</option>
            {printers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-400">
          {t('admin.settings.printerPortLabel', { defaultValue: 'Receipt port (e.g. USB001)' })}
          <input
            className="touch-btn mt-1 w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700"
            value={cfg.receipt_printer_port || ''}
            onChange={(e) => void save({ receipt_printer_port: e.target.value })}
            placeholder="USB001"
            disabled={busy}
          />
        </label>
        <label className="block text-sm text-slate-400">
          {t('admin.settings.receiptPrinterType')}
          <select
            className="touch-btn mt-1 w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700"
            value={cfg.receipt_printer_type}
            onChange={(e) =>
              void save({ receipt_printer_type: e.target.value as HardwareConfig['receipt_printer_type'] })
            }
            disabled={busy}
          >
            <option value="ESC_POS">ESC/POS</option>
            <option value="TSPL">TSPL</option>
          </select>
        </label>
        <label className="block text-sm text-slate-400">
          {t('admin.settings.labelPrinterName')}
          <select
            className="touch-btn mt-1 w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700"
            value={cfg.label_printer_name || ''}
            onChange={(e) => void save({ label_printer_name: e.target.value })}
            disabled={busy}
          >
            <option value="">{t('admin.settings.printerStatus.defaultLabel', { defaultValue: 'Default label printer' })}</option>
            {printers.map((p) => (
              <option key={`label-${p}`} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-400">
          {t('admin.settings.labelPrinterPortLabel', { defaultValue: 'Label port (e.g. USB002)' })}
          <input
            className="touch-btn mt-1 w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700"
            value={cfg.label_printer_port || ''}
            onChange={(e) => void save({ label_printer_port: e.target.value })}
            placeholder="USB002"
            disabled={busy}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={cfg.auto_print_on_sale}
            onChange={(e) => void save({ auto_print_on_sale: e.target.checked })}
            disabled={busy}
          />
          {t('admin.settings.autoPrintOnSale')}
        </label>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            className="touch-btn min-h-12 px-4 rounded-xl bg-emerald-700 border border-emerald-500 font-medium disabled:opacity-40"
            onClick={() => void testPrint()}
          >
            {t('admin.settings.testReceipt')}
          </button>
          <button
            type="button"
            disabled={busy}
            className="touch-btn min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-600 disabled:opacity-40"
            onClick={() => void reload()}
          >
            {t('admin.common.reset')}
          </button>
        </div>
      </div>
    </div>
  )
}
