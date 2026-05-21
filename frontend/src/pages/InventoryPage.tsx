import { useEffect, useMemo, useState, useCallback } from 'react'
import type { StocktakeSession, Variant } from '../api'
import { fetchVariants } from '../api'
import { useTranslation } from 'react-i18next'
import { ActionToast } from '../components/ActionToast'
import { filterVariantsForPicker, stocktakeLineMatchesSearch } from '../utils/variantSearch'

type InventoryMode = 'receive' | 'adjust' | 'stocktake'

function isVariantPickable(v: Variant): boolean {
  return v.is_active && v.deleted_at == null
}

function VariantSearchPicker(props: {
  variants: Variant[]
  variantId: string
  onSelect: (id: string) => void
  langRu: boolean
}) {
  const { t } = useTranslation()
  const { variants, variantId, onSelect, langRu } = props
  const [q, setQ] = useState('')
  const [apiHits, setApiHits] = useState<Variant[] | null>(null)
  const [searching, setSearching] = useState(false)

  const pool = apiHits ?? variants

  const filtered = useMemo(() => filterVariantsForPicker(pool, q, 24), [pool, q])

  useEffect(() => {
    const tq = q.trim()
    if (tq.length < 2) {
      setApiHits(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      void fetchVariants({ q: tq, page: 1, pageSize: 50, ordering: 'name' })
        .then((res) => {
          if (!cancelled) setApiHits(res.results.filter(isVariantPickable))
        })
        .catch(() => {
          if (!cancelled) setApiHits(null)
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [q])

  useEffect(() => {
    const tq = q.trim()
    if (tq.length < 3) return
    const exact = pool.find((v) => isVariantPickable(v) && v.barcode && v.barcode.toLowerCase() === tq.toLowerCase())
    if (exact && exact.id !== variantId) onSelect(exact.id)
  }, [q, pool, variantId, onSelect])

  const picked =
    variants.find((v) => v.id === variantId) ?? pool.find((v) => v.id === variantId) ?? null

  return (
    <div className="space-y-3">
      <label className="block text-xs text-slate-400">
        <span className="block mb-1 font-medium text-slate-300">{t('admin.inventory.barcodeSearch')}</span>
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          className="touch-btn w-full min-h-[3rem] px-4 text-lg rounded-xl bg-slate-950 border border-slate-700"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('admin.inventory.searchPlaceholder')}
        />
      </label>
      {!picked ? (
        <p className="text-xs text-amber-200/90">{t('admin.inventory.pickFromListHint')}</p>
      ) : (
        <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/30 p-3">
          <div className="flex justify-between gap-2 items-start">
            <div>
              <div className="text-base font-semibold text-slate-100">{picked ? pickProductName(picked, langRu) : ''}</div>
              <div className="text-sm text-slate-400 mt-1">
                {t('admin.catalog.barcode')}: <span className="text-slate-200 font-mono">{picked.barcode ?? '—'}</span>
              </div>
              <div className="text-sm text-slate-400">
                {t('admin.inventory.currentStock')}:{' '}
                <span className="font-semibold text-slate-100 tabular-nums">{picked.stock_qty}</span>
              </div>
            </div>
            <button
              type="button"
              className="touch-btn shrink-0 text-sm px-3 py-2 rounded-lg bg-slate-800 border border-slate-600"
              onClick={() => {
                setQ('')
                onSelect('')
              }}
            >
              {t('admin.inventory.changePick')}
            </button>
          </div>
        </div>
      )}
      {searching && q.trim().length >= 2 && (
        <p className="text-xs text-slate-500">{t('admin.common.loading')}</p>
      )}
      {!picked && filtered.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-slate-500">{t('admin.inventory.tapPick')}</div>
          <ul className="max-h-52 overflow-y-auto kiosk-scrollbar rounded-xl border border-slate-800 divide-y divide-slate-800">
            {filtered.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className="w-full text-left p-3 min-h-[3rem] hover:bg-slate-800/80 active:bg-slate-800 transition-colors"
                  onClick={() => onSelect(v.id)}
                >
                  <div className="font-medium">{pickProductName(v, langRu)}</div>
                  {pickCategoryName(v, langRu) ? (
                    <div className="text-xs text-slate-500">{pickCategoryName(v, langRu)}</div>
                  ) : null}
                  <div className="text-xs text-slate-400">
                    <span className="font-mono">{v.barcode ?? '—'}</span>
                    {' · '}
                    <span className="tabular-nums">{v.stock_qty}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!picked && !searching && q.trim().length >= 2 && filtered.length === 0 && (
        <p className="text-sm text-slate-500">{t('admin.inventory.noneFound')}</p>
      )}
    </div>
  )
}

function pickProductName(v: Variant, langRu: boolean): string {
  if (langRu && (v.product_name_ru ?? '').trim()) return v.product_name_ru!.trim()
  return (v.product_name_uz ?? '').trim() || (v.product_name_ru ?? '').trim() || '—'
}

function pickCategoryName(v: Variant, langRu: boolean): string {
  if (langRu && (v.category_name_ru ?? '').trim()) return v.category_name_ru!.trim()
  return (v.category_name_uz ?? '').trim() || (v.category_name_ru ?? '').trim() || ''
}

function QtyStepper(props: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const { value, onChange, disabled } = props
  const n = Number(value || '0')
  const safe = Number.isFinite(n) ? n : 0
  const set = (x: number) => onChange(String(x))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-2 flex-1 min-w-[12rem]">
        {([-1, 1, 5] as const).map((d) => (
          <button
            key={`m${d}`}
            type="button"
            disabled={disabled}
            className="touch-btn flex-1 min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-600 font-semibold disabled:opacity-40"
            onClick={() => set(Math.max(0, safe + d))}
          >
            {d > 0 ? `+${d}` : `${d}`}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          className="touch-btn flex-1 min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-600 font-semibold disabled:opacity-40"
          onClick={() => set(Math.max(0, safe + 10))}
        >
          +10
        </button>
      </div>
      <input
        type="number"
        inputMode="numeric"
        disabled={disabled}
        className="touch-btn w-28 min-h-12 px-2 rounded-xl bg-slate-950 border border-slate-700 text-center text-lg tabular-nums font-medium"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('admin.inventory.qty')}
      />
    </div>
  )
}

function DeltaStepper(props: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const { value, onChange, disabled } = props
  const n = Number(value || '0')
  const safe = Number.isFinite(n) ? n : 0
  const set = (x: number) => onChange(String(x))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1">
        {([-5, -1, 1, 5] as const).map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            className="touch-btn min-h-12 px-3 rounded-xl bg-slate-800 border border-slate-600 font-semibold disabled:opacity-40"
            onClick={() => set(safe + d)}
          >
            {d > 0 ? `+${d}` : `${d}`}
          </button>
        ))}
      </div>
      <input
        type="number"
        inputMode="numeric"
        disabled={disabled}
        className="touch-btn w-28 min-h-12 px-2 rounded-xl bg-slate-950 border border-slate-700 text-center text-lg tabular-nums font-medium"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function InventoryPage({
  variants,
  stocktake,
  onReceive,
  onAdjust,
  onCreateStocktake,
  onReloadOpen,
  onSetCount,
  onApplyStocktake,
}: {
  variants: Variant[]
  stocktake: StocktakeSession | null
  onReceive: (variantId: string, qty: number, note: string) => Promise<void>
  onAdjust: (variantId: string, qtyDelta: number, note: string) => Promise<void>
  onCreateStocktake: (note: string) => Promise<void>
  onReloadOpen: () => Promise<void>
  onSetCount: (variantId: string, countedQty: number) => Promise<void>
  onApplyStocktake: () => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const langRu = i18n.language.startsWith('ru')
  const [mode, setMode] = useState<InventoryMode>('receive')
  const [variantId, setVariantId] = useState('')
  const [qty, setQty] = useState('1')
  const [qtyDelta, setQtyDelta] = useState('0')
  const [note, setNote] = useState('')
  const [stocktakeNote, setStocktakeNote] = useState('')
  const [stocktakeBarcodeFilter, setStocktakeBarcodeFilter] = useState('')
  const [countByVariant, setCountByVariant] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; message: string } | null>(null)

  const selectedVariant = useMemo(() => variants.find((v) => v.id === variantId) || null, [variants, variantId])
  const receiveQty = Number(qty || '0')
  const adjustQty = Number(qtyDelta || '0')
  const receiveAfter = selectedVariant
    ? selectedVariant.stock_qty + (Number.isFinite(receiveQty) ? Math.max(0, receiveQty) : 0)
    : null
  const adjustAfter = selectedVariant
    ? selectedVariant.stock_qty + (Number.isFinite(adjustQty) ? adjustQty : 0)
    : null

  const stocktakeLinesFiltered = useMemo(() => {
    if (!stocktake) return []
    const n = stocktakeBarcodeFilter.trim()
    if (!n) return stocktake.lines
    return stocktake.lines.filter((ln) => stocktakeLineMatchesSearch(ln, n))
  }, [stocktake, stocktakeBarcodeFilter])

  const onSelectVariant = useCallback((id: string) => {
    setVariantId(id)
  }, [])

  async function runAction(fn: () => Promise<void>, okMessage: string) {
    setBusy(true)
    setToast(null)
    try {
      await fn()
      setToast({ kind: 'ok', message: okMessage })
    } catch (e: unknown) {
      const code = (e as Error & { code?: string }).code
      setToast({ kind: 'err', message: t(`err.${code || 'API_ERROR'}`) })
    } finally {
      setBusy(false)
    }
  }

  const modeTabs: { id: InventoryMode; label: string; desc: string }[] = [
    { id: 'receive', label: t('admin.inventory.modeReceiveShort'), desc: t('admin.inventory.receiveHint') },
    { id: 'adjust', label: t('admin.inventory.modeAdjustShort'), desc: t('admin.inventory.adjustHint') },
    { id: 'stocktake', label: t('admin.inventory.modeStocktakeShort'), desc: t('admin.inventory.stocktakeHint') },
  ]

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <h2 className="text-xl font-semibold">{t('admin.inventory.title')}</h2>
      <p className="text-sm text-slate-300">{t('admin.inventory.intro')}</p>
      <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3 text-sm text-slate-300">
        {mode === 'receive' && (
          <>
            <span className="font-medium text-emerald-400">1)</span> {t('admin.inventory.stepsReceive')}
          </>
        )}
        {mode === 'adjust' && (
          <>
            <span className="font-medium text-amber-400">1)</span> {t('admin.inventory.stepsAdjust')}
          </>
        )}
        {mode === 'stocktake' && (
          <>
            <span className="font-medium text-sky-400">1)</span> {t('admin.inventory.stepsStocktake')}
          </>
        )}
      </div>
      {toast && <ActionToast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {modeTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`touch-btn min-h-[3.5rem] px-4 py-3 rounded-xl border text-left transition-colors ${
              mode === tab.id
                ? 'bg-slate-800 border-slate-500 ring-2 ring-slate-500/40'
                : 'bg-slate-900/80 border-slate-700 hover:bg-slate-800/80'
            }`}
            onClick={() => setMode(tab.id)}
          >
            <div className="font-semibold">{tab.label}</div>
            <div className="text-xs text-slate-400 mt-0.5 line-clamp-2">{tab.desc}</div>
          </button>
        ))}
      </div>

      {(mode === 'receive' || mode === 'adjust') && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-4">
          <VariantSearchPicker variants={variants} variantId={variantId} onSelect={onSelectVariant} langRu={langRu} />

          {mode === 'receive' && (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-2 font-medium">{t('admin.inventory.howMuchArrived')}</label>
                <QtyStepper value={qty} onChange={setQty} disabled={busy || !variantId} />
              </div>
              {selectedVariant && (
                <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-4 py-3 text-base text-slate-200 space-y-1">
                  <div>
                    {t('admin.inventory.currentStock')}:{' '}
                    <span className="font-semibold tabular-nums">{selectedVariant.stock_qty}</span>
                  </div>
                  <div>
                    {t('admin.inventory.nextStock')}:{' '}
                    <span className="font-semibold text-emerald-300 tabular-nums">{receiveAfter}</span>
                  </div>
                </div>
              )}
              <input
                className="touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('admin.inventory.noteOptional')}
              />
              <button
                type="button"
                disabled={busy || !variantId || receiveQty <= 0}
                className="touch-btn w-full min-h-14 text-lg py-3 rounded-xl bg-emerald-700 border border-emerald-500 disabled:opacity-40 font-semibold"
                onClick={() =>
                  void runAction(
                    () => onReceive(variantId, Math.max(0, receiveQty), note),
                    t('admin.inventory.receiveSuccess'),
                  )
                }
              >
                {t('admin.inventory.receiveAction')}
              </button>
            </>
          )}

          {mode === 'adjust' && (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-2 font-medium">{t('admin.inventory.howMuchChange')}</label>
                <p className="text-xs text-slate-500 mb-2">{t('admin.inventory.deltaExplain')}</p>
                <DeltaStepper value={qtyDelta} onChange={setQtyDelta} disabled={busy || !variantId} />
              </div>
              {selectedVariant && (
                <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-4 py-3 text-base text-slate-200 space-y-1">
                  <div>
                    {t('admin.inventory.currentStock')}:{' '}
                    <span className="font-semibold tabular-nums">{selectedVariant.stock_qty}</span>
                  </div>
                  <div>
                    {t('admin.inventory.nextStock')}:{' '}
                    <span
                      className={`font-semibold tabular-nums ${
                        adjustAfter != null && adjustAfter < 0 ? 'text-red-400' : 'text-amber-200'
                      }`}
                    >
                      {adjustAfter}
                    </span>
                  </div>
                  {adjustAfter != null && adjustAfter < 0 && (
                    <p className="text-sm text-red-300">{t('admin.inventory.negativeStockWarn')}</p>
                  )}
                </div>
              )}
              <input
                className="touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('admin.inventory.noteWhy')}
              />
              <button
                type="button"
                disabled={busy || !variantId || adjustQty === 0}
                className="touch-btn w-full min-h-14 text-lg py-3 rounded-xl bg-amber-700 border border-amber-500 disabled:opacity-40 font-semibold"
                onClick={() =>
                  void runAction(() => onAdjust(variantId, adjustQty, note), t('admin.inventory.adjustSuccess'))
                }
              >
                {t('admin.inventory.adjustAction')}
              </button>
            </>
          )}
        </div>
      )}

      {mode === 'stocktake' && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-4">
          <div>
            <h3 className="font-semibold text-lg">{t('admin.settings.stocktakeTitle')}</h3>
            <p className="text-sm text-slate-400 mt-1">{t('admin.inventory.stocktakeSimple')}</p>
          </div>
          {!stocktake && (
            <div className="space-y-3">
              <input
                className="touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700"
                value={stocktakeNote}
                onChange={(e) => setStocktakeNote(e.target.value)}
                placeholder={t('admin.settings.sessionNote')}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="touch-btn flex-1 min-h-14 px-4 rounded-xl bg-emerald-700 border border-emerald-500 font-semibold"
                  onClick={() => void runAction(() => onCreateStocktake(stocktakeNote), t('admin.settings.stocktakeStart'))}
                >
                  {t('admin.settings.stocktakeStart')}
                </button>
                <button
                  type="button"
                  className="touch-btn flex-1 min-h-14 px-4 rounded-xl bg-slate-800 border border-slate-700 font-medium"
                  onClick={() => void runAction(() => onReloadOpen(), t('admin.settings.stocktakeReload'))}
                >
                  {t('admin.settings.reopenSession')}
                </button>
              </div>
            </div>
          )}
          {stocktake && (
            <div className="space-y-3">
              <div className="text-sm text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                <span>
                  {t('admin.settings.session')}: {stocktake.id.slice(0, 8)}
                </span>
                <span>|</span>
                <span>{t(`status.${stocktake.status}`)}</span>
              </div>
              <label className="block text-xs text-slate-400">
                {t('admin.inventory.stocktakeFilter')}
                <input
                  type="search"
                  className="touch-btn mt-1 w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700"
                  value={stocktakeBarcodeFilter}
                  onChange={(e) => setStocktakeBarcodeFilter(e.target.value)}
                  placeholder={t('admin.inventory.searchPlaceholder')}
                />
              </label>
              <div className="max-h-[min(28rem,60vh)] overflow-auto kiosk-scrollbar rounded-xl border border-slate-800">
                <table className="w-full text-sm min-w-[36rem]">
                  <thead className="bg-slate-900 text-slate-400 sticky top-0 z-10">
                    <tr>
                      <th className="text-left p-3">{t('admin.catalog.product')}</th>
                      <th className="text-left p-3">{t('admin.catalog.barcode')}</th>
                      <th className="text-right p-3 whitespace-nowrap">{t('admin.inventory.inComputer')}</th>
                      <th className="text-right p-3 whitespace-nowrap">{t('admin.inventory.youCounted')}</th>
                      <th className="text-right p-3 whitespace-nowrap">{t('admin.inventory.difference')}</th>
                      <th className="text-right p-3 min-w-[10rem]">{t('admin.inventory.enterCount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stocktakeLinesFiltered.map((ln) => (
                      <tr key={ln.id} className="border-t border-slate-800 align-top">
                        <td className="p-3">
                          {langRu
                            ? (ln as typeof ln & { product_name_ru?: string }).product_name_ru || ln.product_name_uz
                            : ln.product_name_uz}
                        </td>
                        <td className="p-3 font-mono text-xs">{ln.barcode}</td>
                        <td className="p-3 text-right tabular-nums text-slate-300">{ln.expected_qty}</td>
                        <td className="p-3 text-right tabular-nums">{ln.counted_qty ?? '—'}</td>
                        <td
                          className={`p-3 text-right tabular-nums font-medium ${
                            ln.variance_qty === 0 ? 'text-slate-500' : ln.variance_qty > 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {ln.variance_qty}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex flex-col sm:flex-row gap-2 justify-end items-stretch sm:items-center">
                            <input
                              className="touch-btn min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 w-full sm:w-24 text-lg text-center tabular-nums font-medium"
                              value={countByVariant[ln.variant] ?? ''}
                              onChange={(e) => setCountByVariant((p) => ({ ...p, [ln.variant]: e.target.value }))}
                              placeholder={t('admin.settings.qty')}
                              inputMode="numeric"
                            />
                            <button
                              type="button"
                              className="touch-btn min-h-12 px-4 rounded-xl bg-slate-700 border border-slate-600 font-semibold whitespace-nowrap"
                              onClick={() =>
                                void runAction(
                                  () => onSetCount(ln.variant, Number(countByVariant[ln.variant] || '0')),
                                  t('admin.settings.stocktakeCount'),
                                )
                              }
                            >
                              {t('admin.common.save')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {stocktakeBarcodeFilter.trim() && stocktakeLinesFiltered.length === 0 && (
                <p className="text-sm text-slate-500">{t('admin.inventory.noneFound')}</p>
              )}
              {stocktake.status === 'OPEN' && (
                <button
                  type="button"
                  className="touch-btn min-h-14 px-6 rounded-xl bg-amber-700 border border-amber-500 text-lg font-semibold"
                  onClick={() => void runAction(() => onApplyStocktake(), t('admin.settings.stocktakeApply'))}
                >
                  {t('admin.settings.applyVariance')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
