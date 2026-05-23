import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calculator, LogOut, ScanLine, Printer, LayoutGrid, Lock, Pause, Play, Trash2, Users } from 'lucide-react'
import Decimal from 'decimal.js'
import {
  AppError,
  completeSale,
  fetchHardwareConfig,
  fetchStoreSettings,
  fetchVariantByBarcode,
  fetchPosVariantSearch,
  fetchPosVariantsByProduct,
  fetchStockEvents,
  fetchMe,
  loginWithPin,
  logout,
  updatePosVariantPrice,
  type PosVariant,
} from '../api'
import { usePosStore, type PayMode, type SuspendedCart } from '../store/posStore'
import { formatMoney } from '../utils/money'
import { showSellPriceInCatalog } from '../utils/sellPriceVisibility'
import { cartNameFieldsFromVariant, formatPosCartLineName } from '../utils/posCartName'
import {
  dateLocale,
  pickCustomName,
  pickProductName,
} from '../utils/localizedName'
import { isPrinterError, translatePrinterError } from '../utils/printerErrors'
import { buildCompleteSaleFingerprintInput, hashSaleIdempotencyKey64 } from '../utils/saleFingerprint'
import { printReceiptWithFallback } from '../utils/printingHub'
import { requestAdminDataRefresh } from '../utils/adminDataRefresh'
import { TouchNumpad } from '../components/TouchNumpad'
import { PinNumpadPanel } from '../components/PinNumpadPanel'
import { ActionToast } from '../components/ActionToast'
import { loadLocale } from '../i18n'

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP })

type PaymentRow = {
  id: string
  method: PayMode
  amount: string
}

function roundSom(v: Decimal.Value): Decimal {
  return new Decimal(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
}

function parseSom(v: string): Decimal {
  const normalized = (v || '0').replace(',', '.').trim() || '0'
  try {
    return roundSom(new Decimal(normalized))
  } catch {
    return new Decimal(0)
  }
}

function beepError() {
  // POS sound effects are disabled globally by request.
}

function beepOk() {
  // POS sound effects are disabled globally by request.
}

function normalizeScannerToken(token: string): string {
  const v = (token || '').trim()
  if (!v) return ''
  if (v === '\\t' || v.toLowerCase() === 'tab') return '\t'
  if (v === '\\n' || v.toLowerCase() === 'enter') return '\n'
  return token
}

function normalizeScanValue(raw: string, prefix: string, suffix: string): string {
  let value = (raw || '').trim()
  if (!value) return ''
  if (suffix && value.endsWith(suffix)) value = value.slice(0, -suffix.length).trim()
  if (prefix && value.startsWith(prefix)) value = value.slice(prefix.length)
  return value.trim()
}

function moneyFromLine(list: string, qty: number): string {
  return roundSom(new Decimal(list).mul(qty)).toString()
}

function sumGrand(cart: ReturnType<typeof usePosStore.getState>['cart']): string {
  let t = new Decimal(0)
  for (const l of cart) {
    t = t.plus(new Decimal(l.listPrice).mul(l.qty))
  }
  return roundSom(t).toString()
}

function calcGrand(subtotal: Decimal, discount: Decimal): Decimal {
  const g = subtotal.minus(discount)
  return g.greaterThan(0) ? roundSom(g) : new Decimal(0)
}

const AFTER_SCAN_FOCUS_KEY = 'pos_after_scan_focus'
const LOW_STOCK_THRESHOLD = 3
/** Ignore identical barcode scans within this window (keyboard wedge duplicates). */
const SCAN_DEBOUNCE_MS = 520

type NumpadCtx = { kind: 'discount' } | { kind: 'payment'; rowId: string }

type StockMatrixOpen = { productId: string; colorId: string; title: string }

export function PosPage({
  onLogout,
  footerLangStrip = false,
}: {
  onLogout: () => void
  /** Standalone `/pos` (no admin sidebar): show language at bottom */
  footerLangStrip?: boolean
}) {
  const { t, i18n } = useTranslation()
  const scanRef = useRef<HTMLInputElement>(null)
  const lastQtyCellRef = useRef<HTMLDivElement>(null)
  const pendingQtyFocus = useRef(false)
  /** Synchronous guard: React `completing` state can lag one frame behind rapid double-submit. */
  const completeInFlightRef = useRef(false)
  /** Guard to prevent auto-complete immediately after a scan (debounce). */
  const lastScanTimeRef = useRef(0)
  /** Bumps after each successful sale so identical cart contents still get a new idempotency key. */
  const idempotencyGenRef = useRef(0)
  const lastScanRef = useRef<{ code: string; at: number } | null>(null)
  /** Blocks immediate re-add of same barcode until a different sku is scanned. */
  const scanDupBlockRef = useRef<string | null>(null)
  const [buffer, setBuffer] = useState('')
  const [toast, setToast] = useState<{ kind: 'err' | 'ok'; msg: string; muteSound?: boolean } | null>(null)
  const [promptPriceVariant, setPromptPriceVariant] = useState<null | PosVariant>(null)
  const [promptPriceBuf, setPromptPriceBuf] = useState('0')
  const [banner, setBanner] = useState<string | null>(null)
  const [scanFlash, setScanFlash] = useState(false)
  const [cartFlash, setCartFlash] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [printBanner, setPrintBanner] = useState<string | null>(null)
  const [lastSaleId, setLastSaleId] = useState<string | null>(null)
  const [clearArmed, setClearArmed] = useState(false)
  const [orderDiscount, setOrderDiscount] = useState('0')
  const [debtDueDate, setDebtDueDate] = useState('')
  const [scannerPrefix, setScannerPrefix] = useState('')
  const [scannerSuffix, setScannerSuffix] = useState('\t')
  const [scannerMode, setScannerMode] = useState<'keyboard' | 'serial'>('keyboard')
  const [autoPrintOnSale, setAutoPrintOnSale] = useState(true)
  const [receiptPrinterName, setReceiptPrinterName] = useState('')
  const [receiptPrinterPort, setReceiptPrinterPort] = useState('')
  const [afterScanFocus, setAfterScanFocus] = useState<'scan' | 'qty'>(() => {
    try {
      const v = localStorage.getItem(AFTER_SCAN_FOCUS_KEY)
      return v === 'qty' ? 'qty' : 'scan'
    } catch {
      return 'scan'
    }
  })
  const [numpadCtx, setNumpadCtx] = useState<NumpadCtx | null>(null)
  const [numpadBuf, setNumpadBuf] = useState('0')
  /** Som string when payment/discount numpad was opened (for before / editing). */
  const [amountNumpadBaseline, setAmountNumpadBaseline] = useState('0')
  const [selectedLine, setSelectedLine] = useState<null | { variantId: string; name: string; stockQty: number; listPrice: string }>(null)
  const [numpadValue, setNumpadValue] = useState('0')
  /** list_price when line price modal was opened. */
  const [priceEditBaseline, setPriceEditBaseline] = useState('0')
  const [priceBusy, setPriceBusy] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [searchResults, setSearchResults] = useState<PosVariant[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [stockMatrix, setStockMatrix] = useState<null | StockMatrixOpen>(null)
  const [locked, setLocked] = useState(false)
  const [lockTimeoutMinutes, setLockTimeoutMinutes] = useState(5)
  const [showSellInCatalog, setShowSellInCatalog] = useState(true)
  const [unlockPin, setUnlockPin] = useState('')
  const [unlockErr, setUnlockErr] = useState<string | null>(null)
  const [unlockBusy, setUnlockBusy] = useState(false)
  const [meUser, setMeUser] = useState('')
  const [matrixRows, setMatrixRows] = useState<PosVariant[]>([])
  const [matrixBusy, setMatrixBusy] = useState(false)
  const [lockNow, setLockNow] = useState(() => new Date())

  const cart = usePosStore((s) => s.cart)
  const payMode = usePosStore((s) => s.payMode)
  const customerName = usePosStore((s) => s.customerName)
  const customerPhone = usePosStore((s) => s.customerPhone)
  const addLine = usePosStore((s) => s.addLine)
  const refreshCartNames = usePosStore((s) => s.refreshCartNames)
  const incQty = usePosStore((s) => s.incQty)
  const clearCart = usePosStore((s) => s.clearCart)
  const setPayMode = usePosStore((s) => s.setPayMode)
  const setCustomer = usePosStore((s) => s.setCustomer)
  const updateLinePrice = usePosStore((s) => s.updateLinePrice)
  const updateLineStock = usePosStore((s) => s.updateLineStock)
  const suspendedCarts = usePosStore((s) => s.suspendedCarts)
  const holdCart = usePosStore((s) => s.holdCart)
  const resumeCart = usePosStore((s) => s.resumeCart)
  const deleteSuspendedCart = usePosStore((s) => s.deleteSuspendedCart)
  const setCart = usePosStore((s) => s.setCart)

  const subtotal = sumGrand(cart)
  const subtotalDec = useMemo(() => parseSom(subtotal), [subtotal])
  const discountDec = useMemo(() => parseSom(orderDiscount), [orderDiscount])
  const grandDec = useMemo(() => calcGrand(subtotalDec, discountDec), [subtotalDec, discountDec])
  const grand = grandDec.toString()

  const lowStockModels = useMemo(() => {
    const byProduct = new Map<
      string,
      {
        id: string
        name: string
        totalStock: number
        soldQty: number
      }
    >()
    const seenVariant = new Set<string>()
    for (const l of cart) {
      const key = l.productId || l.variantId
      const current = byProduct.get(key) || { id: key, name: l.name, totalStock: 0, soldQty: 0 }
      current.soldQty += l.qty
      if (!seenVariant.has(l.variantId)) {
        current.totalStock += Math.max(0, Number(l.stockQty ?? 0))
        seenVariant.add(l.variantId)
      }
      byProduct.set(key, current)
    }
    return Array.from(byProduct.values()).filter((row) => {
      const remaining = row.totalStock - row.soldQty
      return remaining >= 0 && remaining < LOW_STOCK_THRESHOLD
    })
  }, [cart])

  const [paymentRows, setPaymentRows] = useState<PaymentRow[]>([
    { id: crypto.randomUUID(), method: 'CASH', amount: '0' },
  ])
  const [activePayId, setActivePayId] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const me = await fetchMe()
        setMeUser(me.username)
      } catch {
        setMeUser('')
      }
    })()
  }, [])

  const shouldKeepCurrentFocus = useCallback(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return false
    const tag = el.tagName.toUpperCase()
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true
    return el.isContentEditable
  }, [])

  const safeRefocus = useCallback(() => {
    if (locked || numpadCtx || selectedLine || stockMatrix) return
    if (shouldKeepCurrentFocus()) return
    requestAnimationFrame(() => {
      if (document.activeElement !== scanRef.current) {
        scanRef.current?.focus()
      }
    })
    window.setTimeout(() => {
      if (document.activeElement !== scanRef.current) {
        scanRef.current?.focus()
      }
    }, 50)
  }, [locked, numpadCtx, selectedLine, shouldKeepCurrentFocus, stockMatrix])

  function scanFieldPending(): boolean {
    const dom = (scanRef.current?.value || '').trim()
    return Boolean(buffer.trim() || dom)
  }

  useEffect(() => {
    safeRefocus()
  }, [safeRefocus, toast, banner, completing, printBanner])

  useEffect(() => {
    if (!pendingQtyFocus.current || cart.length === 0) return
    pendingQtyFocus.current = false
    const id = requestAnimationFrame(() => lastQtyCellRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [cart])

  useEffect(() => {
    const q = productSearch.trim()
    if (q.length < 2) {
      setSearchResults([])
      return
    }
    const tmr = window.setTimeout(() => {
      setSearchBusy(true)
      void fetchPosVariantSearch(q)
        .then(setSearchResults)
        .catch(() => {
          setSearchResults([])
          showToast('err', t('err.API_ERROR'))
        })
        .finally(() => setSearchBusy(false))
    }, 320)
    return () => window.clearTimeout(tmr)
  }, [productSearch, t])

  useEffect(() => {
    if (!stockMatrix) {
      setMatrixRows([])
      return
    }
    setMatrixBusy(true)
    void fetchPosVariantsByProduct(stockMatrix.productId)
      .then(setMatrixRows)
      .catch(() => {
        setMatrixRows([])
        showToast('err', t('err.API_ERROR'))
      })
      .finally(() => setMatrixBusy(false))
  }, [stockMatrix, t])

  useEffect(() => {
    const inProgress = cart.length > 0 || completing
    window.dispatchEvent(new CustomEvent('geekspos-sale-progress', { detail: { inProgress } }))
  }, [cart.length, completing])

  useEffect(() => {
    ;(async () => {
      let store: Awaited<ReturnType<typeof fetchStoreSettings>> | null = null
      try {
        store = await fetchStoreSettings()
        setShowSellInCatalog(showSellPriceInCatalog(store))
      } catch {
        store = null
        setShowSellInCatalog(true)
      }
      try {
        const cfg = await fetchHardwareConfig()
        setScannerMode(cfg.scanner_mode === 'serial' ? 'serial' : 'keyboard')
        setScannerPrefix(normalizeScannerToken(cfg.scanner_prefix || ''))
        setScannerSuffix(normalizeScannerToken(cfg.scanner_suffix || '\t') || '\t')
        setAutoPrintOnSale(cfg.auto_print_on_sale !== false)
        const fromStore = (store?.receipt_printer_name || '').trim()
        const fromHw = (cfg.receipt_printer_name || '').trim()
        setReceiptPrinterName(fromStore || fromHw)
        setReceiptPrinterPort((store?.receipt_printer_port || cfg.receipt_printer_port || '').trim())
        setLockTimeoutMinutes(Math.max(1, Number(cfg.lock_timeout_minutes || 5)))
      } catch {
        setScannerPrefix('')
        setScannerSuffix('\t')
        setScannerMode('keyboard')
        setAutoPrintOnSale(true)
        setReceiptPrinterName((store?.receipt_printer_name || '').trim())
        setReceiptPrinterPort((store?.receipt_printer_port || '').trim())
        setLockTimeoutMinutes(5)
      }
    })()
  }, [])

  useEffect(() => {
    refreshCartNames(i18n.language)
  }, [i18n.language, refreshCartNames])

  useEffect(() => {
    if (locked) return
    const timeoutMs = Math.max(1, lockTimeoutMinutes) * 60 * 1000
    let timer = window.setTimeout(() => setLocked(true), timeoutMs)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setLocked(true), timeoutMs)
    }
    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart']
    for (const e of events) window.addEventListener(e, reset, { passive: true })
    return () => {
      window.clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, reset as EventListener)
    }
  }, [locked, lockTimeoutMinutes])

  useEffect(() => {
    if (!locked) return
    const id = window.setInterval(() => setLockNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [locked])

  const lockDateLabel = useMemo(
    () =>
      lockNow.toLocaleDateString(dateLocale(i18n.language), {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    [i18n.language, lockNow],
  )
  const lockTimeLabel = useMemo(
    () =>
      lockNow.toLocaleTimeString(dateLocale(i18n.language), {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [i18n.language, lockNow],
  )

  useEffect(() => {
    let since: string | undefined
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const events = await fetchStockEvents(since)
          if (events.length === 0) return
          since = events[events.length - 1].created_at
          for (const e of events) {
            updateLineStock(e.variant_id, e.stock_qty)
          }
        } catch {
          // ignore stock sync polling errors
        }
      })()
    }, 5000)
    return () => window.clearInterval(id)
  }, [updateLineStock])

  useEffect(() => {
    if (paymentRows.length === 1) {
      setPaymentRows((prev) => [{ ...prev[0], amount: grand }])
    }
    if (paymentRows.length > 0 && !activePayId) {
      setActivePayId(paymentRows[0].id)
    }
  }, [grand, paymentRows.length, activePayId])

  function paymentTotal(): Decimal {
    return paymentRows.reduce((acc, r) => acc.plus(parseSom(r.amount)), new Decimal(0))
  }

  function setActiveMethod(method: PayMode) {
    setPayMode(method)
    setPaymentRows((prev) => {
      if (prev.length === 0) {
        const id = crypto.randomUUID()
        setActivePayId(id)
        return [{ id, method, amount: grand }]
      }
      if (!activePayId) {
        return prev.map((p, idx) => (idx === 0 ? { ...p, method } : p))
      }
      return prev.map((p) => (p.id === activePayId ? { ...p, method } : p))
    })
  }

  function addPaymentRow() {
    const id = crypto.randomUUID()
    setPaymentRows((prev) => [...prev, { id, method: payMode, amount: '0' }])
    setActivePayId(id)
  }

  function removePaymentRow(id: string) {
    setPaymentRows((prev) => {
      const next = prev.filter((r) => r.id !== id)
      if (next.length === 0) {
        const single = [{ id: crypto.randomUUID(), method: 'CASH' as PayMode, amount: grand }]
        setActivePayId(single[0].id)
        return single
      }
      if (!next.some((r) => r.id === activePayId)) {
        setActivePayId(next[0].id)
      }
      return next
    })
  }

  function updatePaymentRow(id: string, patch: Partial<PaymentRow>) {
    setPaymentRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function showToast(kind: 'err' | 'ok', msg: string, opts?: { muteSound?: boolean }) {
    setToast({ kind, msg, muteSound: opts?.muteSound })
  }

  function resetCheckoutState() {
    setPaymentRows([{ id: crypto.randomUUID(), method: 'CASH', amount: '0' }])
    setActivePayId(null)
    setOrderDiscount('0')
    setDebtDueDate('')
    setCustomer('', '')
  }

  function openNewCart(toastMsg?: string) {
    clearCart()
    resetCheckoutState()
    if (toastMsg) showToast('ok', toastMsg)
    safeRefocus()
  }

  function holdCurrentCart(opts?: { silent?: boolean }) {
    if (cart.length === 0) return null
    const total = Number(grandDec.toString())
    const suspended = holdCart({ items: cart, total })
    openNewCart(opts?.silent ? undefined : t('pos.newCartOpened'))
    return suspended
  }

  function restoreSuspendedCart(session: SuspendedCart) {
    setCart(session.items)
    refreshCartNames(i18n.language)
    resetCheckoutState()
    setPaymentRows([{ id: crypto.randomUUID(), method: 'CASH', amount: String(session.total || 0) }])
    setActivePayId(null)
    showToast('ok', t('pos.cartResumed'))
    safeRefocus()
  }

  async function tryPrint(saleId: string) {
    setPrintBanner(null)
    try {
      const result = await printReceiptWithFallback(saleId, {
        receipt_printer_name: receiptPrinterName || '',
        receipt_printer_port: receiptPrinterPort || '',
      })
      if (result.kind === 'escpos') {
        showToast(
          'ok',
          t('msg.printQueuedTo', { printer: result.printer }),
          { muteSound: true },
        )
      } else {
        showToast(
          'ok',
          t('msg.printQueuedPlain'),
          { muteSound: true },
        )
      }
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e || '')
      if (isPrinterError(rawMessage)) {
        setPrintBanner(translatePrinterError(rawMessage))
      } else {
        setPrintBanner(t('msg.printFailed'))
      }
      showToast('err', rawMessage || t('msg.printFailed'), { muteSound: true })
    }
    safeRefocus()
  }

  function addVariantToCart(v: PosVariant, opts?: { clearSearch?: boolean }) {
    const nameFields = cartNameFieldsFromVariant(v)
    const displayName = formatPosCartLineName(nameFields, i18n.language)
    // If variant has no authoritative list price, prompt cashier for sale-time price.
    if (v.list_price == null) {
      setPromptPriceVariant(v as PosVariant)
      setPromptPriceBuf('0')
      return
    }

    addLine({
      variantId: v.id,
      productId: v.product,
      colorId: '',
      barcode: v.barcode ?? '',
      name: displayName,
      nameFields,
      sizeLabel: '',
      colorLabel: '',
      listPrice: String(v.list_price),
      stockQty: Number(v.stock_qty || 0),
      qty: 1,
    })
    beepOk()
    setCartFlash(true)
    setTimeout(() => setCartFlash(false), 240)
    if (opts?.clearSearch) {
      setProductSearch('')
      setSearchResults([])
    }
    if (afterScanFocus === 'qty') {
      pendingQtyFocus.current = true
    } else {
      safeRefocus()
    }
  }

  async function handleScanSubmit(code: string) {
    const c = code.trim()
    if (!c) return
    if (scanDupBlockRef.current && scanDupBlockRef.current !== c) {
      scanDupBlockRef.current = null
    }
    if (scanDupBlockRef.current && scanDupBlockRef.current === c) {
      showToast('err', t('msg.scanDuplicate'))
      setBuffer('')
      safeRefocus()
      return
    }
    const now = Date.now()
    const prev = lastScanRef.current
    if (prev && prev.code === c && now - prev.at < SCAN_DEBOUNCE_MS) {
      setBuffer('')
      safeRefocus()
      return
    }
    lastScanRef.current = { code: c, at: now }
    lastScanTimeRef.current = now
    try {
      const v = await fetchVariantByBarcode(c)
      setBuffer('')
      addVariantToCart(v)
      scanDupBlockRef.current = c
    } catch (e: unknown) {
      beepError()
      setScanFlash(true)
      setTimeout(() => setScanFlash(false), 400)
      const code = (e as Error & { code?: string }).code
      const msg =
        code === 'BARCODE_NOT_FOUND'
          ? `${t('msg.scanNotFound')}: ${c}`
          : t(`err.${code || 'API_ERROR'}`, { defaultValue: t('msg.scanApi') })
      showToast('err', msg)
      setBuffer('')
      safeRefocus()
    }
  }

  async function doComplete() {
    if (completing || completeInFlightRef.current || cart.length === 0) return
    if (scanFieldPending()) {
      safeRefocus()
      return
    }

    const pays = paymentRows.map((r) => ({ method: r.method, amount: parseSom(r.amount) }))
    const payTotal = pays.reduce((acc, p) => acc.plus(p.amount), new Decimal(0))

    if (!payTotal.eq(grandDec)) {
      beepError()
      setBanner(`${t('msg.paymentMismatch')} (${formatMoney(payTotal.toString())} / ${formatMoney(grandDec.toString())})`)
      safeRefocus()
      return
    }

    const hasDebt = pays.some((p) => p.method === 'DEBT' && p.amount.gt(0))
    if (hasDebt && (!customerPhone.trim() || !customerName.trim())) {
      beepError()
      setBanner(t('msg.debtRequired'))
      safeRefocus()
      return
    }

    completeInFlightRef.current = true
    setBanner(null)
    setCompleting(true)

    try {
      const lines = cart.map((l) => ({
        variant_id: l.variantId,
        qty: l.qty,
        line_discount: '0',
        unit_price: parseSom(l.listPrice).toString(),
      }))
      const payments = pays.map((p) => ({ method: p.method, amount: p.amount.toString() }))
      const customer = hasDebt
        ? {
            name: customerName.trim(),
            phone_normalized: customerPhone.trim(),
          }
        : undefined

      const canonical = buildCompleteSaleFingerprintInput({
        generation: idempotencyGenRef.current,
        lines,
        payments,
        order_discount: discountDec.toString(),
        expected_grand_total: grandDec.toString(),
        debt_due_date: hasDebt && debtDueDate ? debtDueDate : null,
        customer,
      })
      const idem = await hashSaleIdempotencyKey64(canonical)

      const res = await completeSale(
        {
          lines,
          payments,
          order_discount: discountDec.toString(),
          customer,
          debt_due_date: hasDebt && debtDueDate ? debtDueDate : null,
          expected_grand_total: grandDec.toString(),
        },
        idem,
      )
      idempotencyGenRef.current += 1
      setLastSaleId(res.sale_id)
      openNewCart()
      showToast('ok', `${t('msg.sale')}: ${res.public_sale_no || res.sale_id}`)
      if (autoPrintOnSale) void tryPrint(res.sale_id as string)
      requestAdminDataRefresh('sale-complete')
    } catch (e: unknown) {
      beepError()
      const appErr = e instanceof AppError ? e : null
      const code = appErr?.code || (e as Error & { code?: string }).code
      const detail = appErr?.detail || (e as Error & { detail?: string }).detail || ''
      const fallback = detail || (e instanceof Error ? e.message : '') || t('msg.errorGeneric')
      const baseMsg = t(`err.${code || 'API_ERROR'}`, { defaultValue: fallback })
      const msg =
        code === 'API_ERROR' && detail && detail !== 'API_ERROR' ? `${baseMsg}: ${detail}` : baseMsg
      if (code === 'INSUFFICIENT_STOCK') {
        setBanner(`${t('msg.stock')} ${msg}`)
      } else {
        setBanner(msg)
      }
      showToast('err', msg)
    } finally {
      completeInFlightRef.current = false
      setCompleting(false)
    }
    safeRefocus()
  }

  function onScanKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) {
      e.preventDefault()
      return
    }
    if (e.altKey && e.key === 'F4') {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (buffer.trim()) {
        const normalized = normalizeScanValue(buffer, scannerPrefix, scannerSuffix || '\t')
        setBuffer('')
        if (normalized) void handleScanSubmit(normalized)
      } else if (
        cart.length > 0 &&
        !completing &&
        !completeInFlightRef.current &&
        !scanFieldPending() &&
        Date.now() - lastScanTimeRef.current > 500
      ) {
        void doComplete()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      if (cart.length > 0) {
        if (e.shiftKey || clearArmed) {
          clearCart()
          setClearArmed(false)
        } else {
          setClearArmed(true)
          setBanner(t('msg.clearCartConfirm'))
        }
      }
      setBuffer('')
      safeRefocus()
      return
    }
    if (e.key === 'F1') {
      e.preventDefault()
      setActiveMethod('CASH')
      return
    }
    if (e.key === 'F2') {
      e.preventDefault()
      setActiveMethod('CARD')
      return
    }
    if (e.key === 'F3') {
      e.preventDefault()
      setActiveMethod('DEBT')
      return
    }
  }

  useEffect(() => {
    function onGlobalKeyDown(e: KeyboardEvent) {
      if (locked) return
      if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault()
        return
      }
      if (e.altKey && e.key === 'F4') {
        e.preventDefault()
        return
      }
      if (['Enter', 'Escape', 'F1', 'F2', 'F3'].includes(e.key)) {
        e.preventDefault()
        const target = e.target as HTMLElement | null
        const tag = (target?.tagName || '').toUpperCase()
        // Keep standard text editing unaffected except the dedicated scanner input.
        if (tag === 'INPUT' && target?.id !== 'posScanInput') return
        if (e.key === 'Enter') {
          if (buffer.trim()) {
            const normalized = normalizeScanValue(buffer, scannerPrefix, scannerSuffix || '\t')
            setBuffer('')
            if (normalized) void handleScanSubmit(normalized)
          } else if (
            cart.length > 0 &&
            !completing &&
            !completeInFlightRef.current &&
            !scanFieldPending() &&
            Date.now() - lastScanTimeRef.current > 500
          ) {
            void doComplete()
          }
          return
        }
        if (e.key === 'Escape') {
          if (cart.length > 0) {
            if (e.shiftKey || clearArmed) {
              clearCart()
              setClearArmed(false)
            } else {
              setClearArmed(true)
              setBanner(t('msg.clearCartConfirm'))
            }
          }
          setBuffer('')
          safeRefocus()
          return
        }
        if (e.key === 'F1') setActiveMethod('CASH')
        if (e.key === 'F2') setActiveMethod('CARD')
        if (e.key === 'F3') setActiveMethod('DEBT')
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown)
    return () => window.removeEventListener('keydown', onGlobalKeyDown)
  }, [
    buffer,
    cart.length,
    clearArmed,
    clearCart,
    completing,
    locked,
    safeRefocus,
    scannerPrefix,
    scannerSuffix,
    t,
  ])

  useEffect(() => {
    if (locked) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input,select,textarea,button,[role="dialog"]')) return
      safeRefocus()
    }
    const onFocus = () => safeRefocus()
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('focus', onFocus)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') safeRefocus()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [locked, safeRefocus])

  function onScanChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    if (scannerMode !== 'keyboard') {
      setBuffer(v)
      return
    }
    const suffix = scannerSuffix || '\t'
    if (suffix && v.endsWith(suffix)) {
      const code = normalizeScanValue(v, scannerPrefix, suffix)
      setBuffer('')
      void handleScanSubmit(code)
      return
    }
    setBuffer(v)
  }

  const payTotalView = paymentTotal().toString()

  function openAmountNumpad(ctx: NumpadCtx) {
    setNumpadCtx(ctx)
    if (ctx.kind === 'discount') {
      const buf = roundSom(parseSom(orderDiscount)).toString()
      setNumpadBuf(buf)
      setAmountNumpadBaseline(buf)
    } else {
      const row = paymentRows.find((r) => r.id === ctx.rowId)
      const buf = row ? roundSom(parseSom(row.amount)).toString() : '0'
      setNumpadBuf(buf)
      setAmountNumpadBaseline(buf)
    }
  }

  function applyAmountNumpad() {
    if (!numpadCtx) return
    const v = roundSom(parseSom(numpadBuf)).toString()
    if (numpadCtx.kind === 'discount') {
      setOrderDiscount(v)
    } else {
      updatePaymentRow(numpadCtx.rowId, { amount: v })
    }
    setNumpadCtx(null)
    safeRefocus()
  }

  function setAfterScanMode(mode: 'scan' | 'qty') {
    setAfterScanFocus(mode)
    try {
      localStorage.setItem(AFTER_SCAN_FOCUS_KEY, mode)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold truncate">{t('app.title')}</span>
        </div>
        <div className="flex gap-2 items-center">
          {lastSaleId && (
            <button
              type="button"
              className="touch-btn inline-flex items-center gap-2 text-sm px-4 py-2 rounded-xl bg-slate-800 border border-slate-600"
              onClick={() => lastSaleId && void tryPrint(lastSaleId)}
            >
              <Printer className="h-4 w-4" aria-hidden />
              {t('header.reprint')}
            </button>
          )}
          <button
            type="button"
            className="touch-btn inline-flex items-center gap-2 text-sm px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-slate-200"
            onClick={() => {
              setLocked(true)
              setUnlockPin('')
              setUnlockErr(null)
            }}
          >
            <Lock className="h-4 w-4" aria-hidden />
            {t('header.lock', { defaultValue: 'Lock' })}
          </button>
          <button
            type="button"
            className="touch-btn inline-flex items-center gap-2 text-sm px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-slate-200"
            onClick={async () => {
              await logout()
              onLogout()
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t('header.logout')}
          </button>
        </div>
      </header>

      <section className="mx-4 mt-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3 max-h-48 min-h-0 flex flex-col">
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="inline-flex items-center gap-2 text-sm text-slate-300">
            <Users className="h-4 w-4" />
            {t('pos.activeSessions', { defaultValue: 'Faol navbatlar' })}: {suspendedCarts.length}
          </div>
          <button
            type="button"
            className="touch-btn min-h-11 px-4 rounded-xl bg-slate-800 border border-slate-600 inline-flex items-center gap-2 text-sm"
            onClick={() => {
              const held = holdCurrentCart()
              if (!held) {
                showToast('err', t('cart.empty', { defaultValue: 'Savat bosh' }))
              }
            }}
          >
            <Pause className="h-4 w-4" />
            {t('pos.holdCart', { defaultValue: "Navbatga olish" })}
          </button>
        </div>
        {suspendedCarts.length > 0 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto overflow-y-auto pb-1 min-h-0 max-h-[min(11rem,28vh)] kiosk-scrollbar">
            {suspendedCarts.map((session) => (
              <div
                key={session.id}
                className="min-w-[210px] rounded-xl border border-slate-700 bg-slate-900 p-3"
              >
                <div className="text-sm font-medium text-slate-100 truncate">{session.label}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {t('summary.total')}: {formatMoney(String(session.total))}
                </div>
                <div className="text-xs text-slate-500">{session.timestamp}</div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="touch-btn min-h-12 px-3 rounded-lg bg-emerald-700 border border-emerald-500 text-xs inline-flex items-center gap-1"
                    onClick={() => {
                      if (cart.length > 0) {
                        holdCurrentCart({ silent: true })
                      }
                      const picked = resumeCart(session.id)
                      if (picked) restoreSuspendedCart(picked)
                    }}
                  >
                    <Play className="h-3.5 w-3.5" />
                    {t('pos.resumeCart', { defaultValue: 'Tiklash' })}
                  </button>
                  <button
                    type="button"
                    className="touch-btn min-h-12 px-3 rounded-lg bg-red-900 border border-red-700 text-xs inline-flex items-center gap-1"
                    onClick={() => {
                      deleteSuspendedCart(session.id)
                      showToast('ok', t('pos.cartDeleted', { defaultValue: "Navbatdagi savat o'chirildi" }))
                      safeRefocus()
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('admin.catalog.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">{t('pos.noHeldCarts', { defaultValue: "Navbatdagi savatlar yo'q" })}</p>
        )}
      </section>

      {toast && (
        <ActionToast
          kind={toast.kind}
          message={toast.msg}
          muteSound={toast.muteSound}
          onClose={() => setToast(null)}
        />
      )}
      {banner && (
        <div className="mx-4 mt-2 px-3 py-2 rounded text-sm bg-red-950 border border-red-800 text-red-100">
          {banner}
          <button
            type="button"
            className="ml-2 underline text-white"
            onClick={() => {
              setBanner(null)
              setClearArmed(false)
              safeRefocus()
            }}
          >
            {t('msg.close')}
          </button>
        </div>
      )}
      {printBanner && (
        <div className="mx-4 mt-2 px-3 py-2 rounded text-sm bg-amber-950 border border-amber-800">
          {printBanner}
        </div>
      )}
      {lowStockModels.length > 0 && (
        <div className="mx-4 mt-2 px-3 py-2 rounded text-sm bg-amber-950/90 border border-amber-700 text-amber-50 max-h-[min(10rem,22vh)] min-h-0 flex flex-col">
          <div className="font-medium shrink-0">{t('pos.lowStockModelWarning', { n: LOW_STOCK_THRESHOLD })}</div>
          <ul className="mt-1 list-disc list-inside text-xs opacity-95 overflow-y-auto min-h-0 kiosk-scrollbar pr-1">
            {lowStockModels.map((row) => (
              <li key={row.id}>
                {row.name}: {t('pos.afterSaleModelStock', { count: Math.max(0, row.totalStock - row.soldQty) })}
              </li>
            ))}
          </ul>
        </div>
      )}

      <main className="flex-1 flex flex-col md:flex-row gap-4 p-4">
        <section className="flex-1 flex flex-col gap-3">
          <label className="text-xs text-slate-400">{t('scan.label')}</label>
          <input
            ref={scanRef}
            id="posScanInput"
            value={buffer}
            onChange={onScanChange}
            onKeyDown={onScanKeyDown}
            inputMode="none"
            enterKeyHint="done"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={`w-full text-lg px-3 py-3 rounded border bg-slate-900 outline-none ${
              scanFlash ? 'border-red-500 ring-2 ring-red-600' : 'border-slate-600'
            }`}
            placeholder={t('scan.placeholder')}
            autoComplete="off"
          />
          <p className="text-xs text-slate-500">{t('scan.hint')}</p>

          <label className="text-xs text-slate-400 mt-3 block" htmlFor="posProductSearch">
            {t('pos.searchLabel')}
          </label>
          <input
            id="posProductSearch"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            className="touch-btn w-full text-base px-3 py-3 rounded-xl border bg-slate-900 border-slate-600 outline-none"
            placeholder={t('pos.searchPlaceholder')}
            autoComplete="off"
          />
          {searchBusy && <p className="text-xs text-slate-500">{t('admin.common.loading')}</p>}
          {productSearch.trim().length >= 2 && !searchBusy && searchResults.length === 0 && (
            <p className="text-xs text-amber-600/90">{t('pos.searchEmpty')}</p>
          )}
          {searchResults.length > 0 && (
            <ul
              className="max-h-52 overflow-y-auto kiosk-scrollbar rounded-xl border border-slate-700 bg-slate-900/90 divide-y divide-slate-800"
              role="listbox"
            >
              {searchResults.map((v) => {
                const customName = pickCustomName(v, i18n.language)
                return (
                <li key={v.id}>
                  <button
                    type="button"
                    className="touch-btn w-full min-h-12 text-left px-3 py-3 text-sm hover:bg-slate-800"
                    onClick={() => addVariantToCart(v, { clearSearch: true })}
                  >
                    <div className="font-medium">
                      {pickProductName(v, i18n.language)}
                    </div>
                    {customName && <div className="text-xs text-slate-300 italic">{customName}</div>}
                    <div className="text-xs text-slate-400">
                      {showSellInCatalog && !v.hide_selling_price && v.list_price != null
                        ? `${formatMoney(String(v.list_price))} · `
                        : ''}
                      {t('admin.catalog.stock')}: {v.stock_qty}
                    </div>
                    {v.barcode ? <div className="text-xs text-slate-500 font-mono mt-0.5">{v.barcode}</div> : null}
                  </button>
                </li>
              )
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>{t('pos.focusAfterScan')}:</span>
            <button
              type="button"
              className={`touch-btn px-3 py-2 rounded-lg border text-sm ${
                afterScanFocus === 'scan' ? 'border-emerald-500 bg-emerald-950/50 text-emerald-100' : 'border-slate-600'
              }`}
              onClick={() => setAfterScanMode('scan')}
            >
              {t('pos.focusScanField')}
            </button>
            <button
              type="button"
              className={`touch-btn px-3 py-2 rounded-lg border text-sm ${
                afterScanFocus === 'qty' ? 'border-emerald-500 bg-emerald-950/50 text-emerald-100' : 'border-slate-600'
              }`}
              onClick={() => setAfterScanMode('qty')}
            >
              {t('pos.focusQtyField')}
            </button>
          </div>

          {cart.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 py-12 px-6 text-center">
              <ScanLine className="mx-auto h-20 w-20 text-slate-600 mb-4" strokeWidth={1.25} aria-hidden />
              <div className="text-lg font-semibold text-slate-200">{t('pos.emptyCartTitle')}</div>
              <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto">{t('pos.emptyCartBody')}</p>
            </div>
          )}

          <div
            className={`rounded-xl border overflow-hidden transition-colors ${
              cart.length === 0 ? 'hidden' : ''
            } ${cartFlash ? 'border-emerald-500' : 'border-slate-800'}`}
          >
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="text-left p-3">{t('cart.title')}</th>
                  <th className="p-3">{t('cart.qty')}</th>
                  <th className="text-right p-3">{t('cart.sum')}</th>
                </tr>
              </thead>
              <tbody>
                {cart.map((l, idx) => (
                  <tr
                    key={l.variantId}
                    className="border-t border-slate-800 cursor-pointer hover:bg-slate-900/60"
                    onClick={() => {
                      setPriceEditBaseline(l.listPrice)
                      setNumpadValue(String(parseSom(l.listPrice)))
                      setSelectedLine({
                        variantId: l.variantId,
                        name: l.name,
                        stockQty: Number(l.stockQty || 0),
                        listPrice: l.listPrice,
                      })
                    }}
                  >
                    <td className="p-3">
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-slate-400">
                        {l.colorLabel} / {l.sizeLabel} - {l.barcode}
                      </div>
                      {l.productId ? (
                        <button
                          type="button"
                          className="touch-btn mt-2 inline-flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-slate-200"
                          onClick={(e) => {
                            e.stopPropagation()
                            setStockMatrix({
                              productId: l.productId,
                              colorId: l.colorId,
                              title: `${l.name} — ${l.colorLabel}`,
                            })
                          }}
                        >
                          <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />
                          {t('pos.stockMatrix')}
                        </button>
                      ) : null}
                    </td>
                    <td className="p-3 text-center">
                      <div
                        ref={idx === cart.length - 1 ? lastQtyCellRef : undefined}
                        tabIndex={idx === cart.length - 1 ? 0 : -1}
                        className="inline-flex items-center gap-2 outline-none rounded-lg focus-visible:ring-2 focus-visible:ring-emerald-500"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="touch-btn min-h-12 min-w-12 rounded-xl bg-slate-800 border border-slate-600 text-lg font-semibold"
                          onClick={() => incQty(l.variantId, -1)}
                        >
                          -
                        </button>
                        <span className="min-w-[2rem] text-center text-base font-medium">{l.qty}</span>
                        <button
                          type="button"
                          className="touch-btn min-h-12 min-w-12 rounded-xl bg-slate-800 border border-slate-600 text-lg font-semibold"
                          onClick={() => incQty(l.variantId, 1)}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="p-3 text-right text-base">{formatMoney(moneyFromLine(l.listPrice, l.qty))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="w-full md:w-96 md:self-start flex flex-col gap-3">
          <div className="rounded border border-slate-800 p-3 bg-slate-900">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-slate-400">{t('pay.split')}</div>
              <button
                type="button"
                className="touch-btn px-4 py-2 text-sm rounded-xl bg-slate-800 border border-slate-600"
                onClick={addPaymentRow}
              >
                {t('pay.addRow')}
              </button>
            </div>

            <div className="space-y-2">
              {paymentRows.map((r) => (
                <div
                  key={r.id}
                  className={`grid grid-cols-[1fr_1fr_auto] gap-3 p-3 rounded border ${
                    activePayId === r.id ? 'border-emerald-500 bg-slate-950' : 'border-slate-700'
                  }`}
                  onClick={() => setActivePayId(r.id)}
                >
                  <select
                    className="touch-btn min-h-12 px-2 rounded-xl bg-slate-900 border border-slate-600 text-sm"
                    value={r.method}
                    onChange={(e) => updatePaymentRow(r.id, { method: e.target.value as PayMode })}
                  >
                    <option value="CASH">{t('pay.method.cash')}</option>
                    <option value="CARD">{t('pay.method.card')}</option>
                    <option value="DEBT">{t('pay.method.debt')}</option>
                  </select>
                  <div className="flex gap-1 items-stretch min-w-0">
                    <input
                      className="touch-btn min-h-12 flex-1 min-w-0 px-2 rounded-xl bg-slate-900 border border-slate-600 text-sm"
                      value={r.amount}
                      readOnly
                      inputMode="none"
                      onFocus={() => openAmountNumpad({ kind: 'payment', rowId: r.id })}
                    />
                    <button
                      type="button"
                      className="touch-btn min-h-12 min-w-12 shrink-0 rounded-xl bg-slate-800 border border-slate-600 flex items-center justify-center"
                      onClick={() => openAmountNumpad({ kind: 'payment', rowId: r.id })}
                      aria-label={t('pos.openNumpad')}
                    >
                      <Calculator className="h-5 w-5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="touch-btn min-h-12 min-w-14 rounded-xl bg-red-900/70 border border-red-700 text-base font-bold"
                    onClick={() => removePaymentRow(r.id)}
                    disabled={paymentRows.length === 1}
                    aria-label={t('pay.removeRow', { defaultValue: 'Remove payment row' })}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-2 text-xs text-slate-400">
              {t('summary.subtotal')}: {formatMoney(subtotal)}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {t('summary.discount')}: {formatMoney(orderDiscount)}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {t('pay.total')}: {formatMoney(payTotalView)} / {t('pay.grand')}: {formatMoney(grand)}
            </div>
            <div className="mt-2 flex gap-2 items-stretch">
              <input
                className="touch-btn min-h-12 flex-1 px-3 rounded-xl bg-slate-900 border border-slate-600 text-sm"
                value={orderDiscount}
                readOnly
                inputMode="none"
                onFocus={() => openAmountNumpad({ kind: 'discount' })}
                placeholder={t('summary.discount')}
              />
              <button
                type="button"
                className="touch-btn min-h-12 min-w-12 shrink-0 rounded-xl bg-slate-800 border border-slate-600 flex items-center justify-center"
                onClick={() => openAmountNumpad({ kind: 'discount' })}
                aria-label={t('pos.openNumpad')}
              >
                <Calculator className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-3 flex gap-3 flex-wrap">
              {(['CASH', 'CARD', 'DEBT'] as PayMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setActiveMethod(m)}
                  className={`touch-btn min-h-12 px-5 rounded-xl text-sm font-medium border ${
                    payMode === m
                      ? m === 'CASH'
                        ? 'bg-emerald-700 border-emerald-500'
                        : m === 'CARD'
                          ? 'bg-sky-700 border-sky-500'
                          : 'bg-amber-700 border-amber-500'
                      : 'bg-slate-800 border-slate-600'
                  }`}
                >
                  {m === 'CASH' && `F1 ${t('pay.mode.cash')}`}
                  {m === 'CARD' && `F2 ${t('pay.mode.card')}`}
                  {m === 'DEBT' && `F3 ${t('pay.mode.debt')}`}
                </button>
              ))}
            </div>
          </div>

          {paymentRows.some((p) => p.method === 'DEBT' && parseSom(p.amount).gt(0)) && (
            <div className="rounded border border-slate-800 p-3 bg-slate-900 space-y-2">
              <div className="text-sm text-slate-400">{t('pay.customer')}</div>
              <input
                className="touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 text-sm"
                placeholder={t('pay.customerName')}
                value={customerName}
                onChange={(e) => setCustomer(e.target.value, customerPhone)}
              />
              <input
                className="touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 text-sm"
                placeholder={t('pay.customerPhone')}
                value={customerPhone}
                onChange={(e) => setCustomer(customerName, e.target.value)}
              />
              <input
                type="date"
                className="touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 text-sm text-slate-100 [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-90 [&::-webkit-calendar-picker-indicator]:invert"
                value={debtDueDate}
                onChange={(e) => setDebtDueDate(e.target.value)}
              />
            </div>
          )}

          <div className="sticky bottom-2 md:bottom-4 z-20 rounded-xl border border-slate-700 p-4 bg-slate-900/95 backdrop-blur supports-[backdrop-filter]:bg-slate-900/85 shadow-xl">
            <div className="text-slate-400 text-sm">{t('summary.total')}</div>
            <div className="text-3xl font-bold mt-1">{formatMoney(grand)}</div>
            <button
              type="button"
              disabled={cart.length === 0}
              className="touch-btn mt-3 w-full min-h-12 py-3 rounded-xl bg-slate-800 border border-slate-600 disabled:opacity-40 font-medium inline-flex items-center justify-center gap-2"
              onClick={() => {
                const held = holdCurrentCart()
                if (!held) {
                  showToast('err', t('cart.empty', { defaultValue: 'Savat bosh' }))
                }
              }}
            >
              <Pause className="h-4 w-4" />
              {t('pos.holdCart', { defaultValue: "Navbatga olish" })}
            </button>
            <button
              type="button"
              disabled={completing || cart.length === 0}
              className="touch-btn mt-4 w-full min-h-14 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 font-semibold text-lg"
              onClick={() => void doComplete()}
            >
              {completing ? t('summary.saving') : t('summary.completeTouch')}
            </button>
            <p className="text-xs text-slate-500 mt-2 text-center">{t('summary.complete')}</p>
          </div>
        </aside>
      </main>
      {numpadCtx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/70 p-4">
          <div className="my-auto w-full max-w-md max-h-[min(90dvh,90svh)] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-xl kiosk-scrollbar">
            <h3 className="text-lg font-semibold mb-3">
              {numpadCtx.kind === 'discount' ? t('pos.numpadDiscountTitle') : t('pos.numpadTitle')}
            </h3>
            <div className="space-y-2 mb-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('common.valueBefore')}</div>
              <div className="w-full min-h-12 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-600 text-right text-xl font-bold tabular-nums text-slate-100">
                {formatMoney(amountNumpadBaseline)}
              </div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('common.valueEditing')}</div>
              <div className="w-full min-h-12 px-3 py-2.5 rounded-xl bg-slate-950 border border-emerald-700/50 ring-1 ring-emerald-500/30 text-right text-xl font-bold tabular-nums text-emerald-100">
                {formatMoney(numpadBuf)}
              </div>
            </div>
            <TouchNumpad value={(numpadBuf || '0').replace(/\D/g, '') || '0'} onChange={setNumpadBuf} />
            <div className="flex gap-3 mt-5 justify-end">
              <button
                type="button"
                className="touch-btn min-h-12 px-5 rounded-xl bg-slate-800 border border-slate-600"
                onClick={() => {
                  setNumpadCtx(null)
                  safeRefocus()
                }}
              >
                {t('admin.common.cancel')}
              </button>
              <button
                type="button"
                className="touch-btn min-h-12 px-6 rounded-xl bg-emerald-700 border border-emerald-500 font-semibold"
                onClick={() => applyAmountNumpad()}
              >
                {t('pos.numpadApply')}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedLine && (
        <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/60 p-4">
          <div className="my-auto w-full max-w-lg max-h-[min(90dvh,90svh)] overflow-y-auto rounded border border-slate-700 bg-slate-900 p-4 space-y-3 kiosk-scrollbar">
            <h3 className="text-lg font-semibold">{selectedLine.name}</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded bg-slate-950 border border-slate-700 p-2">
                <div className="text-slate-400">{t('admin.catalog.stock')}</div>
                <div className="text-xl">{selectedLine.stockQty}</div>
              </div>
              <div className="rounded bg-slate-950 border border-slate-700 p-2">
                <div className="text-slate-400">{t('admin.catalog.salePrice')}</div>
                <div className="text-xl">{formatMoney(selectedLine.listPrice)}</div>
              </div>
            </div>
            <div className="rounded-xl bg-slate-950 border border-slate-700 p-3 space-y-2">
              <div className="text-sm text-slate-400">{t('admin.catalog.salePrice')}</div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('common.valueBefore')}</div>
              <div className="w-full min-h-12 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-600 text-right text-xl font-semibold tabular-nums">
                {formatMoney(priceEditBaseline)}
              </div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('common.valueEditing')}</div>
              <div className="w-full min-h-12 px-3 py-2.5 rounded-xl bg-slate-900 border border-emerald-700/50 ring-1 ring-emerald-500/25 text-right text-xl font-semibold tabular-nums text-emerald-100">
                {formatMoney(numpadValue)}
              </div>
              <TouchNumpad
                className="mt-2"
                value={(numpadValue || '0').replace(/\D/g, '') || '0'}
                onChange={(v) => setNumpadValue(v)}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                className="touch-btn min-h-12 px-5 rounded-xl bg-slate-800 border border-slate-600"
                onClick={() => {
                  setSelectedLine(null)
                  safeRefocus()
                }}
              >
                {t('admin.common.cancel')}
              </button>
              <button
                type="button"
                disabled={priceBusy}
                className="touch-btn min-h-12 px-5 rounded-xl bg-emerald-700 border border-emerald-500 disabled:opacity-50"
                onClick={async () => {
                  setPriceBusy(true)
                  try {
                    const nextPrice = String(parseSom(numpadValue))
                    await updatePosVariantPrice(selectedLine.variantId, nextPrice)
                    updateLinePrice(selectedLine.variantId, nextPrice)
                    showToast('ok', t('admin.settings.actionCompleted', { label: t('admin.catalog.salePrice') }))
                    setSelectedLine(null)
                    setNumpadValue('0')
                  } catch (e: unknown) {
                    const code = (e as Error & { code?: string }).code
                    showToast('err', t(`err.${code || 'POS_PRICE_UPDATE_FAILED'}`))
                  } finally {
                    setPriceBusy(false)
                  }
                }}
              >
                {priceBusy ? t('admin.common.saving') : t('admin.common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
      {promptPriceVariant && (
        <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/60 p-4">
          <div className="my-auto w-full max-w-md max-h-[min(90dvh,90svh)] overflow-y-auto rounded border border-slate-700 bg-slate-900 p-4 space-y-3 kiosk-scrollbar">
            <h3 className="text-lg font-semibold">{pickProductName(promptPriceVariant, i18n.language)}</h3>
            <div className="text-sm text-slate-400">{t('pos.enterSalePrice')}</div>
            <div className="rounded-xl bg-slate-950 border border-slate-700 p-3 space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('common.valueEditing')}</div>
              <div className="w-full min-h-12 px-3 py-2.5 rounded-xl bg-slate-900 border border-emerald-700/50 ring-1 ring-emerald-500/25 text-right text-xl font-semibold tabular-nums text-emerald-100">
                {formatMoney(promptPriceBuf)}
              </div>
              <TouchNumpad value={(promptPriceBuf || '0').replace(/\D/g, '') || '0'} onChange={setPromptPriceBuf} />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="touch-btn min-h-12 px-5 rounded-xl bg-slate-800 border border-slate-600" onClick={() => { setPromptPriceVariant(null); setPromptPriceBuf('0'); safeRefocus(); }}>
                {t('admin.common.cancel')}
              </button>
              <button type="button" className="touch-btn min-h-12 px-5 rounded-xl bg-emerald-700 border border-emerald-500" onClick={() => {
                try {
                  const price = String(parseSom(promptPriceBuf))
                  const nameFields = cartNameFieldsFromVariant(promptPriceVariant)
                  addLine({
                    variantId: promptPriceVariant.id,
                    productId: promptPriceVariant.product,
                    colorId: '',
                    barcode: promptPriceVariant.barcode ?? '',
                    name: formatPosCartLineName(nameFields, i18n.language),
                    nameFields,
                    sizeLabel: '',
                    colorLabel: '',
                    listPrice: price,
                    stockQty: Number(promptPriceVariant.stock_qty || 0),
                    qty: 1,
                  })
                  beepOk()
                  setCartFlash(true)
                  setTimeout(() => setCartFlash(false), 240)
                } finally {
                  setPromptPriceVariant(null)
                  setPromptPriceBuf('0')
                  safeRefocus()
                }
              }}>
                {t('admin.common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
      {stockMatrix && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overscroll-contain bg-black/60 p-4"
          role="dialog"
          aria-modal
          aria-labelledby="stock-matrix-title"
        >
          <div className="my-auto flex min-h-0 w-full max-w-lg max-h-[min(90dvh,90svh)] flex-col rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <div className="mb-3 flex shrink-0 items-start justify-between gap-2">
              <div>
                <h2 id="stock-matrix-title" className="text-lg font-semibold text-slate-100">
                  {t('pos.stockMatrixTitle')}
                </h2>
                <p className="text-sm text-slate-400 mt-1">{stockMatrix.title}</p>
              </div>
              <button
                type="button"
                className="touch-btn px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-sm"
                onClick={() => {
                  setStockMatrix(null)
                  safeRefocus()
                }}
              >
                {t('pos.matrixClose')}
              </button>
            </div>
            {matrixBusy ? (
              <p className="shrink-0 py-6 text-sm text-slate-400">{t('admin.common.loading')}</p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-800 kiosk-scrollbar">
                <table className="w-full text-sm">
                  <thead className="bg-slate-950 text-slate-400 sticky top-0">
                    <tr>
                      <th className="text-left p-3">{t('pos.matrixSize')}</th>
                      <th className="text-right p-3">{t('pos.matrixStock')}</th>
                      {showSellInCatalog && (
                        <th className="text-right p-3">{t('cart.sum')}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map((r) => (
                      <tr key={r.id} className="border-t border-slate-800">
                        <td className="p-3">
                          <div className="font-medium">
                            {pickProductName(r, i18n.language)}
                          </div>
                          {r.barcode ? <div className="text-xs text-slate-500 font-mono">{r.barcode}</div> : null}
                        </td>
                        <td className="p-3 text-right tabular-nums">{r.stock_qty}</td>
                        {showSellInCatalog && (
                          <td className="p-3 text-right tabular-nums">
                            {!r.hide_selling_price && r.list_price != null
                              ? formatMoney(String(r.list_price))
                              : ''}
                          </td>
                        )}
                      </tr>
                    ))}
                    {matrixRows.length === 0 && (
                      <tr>
                        <td colSpan={showSellInCatalog ? 3 : 2} className="p-6 text-center text-slate-500">
                          {t('pos.searchEmpty')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {footerLangStrip && (
        <footer className="border-t border-slate-800 bg-slate-900 px-4 py-2 flex flex-wrap items-center gap-2 justify-center shrink-0">
          <span className="text-xs text-slate-500 uppercase tracking-wide">{t('admin.sidebar.language')}</span>
          <button
            type="button"
            className={`touch-btn text-sm px-4 py-2 rounded-xl border ${
              i18n.language === 'uz'
                ? 'bg-emerald-700 border-emerald-500 text-white'
                : 'bg-slate-800 border-slate-600 text-slate-200'
            }`}
            onClick={() => void loadLocale('uz')}
          >
            {t('lang.uz')}
          </button>
          <button
            type="button"
            className={`touch-btn text-sm px-4 py-2 rounded-xl border ${
              i18n.language === 'uz-cyrl'
                ? 'bg-emerald-700 border-emerald-500 text-white'
                : 'bg-slate-800 border-slate-600 text-slate-200'
            }`}
            onClick={() => void loadLocale('uz-cyrl')}
          >
            {t('lang.uz-cyrl')}
          </button>
          <button
            type="button"
            className={`touch-btn text-sm px-4 py-2 rounded-xl border ${
              i18n.language.startsWith('ru')
                ? 'bg-emerald-700 border-emerald-500 text-white'
                : 'bg-slate-800 border-slate-600 text-slate-200'
            }`}
            onClick={() => void loadLocale('ru')}
          >
            {t('lang.ru')}
          </button>
        </footer>
      )}
      {locked && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto overscroll-contain bg-black/90 p-4">
          <div className="my-auto w-full max-w-sm max-h-[min(90dvh,90svh)] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5 space-y-4 shadow-2xl kiosk-scrollbar">
            <div className="flex flex-col items-center text-center gap-2">
              <img src="/resized-logo.png" alt="logo" className="h-16 w-16 rounded-xl bg-white p-1 object-contain" />
              <h3 className="text-xl font-semibold">{t('header.lock', { defaultValue: 'Locked' })}</h3>
              <p className="text-slate-300 text-sm capitalize">{lockDateLabel}</p>
              <p className="text-3xl font-bold text-emerald-300 tracking-wide">{lockTimeLabel}</p>
            </div>
            <PinNumpadPanel
              pin={unlockPin}
              setPin={setUnlockPin}
              label={t('auth.pin', { defaultValue: 'PIN' })}
            />
            {unlockErr && <p className="text-sm text-red-400">{unlockErr}</p>}
            <button
              type="button"
              className="touch-btn w-full px-3 py-2 rounded-xl bg-emerald-700 border border-emerald-500 font-medium"
              disabled={unlockBusy}
              onClick={async () => {
                if (unlockBusy) return
                setUnlockBusy(true)
                try {
                  if (!meUser) throw new Error('INVALID_PIN')
                  await loginWithPin(meUser, unlockPin)
                  setLocked(false)
                } catch {
                  setUnlockErr(t('err.INVALID_PIN'))
                } finally {
                  setUnlockBusy(false)
                }
              }}
            >
              {t('admin.common.unlock', { defaultValue: 'Unlock' })}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
