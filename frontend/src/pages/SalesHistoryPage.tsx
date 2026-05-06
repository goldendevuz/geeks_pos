import type { SaleHistoryRow } from '../api'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { List, type RowComponentProps } from 'react-window'
import { formatMoney } from '../utils/money'
import { ActionToast } from '../components/ActionToast'
import { playUiSound } from '../utils/uiSound'

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
  const { t } = useTranslation()
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
                const message = t(`err.${code || 'EXPORT_SALES_FAILED'}`, { defaultValue: t('err.API_ERROR') })
                setActionToast({ kind: 'err', message })
              } finally {
                setExportBusy(false)
              }
            }}
          >
            {exportBusy ? t('admin.common.loading') : t('admin.sales.exportCsv')}
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
        <p className="text-xs text-amber-400">
          {t('admin.sales.cashierDefaultToday', { defaultValue: "Cashier uchun sukut bo'yicha bugungi sotuvlar ko'rsatiladi." })}
        </p>
      )}
      <div className="rounded border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="text-left p-2">{t('admin.sales.saleId')}</th>
              <th className="text-left p-2">{t('admin.sales.cashier')}</th>
              <th className="text-left p-2">{t('admin.sales.time')}</th>
              <th className="text-left p-2">{t('admin.sales.status')}</th>
              <th className="text-right p-2">{t('admin.sales.total')}</th>
              <th className="text-right p-2">{t('admin.sales.action')}</th>
            </tr>
          </thead>
          {!useVirtualRows && (
          <tbody>
            {sales.map((s) => (
              <tr key={s.id} className="border-t border-slate-800">
                <td className="p-2">{s.public_sale_no || s.id.slice(0, 8)}</td>
                <td className="p-2">{s.cashier_username}</td>
                <td className="p-2">{new Date(s.completed_at).toLocaleString()}</td>
                <td className="p-2">{t(`status.${s.status}`, { defaultValue: s.status })}</td>
                <td className="p-2 text-right">{formatMoney(s.grand_total)}</td>
                <td className="p-2 text-right">
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-3 rounded-xl bg-slate-800 border border-slate-600 text-sm font-medium"
                      onClick={async () => {
                        try {
                          await onReprint(s.id)
                          setActionToast({ kind: 'ok', message: t('admin.sales.reprintSuccess') })
                        } catch (e: unknown) {
                          const rawMessage = e instanceof Error ? e.message : String(e || '')
                          if (rawMessage.startsWith('Printer ulanmagan:')) {
                            setActionToast({ kind: 'err', message: rawMessage })
                            return
                          }
                          const code = (e as Error & { code?: string }).code
                          const message = t(`err.${code || 'PRINT_FAILED'}`, { defaultValue: t('msg.printFailed') })
                          setActionToast({ kind: 'err', message })
                        }
                      }}
                    >
                      {t('admin.sales.reprint')}
                    </button>
                    {canVoid && s.status !== 'VOIDED' && (
                      <button
                        type="button"
                        className="touch-btn min-h-12 px-3 rounded-xl bg-red-800 border border-red-600 text-sm font-medium"
                        onClick={() => setVoiding(s)}
                      >
                        {t('admin.sales.void')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-slate-500">
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
                <div style={style} className="grid grid-cols-[1.1fr_1fr_1.2fr_0.9fr_0.8fr_1.7fr] items-center border-b border-slate-800 px-2 text-sm">
                  <div>{s.public_sale_no || s.id.slice(0, 8)}</div>
                  <div>{s.cashier_username}</div>
                  <div>{new Date(s.completed_at).toLocaleString()}</div>
                  <div>{t(`status.${s.status}`, { defaultValue: s.status })}</div>
                  <div className="text-right">{formatMoney(s.grand_total)}</div>
                  <div className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        className="touch-btn min-h-10 px-3 rounded-xl bg-slate-800 border border-slate-600 text-sm font-medium"
                        onClick={async () => {
                          try {
                            await onReprint(s.id)
                            setActionToast({ kind: 'ok', message: t('admin.sales.reprintSuccess') })
                          } catch (e: unknown) {
                            const rawMessage = e instanceof Error ? e.message : String(e || '')
                            if (rawMessage.startsWith('Printer ulanmagan:')) {
                              setActionToast({ kind: 'err', message: rawMessage })
                              return
                            }
                            const code = (e as Error & { code?: string }).code
                            const message = t(`err.${code || 'PRINT_FAILED'}`, { defaultValue: t('msg.printFailed') })
                            setActionToast({ kind: 'err', message })
                          }
                        }}
                      >
                        {t('admin.sales.reprint')}
                      </button>
                      {canVoid && s.status !== 'VOIDED' && (
                        <button
                          type="button"
                          className="touch-btn min-h-10 px-3 rounded-xl bg-red-800 border border-red-600 text-sm font-medium"
                          onClick={() => setVoiding(s)}
                        >
                          {t('admin.sales.void')}
                        </button>
                      )}
                    </div>
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
