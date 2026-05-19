import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CashierStockVariant, Paginated, UserRole, Variant } from '../api'
import { fetchCashierStockVariants, fetchVariants } from '../api'
import { formatMoney } from '../utils/money'
import { ActionToast } from '../components/ActionToast'

export function CashStockPage({ role }: { role: UserRole | null }) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Paginated<CashierStockVariant | Variant> | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const showPurchase = role === 'OWNER' || role === 'ADMIN'

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300)
    return () => window.clearTimeout(id)
  }, [query])

  useEffect(() => {
    setPage(1)
  }, [debounced])

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    const load = showPurchase
      ? fetchVariants({ q: debounced || undefined, page, pageSize: 20, ordering: 'name' })
      : fetchCashierStockVariants({ q: debounced || undefined, page, pageSize: 20 })
    void load
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        if (!cancelled) setToast(t('err.API_ERROR'))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced, page, showPurchase, t])

  const maxPage = data ? Math.max(1, Math.ceil(data.count / 20)) : 1
  const rows = data?.results ?? []
  const colSpan = showPurchase ? 7 : 6
  const langRu = i18n.language.startsWith('ru')

  function rowBrand(v: CashierStockVariant | Variant): string {
    const uz = 'category_name_uz' in v ? v.category_name_uz : undefined
    if (!uz) return '—'
    return langRu ? v.category_name_ru || uz : uz
  }

  function stockRowClass(v: CashierStockVariant | Variant) {
    if (!v.is_active) {
      return 'bg-violet-950/30 border-l-[3px] border-violet-500/55 text-slate-400'
    }
    if (Number(v.stock_qty ?? 0) <= 0) {
      return 'bg-amber-950/40 border-l-[3px] border-amber-600/90 text-slate-100'
    }
    return ''
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">{t('admin.cashier.stockTitle')}</h2>
      <p className="text-sm text-slate-400">
        {showPurchase ? t('admin.cashier.stockHintAdmin') : t('admin.cashier.stockHint')}
      </p>
      {toast && <ActionToast kind="err" message={toast} onClose={() => setToast(null)} />}
      <input
        className="touch-btn w-full max-w-xl min-h-12 px-3 rounded-xl bg-slate-900 border border-slate-700"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('admin.catalog.searchPlaceholder')}
      />
      <div className="rounded border border-slate-700 overflow-x-auto kiosk-scrollbar">
        <table className="w-full text-sm min-w-[56rem]">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="text-left p-2">{t('admin.catalog.brand')}</th>
              <th className="text-left p-2">{t('admin.catalog.product')}</th>
              <th className="text-left p-2">{t('admin.catalog.sizeColor')}</th>
              <th className="text-left p-2">{t('admin.catalog.barcode')}</th>
              <th className="text-right p-2">{t('admin.catalog.stock')}</th>
              {showPurchase && (
                <th className="text-right p-2">{t('admin.catalog.purchasePrice')}</th>
              )}
              <th className="text-right p-2">{t('admin.catalog.price')}</th>
            </tr>
          </thead>
          <tbody>
            {busy && rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="p-4 text-slate-500">
                  {t('admin.common.loading')}
                </td>
              </tr>
            ) : (
              rows.map((v) => (
                <tr key={v.id} className={`border-t border-slate-800 ${stockRowClass(v)}`}>
                  <td className="p-2 text-slate-300">{rowBrand(v)}</td>
                  <td className="p-2">
                    {langRu ? v.product_name_ru || v.product_name_uz : v.product_name_uz}
                  </td>
                  <td className="p-2">
                    {langRu ? v.size_label_ru || v.size_label_uz : v.size_label_uz} /{' '}
                    {langRu ? v.color_label_ru || v.color_label_uz : v.color_label_uz}
                  </td>
                  <td className="p-2 font-mono text-xs">{v.barcode}</td>
                  <td className="p-2 text-right tabular-nums">{v.stock_qty}</td>
                  {showPurchase && (
                    <td className="p-2 text-right tabular-nums">{formatMoney(v.purchase_price)}</td>
                  )}
                  <td className="p-2 text-right tabular-nums">{formatMoney(v.list_price)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          disabled={page <= 1 || busy}
          className="touch-btn min-h-11 px-3 rounded-xl bg-slate-800 border border-slate-600 disabled:opacity-40"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          {t('admin.common.prev')}
        </button>
        <span className="text-slate-400">
          {t('admin.common.pageOf', { page, maxPage })}
        </span>
        <button
          type="button"
          disabled={page >= maxPage || busy}
          className="touch-btn min-h-11 px-3 rounded-xl bg-slate-800 border border-slate-600 disabled:opacity-40"
          onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
        >
          {t('admin.common.next')}
        </button>
      </div>
    </div>
  )
}
