import { useEffect, useMemo, useState } from 'react'
import { List, type RowComponentProps } from 'react-window'
import type { BulkGridCell, Category, Color, LabelStickerSize, Product, Size, Variant } from '../api'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '../utils/money'
import { TouchNumpad } from '../components/TouchNumpad'
import { NumericNumpadField } from '../components/NumericNumpadField'
import { ActionToast } from '../components/ActionToast'
import { Pencil, Printer, Power, Trash2, PackagePlus, ScanBarcode } from 'lucide-react'

const STANDARD_COLOR_VALUES = [
  'std_black',
  'std_white',
  'std_gray',
  'std_brown',
  'std_blue',
  'std_red',
  'std_yellow',
  'std_green',
  'std_beige',
  'std_navy',
] as const

const LABEL_SIZE_STORAGE_KEY = 'geeks_pos_catalog_label_size'
const DEFAULT_LABEL_SIZE: LabelStickerSize = '40x30'

function normalizeSavedLabelSize(raw: string | null): LabelStickerSize {
  const v = (raw || '').trim()
  if (v === '40x30' || v === '40x50' || v === '50x40' || v === '58mm') return v
  return DEFAULT_LABEL_SIZE
}

type WizardVariantForm = {
  product: string
  size: string
  color: string
  purchase_price: string
  list_price: string
  stock_qty: number
}

type MatrixField = 'purchase' | 'list' | 'qty'

export function CatalogPage({
  categories,
  products,
  sizes,
  colors,
  variants,
  count,
  includeDeleted,
  setIncludeDeleted,
  page,
  onCreateVariantBulk,
  onCreateCategory,
  onCreateProduct,
  onCreateSize,
  onAdjustStockQuick,
  onPrintSticker,
  onPrintStickerQueue,
  onToggleVariant,
  onUpdateVariant,
  onDeleteVariant,
  onFilter,
  onPage,
}: {
  categories: Category[]
  products: Product[]
  sizes: Size[]
  colors: Color[]
  variants: Variant[]
  count: number
  includeDeleted: boolean
  setIncludeDeleted: (v: boolean) => void
  page: number
  onCreateVariantBulk: (payload: { product_id: string; matrix: BulkGridCell[] }) => Promise<Variant[]>
  onCreateCategory: (payload: { name_uz: string; name_ru: string }) => Promise<void>
  onCreateProduct: (payload: { category: string; name_uz: string; name_ru: string }) => Promise<void>
  onCreateSize: (payload: { value: string; label_uz: string; label_ru: string; sort_order?: number }) => Promise<void>
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
}) {
  const { t, i18n } = useTranslation()
  const [form, setForm] = useState<WizardVariantForm>({
    product: '',
    size: '',
    color: '',
    purchase_price: '0',
    list_price: '0',
    stock_qty: 0,
  })
  const [busy, setBusy] = useState(false)
  const [seedBusy, setSeedBusy] = useState(false)
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
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1)
  const [matrixCells, setMatrixCells] = useState<Record<string, { purchase: string; list: string; qty: string }>>({})
  const [defaultQty, setDefaultQty] = useState('0')
  const [defaultPurchase, setDefaultPurchase] = useState('0')
  const [defaultList, setDefaultList] = useState('0')
  const [addToPrintQueue, setAddToPrintQueue] = useState(true)
  const [bulkStickerPrompt, setBulkStickerPrompt] = useState<null | { variantIds: string[]; copiesStr: string }>(null)
  const [bulkStickerBusy, setBulkStickerBusy] = useState(false)
  const [numpadOpen, setNumpadOpen] = useState<null | { field: MatrixField; sizeId: string | 'all' }>(null)
  /** Raw digits when matrix numpad was opened. */
  const [matrixNumpadBaseline, setMatrixNumpadBaseline] = useState('0')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  const shoeSizes = useMemo(() => {
    return sizes
      .filter((s) => {
        const n = Number(s.value)
        return Number.isFinite(n) && n >= 36 && n <= 45
      })
      .sort((a, b) => Number(a.value) - Number(b.value))
  }, [sizes])

  const orderedColors = useMemo(() => {
    const std = STANDARD_COLOR_VALUES.map((val) => colors.find((c) => c.value === val)).filter(Boolean) as Color[]
    const stdSet = new Set<string>([...STANDARD_COLOR_VALUES])
    const rest = colors.filter((c) => !stdSet.has(c.value))
    return [...std, ...rest]
  }, [colors])

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

  useEffect(() => {
    if (wizardStep !== 3) return
    setMatrixCells((prev) => {
      const next = { ...prev }
      for (const s of shoeSizes) {
        if (!next[s.id]) next[s.id] = { purchase: '0', list: '0', qty: '0' }
      }
      return next
    })
  }, [wizardStep, shoeSizes])

  function colorChipLabel(c: Color) {
    const key = `catalog.colors.standard.${c.value}`
    const translated = t(key)
    if (translated !== key) return translated
    return i18n.language.startsWith('ru') ? (c.label_ru || c.label_uz) : c.label_uz
  }

  function colorChipStyle(value: string) {
    const v = value.toLowerCase()
    const map: Record<string, string> = { black: '#111827', white: '#f8fafc', red: '#dc2626', blue: '#2563eb', green: '#16a34a', yellow: '#eab308', gray: '#6b7280', beige: '#d6c2a1' }
    const bg = map[v] || '#334155'
    const text = bg === '#f8fafc' || bg === '#d6c2a1' || bg === '#eab308' ? '#0f172a' : '#f8fafc'
    return { backgroundColor: bg, color: text }
  }

  function digitsOnly(v: string): string {
    return (v || '').replace(/\D/g, '')
  }

  function setCellValue(sizeId: string, field: MatrixField, value: string) {
    const nextRaw = digitsOnly(value) || '0'
    setMatrixCells((prev) => {
      const base = prev[sizeId] || { purchase: '0', list: '0', qty: '0' }
      return { ...prev, [sizeId]: { ...base, [field]: nextRaw } }
    })
  }

  function applyDefaultToAll(field: MatrixField, rawValue: string) {
    const nextRaw = digitsOnly(rawValue) || '0'
    setMatrixCells((prev) => {
      const next = { ...prev }
      for (const s of shoeSizes) {
        const base = next[s.id] || { purchase: '0', list: '0', qty: '0' }
        next[s.id] = { ...base, [field]: nextRaw }
      }
      return next
    })
  }

  function matrixNumpadRaw(ctx: { field: MatrixField; sizeId: string | 'all' }): string {
    if (ctx.sizeId === 'all') {
      if (ctx.field === 'qty') return digitsOnly(defaultQty) || '0'
      if (ctx.field === 'purchase') return digitsOnly(defaultPurchase) || '0'
      return digitsOnly(defaultList) || '0'
    }
    const row = matrixCells[ctx.sizeId] || { purchase: '0', list: '0', qty: '0' }
    return digitsOnly(row[ctx.field]) || '0'
  }

  function numpadValue(): string {
    if (!numpadOpen) return '0'
    return matrixNumpadRaw(numpadOpen)
  }

  function openMatrixNumpad(field: MatrixField, sizeId: string | 'all') {
    const ctx = { field, sizeId }
    setMatrixNumpadBaseline(matrixNumpadRaw(ctx))
    setNumpadOpen(ctx)
  }

  function matrixNumpadDisplay(field: MatrixField, rawDigits: string): string {
    if (field === 'qty') return rawDigits
    return formatMoney(rawDigits)
  }

  function onNumpadChange(next: string) {
    const value = digitsOnly(next) || '0'
    if (!numpadOpen) return
    if (numpadOpen.sizeId === 'all') {
      if (numpadOpen.field === 'qty') {
        setDefaultQty(value)
        applyDefaultToAll('qty', value)
      } else if (numpadOpen.field === 'purchase') {
        setDefaultPurchase(value)
        applyDefaultToAll('purchase', value)
      } else {
        setDefaultList(value)
        applyDefaultToAll('list', value)
      }
      return
    }
    setCellValue(numpadOpen.sizeId, numpadOpen.field, value)
  }

  async function submitBulkVariant() {
    const productId = selectedModel || form.product
    if (!productId || !form.color) return
    if (shoeSizes.length === 0) {
      setToast(t('admin.catalog.wizard.needShoeSizes'))
      return
    }
    const matrix: BulkGridCell[] = []
    for (const s of shoeSizes) {
      const cell = matrixCells[s.id] || { purchase: '0', list: '0', qty: '0' }
      const qty = Math.max(0, Math.floor(Number(digitsOnly(cell.qty)) || 0))
      const listInt = digitsOnly(cell.list) || '0'
      const purchaseInt = digitsOnly(cell.purchase) || '0'
      if (qty <= 0 && Number(listInt) <= 0 && Number(purchaseInt) <= 0) continue
      matrix.push({
        size_id: s.id,
        color_id: form.color,
        purchase_price: purchaseInt,
        list_price: listInt,
        initial_qty: qty,
      })
    }
    if (matrix.length === 0) {
      setToast(t('admin.catalog.wizard.bulkEmpty'))
      return
    }
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
        size: '',
        color: '',
      }))
      setMatrixCells({})
      setWizardStep(1)
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e || '')
      if (rawMessage.startsWith('Printer ulanmagan:')) {
        setToast(rawMessage)
      } else {
        setToast(t('admin.catalog.wizard.bulkError'))
      }
    } finally {
      setBusy(false)
    }
  }

  function wizardNext() {
    if (wizardStep === 1) {
      if (!selectedBrand) {
        setToast(t('admin.catalog.wizard.needBrand'))
        return
      }
      if (!(selectedModel || form.product)) {
        setToast(t('admin.catalog.wizard.needModel'))
        return
      }
      setWizardStep(2)
      return
    }
    if (wizardStep === 2) {
      if (!form.color) {
        setToast(t('admin.catalog.wizard.needColor'))
        return
      }
      setWizardStep(3)
      return
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

  async function seedStandardSizesColors() {
    setSeedBusy(true)
    try {
      const sizeValues = Array.from({ length: 10 }, (_, i) => String(36 + i))
      for (const value of sizeValues) {
        if (!sizes.some((s) => s.label_uz === value)) {
          await onCreateSize({ value, label_uz: value, label_ru: value, sort_order: Number(value) })
        }
      }
      /* Standart ranglar migratsiya orqali (std_*) bazaga qo'shiladi */
      setToast(t('admin.catalog.seedSuccess'))
    } catch (e: unknown) {
      const code = (e as Error & { code?: string }).code
      setToast(t(`err.${code || 'CREATE_SIZE_FAILED'}`))
    } finally {
      setSeedBusy(false)
    }
  }

  function addToQueue(variantId: string) {
    setQueueMap((p) => ({ ...p, [variantId]: Math.max(1, (p[variantId] || 0) + 1) }))
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
      {toast && <ActionToast kind="info" message={toast} onClose={() => setToast(null)} />}
      <p className="text-xs text-slate-400">{t('admin.catalog.hint')}</p>
      <p className="text-xs text-slate-500">{t('admin.catalog.actionsHelp')}</p>
      <p className="text-xs text-emerald-400">{t('admin.catalog.barcodeSearchHelp', { defaultValue: 'Barcode bo‘yicha tez qidirish uchun kod kiriting (masalan 20000001).' })}</p>

      <div className="rounded border border-slate-700 bg-slate-900 p-4 space-y-4">
        <button
          type="button"
          className="w-full text-left flex flex-wrap items-center justify-between gap-2"
          onClick={() => setWizardOpen((p) => !p)}
        >
          <div className="text-sm font-medium text-slate-200 inline-flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden />
            {t('admin.catalog.wizard.progress', { step: wizardStep })}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-2">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`h-2 w-10 rounded-full ${wizardStep >= s ? 'bg-emerald-500' : 'bg-slate-700'}`}
                />
              ))}
            </div>
            <span className="text-xs text-slate-400">{wizardOpen ? '▲' : '▼'}</span>
          </div>
        </button>

        {wizardOpen && wizardStep === 1 && (
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
              <div className="flex gap-2">
                <input
                  className="touch-btn min-h-14 flex-1 px-4 rounded-xl bg-slate-950 border border-slate-700 text-base"
                  value={newBrand}
                  onChange={(e) => setNewBrand(e.target.value)}
                  placeholder={t('admin.catalog.newBrand')}
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
                <button
                  type="button"
                  className="touch-btn min-h-14 px-5 rounded-xl bg-emerald-700 border border-emerald-500 font-semibold shrink-0 inline-flex items-center justify-center gap-2"
                  onClick={() => wizardNext()}
                >
                  <PackagePlus className="h-5 w-5" aria-hidden />
                  {t('admin.catalog.wizard.addProductCta')}
                </button>
              </div>
              <div className="flex gap-2 md:col-span-2">
                <input
                  className="touch-btn min-h-14 flex-1 px-4 rounded-xl bg-slate-950 border border-slate-700 text-base"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  placeholder={t('admin.catalog.newModel')}
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
            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={seedBusy}
                className="touch-btn min-h-14 px-5 rounded-xl bg-slate-800 border border-slate-600 disabled:opacity-40"
                onClick={() => void seedStandardSizesColors()}
              >
                {seedBusy ? t('admin.common.saving') : t('admin.catalog.seedStandard')}
              </button>
              <button
                type="button"
                className="touch-btn min-h-14 px-6 rounded-xl bg-emerald-700 border border-emerald-500 font-semibold"
                onClick={() => wizardNext()}
              >
                {t('admin.catalog.wizard.next')}
              </button>
            </div>
          </div>
        )}

        {wizardOpen && wizardStep === 2 && (
          <div className="space-y-4">
            <div className="text-base text-slate-100">{t('admin.catalog.wizard.step2ColorTitle')}</div>
            <p className="text-sm text-slate-400">{t('admin.catalog.wizard.step2ColorHint')}</p>
            <div>
              <div className="text-sm text-slate-400 mb-2">{t('admin.catalog.color')}</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {orderedColors.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    style={colorChipStyle(c.value)}
                    className={`touch-btn min-h-14 rounded-xl border text-sm font-medium px-2 ${
                      form.color === c.id
                        ? 'border-emerald-400 ring-2 ring-emerald-500/50'
                        : 'border-slate-700'
                    }`}
                    onClick={() => setForm((f: WizardVariantForm) => ({ ...f, color: c.id }))}
                  >
                    {colorChipLabel(c)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap justify-between gap-3 pt-2">
              <button
                type="button"
                className="touch-btn min-h-14 px-6 rounded-xl bg-slate-800 border border-slate-600"
                onClick={() => setWizardStep(1)}
              >
                {t('admin.catalog.wizard.back')}
              </button>
              <button
                type="button"
                className="touch-btn min-h-14 px-6 rounded-xl bg-emerald-700 border border-emerald-500 font-semibold"
                onClick={() => wizardNext()}
              >
                {t('admin.catalog.wizard.next')}
              </button>
            </div>
          </div>
        )}

        {wizardOpen && wizardStep === 3 && (
          <div className="space-y-4">
            <div className="text-base text-slate-100">{t('admin.catalog.wizard.step3MatrixTitle')}</div>
            <p className="text-sm text-slate-400">{t('admin.catalog.wizard.step3MatrixHint')}</p>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-3">
              <div className="text-sm font-medium text-slate-200">{t('admin.catalog.wizard.applyDefaults')}</div>
              <div className="grid sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  className="touch-btn min-h-12 rounded-xl border border-slate-700 bg-slate-900 px-3 text-left"
                  onClick={() => openMatrixNumpad('qty', 'all')}
                >
                  <div className="text-xs text-slate-500">{t('admin.catalog.wizard.defaultQty')}</div>
                  <div className="text-lg font-semibold tabular-nums">{digitsOnly(defaultQty) || '0'}</div>
                </button>
                <button
                  type="button"
                  className="touch-btn min-h-12 rounded-xl border border-slate-700 bg-slate-900 px-3 text-left"
                  onClick={() => openMatrixNumpad('purchase', 'all')}
                >
                  <div className="text-xs text-slate-500">{t('admin.catalog.wizard.defaultCost')}</div>
                  <div className="text-lg font-semibold tabular-nums">{formatMoney(defaultPurchase)}</div>
                </button>
                <button
                  type="button"
                  className="touch-btn min-h-12 rounded-xl border border-slate-700 bg-slate-900 px-3 text-left"
                  onClick={() => openMatrixNumpad('list', 'all')}
                >
                  <div className="text-xs text-slate-500">{t('admin.catalog.wizard.defaultSale')}</div>
                  <div className="text-lg font-semibold tabular-nums">{formatMoney(defaultList)}</div>
                </button>
              </div>
            </div>
            <div className="overflow-x-auto kiosk-scrollbar rounded-xl border border-slate-800">
              <table className="w-full text-sm min-w-[32rem]">
                <thead className="bg-slate-950 text-slate-400">
                  <tr>
                    <th className="text-left p-3">{t('admin.catalog.size')}</th>
                    <th className="text-left p-3">{t('admin.catalog.purchase')}</th>
                    <th className="text-left p-3">{t('admin.catalog.sale')}</th>
                    <th className="text-right p-3">{t('admin.catalog.stock')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shoeSizes.map((s) => {
                    const cell = matrixCells[s.id] || { purchase: '0', list: '0', qty: '0' }
                    return (
                      <tr key={s.id} className="border-t border-slate-800">
                        <td className="p-2 font-semibold text-slate-200">{s.label_uz}</td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 text-right tabular-nums"
                            onClick={() => openMatrixNumpad('purchase', s.id)}
                          >
                            {formatMoney(digitsOnly(cell.purchase) || '0')}
                          </button>
                        </td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 text-right tabular-nums"
                            onClick={() => openMatrixNumpad('list', s.id)}
                          >
                            {formatMoney(digitsOnly(cell.list) || '0')}
                          </button>
                        </td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 text-right tabular-nums"
                            onClick={() => openMatrixNumpad('qty', s.id)}
                          >
                            {digitsOnly(cell.qty) || '0'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">{t('admin.catalog.barcodeAuto')}</p>
            <label className="touch-btn inline-flex items-center gap-2 min-h-12 px-3 rounded-xl border border-slate-700 bg-slate-950 text-sm">
              <input
                type="checkbox"
                checked={addToPrintQueue}
                onChange={(e) => setAddToPrintQueue(e.target.checked)}
              />
              {t('admin.catalog.wizard.addToQueueAfterSave')}
            </label>
            <div className="flex flex-wrap justify-between gap-3 pt-2">
              <button
                type="button"
                className="touch-btn min-h-14 px-6 rounded-xl bg-slate-800 border border-slate-600"
                onClick={() => {
                  setWizardStep(2)
                }}
              >
                {t('admin.catalog.wizard.back')}
              </button>
              <button
                type="button"
                disabled={busy || !(selectedModel || form.product)}
                className="touch-btn min-h-14 px-6 rounded-xl bg-emerald-700 border border-emerald-500 font-semibold disabled:opacity-40"
                onClick={() => void submitBulkVariant()}
              >
                {busy ? t('admin.common.saving') : t('admin.catalog.wizard.submitBulk')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="text-left p-2">{t('admin.catalog.product')}</th>
              <th className="text-left p-2">{t('admin.catalog.sizeColor')}</th>
              <th className="text-left p-2">{t('admin.catalog.barcode')}</th>
              <th className="text-right p-2">{t('admin.catalog.stock')}</th>
              <th className="text-right p-2">{t('admin.catalog.price')}</th>
              <th className="text-right p-2">{t('admin.catalog.action')}</th>
            </tr>
          </thead>
          {!useVirtualRows && (
          <tbody>
            {variants.map((v) => (
              <tr key={v.id} className="border-t border-slate-800">
                <td className="p-2">
                  {i18n.language.startsWith('ru')
                    ? (v as typeof v & { product_name_ru?: string }).product_name_ru || v.product_name_uz
                    : v.product_name_uz}
                </td>
                <td className="p-2">
                  {i18n.language.startsWith('ru')
                    ? (v as typeof v & { size_label_ru?: string }).size_label_ru || v.size_label_uz
                    : v.size_label_uz}{' '}
                  /{' '}
                  {i18n.language.startsWith('ru')
                    ? (v as typeof v & { color_label_ru?: string }).color_label_ru || v.color_label_uz
                    : v.color_label_uz}
                </td>
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
                </td>
                <td className="p-2 text-right">{formatMoney(v.list_price)}</td>
                <td className="p-2 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-3 rounded bg-slate-800 border border-slate-600 inline-flex items-center gap-1"
                      onClick={() => {
                        setEditing(v)
                        setEditPrice(v.list_price)
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
            ))}
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
              return (
                <div style={style} className="grid grid-cols-[1.3fr_1fr_0.8fr_0.7fr_0.8fr_2fr] items-center border-b border-slate-800 px-2 text-sm">
                  <div>
                    {i18n.language.startsWith('ru')
                      ? (v as typeof v & { product_name_ru?: string }).product_name_ru || v.product_name_uz
                      : v.product_name_uz}
                  </div>
                  <div>
                    {i18n.language.startsWith('ru')
                      ? (v as typeof v & { size_label_ru?: string }).size_label_ru || v.size_label_uz
                      : v.size_label_uz}{' '}
                    /{' '}
                    {i18n.language.startsWith('ru')
                      ? (v as typeof v & { color_label_ru?: string }).color_label_ru || v.color_label_uz
                      : v.color_label_uz}
                  </div>
                  <div>{v.barcode}</div>
                  <div className="text-right">{v.stock_qty}</div>
                  <div className="text-right">{formatMoney(v.list_price)}</div>
                  <div className="text-right">
                    <div className="inline-flex gap-2">
                      <button
                        type="button"
                        className="touch-btn min-h-10 px-2 rounded bg-slate-800 border border-slate-600 inline-flex items-center gap-1"
                        onClick={() => {
                          setEditing(v)
                          setEditPrice(v.list_price)
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
              ? (quickAdjust as typeof quickAdjust & { product_name_ru?: string }).product_name_ru ||
                quickAdjust.product_name_uz
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
                            ? (v as typeof v & { product_name_ru?: string }).product_name_ru || v.product_name_uz
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
                ? (editing as typeof editing & { product_name_ru?: string }).product_name_ru ||
                  editing.product_name_uz
                : editing.product_name_uz}{' '}
              / {editing.barcode}
            </div>
            <input
              className="w-full px-2 py-2 rounded bg-slate-950 border border-slate-700"
              value={editPurchase}
              onChange={(e) => setEditPurchase(e.target.value)}
              placeholder={t('admin.catalog.purchasePrice')}
            />
            <input
              className="w-full px-2 py-2 rounded bg-slate-950 border border-slate-700"
              value={editPrice}
              onChange={(e) => setEditPrice(e.target.value)}
              placeholder={t('admin.catalog.salePrice')}
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
      {numpadOpen && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setNumpadOpen(null)}
        >
          <div
            className="my-auto w-full max-w-sm max-h-[min(90dvh,90svh)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3 shadow-xl kiosk-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('common.valueBefore')}</div>
              <div className="w-full min-h-12 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-600 text-right text-lg font-semibold tabular-nums text-slate-100">
                {matrixNumpadDisplay(numpadOpen.field, matrixNumpadBaseline)}
              </div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('common.valueEditing')}</div>
              <div className="w-full min-h-12 px-3 py-2.5 rounded-xl bg-slate-950 border border-emerald-700/50 ring-1 ring-emerald-500/30 text-right text-lg font-semibold tabular-nums text-emerald-100">
                {matrixNumpadDisplay(numpadOpen.field, numpadValue())}
              </div>
            </div>
            <TouchNumpad
              className="rounded-xl border border-slate-800 bg-slate-950 p-3"
              value={numpadValue()}
              onChange={onNumpadChange}
              label={
                numpadOpen.field === 'qty'
                  ? t('admin.catalog.wizard.defaultQty')
                  : numpadOpen.field === 'purchase'
                    ? t('admin.catalog.wizard.defaultCost')
                    : t('admin.catalog.wizard.defaultSale')
              }
            />
            <div className="flex justify-end">
              <button
                type="button"
                className="touch-btn min-h-12 px-5 rounded-xl bg-emerald-700 border border-emerald-500 font-medium"
                onClick={() => setNumpadOpen(null)}
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
