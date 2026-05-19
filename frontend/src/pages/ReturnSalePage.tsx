import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, Receipt, Search } from 'lucide-react'
import {
  fetchSaleReturnLines,
  fetchSalesSearchForReturn,
  submitSaleReturn,
  type RefundMethod,
  type SaleReturnEligibleLineRow,
  type SaleReturnState,
  type SalePaymentRow,
  type SaleSearchForReturnRow,
} from '../api'
import { requestAdminDataRefresh } from '../utils/adminDataRefresh'
import { ActionToast } from '../components/ActionToast'
import { formatMoney } from '../utils/money'

const RETURN_SEARCH_DEBOUNCE_MS = 380

const adminSearchInputCls =
  'touch-btn w-full min-h-[3rem] px-4 text-lg rounded-xl bg-slate-950 border border-slate-700 text-slate-100'
const adminInputCls = 'touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 text-slate-100'
const adminQtyInputCls =
  'touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 text-lg text-center tabular-nums font-medium text-slate-100'

type SalePanelHeader = {
  completed_at?: string
  cashier_username?: string
  grand_total?: string
  payments?: SalePaymentRow[]
}

function pickLocalized(uz: string | undefined, ru: string | undefined, langRu: boolean): string {
  const u = (uz ?? '').trim()
  const r = (ru ?? '').trim()
  if (langRu) return r || u || '—'
  return u || r || '—'
}

function resolvedHeader(sel: SaleSearchForReturnRow | null, meta: SalePanelHeader | null): SalePanelHeader {
  if (!sel) return {}
  const m = meta ?? {}
  return {
    completed_at: m.completed_at ?? sel.completed_at,
    cashier_username: m.cashier_username ?? sel.cashier_username,
    grand_total: m.grand_total ?? sel.grand_total,
    payments: m.payments ?? sel.payments,
  }
}

function maxReturnQty(row: SaleReturnEligibleLineRow): number {
  return Math.max(0, row.remaining_qty)
}

const REFUND_METHODS: RefundMethod[] = ['CASH', 'CARD', 'DEBT']

function parseCap(s?: string): number {
  const n = parseFloat(s || '0')
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function allocateRefundPreview(
  amount: number,
  capacity: Partial<Record<RefundMethod, string>>,
): Record<RefundMethod, number> {
  const rounded = Math.round(amount)
  const out: Record<RefundMethod, number> = { CASH: 0, CARD: 0, DEBT: 0 }
  if (rounded <= 0) return out
  const weights = REFUND_METHODS.map((m) => ({ m, w: parseCap(capacity[m]) })).filter((x) => x.w > 0)
  const totalW = weights.reduce((a, x) => a + x.w, 0)
  if (totalW <= 0) return out
  let rem = rounded
  weights.forEach((x, i) => {
    if (i === weights.length - 1) {
      out[x.m] = rem
    } else {
      const part = Math.round((rounded * x.w) / totalW)
      out[x.m] = part
      rem -= part
    }
  })
  return out
}

function lineNetUnit(ln: SaleReturnEligibleLineRow): number {
  const sold = ln.sold_qty || 0
  if (sold > 0 && ln.line_total_sold) {
    const total = parseFloat(ln.line_total_sold)
    if (Number.isFinite(total)) return total / sold
  }
  const list = parseFloat(ln.list_unit_price || '0')
  return Number.isFinite(list) ? list : 0
}

function formatSaleWhen(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function StepBar(props: { active: 1 | 2 | 3 }) {
  const { t } = useTranslation()
  const { active } = props
  const steps: { n: 1 | 2 | 3; label: string }[] = [
    { n: 1, label: t('admin.return.stepFind') },
    { n: 2, label: t('admin.return.stepQty') },
    { n: 3, label: t('admin.return.stepConfirm') },
  ]
  return (
    <ol className="grid grid-cols-3 gap-2 text-xs">
      {steps.map((s) => {
        const on = active >= s.n
        const current = active === s.n
        return (
          <li
            key={s.n}
            className={`rounded-xl px-2 py-2 border text-center leading-tight ${
              current
                ? 'border-amber-500/80 bg-amber-950/50 text-amber-100 font-medium'
                : on
                  ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-100'
                  : 'border-slate-700 bg-slate-900/40 text-slate-500'
            }`}
          >
            <span className="tabular-nums">{s.n}.</span> {s.label}
          </li>
        )
      })}
    </ol>
  )
}

function ReturnQtyStepper(props: {
  value: number
  max: number
  disabled?: boolean
  onChange: (n: number) => void
}) {
  const { t } = useTranslation()
  const { value, max, disabled, onChange } = props
  const set = (n: number) => onChange(Math.max(0, Math.min(max, n)))

  if (max <= 0) {
    return <p className="text-xs text-slate-500">{t('admin.return.lineFullyReturned')}</p>
  }

  return (
    <div className="flex flex-col gap-2 w-full sm:w-44">
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={disabled || value <= 0}
          className="touch-btn min-h-11 rounded-xl bg-slate-800 border border-slate-600 font-semibold disabled:opacity-40"
          onClick={() => set(value - 1)}
        >
          −1
        </button>
        <button
          type="button"
          disabled={disabled || value >= max}
          className="touch-btn min-h-11 rounded-xl bg-slate-800 border border-slate-600 font-semibold disabled:opacity-40"
          onClick={() => set(value + 1)}
        >
          +1
        </button>
        <button
          type="button"
          disabled={disabled || max <= 0}
          className="touch-btn min-h-11 rounded-xl bg-slate-800 border border-slate-600 text-xs font-medium disabled:opacity-40"
          onClick={() => set(max)}
        >
          {t('admin.return.btnAll')}
        </button>
      </div>
      <input
        type="number"
        min={0}
        max={max}
        inputMode="numeric"
        disabled={disabled}
        aria-label={t('admin.return.qtyLabel')}
        className={adminQtyInputCls}
        value={value}
        onChange={(e) => set(Number(e.target.value) || 0)}
      />
    </div>
  )
}

export function ReturnSalePage() {
  const { t, i18n } = useTranslation()
  const langRu = i18n.language.toLowerCase().startsWith('ru')
  const [q, setQ] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [results, setResults] = useState<SaleSearchForReturnRow[]>([])
  const [selected, setSelected] = useState<SaleSearchForReturnRow | null>(null)
  const [saleDetailMeta, setSaleDetailMeta] = useState<SalePanelHeader | null>(null)
  const [lines, setLines] = useState<SaleReturnEligibleLineRow[]>([])
  const [qtyByVariant, setQtyByVariant] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [returnState, setReturnState] = useState<SaleReturnState | null>(null)
  const [refundCapacity, setRefundCapacity] = useState<Partial<Record<RefundMethod, string>>>({})
  const [autoRefund, setAutoRefund] = useState(true)
  const [manualRefund, setManualRefund] = useState<Record<RefundMethod, number>>({
    CASH: 0,
    CARD: 0,
    DEBT: 0,
  })
  const [linesBusy, setLinesBusy] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null)
  const [showNoHits, setShowNoHits] = useState(false)
  const searchReqId = useRef(0)
  const wasSearchingRef = useRef(false)

  const runSearch = useCallback(
    async (needle: string, reqId: number) => {
      const s = needle.trim()
      setToast(null)
      if (s.length < 2) {
        if (reqId === searchReqId.current) {
          setResults([])
          setShowNoHits(false)
          setSearchBusy(false)
          setSelected(null)
          setSaleDetailMeta(null)
          setLines([])
          setQtyByVariant({})
        }
        return
      }
      setSearchBusy(true)
      setShowNoHits(false)
      try {
        const { results: rows } = await fetchSalesSearchForReturn(s)
        if (reqId !== searchReqId.current) return
        setResults(rows)
        setSelected(null)
        setSaleDetailMeta(null)
        setLines([])
        setQtyByVariant({})
        setShowNoHits(rows.length === 0)
      } catch {
        if (reqId !== searchReqId.current) return
        setToast({ kind: 'err', message: t('err.API_ERROR') })
        setResults([])
        setShowNoHits(false)
      } finally {
        if (reqId === searchReqId.current) setSearchBusy(false)
      }
    },
    [t],
  )

  useEffect(() => {
    const s = q.trim()
    if (s.length < 2) {
      if (wasSearchingRef.current) {
        searchReqId.current += 1
        wasSearchingRef.current = false
      }
      setResults([])
      setShowNoHits(false)
      setSearchBusy(false)
      setSelected(null)
      setSaleDetailMeta(null)
      setLines([])
      setQtyByVariant({})
      return
    }
    wasSearchingRef.current = true
    const id = window.setTimeout(() => {
      const reqId = ++searchReqId.current
      void runSearch(q, reqId)
    }, RETURN_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [q, runSearch])

  const applyReturnLinesResponse = useCallback(
    (out: Awaited<ReturnType<typeof fetchSaleReturnLines>>, opts?: { toastOnEmpty?: boolean }) => {
      setLines(out.lines)
      setReturnState(out.return_state ?? (out.lines.length ? 'returnable' : 'fully_returned'))
      setRefundCapacity(out.refund_capacity ?? {})
      setSaleDetailMeta({
        completed_at: out.completed_at,
        cashier_username: out.cashier_username,
        grand_total: out.grand_total,
        payments: out.payments,
      })
      const init: Record<string, number> = {}
      for (const ln of out.lines) {
        init[ln.variant_id] = 0
      }
      setQtyByVariant(init)
      if (opts?.toastOnEmpty && !out.lines.length) {
        const state = out.return_state ?? 'fully_returned'
        if (state === 'no_lines') {
          setToast({ kind: 'err', message: t('admin.return.noSaleLines') })
        } else {
          setToast({ kind: 'err', message: t('admin.return.fullyReturned') })
        }
      }
    },
    [t],
  )

  const onPickSale = useCallback(
    async (row: SaleSearchForReturnRow) => {
      setSelected(row)
      setSaleDetailMeta(null)
      setLines([])
      setReturnState(null)
      setQtyByVariant({})
      setLinesBusy(true)
      setToast(null)
      try {
        const out = await fetchSaleReturnLines(row.sale_id)
        applyReturnLinesResponse(out, { toastOnEmpty: true })
      } catch {
        setToast({ kind: 'err', message: t('err.API_ERROR') })
      } finally {
        setLinesBusy(false)
      }
    },
    [applyReturnLinesResponse, t],
  )

  const returnUnits = useMemo(
    () => lines.reduce((acc, ln) => acc + (qtyByVariant[ln.variant_id] || 0), 0),
    [lines, qtyByVariant],
  )

  const returnAmountEst = useMemo(() => {
    let sum = 0
    for (const ln of lines) {
      const qty = qtyByVariant[ln.variant_id] || 0
      if (qty > 0) sum += lineNetUnit(ln) * qty
    }
    return sum
  }, [lines, qtyByVariant])

  const refundPreview = useMemo(
    () => allocateRefundPreview(returnAmountEst, refundCapacity),
    [returnAmountEst, refundCapacity],
  )

  useEffect(() => {
    if (autoRefund && returnUnits > 0) {
      setManualRefund(refundPreview)
    }
  }, [autoRefund, returnUnits, refundPreview])

  const manualRefundSum = useMemo(
    () => REFUND_METHODS.reduce((a, m) => a + (manualRefund[m] || 0), 0),
    [manualRefund],
  )

  const uiStep: 1 | 2 | 3 = !selected ? 1 : returnUnits > 0 ? 3 : 2

  function clearSelection() {
    setSelected(null)
    setSaleDetailMeta(null)
    setLines([])
    setReturnState(null)
    setRefundCapacity({})
    setQtyByVariant({})
  }

  function formatRefundSuccess(refunds?: Array<{ method: string; amount: string }>, total?: string) {
    if (!refunds?.length) return t('admin.return.done')
    const parts = refunds.map((r) => `${r.method} ${formatMoney(r.amount)}`).join(', ')
    return t('admin.return.doneWithRefund', { total: formatMoney(total || '0'), parts })
  }

  async function onSubmit() {
    if (!selected || !lines.length) return
    const linesPayload = lines
      .map((ln) => ({ variant_id: ln.variant_id, qty: qtyByVariant[ln.variant_id] || 0 }))
      .filter((x) => x.qty > 0)
    if (!linesPayload.length) {
      setToast({ kind: 'err', message: t('admin.return.pickQty') })
      return
    }
    for (const p of linesPayload) {
      const row = lines.find((l) => l.variant_id === p.variant_id)
      if (!row || p.qty > maxReturnQty(row)) {
        setToast({ kind: 'err', message: t('admin.return.qtyTooHigh') })
        return
      }
    }
    const roundedReturn = Math.round(returnAmountEst)
    if (!autoRefund && Math.round(manualRefundSum) !== roundedReturn) {
      setToast({ kind: 'err', message: t('admin.return.refundSumMismatch') })
      return
    }
    setSubmitBusy(true)
    setToast(null)
    try {
      const refundPayload = autoRefund
        ? { auto_refund: true as const }
        : {
            auto_refund: false as const,
            refunds: REFUND_METHODS.filter((m) => (manualRefund[m] || 0) > 0).map((m) => ({
              method: m,
              amount: String(Math.round(manualRefund[m])),
            })),
          }
      const result = await submitSaleReturn(selected.sale_id, {
        lines: linesPayload,
        reason: reason.trim() || undefined,
        ...refundPayload,
      })
      await requestAdminDataRefresh('sale-return')
      const out = await fetchSaleReturnLines(selected.sale_id)
      applyReturnLinesResponse(out)
      if (!out.lines.length) {
        setToast({
          kind: 'ok',
          message: formatRefundSuccess(result.refunds, result.return_amount) || t('admin.return.doneFully'),
        })
        clearSelection()
        if (q.trim().length >= 2) {
          void runSearch(q.trim(), searchReqId.current)
        }
      } else {
        setToast({
          kind: 'ok',
          message: formatRefundSuccess(result.refunds, result.return_amount),
        })
      }
    } catch (e: unknown) {
      const code = (e as Error & { code?: string }).code
      setToast({ kind: 'err', message: t(`err.${code || 'RETURN_FAILED'}`, { defaultValue: t('msg.errorGeneric') }) })
    } finally {
      setSubmitBusy(false)
    }
  }

  const panelHeader = selected ? resolvedHeader(selected, saleDetailMeta) : ({} as SalePanelHeader)
  const saleLabel = selected ? selected.public_sale_no || selected.sale_id.slice(0, 8) : ''

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold inline-flex items-center gap-2">
          <Receipt className="h-5 w-5 text-amber-400" />
          {t('admin.return.title')}
        </h2>
        <p className="text-sm text-slate-400 mt-1">{t('admin.return.intro')}</p>
      </div>

      <StepBar active={uiStep} />

      {toast && <ActionToast kind={toast.kind === 'ok' ? 'ok' : 'err'} message={toast.message} onClose={() => setToast(null)} />}

      {!selected && (
        <section className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 space-y-3">
          <label className="block text-xs text-slate-400">
            <span className="block mb-1 font-medium text-slate-300 inline-flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              {t('admin.return.search')}
            </span>
            <input
              type="text"
              inputMode="search"
              autoComplete="off"
              className={adminSearchInputCls}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('admin.return.searchPh')}
            />
          </label>
          <p className="text-xs text-slate-500">{t('admin.return.searchHint')}</p>

          {searchBusy && q.trim().length >= 2 && (
            <p className="text-sm text-slate-400">{t('admin.common.loading')}</p>
          )}

          {!searchBusy && q.trim().length >= 2 && showNoHits && (
            <p className="text-sm text-slate-400 rounded-lg border border-dashed border-slate-700 p-4 text-center">
              {t('admin.return.noHits')}
            </p>
          )}

          {results.length > 0 && (
            <ul className="space-y-2">
              <li className="text-xs text-slate-500 px-1">{t('admin.return.pickSale')}</li>
              {results.map((r) => {
                const itemCount = r.preview_lines?.length ?? 0
                return (
                  <li key={r.sale_id}>
                    <button
                      type="button"
                      className="touch-btn w-full text-left p-4 min-h-[3.5rem] rounded-xl border border-slate-700 bg-slate-950/60 hover:border-emerald-600/70 hover:bg-slate-900 transition-colors"
                      onClick={() => void onPickSale(r)}
                    >
                      <div className="flex justify-between gap-3 items-start">
                        <div>
                          <div className="font-semibold text-base">{r.public_sale_no || r.sale_id.slice(0, 8)}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {formatSaleWhen(r.completed_at)} · {r.cashier_username}
                          </div>
                          {itemCount > 0 && (
                            <div className="text-xs text-slate-500 mt-1">
                              {t('admin.return.itemCount', { count: itemCount })}
                            </div>
                          )}
                        </div>
                        <div className="text-lg font-semibold text-emerald-200 tabular-nums shrink-0">
                          {formatMoney(r.grand_total)}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {selected && (
        <section className="rounded-xl border border-amber-800/50 bg-slate-900/60 p-4 space-y-4">
          <div className="flex justify-between gap-2 items-start">
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">{t('admin.return.selectedSale')}</div>
              <div className="text-lg font-semibold mt-0.5">{saleLabel}</div>
              <div className="text-xs text-slate-400 mt-1">
                {formatSaleWhen(panelHeader.completed_at)} · {panelHeader.cashier_username}
              </div>
              <div className="text-sm text-emerald-200 tabular-nums mt-1">{formatMoney(panelHeader.grand_total)}</div>
            </div>
            <button
              type="button"
              className="touch-btn shrink-0 inline-flex items-center gap-1 text-sm px-3 py-2 rounded-xl bg-slate-800 border border-slate-600"
              onClick={clearSelection}
            >
              <ChevronLeft className="h-4 w-4" />
              {t('admin.return.back')}
            </button>
          </div>

          {linesBusy && <p className="text-sm text-slate-400">{t('admin.common.loading')}</p>}

          {!linesBusy && lines.length > 0 && (
            <>
              <p className="text-sm text-slate-300">{t('admin.return.qtyInstruction')}</p>
              <ul className="space-y-3">
                {lines.map((ln) => {
                  const max = maxReturnQty(ln)
                  const qty = qtyByVariant[ln.variant_id] ?? 0
                  return (
                    <li
                      key={ln.variant_id}
                      className={`rounded-xl border p-3 ${
                        qty > 0 ? 'border-amber-600/60 bg-amber-950/20' : 'border-slate-700 bg-slate-950/40'
                      }`}
                    >
                      <div className="grid sm:grid-cols-[1fr,auto] gap-3 items-center">
                        <div>
                          <div className="font-medium text-sm">
                            {pickLocalized(ln.product_name_uz, ln.product_name_ru, langRu)}
                          </div>
                          <div className="text-xs text-slate-500">
                            {pickLocalized(ln.category_name_uz, ln.category_name_ru, langRu)}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5 font-mono">{ln.barcode}</div>
                          <div className="text-xs text-slate-400">
                            {pickLocalized(ln.size_label_uz, ln.size_label_ru, langRu)}
                            {' / '}
                            {pickLocalized(ln.color_label_uz, ln.color_label_ru, langRu)}
                          </div>
                          <p className="text-xs text-slate-500 mt-1">
                            {t('admin.return.canReturn', { remaining: max, sold: ln.sold_qty })}
                          </p>
                        </div>
                        <ReturnQtyStepper
                          value={qty}
                          max={max}
                          disabled={submitBusy}
                          onChange={(n) => setQtyByVariant((p) => ({ ...p, [ln.variant_id]: n }))}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {!linesBusy && lines.length === 0 && (
            <p className="text-sm text-slate-400">
              {returnState === 'no_lines'
                ? t('admin.return.noSaleLines')
                : t('admin.return.fullyReturned')}
            </p>
          )}

          {returnUnits > 0 && (
            <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 p-3 text-sm">
              <div className="font-medium text-amber-100">{t('admin.return.summaryTitle')}</div>
              <p className="text-amber-200/90 mt-1 tabular-nums">
                {t('admin.return.summaryItems', {
                  count: returnUnits,
                  amount: formatMoney(String(Math.round(returnAmountEst))),
                })}
              </p>
              <p className="text-xs text-slate-500 mt-1">{t('admin.return.summaryNote')}</p>
            </div>
          )}

          {returnUnits > 0 && (
            <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-3 space-y-3 text-sm">
              <div className="font-medium text-slate-200">{t('admin.return.refundTitle')}</div>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefund}
                  onChange={(e) => setAutoRefund(e.target.checked)}
                  className="rounded"
                />
                {t('admin.return.autoRefund')}
              </label>
              {REFUND_METHODS.map((method) => {
                const cap = parseCap(refundCapacity[method])
                if (cap <= 0 && autoRefund) return null
                return (
                  <label key={method} className="block text-xs text-slate-400">
                    <span className="text-slate-300">{t(`admin.return.refund${method}`)}</span>
                    {cap > 0 && (
                      <span className="text-slate-500 ml-1">
                        ({t('admin.return.refundMax', { amount: formatMoney(String(cap)) })})
                      </span>
                    )}
                    <input
                      type="number"
                      min={0}
                      max={cap || undefined}
                      disabled={autoRefund || submitBusy}
                      className={`${adminInputCls} mt-1 tabular-nums`}
                      value={autoRefund ? refundPreview[method] : manualRefund[method]}
                      onChange={(e) => {
                        const n = Math.max(0, Math.round(Number(e.target.value) || 0))
                        setManualRefund((p) => ({ ...p, [method]: cap > 0 ? Math.min(n, cap) : n }))
                      }}
                    />
                  </label>
                )
              })}
              {!autoRefund && Math.round(manualRefundSum) !== Math.round(returnAmountEst) && (
                <p className="text-xs text-red-400">{t('admin.return.refundSumMismatch')}</p>
              )}
            </div>
          )}

          <label className="block text-xs text-slate-400">
            <span className="block mb-1 font-medium text-slate-300">{t('admin.return.reason')}</span>
            <input
              type="text"
              autoComplete="off"
              className={adminInputCls}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          <button
            type="button"
            disabled={submitBusy || linesBusy || !lines.length || returnUnits <= 0}
            className="touch-btn w-full min-h-14 px-5 rounded-xl bg-amber-700 border border-amber-500 text-base font-semibold disabled:opacity-40"
            onClick={() => void onSubmit()}
          >
            {submitBusy ? t('admin.common.loading') : t('admin.return.confirm')}
          </button>
        </section>
      )}
    </div>
  )
}
