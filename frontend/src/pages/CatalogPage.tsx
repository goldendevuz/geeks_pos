import { useEffect, useMemo, useState } from 'react'
import { List, type RowComponentProps } from 'react-window'
import type { BulkGridCell, Category, LabelStickerSize, Product, Variant } from '../api'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '../utils/money'
import { NumericNumpadField } from '../components/NumericNumpadField'
import { ActionToast } from '../components/ActionToast'
import { Pencil, Printer, Power, Trash2, PackagePlus, ScanBarcode } from 'lucide-react'

const LABEL_SIZE_STORAGE_KEY = 'geeks_pos_catalog_label_size'
const DEFAULT_LABEL_SIZE: LabelStickerSize = '40x30'
const LOW_STOCK_THRESHOLD = 3

function normalizeSavedLabelSize(raw: string | null): LabelStickerSize {
  const v = (raw || '').trim()
  if (v === '40x30' || v === '40x50' || v === '50x40' || v === '58mm') return v
  return DEFAULT_LABEL_SIZE
}

type WizardVariantForm = {
  product: string
  purchase_price: string
  list_price: string
  stock_qty: number
}

export function CatalogPage({
  categories,
  products,
  variants,
  count,
  includeDeleted,
  setIncludeDeleted,
  page,
  onCreateVariantBulk,
  onCreateCategory,
  onCreateProduct,
  onDeleteCategory,
  onDeleteProduct,
  onAdjustStockQuick,
  onPrintSticker,
  onPrintStickerQueue,
  onToggleVariant,
  onUpdateVariant,
  onDeleteVariant,
  onFilter,
  onPage,
  ordering,
  categoryId,
  productId,
  onFacetsChange,
}: {
  categories: Category[]
  products: Product[]
  variants: Variant[]
  count: number
  includeDeleted: boolean
  setIncludeDeleted: (v: boolean) => void
  page: number
  onCreateVariantBulk: (payload: { product_id: string; matrix: BulkGridCell[] }) => Promise<Variant[]>
  onCreateCategory: (payload: { name_uz: string; name_ru: string }) => Promise<void>
  onCreateProduct: (payload: { category: string; name_uz: string; name_ru: string }) => Promise<void>
  onDeleteCategory: (categoryId: string) => Promise<void>
  onDeleteProduct: (productId: string) => Promise<void>
  onAdjustStockQuick: (variantId: string, qtyDelta: number, note: string) => Promise<void>
  onPrintSticker: (variantId: string, copies: number, size: LabelStickerSize) => Promise<void>
  onPrintStickerQueue: (
    items: Array<{ variant_id: string; copies: number }>,
    size: LabelStickerSize,
  ) => Promise<void>
  onToggleVariant: (v: Variant) => Promise<void>
  onUpdateVariant: (
    v: Variant,
    patch: { purchase_price: string; list_price: string },
  ) => Promise<void>
  onDeleteVariant: (variantId: string) => Promise<void>
  onFilter: (q: string) => void
  onPage: (page: number) => void
  ordering: 'name' | 'recent'
  categoryId: string
  productId: string
  onFacetsChange: (facets: {
    ordering?: 'name' | 'recent'
    category_id?: string
    product_id?: string
  }) => void
}) {
  const { t, i18n } = useTranslation()
  const [form, setForm] = useState<WizardVariantForm>({
    product: '',
    purchase_price: '0',
    list_price: '0',
    stock_qty: 0,
  })
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Variant | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [editPurchase, setEditPurchase] = useState('')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [selectedBrand, setSelectedBrand] = useState('')
  const [newBrand, setNewBrand] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [newModel, setNewModel] = useState('')
  const modelOptions = useMemo(
    () => products.filter((p) => !selectedBrand || p.category === selectedBrand),
    [products, selectedBrand],
  )
  const maxPage = Math.max(1, Math.ceil(count / 20))
  const useVirtualRows = variants.length > 12
  const [quickAdjust, setQuickAdjust] = useState<Variant | null>(null)
  const [quickDelta, setQuickDelta] = useState(0)
  const [queueOpen, setQueueOpen] = useState(false)
  const [queueSize, setQueueSize] = useState<LabelStickerSize>(() => {
    try {
      return normalizeSavedLabelSize(window.localStorage.getItem(LABEL_SIZE_STORAGE_KEY))
    } catch {
      return DEFAULT_LABEL_SIZE
    }
  })
  const [queueMap, setQueueMap] = useState<Record<string, number>>({})
  const addToPrintQueue = true
  const [bulkStickerPrompt, setBulkStickerPrompt] = useState<null | { variantIds: string[]; copiesStr: string }>(null)
  const [bulkStickerBusy, setBulkStickerBusy] = useState(false)
  const [printAllBusy, setPrintAllBusy] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleteCategoryId, setConfirmDeleteCategoryId] = useState<string | null>(null)
  const [confirmDeleteProductId, setConfirmDeleteProductId] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [applianceOpen, setApplianceOpen] = useState(false)
  const [apPurchase, setApPurchase] = useState('0')
  const [apList, setApList] = useState('')
  const [apQty, setApQty] = useState('0')
  const [apBarcode, setApBarcode] = useState('')

  const productStockTotals = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const v of variants) {
      const current = totals[v.product] || 0
      totals[v.product] = current + Math.max(0, Number(v.stock_qty || 0))
    }
    return totals
  }, [variants])

  const lowStockProductCount = useMemo(() => {
    const uniqueProducts = new Set<string>(variants.map((v) => v.product))
    let count = 0
    uniqueProducts.forEach((productId) => {
      if ((productStockTotals[productId] || 0) < LOW_STOCK_THRESHOLD) count += 1
    })
    return count
  }, [productStockTotals, variants])

  /** Deactivated rows vs zero-stock (active) rows — distinct backgrounds. */
  function catalogVariantRowClass(v: Variant) {
    if (!v.is_active) {
      return 'bg-violet-950/30 border-l-[3px] border-violet-500/55 text-slate-400'
    }
    if (Number(v.stock_qty ?? 0) <= 0) {
      return 'bg-amber-950/40 border-l-[3px] border-amber-600/90 text-slate-100'
    }
    return ''
  }

  useEffect(() => {
    const timer = setTimeout(() => onFilter(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query, onFilter])

  useEffect(() => {
    try {
      window.localStorage.setItem(LABEL_SIZE_STORAGE_KEY, queueSize)
    } catch {
      // ignore storage access issues
    }
  }, [queueSize])

  function digitsOnly(v: string): string {
    return (v || '').replace(/\D/g, '')
  }

  async function submitApplianceVariant() {
    const productId = selectedModel || form.product
    if (!productId) {
      setToast('Select a product first')
      return
    }
    const purchaseInt = digitsOnly(apPurchase) || '0'
    if (Number(purchaseInt) <= 0) {
      setToast('Purchase price is required')
      return
    }
    const qty = Math.max(0, Math.floor(Number(digitsOnly(apQty)) || 0))
    const listInt = apList ? digitsOnly(apList) : ''

    const matrix: BulkGridCell[] = [
      {
        purchase_price: purchaseInt,
        list_price: listInt || undefined,
        initial_qty: qty,
        barcode: apBarcode.trim() || undefined,
      },
    ]

    setBusy(true)
    try {
      const created = await onCreateVariantBulk({ product_id: productId, matrix })
      setToast(t('admin.catalog.wizard.bulkSuccess'))
      if (addToPrintQueue && created.length > 0) {
        setBulkStickerPrompt({ variantIds: created.map((row) => row.id), copiesStr: '1' })
      }
      setForm((p: WizardVariantForm) => ({
        ...p,
        product: productId,
        purchase_price: '0',
        list_price: '0',
        stock_qty: 0,
      }))
      setApPurchase('0')
      setApList('')
      setApQty('0')
      setApBarcode('')
      setApplianceOpen(false)
    } catch {
      setToast(t('admin.catalog.wizard.bulkError'))
    } finally {
      setBusy(false)
    }
  }

  async function createBrandAndSelect() {
    const name = newBrand.trim()
    if (!name) return
    setBusy(true)
    try {
      await onCreateCategory({ name_uz: name, name_ru: name })
      setSelectedBrand('')
      setNewBrand('')
      setToast(t('admin.catalog.brandCreated'))
    } catch (e: unknown) {
      const code = (e as Error & { code?: string }).code
      setToast(t(`err.${code || 'CREATE_CATEGORY_FAILED'}`))
    } finally {
      setBusy(false)
    }
  }

  async function createModelAndSelect() {
    const model = newModel.trim()
    const brand = selectedBrand
    if (!model || !brand) return
    setBusy(true)
    try {
      await onCreateProduct({ category: brand, name_uz: model, name_ru: model })
      setSelectedModel('')
      setNewModel('')
      setToast(t('admin.catalog.modelCreated'))
    } catch (e: unknown) {
      const code = (e as Error & { code?: string }).code
      setToast(t(`err.${code || 'CREATE_PRODUCT_FAILED'}`))
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelectedBrand() {
    if (!selectedBrand) return
    setBusy(true)
    try {
      await onDeleteCategory(selectedBrand)
      setSelectedBrand('')
      setSelectedModel('')
      setForm((prev) => ({ ...prev, product: '' }))
      setConfirmDeleteCategoryId(null)
      setToast(t('admin.catalog.brandDeleted'))
    } catch (e: unknown) {
      const code = (e as Error & { code?: string }).code
      setToast(t(`err.${code || 'DELETE_CATEGORY_FAILED'}`))
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelectedModel() {
    const modelId = selectedModel || form.product
    if (!modelId) return
    setBusy(true)
    try {
      await onDeleteProduct(modelId)
      setSelectedModel('')
      setForm((prev) => ({ ...prev, product: '' }))
      setConfirmDeleteProductId(null)
      setToast(t('admin.catalog.modelDeleted'))
    } catch (e: unknown) {
      const code = (e as Error & { code?: string }).code
      setToast(t(`err.${code || 'DELETE_PRODUCT_FAILED'}`))
    } finally {
      setBusy(false)
    }
  }

  async function printAllVariantsForSelectedModel() {
    const modelId = selectedModel || form.product
    if (!modelId) return
    setPrintAllBusy(true)
    try {
      const rows = variants.filter((v) => v.product === modelId && (includeDeleted || !v.deleted_at))
      if (rows.length === 0) {
        setToast(t('admin.catalog.printAllNothing', { defaultValue: 'Variant topilmadi' }))
        return
      }
      const items = rows.map((v) => ({ variant_id: v.id, copies: 1 }))
      await onPrintStickerQueue(items, queueSize)
      setToast(
        t('admin.catalog.printAllOk', {
          count: rows.length,
          defaultValue: `Chop uchun ${rows.length} ta variant jo‘natildi`,
        }),
      )
    } catch {
      setToast(t('admin.catalog.printAllFail', { defaultValue: 'Chop uchun yuklashda xatolik' }))
    } finally {
      setPrintAllBusy(false)
    }
  }

  function addToQueue(variantId: string) {
    setQueueMap((prev) => ({ ...prev, [variantId]: Math.max(1, prev[variantId] || 1) }))
    setQueueOpen(true)
  }

  return (
    <div className="p-4 space-y-4 relative">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t('admin.catalog.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <span className="whitespace-nowrap">{t('admin.catalog.labelSize')}</span>
            <select
              className="touch-btn min-h-10 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-sm text-slate-100"
              value={queueSize}
              onChange={(e) => setQueueSize(e.target.value as LabelStickerSize)}
            >
              <option value="40x50">40×50 (4×5 cm)</option>
              <option value="50x40">50×40 (5×4 cm)</option>
              <option value="40x30">40×30</option>
              <option value="58mm">58 mm</option>
            </select>
          </label>
          <button
            type="button"
            className="touch-btn min-h-12 px-3 rounded bg-slate-800 border border-slate-600 text-sm"
            onClick={() => setQueueOpen(true)}
          >
            {t('admin.catalog.printQueue')}
          </button>
          <div className="relative">
            <ScanBarcode className="h-4 w-4 text-emerald-400 absolute left-2 top-2" />
            <input
              className="touch-btn min-h-12 pl-8 px-3 rounded bg-slate-900 border border-slate-700 text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputMode="none"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t('admin.catalog.searchPlaceholder', { defaultValue: 'Qidiruv / barcode: 20000001' })}
            />
          </div>
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => setIncludeDeleted(e.target.checked)}
            />
            {t('admin.catalog.showDeleted')}
          </label>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 items-end rounded border border-slate-800 bg-slate-950/50 p-3">
        <label className="text-xs text-slate-400 flex flex-col gap-1">
          <span>{t('admin.catalog.filterBrand')}</span>
          <select
            className="touch-btn min-h-10 px-2 rounded bg-slate-950 border border-slate-700 text-sm text-slate-100 min-w-[8rem]"
            value={categoryId}
            onChange={(e) => onFacetsChange({ category_id: e.target.value })}
          >
            <option value="">{t('admin.catalog.filterBrandAll')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {i18n.language.startsWith('ru') ? c.name_ru || c.name_uz : c.name_uz}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400 flex flex-col gap-1">
          <span>{t('admin.catalog.filterModel')}</span>
          <select
            className="touch-btn min-h-10 px-2 rounded bg-slate-950 border border-slate-700 text-sm text-slate-100 min-w-[10rem]"
            value={productId}
            disabled={!categoryId}
            onChange={(e) => onFacetsChange({ product_id: e.target.value })}
          >
            <option value="">
              {!categoryId ? t('admin.catalog.filterModelPickBrandFirst') : t('admin.catalog.filterModelAll')}
            </option>
            {products.filter((p) => !categoryId || p.category === categoryId).map((p) => (
              <option key={p.id} value={p.id}>
                {i18n.language.startsWith('ru') ? p.name_ru || p.name_uz : p.name_uz}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400 flex flex-col gap-1">
          <span>{t('admin.catalog.sortVariants')}</span>
          <select
            className="touch-btn min-h-10 px-2 rounded bg-slate-950 border border-slate-700 text-sm text-slate-100"
            value={ordering}
            onChange={(e) =>
              onFacetsChange({
                ordering: e.target.value === 'recent' ? 'recent' : 'name',
              })
            }
          >
            <option value="name">{t('admin.catalog.sortByName')}</option>
            <option value="recent">{t('admin.catalog.sortRecent')}</option>
          </select>
        </label>
        <button
          type="button"
          disabled={!productId || printAllBusy}
          className="touch-btn min-h-10 px-3 rounded-lg bg-emerald-900 border border-emerald-700 text-sm disabled:opacity-40"
          title={t('admin.catalog.printAllTool')}
          onClick={() => void printAllVariantsForSelectedModel()}
        >
          {printAllBusy ? t('admin.common.loading') : t('admin.catalog.printAllModelVariants')}
        </button>
      </div>
      {toast && <ActionToast kind="info" message={toast} onClose={() => setToast(null)} />}
      <p className="text-xs text-slate-400">{t('admin.catalog.hint')}</p>
      <p className="text-xs text-slate-500">{t('admin.catalog.actionsHelp')}</p>
      <p className="text-xs text-emerald-400">{t('admin.catalog.barcodeSearchHelp', { defaultValue: 'Barcode bo‘yicha tez qidirish uchun kod kiriting (masalan 20000001).' })}</p>
      {lowStockProductCount > 0 && (
        <p className="text-xs text-amber-300">
          {t('admin.catalog.lowStockModelsWarning', {
            count: lowStockProductCount,
            n: LOW_STOCK_THRESHOLD,
            defaultValue: `Kam qoldiqdagi modellar: ${lowStockProductCount} ta (< ${LOW_STOCK_THRESHOLD})`,
          })}
        </p>
      )}

      <div className="rounded border border-slate-700 bg-slate-900 p-4 space-y-4">
        <div className="w-full flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-slate-200 inline-flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden />
            {t('admin.catalog.wizard.applianceTitle')}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="touch-btn min-h-14 px-4 rounded-xl bg-amber-700 border border-amber-500 text-sm"
              onClick={() => setWizardOpen((p) => !p)}
            >
              {wizardOpen ? t('admin.catalog.wizard.closeApplianceForm') : t('admin.catalog.wizard.addApplianceVariant')}
            </button>
          </div>
        </div>

        {wizardOpen && (
          <div className="space-y-3">
            <div className="text-base text-slate-100">{t('admin.catalog.wizard.step1Title')}</div>
            <div className="grid md:grid-cols-2 gap-3">
              <select
                className="touch-btn min-h-14 px-4 rounded-xl bg-slate-950 border border-slate-700 text-base"
                value={selectedBrand}
                onChange={(e) => {
                  setSelectedBrand(e.target.value)
                  setSelectedModel('')
                }}
              >
                <option value="">{t('admin.catalog.brand')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_uz}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedBrand || busy}
                className="touch-btn min-h-14 px-4 rounded-xl bg-red-900 border border-red-700 disabled:opacity-40"
                onClick={() => setConfirmDeleteCategoryId(selectedBrand)}
              >
                {t('admin.catalog.deleteBrand')}
              </button>
              <div className="flex gap-2">
                <input
                  className="touch-btn min-h-14 flex-1 px-4 rounded-xl bg-slate-950 border border-slate-700 text-base"
                  value={newBrand}
                  onChange={(e) => setNewBrand(e.target.value)}
                  placeholder={t('admin.catalog.newBrandPlaceholder')}
                />
                <button
                  type="button"
                  disabled={busy}
                  className="touch-btn min-h-14 px-4 rounded-xl bg-slate-800 border border-slate-600 disabled:opacity-40 shrink-0"
                  onClick={() => void createBrandAndSelect()}
                >
                  {t('admin.catalog.addBrand')}
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 md:col-span-2">
                <select
                  className="touch-btn min-h-14 flex-1 px-4 rounded-xl bg-slate-950 border border-slate-700 text-base"
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value)
                    setForm((p: WizardVariantForm) => ({ ...p, product: e.target.value }))
                  }}
                  disabled={!selectedBrand}
                >
                  <option value="">{t('admin.catalog.model')}</option>
                  {modelOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name_uz}
                    </option>
                  ))}
                </select>
                <div className="ml-2">
                  <button
                    type="button"
                    className="touch-btn min-h-14 px-4 rounded-xl bg-amber-700 border border-amber-500 text-sm"
                    onClick={() => setApplianceOpen((p) => !p)}
                  >
                    {applianceOpen ? t('admin.catalog.wizard.closeApplianceForm') : t('admin.catalog.wizard.addApplianceVariant')}
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!(selectedModel || form.product) || busy}
                  className="touch-btn min-h-14 px-4 rounded-xl bg-red-900 border border-red-700 disabled:opacity-40 shrink-0"
                  onClick={() => setConfirmDeleteProductId(selectedModel || form.product)}
                >
                  {t('admin.catalog.deleteModel')}
                </button>
              </div>
              <div className="flex gap-2 md:col-span-2">
                <input
                  className="touch-btn min-h-14 flex-1 px-4 rounded-xl bg-slate-950 border border-slate-700 text-base"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  placeholder={t('admin.catalog.newModelPlaceholder')}
                />
                <button
                  type="button"
                  disabled={busy || !selectedBrand}
                  className="touch-btn min-h-14 px-4 rounded-xl bg-slate-800 border border-slate-600 disabled:opacity-40 shrink-0"
                  onClick={() => void createModelAndSelect()}
                >
                  {t('admin.catalog.addModel')}
                </button>
              </div>
            </div>
            {applianceOpen && (
              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950 mt-3 space-y-2">
                <div className="text-sm text-slate-300">{t('admin.catalog.wizard.applianceFormTitle')}</div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">{t('admin.catalog.purchasePricePlaceholder')}</label>
                    <input 
                      className="touch-btn px-3 py-2 rounded-xl bg-slate-900 border border-slate-700" 
                      value={apPurchase} 
                      onChange={(e) => setApPurchase(e.target.value)} 
                      placeholder={t('admin.catalog.purchasePricePlaceholder')} 
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">{t('admin.catalog.listPricePlaceholder')}</label>
                    <input 
                      className="touch-btn px-3 py-2 rounded-xl bg-slate-900 border border-slate-700" 
                      value={apList} 
                      onChange={(e) => setApList(e.target.value)} 
                      placeholder={t('admin.catalog.listPricePlaceholder')} 
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">{t('admin.catalog.initialQtyPlaceholder')}</label>
                    <input 
                      className="touch-btn px-3 py-2 rounded-xl bg-slate-900 border border-slate-700" 
                      value={apQty} 
                      onChange={(e) => setApQty(e.target.value)} 
                      placeholder={t('admin.catalog.initialQtyPlaceholder')} 
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">{t('admin.catalog.barcodePlaceholder')}</label>
                    <input 
                      className="touch-btn px-3 py-2 rounded-xl bg-slate-900 border border-slate-700" 
                      value={apBarcode} 
                      onChange={(e) => setApBarcode(e.target.value)} 
                      placeholder={t('admin.catalog.barcodePlaceholder')} 
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <button type="button" disabled={busy} className="touch-btn px-4 py-2 rounded-xl bg-emerald-700" onClick={() => void submitApplianceVariant()}>
                    {busy ? t('admin.common.loading') : t('admin.catalog.wizard.createApplianceVariant')}
                  </button>
                </div>
              </div>
            )}
            {/* Appliance flow — matrix wizard removed; use appliance form above */}
          </div>
        )}


      </div>

      <div className="rounded border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="text-left p-2">{t('admin.catalog.product')}</th>
              <th className="text-left p-2">{t('admin.catalog.barcode')}</th>
              <th className="text-right p-2">{t('admin.catalog.stock')}</th>
              <th className="text-right p-2">{t('admin.catalog.purchase')}</th>
              <th className="text-right p-2">{t('admin.catalog.price')}</th>
              <th className="text-right p-2">{t('admin.catalog.action')}</th>
            </tr>
          </thead>
          {!useVirtualRows && (
          <tbody>
            {variants.map((v) => {
              const modelTotalStock = productStockTotals[v.product] || 0
              const isModelLow = modelTotalStock < LOW_STOCK_THRESHOLD
              const displayName = i18n.language.startsWith('ru')
                ? (v.product_custom_name_ru || v.product_name_ru || v.product_name_uz)
                : (v.product_custom_name_uz || v.product_name_uz)
              return (
              <tr key={v.id} className={`border-t border-slate-800 ${catalogVariantRowClass(v)}`}>
                <td className="p-2">{displayName}</td>
                <td className="p-2">{v.barcode}</td>
                <td className="p-2 text-right">
                  <button
                    type="button"
                    className="touch-btn min-h-12 px-3 rounded bg-slate-800 border border-slate-600"
                    onClick={() => {
                      setQuickAdjust(v)
                      setQuickDelta(0)
                    }}
                  >
                    {v.stock_qty} {t('admin.catalog.stockUnit')}
                  </button>
                  <div
                    className={`text-xs mt-1 ${
                      !v.is_active ? 'text-slate-500' : isModelLow ? 'text-amber-300' : 'text-slate-500'
                    }`}
                  >
                    {t('admin.catalog.modelStock', {
                      count: modelTotalStock,
                      defaultValue: `Model: ${modelTotalStock}`,
                    })}
                  </div>
                </td>
                <td className="p-2 text-right">{formatMoney(v.purchase_price)}</td>
                <td className="p-2 text-right">
                  {v.list_price ? formatMoney(v.list_price) : <span className="text-slate-500 text-xs">{t('admin.catalog.priceOptional', { defaultValue: 'Optional' })}</span>}
                </td>
                <td className="p-2 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-3 rounded bg-slate-800 border border-slate-600 inline-flex items-center gap-1"
                      onClick={() => {
                        setEditing(v)
                        setEditPrice(v.list_price ?? '')
                        setEditPurchase(v.purchase_price)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" /> {t('admin.catalog.edit')}
                    </button>
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-3 rounded bg-slate-800 border border-slate-600 inline-flex items-center gap-1"
                      onClick={() => void addToQueue(v.id)}
                    >
                      <PackagePlus className="h-3.5 w-3.5" /> {t('admin.catalog.queueAdd')}
                    </button>
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-3 rounded bg-slate-800 border border-slate-600 inline-flex items-center gap-1"
                      onClick={async () => {
                        try {
                          await onPrintSticker(v.id, 1, queueSize)
                          setToast(t('admin.catalog.stickerPrinted'))
                        } catch (e: unknown) {
                          const rawMessage = e instanceof Error ? e.message : String(e || '')
                          if (rawMessage.startsWith('Printer ulanmagan:')) {
                            setToast(rawMessage)
                          } else {
                            setToast(t('err.LABEL_PRINT_FAILED'))
                          }
                        }
                      }}
                    >
                      <Printer className="h-3.5 w-3.5" /> {t('admin.catalog.printSticker')}
                    </button>
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-3 rounded bg-slate-800 border border-slate-600 inline-flex items-center gap-1"
                      onClick={async () => {
                        try {
                          await onToggleVariant(v)
                          setToast(t('admin.catalog.toggleSuccess'))
                        } catch (e: unknown) {
                          const code = (e as Error & { code?: string }).code
                          setToast(t(`err.${code || 'API_ERROR'}`))
                        }
                      }}
                    >
                      <Power className="h-3.5 w-3.5" />
                      {v.is_active ? t('admin.catalog.deactivate') : t('admin.catalog.activate')}
                    </button>
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-3 rounded bg-red-900 border border-red-700 inline-flex items-center gap-1"
                      onClick={async () => {
                        setConfirmDeleteId(v.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {t('admin.catalog.delete')}
                    </button>
                  </div>
                </td>
              </tr>
              )
            })}
            {variants.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-400">
                  <div className="text-slate-300 mb-1">{query ? t('admin.catalog.emptyFiltered') : t('admin.catalog.empty')}</div>
                </td>
              </tr>
            )}
          </tbody>
          )}
        </table>
        {useVirtualRows && (
          <List
            defaultHeight={Math.min(620, Math.max(260, variants.length * 74))}
            rowCount={variants.length}
            rowHeight={74}
            style={{ height: Math.min(620, Math.max(260, variants.length * 74)), width: '100%' }}
            rowComponent={({ index, style, rows }: RowComponentProps<{ rows: Variant[] }>) => {
              const v = rows[index]
              const modelTotalStock = productStockTotals[v.product] || 0
              const isModelLow = modelTotalStock < LOW_STOCK_THRESHOLD
              return (
                <div
                  style={style}
                  className={`grid grid-cols-[1.3fr_1fr_0.8fr_0.7fr_0.8fr_2fr] items-center border-b border-slate-800 px-2 text-sm ${catalogVariantRowClass(v)}`}
                >
                  <div>
                    {i18n.language.startsWith('ru')
                      ? v.product_name_ru || v.product_name_uz
                      : v.product_name_uz}
                  </div>
                  <div>—</div>
                  <div>{v.barcode}</div>
                  <div className="text-right">
                    <div>{v.stock_qty}</div>
                    <div
                      className={`text-[11px] ${
                        !v.is_active ? 'text-slate-500' : isModelLow ? 'text-amber-300' : 'text-slate-500'
                      }`}
                    >
                      {t('admin.catalog.modelStock', {
                        count: modelTotalStock,
                        defaultValue: `Model: ${modelTotalStock}`,
                      })}
                    </div>
                  </div>
                  <div className="text-right">{formatMoney(v.list_price)}</div>
                  <div className="text-right">
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        className="touch-btn min-h-10 px-2 rounded bg-slate-800 border border-slate-600 inline-flex items-center gap-1"
                        onClick={() => {
                          setEditing(v)
                          setEditPrice(v.list_price ?? '')
                          setEditPurchase(v.purchase_price)
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="touch-btn min-h-10 px-2 rounded bg-slate-800 border border-slate-600 inline-flex items-center gap-1"
                        onClick={() => void addToQueue(v.id)}
                      >
                        <PackagePlus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="touch-btn min-h-10 px-2 rounded bg-slate-800 border border-slate-600 inline-flex items-center gap-1"
                        onClick={async () => {
                          try {
                            await onPrintSticker(v.id, 1, queueSize)
                            setToast(t('admin.catalog.stickerPrinted'))
                          } catch (e: unknown) {
                            const rawMessage = e instanceof Error ? e.message : String(e || '')
                            setToast(rawMessage.startsWith('Printer ulanmagan:') ? rawMessage : t('err.LABEL_PRINT_FAILED'))
                          }
                        }}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="touch-btn min-h-10 px-2 rounded bg-slate-800 border border-slate-600 inline-flex items-center gap-1"
                        onClick={async () => {
                          try {
                            await onToggleVariant(v)
                            setToast(t('admin.catalog.toggleSuccess'))
                          } catch (e: unknown) {
                            const code = (e as Error & { code?: string }).code
                            setToast(t(`err.${code || 'API_ERROR'}`))
                          }
                        }}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="touch-btn min-h-10 px-2 rounded bg-red-900 border border-red-700 inline-flex items-center gap-1"
                        onClick={() => setConfirmDeleteId(v.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            }}
            rowProps={{ rows: variants }}
            className="border-t border-slate-800"
          />
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="touch-btn min-h-12 px-5 rounded-xl bg-slate-800 border border-slate-700 disabled:opacity-50"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {t('admin.common.prev')}
        </button>
        <div className="px-3 py-1 text-sm text-slate-400">
          {t('admin.common.pageOf', { page, maxPage })}
        </div>
        <button
          type="button"
          className="touch-btn min-h-12 px-5 rounded-xl bg-slate-800 border border-slate-700 disabled:opacity-50"
          disabled={page >= maxPage}
          onClick={() => onPage(page + 1)}
        >
          {t('admin.common.next')}
        </button>
      </div>

      {quickAdjust && (
        <div
          className="fixed inset-0 z-20 bg-black/60 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setQuickAdjust(null)}
        >
          <div
            className="w-full max-w-md rounded border border-slate-700 bg-slate-900 p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">{t('admin.catalog.quickAdjust')}</h3>
          <div className="text-sm text-slate-400">
            {i18n.language.startsWith('ru')
              ? quickAdjust.product_name_ru || quickAdjust.product_name_uz
              : quickAdjust.product_name_uz}{' '}
            / {quickAdjust.barcode}
          </div>
            <div className="text-center text-3xl font-semibold">{quickDelta > 0 ? `+${quickDelta}` : quickDelta}</div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                className="py-4 rounded bg-red-800 border border-red-600 text-2xl"
                onClick={() => setQuickDelta((p) => p - 1)}
              >
                -
              </button>
              <button
                type="button"
                className="py-4 rounded bg-emerald-800 border border-emerald-600 text-2xl"
                onClick={() => setQuickDelta((p) => p + 1)}
              >
                +
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-800 border border-slate-600"
                onClick={() => setQuickAdjust(null)}
              >
                {t('admin.common.cancel')}
              </button>
              <button
                type="button"
                className="touch-btn min-h-12 px-3 py-2 rounded bg-emerald-700 border border-emerald-500"
                onClick={async () => {
                  if (quickDelta === 0) return
                  try {
                    await onAdjustStockQuick(quickAdjust.id, quickDelta, 'Quick adjust')
                    setToast(t('admin.inventory.adjustSuccess'))
                    setQuickAdjust(null)
                  } catch (e: unknown) {
                    const code = (e as Error & { code?: string }).code
                    setToast(t(`err.${code || 'INVENTORY_ADJUST_FAILED'}`))
                  }
                }}
              >
                {t('admin.common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {queueOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setQueueOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded border border-slate-700 bg-slate-900 p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">{t('admin.catalog.printQueue')}</h3>
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-400">{t('admin.catalog.labelSize')}</label>
              <select
                className="touch-btn min-h-12 px-2 py-1 rounded bg-slate-950 border border-slate-700"
                value={queueSize}
                onChange={(e) => setQueueSize(e.target.value as LabelStickerSize)}
              >
                <option value="40x50">40×50 (4×5 cm)</option>
                <option value="50x40">50×40 (5×4 cm)</option>
                <option value="40x30">40×30</option>
                <option value="58mm">58 mm</option>
              </select>
            </div>
            <div className="max-h-72 overflow-auto kiosk-scrollbar rounded border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-950 text-slate-400">
                  <tr>
                    <th className="text-left p-2">{t('admin.catalog.product')}</th>
                    <th className="text-left p-2">{t('admin.catalog.barcode')}</th>
                    <th className="text-right p-2">{t('admin.catalog.copies')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(queueMap).map(([variantId, copies]) => {
                    const v = variants.find((row) => row.id === variantId)
                    if (!v) return null
                    return (
                      <tr key={variantId} className="border-t border-slate-800">
                        <td className="p-2">
                          {i18n.language.startsWith('ru')
                            ? v.product_name_ru || v.product_name_uz
                            : v.product_name_uz}
                        </td>
                        <td className="p-2">{v.barcode}</td>
                        <td className="p-2 text-right">
                          <div className="w-28 ml-auto">
                            <NumericNumpadField
                              value={String(copies)}
                              min={1}
                              max={200}
                              maxDigits={3}
                              label={t('admin.catalog.copies')}
                              onChange={(next) =>
                                setQueueMap((p) => ({ ...p, [variantId]: Math.max(1, Number(next || '1')) }))
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {Object.keys(queueMap).length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-slate-500">{t('admin.catalog.queueEmpty')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-800 border border-slate-600"
                onClick={() => setQueueOpen(false)}
              >
                {t('admin.common.cancel')}
              </button>
              <button
                type="button"
                className="touch-btn min-h-12 px-3 py-2 rounded bg-emerald-700 border border-emerald-500"
                onClick={async () => {
                  const items = Object.entries(queueMap).map(([variant_id, copies]) => ({ variant_id, copies }))
                  if (items.length === 0) return
                  try {
                    await onPrintStickerQueue(items, queueSize)
                    setToast(t('admin.catalog.queuePrinted'))
                    setQueueMap({})
                    setQueueOpen(false)
                  } catch (e: unknown) {
                    const rawMessage = e instanceof Error ? e.message : String(e || '')
                    if (rawMessage.startsWith('Printer ulanmagan:')) {
                      setToast(rawMessage)
                    } else {
                      setToast(t('err.LABEL_QUEUE_FAILED'))
                    }
                  }
                }}
              >
                {t('admin.catalog.printQueue')}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 z-20 bg-black/60 flex items-center justify-center overflow-y-auto overscroll-contain p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setEditing(null)}
        >
          <div
            className="w-full max-w-md rounded border border-slate-700 bg-slate-900 p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">{t('admin.catalog.editVariant')}</h3>
            <div className="text-sm text-slate-400">
              {i18n.language.startsWith('ru')
                ? editing.product_name_ru || editing.product_name_uz
                : editing.product_name_uz}{' '}
              / {editing.barcode}
            </div>
            <input
              className="w-full px-2 py-2 rounded bg-slate-950 border border-slate-700"
              value={editPurchase}
              onChange={(e) => setEditPurchase(e.target.value)}
              placeholder={t('admin.catalog.purchasePricePlaceholder')}
            />
            <input
              className="w-full px-2 py-2 rounded bg-slate-950 border border-slate-700"
              value={editPrice}
              onChange={(e) => setEditPrice(e.target.value)}
              placeholder={t('admin.catalog.salePricePlaceholder')}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
              className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-800 border border-slate-600"
                onClick={() => setEditing(null)}
              >
                {t('admin.common.cancel')}
              </button>
              <button
                type="button"
              className="touch-btn min-h-12 px-3 py-2 rounded bg-emerald-700 border border-emerald-500"
                onClick={async () => {
                  try {
                    await onUpdateVariant(editing, {
                      list_price: editPrice,
                      purchase_price: editPurchase,
                    })
                    setToast(t('admin.catalog.updateSuccess'))
                    setEditing(null)
                  } catch (e: unknown) {
                    const code = (e as Error & { code?: string }).code
                    setToast(t(`err.${code || 'API_ERROR'}`))
                  }
                }}
              >
                {t('admin.common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
      {bulkStickerPrompt && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/70 p-4"
          onClick={() => {
            if (!bulkStickerBusy) setBulkStickerPrompt(null)
          }}
        >
          <div
            role="dialog"
            aria-modal
            className="my-auto w-full max-w-md max-h-[min(90dvh,90svh)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-4 shadow-xl kiosk-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-semibold">
              {t('admin.catalog.wizard.stickerAfterBulkTitle', { count: bulkStickerPrompt.variantIds.length })}
            </div>
            <label className="block text-sm text-slate-400">
              <span className="block mb-2">{t('admin.catalog.wizard.stickerAfterBulkCopies')}</span>
              <NumericNumpadField
                value={bulkStickerPrompt.copiesStr}
                min={1}
                max={200}
                maxDigits={3}
                label={t('admin.catalog.wizard.stickerAfterBulkCopies')}
                onChange={(next) =>
                  setBulkStickerPrompt((p) => (p ? { ...p, copiesStr: digitsOnly(next) || '1' } : p))
                }
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={bulkStickerBusy}
                className="touch-btn min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-700 disabled:opacity-40"
                onClick={() => setBulkStickerPrompt(null)}
              >
                {t('admin.catalog.wizard.stickerAfterBulkNo')}
              </button>
              <button
                type="button"
                disabled={bulkStickerBusy}
                className="touch-btn min-h-12 px-4 rounded-xl bg-emerald-700 border border-emerald-500 font-medium disabled:opacity-40"
                onClick={() => {
                  void (async () => {
                    if (!bulkStickerPrompt) return
                    const raw = digitsOnly(bulkStickerPrompt.copiesStr)
                    const n = Math.max(1, Math.floor(Number(raw || '1')) || 1)
                    setBulkStickerBusy(true)
                    try {
                      await onPrintStickerQueue(
                        bulkStickerPrompt.variantIds.map((variant_id) => ({ variant_id, copies: n })),
                        queueSize,
                      )
                      setBulkStickerPrompt(null)
                    } catch (e: unknown) {
                      const rawMessage = e instanceof Error ? e.message : String(e || '')
                      if (rawMessage.startsWith('Printer ulanmagan:')) {
                        setToast(rawMessage)
                      } else {
                        setToast(t('admin.catalog.wizard.bulkError'))
                      }
                    } finally {
                      setBulkStickerBusy(false)
                    }
                  })()
                }}
              >
                {bulkStickerBusy ? t('admin.catalog.wizard.stickerAfterBulkWorking') : t('admin.catalog.wizard.stickerAfterBulkYes')}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteCategoryId && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
            <div className="text-base font-semibold">{t('admin.catalog.confirmDeleteBrand')}</div>
            <p className="text-sm text-slate-400">{t('admin.catalog.deleteImpact', { defaultValue: 'Bog‘langan savdo mavjud bo‘lsa soft delete ishlatiladi.' })}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-800 border border-slate-700" onClick={() => setConfirmDeleteCategoryId(null)}>
                {t('admin.common.cancel')}
              </button>
              <button
                type="button"
                className="touch-btn min-h-12 px-3 py-2 rounded bg-red-700 border border-red-500"
                onClick={() => void deleteSelectedBrand()}
              >
                {t('admin.catalog.deleteBrand')}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteProductId && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
            <div className="text-base font-semibold">{t('admin.catalog.confirmDeleteModel')}</div>
            <p className="text-sm text-slate-400">{t('admin.catalog.deleteImpact', { defaultValue: 'Bog‘langan savdo mavjud bo‘lsa soft delete ishlatiladi.' })}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-800 border border-slate-700" onClick={() => setConfirmDeleteProductId(null)}>
                {t('admin.common.cancel')}
              </button>
              <button
                type="button"
                className="touch-btn min-h-12 px-3 py-2 rounded bg-red-700 border border-red-500"
                onClick={() => void deleteSelectedModel()}
              >
                {t('admin.catalog.deleteModel')}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
            <div className="text-base font-semibold">{t('admin.catalog.confirmDelete')}</div>
            <p className="text-sm text-slate-400">{t('admin.catalog.deleteImpact', { defaultValue: 'Bog‘langan savdo mavjud bo‘lsa soft delete ishlatiladi.' })}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-800 border border-slate-700" onClick={() => setConfirmDeleteId(null)}>
                {t('admin.common.cancel')}
              </button>
              <button
                type="button"
                className="touch-btn min-h-12 px-3 py-2 rounded bg-red-700 border border-red-500"
                onClick={async () => {
                  const id = confirmDeleteId
                  setConfirmDeleteId(null)
                  if (!id) return
                  try {
                    await onDeleteVariant(id)
                    setToast(t('admin.catalog.deleteSuccess'))
                  } catch (e: unknown) {
                    const code = (e as Error & { code?: string }).code
                    setToast(t(`err.${code || 'DELETE_VARIANT_FAILED'}`))
                  }
                }}
              >
                {t('admin.catalog.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
