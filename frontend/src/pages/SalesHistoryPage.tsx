import type { SaleHistoryRow } from '../api'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { List, type RowComponentProps } from 'react-window'
import { formatMoney, netMoney, toIntAmount } from '../utils/money'
import { dateLocale as resolveDateLocale } from '../utils/localizedName'
import { isPrinterError, translatePrinterError } from '../utils/printerErrors'
import { ActionToast } from '../components/ActionToast'
import { playUiSound } from '../utils/uiSound'

function showVoidButton(s: SaleHistoryRow, canVoid: boolean) {
  return canVoid && s.status !== 'VOIDED' && (s.can_void ?? true)
}

function StatusBadges({
  s,
  t,
}: {
  s: SaleHistoryRow
  t: (key: string, opts?: { defaultValue?: string }) => string
}) {
  const statusClass =
    s.status === 'VOIDED'
      ? 'bg-red-950/60 text-red-200 border-red-800/80'
      : 'bg-emerald-950/50 text-emerald-200 border-emerald-800/70'
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={`inline-block px-2 py-0.5 rounded-md text-xs border ${statusClass}`}>
        {t(`status.${s.status}`, { defaultValue: s.status })}
      </span>
      {s.return_status === 'partial' && (
        <span className="inline-block px-2 py-0.5 rounded-md text-xs border border-amber-700/80 bg-amber-950/50 text-amber-200">
          {t('admin.sales.badgePartial')}
        </span>
      )}
      {s.return_status === 'full' && (
        <span className="inline-block px-2 py-0.5 rounded-md text-xs border border-sky-700/80 bg-sky-950/50 text-sky-200">
          {t('admin.sales.badgeFull')}
        </span>
      )}
    </div>
  )
}

function SaleRowActions({
  s,
  canVoid,
  t,
  onReprint,
  onVoidClick,
  setActionToast,
  compact,
}: {
  s: SaleHistoryRow
  canVoid: boolean
  t: (key: string, opts?: { defaultValue?: string }) => string
  onReprint: (saleId: string) => Promise<void>
  onVoidClick: () => void
  setActionToast: (v: { kind: 'ok' | 'err'; message: string }) => void
  compact?: boolean
}) {
  const btn = compact ? 'touch-btn min-h-10 px-3 rounded-xl text-sm font-medium' : 'touch-btn min-h-12 px-3 rounded-xl text-sm font-medium'
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="inline-flex items-center gap-2">
        <button
          type="button"
          className={`${btn} bg-slate-800 border border-slate-600`}
          onClick={async () => {
            try {
              await onReprint(s.id)
              setActionToast({ kind: 'ok', message: t('admin.sales.reprintSuccess') })
            } catch (e: unknown) {
              const rawMessage = e instanceof Error ? e.message : String(e || '')
              if (isPrinterError(rawMessage)) {
                setActionToast({ kind: 'err', message: translatePrinterError(rawMessage) })
                return
              }
              const code = (e as Error & { code?: string }).code
              setActionToast({
                kind: 'err',
                message: t(`err.${code || 'PRINT_FAILED'}`),
              })
            }
          }}
        >
          {t('admin.sales.reprint')}
        </button>
        {showVoidButton(s, canVoid) && (
          <button
            type="button"
            className={`${btn} bg-red-800 border border-red-600`}
            onClick={onVoidClick}
          >
            {t('admin.sales.void')}
          </button>
        )}
      </div>
      {canVoid && s.status === 'COMPLETED' && s.can_void === false && (
        <span className="text-xs text-slate-500 max-w-[14rem] text-right">{t('admin.sales.voidDisabledReturned')}</span>
      )}
    </div>
  )
}

export function SalesHistoryPage({
  sales,
  count,
  page,
  onPage,
  onFilter,
  onExport,
  onVoid,
  onReprint,
  canVoid,
  canExport = true,
  isCashier = false,
}: {
  sales: SaleHistoryRow[]
  count: number
  page: number
  onPage: (p: number) => void
  onFilter: (from: string, to: string, q: string) => void
  onExport: () => Promise<void>
  onVoid: (saleId: string, reason: string) => Promise<void>
  onReprint: (saleId: string) => Promise<void>
  canVoid: boolean
  canExport?: boolean
  isCashier?: boolean
}) {
  const { t, i18n } = useTranslation()
  const dateLocaleStr = resolveDateLocale(i18n.language)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState('')
  const [voiding, setVoiding] = useState<SaleHistoryRow | null>(null)
  const [reason, setReason] = useState('')
  const [actionToast, setActionToast] = useState<{
    kind: 'ok' | 'err'
    message: string
  } | null>(null)
  const [voidBusy, setVoidBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const maxPage = Math.max(1, Math.ceil(count / 20))
  const useVirtualRows = sales.length > 12

  useEffect(() => {
    const timer = setTimeout(() => onFilter(from, to, query.trim()), 300)
    return () => clearTimeout(timer)
  }, [from, to, query, onFilter])

  useEffect(() => {
    if (voiding) playUiSound('confirm')
  }, [voiding])

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">{t('admin.sales.title')}</h2>
      {actionToast && (
        <ActionToast kind={actionToast.kind} message={actionToast.message} onClose={() => setActionToast(null)} />
      )}
      <div className="sticky top-0 z-10 flex flex-wrap gap-2 items-center rounded-xl border border-slate-800 bg-slate-950/95 p-2 backdrop-blur">
        <input type="date" className="touch-btn min-h-12 px-3 rounded-xl bg-slate-900 border border-slate-700" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="touch-btn min-h-12 px-3 rounded-xl bg-slate-900 border border-slate-700" value={to} onChange={(e) => setTo(e.target.value)} />
        <input
          className="touch-btn min-h-12 flex-1 min-w-[10rem] px-3 rounded-xl bg-slate-900 border border-slate-700"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.sales.searchPlaceholder')}
        />
        {canExport && (
          <button
            type="button"
            disabled={exportBusy}
            className="touch-btn min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-700 font-medium disabled:opacity-50"
            onClick={async () => {
              setExportBusy(true)
              try {
                await onExport()
                setActionToast({ kind: 'ok', message: t('admin.sales.exportSuccess') })
              } catch (e: unknown) {
                const code = (e as Error & { code?: string }).code
                const message = t(`err.${code || 'EXPORT_SALES_FAILED'}`)
                setActionToast({ kind: 'err', message })
              } finally {
                setExportBusy(false)
              }
            }}
          >
            {exportBusy ? t('admin.common.loading') : t('admin.sales.exportExcel')}
          </button>
        )}
        <button
          type="button"
          className="touch-btn min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-700 font-medium"
          onClick={() => {
            setFrom('')
            setTo('')
            setQuery('')
          }}
        >
          {t('admin.common.reset')}
        </button>
      </div>
      <p className="text-xs text-slate-400">{t('admin.sales.hint')}</p>
      {isCashier && !from && !to && (
        <p className="text-xs text-amber-400">{t('admin.sales.cashierDefaultToday')}</p>
      )}
      <div className="rounded border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="text-left p-2">{t('admin.sales.saleId')}</th>
              <th className="text-left p-2">{t('admin.sales.cashier')}</th>
              <th className="text-left p-2">{t('admin.sales.time')}</th>
              <th className="text-left p-2">{t('admin.sales.status')}</th>
              <th className="text-right p-2">{t('admin.sales.grossTotal')}</th>
              <th className="text-right p-2">{t('admin.sales.netTotal')}</th>
              <th className="text-right p-2">{t('admin.sales.action')}</th>
            </tr>
          </thead>
          {!useVirtualRows && (
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="p-2">{s.public_sale_no || s.id.slice(0, 8)}</td>
                <td className="p-2">{s.cashier_username}</td>
                <td className="p-2 whitespace-nowrap">{new Date(s.completed_at).toLocaleString(dateLocaleStr)}</td>
                <td className="p-2">
                  <StatusBadges s={s} t={t} />
                  {toIntAmount(s.refund_total) > 0 && (
                    <div className="text-xs text-amber-400/90 mt-1">
                      {t('admin.sales.refundTotal', { amount: formatMoney(s.refund_total) })}
                    </div>
                  )}
                </td>
                <td className="p-2 text-right tabular-nums">{formatMoney(s.grand_total)}</td>
                <td className="p-2 text-right tabular-nums font-medium">{netMoney(s.grand_total, s.refund_total)}</td>
                <td className="p-2 text-right">
                  <SaleRowActions
                    s={s}
                    canVoid={canVoid}
                    t={t}
                    onReprint={onReprint}
                    onVoidClick={() => setVoiding(s)}
                    setActionToast={setActionToast}
                  />
                </td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-500">
                  {t('admin.sales.empty')}
                </td>
              </tr>
            )}
          </tbody>
          )}
        </table>
        {useVirtualRows && (
          <List
            defaultHeight={Math.min(560, Math.max(220, sales.length * 64))}
            rowCount={sales.length}
            rowHeight={64}
            style={{ height: Math.min(560, Math.max(220, sales.length * 64)), width: '100%' }}
            rowComponent={({ index, style, rows }: RowComponentProps<{ rows: SaleHistoryRow[] }>) => {
              const s = rows[index]
              return (
                <div
                  style={style}
                  className="grid grid-cols-[1fr_1fr_1.1fr_1.2fr_0.75fr_0.75fr_1.4fr] items-center border-b border-slate-800 px-2 text-sm gap-1"
                >
                  <div>{s.public_sale_no || s.id.slice(0, 8)}</div>
                  <div>{s.cashier_username}</div>
                  <div className="text-xs">{new Date(s.completed_at).toLocaleString(dateLocaleStr)}</div>
                  <div>
                    <StatusBadges s={s} t={t} />
                  </div>
                  <div className="text-right tabular-nums">{formatMoney(s.grand_total)}</div>
                  <div className="text-right tabular-nums font-medium">{netMoney(s.grand_total, s.refund_total)}</div>
                  <div className="text-right">
                    <SaleRowActions
                      s={s}
                      canVoid={canVoid}
                      t={t}
                      onReprint={onReprint}
                      onVoidClick={() => setVoiding(s)}
                      setActionToast={setActionToast}
                      compact
                    />
                  </div>
                </div>
              )
            }}
            rowProps={{ rows: sales }}
            className="border-t border-slate-800"
          />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="touch-btn min-h-12 px-5 rounded-xl bg-slate-800 border border-slate-700 font-medium"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {t('admin.common.prev')}
        </button>
        <div className="px-3 py-2 text-sm text-slate-400">
          {t('admin.common.pageOf', { page, maxPage })}
        </div>
        <button
          type="button"
          className="touch-btn min-h-12 px-5 rounded-xl bg-slate-800 border border-slate-700 font-medium"
          disabled={page >= maxPage}
          onClick={() => onPage(page + 1)}
        >
          {t('admin.common.next')}
        </button>
      </div>
      {voiding && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded border border-slate-700 bg-slate-900 p-4 space-y-3">
            <h3 className="text-lg font-semibold">
              {t('admin.sales.voidTitle', { saleId: voiding.id.slice(0, 8) })}
            </h3>
            <textarea
              className="touch-btn w-full min-h-24 px-3 py-3 rounded-xl bg-slate-950 border border-slate-700"
              placeholder={t('admin.sales.voidReason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex justify-end gap-3">
              <button type="button" className="touch-btn min-h-12 px-5 rounded-xl bg-slate-800 border border-slate-700" onClick={() => setVoiding(null)}>
                {t('admin.common.cancel')}
              </button>
              <button
                type="button"
                className="touch-btn min-h-12 px-5 rounded-xl bg-red-700 border border-red-500 disabled:opacity-50 font-medium"
                disabled={voidBusy}
                onClick={async () => {
                  if (!canVoid) {
                    setActionToast({ kind: 'err', message: t('err.PERMISSION_DENIED') })
                    return
                  }
                  setVoidBusy(true)
                  try {
                    await onVoid(voiding.id, reason)
                    setActionToast({ kind: 'ok', message: t('admin.sales.voidSuccess') })
                    setVoiding(null)
                    setReason('')
                  } catch (e: unknown) {
                    const code = (e as Error & { code?: string }).code
                    const message = t(`err.${code || 'VOID_FAILED'}`, {
                      defaultValue: t('err.VOID_FAILED'),
                    })
                    setActionToast({ kind: 'err', message })
                  } finally {
                    setVoidBusy(false)
                  }
                }}
              >
                {voidBusy ? t('admin.sales.voiding') : t('admin.sales.confirmVoid')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
