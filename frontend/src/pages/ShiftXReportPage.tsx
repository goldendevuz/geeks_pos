import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CashierXReport } from '../api'
import { fetchCashierXReport, sendZReport } from '../api'
import { formatMoney, toIntAmount } from '../utils/money'
import { ActionToast } from '../components/ActionToast'

function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function MetricRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <>
      <div className="text-slate-400">{label}</div>
      <div className={`text-right font-semibold tabular-nums ${accent ? 'text-amber-200' : ''}`}>{value}</div>
    </>
  )
}

export function ShiftXReportPage() {
  const { t, i18n } = useTranslation()
  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')
  const [report, setReport] = useState<CashierXReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [zBusy, setZBusy] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const lang = i18n.language

  async function onSendDailyZ() {
    setToast(null)
    if (!navigator.onLine) {
      const confirmOk = window.confirm(t('admin.cashier.zOfflineWarn'))
      if (!confirmOk) return
    }
    setZBusy(true)
    try {
      await sendZReport()
      setToast({ kind: 'ok', msg: t('admin.cashier.zSentOk') })
    } catch {
      setToast({ kind: 'err', msg: t('err.ZREPORT_SEND_FAILED') })
    } finally {
      setZBusy(false)
    }
  }

  const load = useCallback(async () => {
    setBusy(true)
    setToast(null)
    try {
      const fromIso = fromInput ? new Date(fromInput).toISOString() : undefined
      const toIso = toInput ? new Date(toInput).toISOString() : undefined
      const r = await fetchCashierXReport({ from: fromIso, to: toIso })
      setReport(r)
      if (!fromInput && !toInput) {
        setFromInput(toLocalInputValue(r.range.from))
        setToInput(toLocalInputValue(r.range.to))
      }
    } catch {
      setToast({ kind: 'err', msg: t('err.API_ERROR') })
    } finally {
      setBusy(false)
    }
  }, [fromInput, toInput, t])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, [])

  const refundCash = toIntAmount(report?.refund_cash)
  const refundCard = toIntAmount(report?.refund_card)
  const refundDebt = toIntAmount(report?.refund_debt)
  const hasRefundBreakdown = refundCash > 0 || refundCard > 0 || refundDebt > 0

  return (
    <div className="p-4 space-y-4 max-w-xl">
      <h2 className="text-xl font-semibold">{t('admin.cashier.shiftTitle')}</h2>
      <p className="text-sm text-slate-400">{t('admin.cashier.shiftHint')}</p>
      {toast && <ActionToast kind={toast.kind} message={toast.msg} onClose={() => setToast(null)} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-400 block">
          {t('admin.cashier.shiftFrom')}
          <input
            type="datetime-local"
            className="touch-btn mt-1 w-full min-h-12 px-2 rounded-xl bg-slate-900 border border-slate-700"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
          />
        </label>
        <label className="text-xs text-slate-400 block">
          {t('admin.cashier.shiftTo')}
          <input
            type="datetime-local"
            className="touch-btn mt-1 w-full min-h-12 px-2 rounded-xl bg-slate-900 border border-slate-700"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        className="touch-btn min-h-12 px-5 rounded-xl bg-emerald-700 border border-emerald-500 font-medium disabled:opacity-40"
        onClick={() => void load()}
      >
        {busy ? t('admin.common.loading') : t('admin.cashier.shiftRefresh')}
      </button>
      <div className="rounded-xl border border-amber-800/80 bg-slate-900/60 p-4 space-y-3">
        <div className="text-sm font-medium text-amber-100">{t('admin.cashier.dailyCloseTitle')}</div>
        <p className="text-xs text-slate-400">{t('admin.cashier.dailyCloseHint')}</p>
        <button
          type="button"
          disabled={zBusy}
          className="touch-btn min-h-12 px-5 rounded-xl bg-amber-800 border border-amber-500 font-medium disabled:opacity-40 text-sm"
          onClick={() => void onSendDailyZ()}
        >
          {zBusy ? t('admin.common.loading') : t('admin.cashier.sendDailyZ')}
        </button>
      </div>
      {report && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 space-y-2 text-sm">
          <div className="text-slate-400">
            {t('admin.cashier.shiftCashier')}:{' '}
            <span className="text-slate-100 font-medium">{report.cashier_username}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <MetricRow label={t('admin.cashier.shiftSalesCount')} value={String(report.sales_count)} />
            <MetricRow label={t('admin.cashier.shiftTotal')} value={formatMoney(report.sales_amount, lang)} />
            <MetricRow label={t('admin.cashier.shiftCash')} value={formatMoney(report.cash_total, lang)} />
            <MetricRow label={t('admin.cashier.shiftCard')} value={formatMoney(report.card_total, lang)} />
            <MetricRow label={t('admin.cashier.shiftDebt')} value={formatMoney(report.debt_total, lang)} />
            {toIntAmount(report.total_discounts) > 0 && (
              <MetricRow
                label={t('admin.dashboard.totalDiscounts')}
                value={formatMoney(report.total_discounts, lang)}
              />
            )}
            {toIntAmount(report.avg_check) > 0 && (
              <MetricRow label={t('admin.dashboard.avgCheck')} value={formatMoney(report.avg_check, lang)} />
            )}
            {toIntAmount(report.refund_total) > 0 && (
              <MetricRow
                label={t('admin.cashier.shiftRefunds')}
                value={`−${formatMoney(report.refund_total, lang)}`}
                accent
              />
            )}
            {hasRefundBreakdown && (
              <>
                {refundCash > 0 && (
                  <MetricRow
                    label={t('admin.cashier.shiftRefundCash')}
                    value={`−${formatMoney(report.refund_cash, lang)}`}
                    accent
                  />
                )}
                {refundCard > 0 && (
                  <MetricRow
                    label={t('admin.cashier.shiftRefundCard')}
                    value={`−${formatMoney(report.refund_card, lang)}`}
                    accent
                  />
                )}
                {refundDebt > 0 && (
                  <MetricRow
                    label={t('admin.cashier.shiftRefundDebt')}
                    value={`−${formatMoney(report.refund_debt, lang)}`}
                    accent
                  />
                )}
              </>
            )}
            {report.gross_profit != null && (
              <MetricRow
                label={t('admin.cashier.shiftGrossProfit')}
                value={formatMoney(report.gross_profit, lang)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
