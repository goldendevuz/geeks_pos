/** In Tauri/bundled mode default to loopback backend, in Vite dev keep same-origin proxy. */
const RUNTIME_API_KEY = 'geeks_pos_runtime_api_base'
const LAST_RUNTIME_API_KEY = 'geeks_pos_runtime_api_base_last_auth'
const TOKEN_KEY = 'geeks_pos_auth_token'

function shouldUseDevProxy(): boolean {
  if (typeof window === 'undefined') return false
  return (
    isTauriRuntime() &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
    window.location.hostname === 'localhost'
  )
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== 'undefined'
}

function readRuntimeApiBase(): string {
  try {
    return localStorage.getItem(RUNTIME_API_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

function writeRuntimeApiBase(base: string) {
  try {
    localStorage.setItem(RUNTIME_API_KEY, base)
  } catch {
    // ignore storage errors
  }
}

function readLastAuthApiBase(): string {
  try {
    return localStorage.getItem(LAST_RUNTIME_API_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

function writeLastAuthApiBase(base: string) {
  try {
    localStorage.setItem(LAST_RUNTIME_API_KEY, base)
  } catch {
    // ignore storage errors
  }
}

function readAccessToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

function writeToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // ignore storage errors
  }
}

function clearTokens() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore storage errors
  }
}

function shouldAttachAuth(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  return raw.includes('/api/')
}

const fetch: typeof globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers || {})
  if (shouldAttachAuth(input)) {
    const token = readAccessToken()
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Token ${token}`)
    }
  }
  const res = await globalThis.fetch(input, { ...init, headers })
  if (res.status === 401 && shouldAttachAuth(input)) {
    clearTokens()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('geekspos-auth-expired'))
    }
  }
  return res
}

async function resolveLatestRuntimeApiBase(): Promise<string> {
  if (shouldUseDevProxy()) {
    return ''
  }
  const cached = readRuntimeApiBase()
  if (!isTauriRuntime()) return cached
  try {
    const { invoke } = await import('@tauri-apps/api/tauri')
    const live = (await invoke<string>('get_backend_base_url')).trim()
    if (live) {
      writeRuntimeApiBase(live)
      return live
    }
  } catch {
    // fallback to cached runtime base
  }
  return cached
}

function resolveApiBase(): string {
  if (shouldUseDevProxy()) {
    return ''
  }
  const runtime = readRuntimeApiBase()
  if (runtime) return runtime
  const configured = (import.meta.env.VITE_API_BASE as string | undefined)?.trim()
  if (configured) return configured
  if (isTauriRuntime() || import.meta.env.PROD) return 'http://127.0.0.1:8000'
  return ''
}

const API = {
  toString() {
    return resolveApiBase()
  },
} as unknown as string

export class AppError extends Error {
  code: string
  detail?: string
  constructor(code: string, detail?: string) {
    super(code)
    this.code = code
    this.detail = detail
  }
}

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[2]) : null
}

function getUiLanguageHeader(): string {
  try {
    const stored = localStorage.getItem('geeks_pos_lang') || ''
    if (stored.toLowerCase().startsWith('ru')) return 'ru'
  } catch {
    // ignore localStorage access issues
  }
  return 'uz'
}

async function logApiError(message: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/tauri')
    await invoke('append_app_log', { level: 'ERROR', message: `API: ${message}` })
  } catch {
    // ignore logging errors in browser/dev
  }
}

async function resetSessionOnBaseChange(nextBase: string): Promise<void> {
  if (!nextBase) return
  const prevBase = readLastAuthApiBase()
  if (!prevBase || prevBase === nextBase) {
    writeLastAuthApiBase(nextBase)
    return
  }
  clearTokens()
  writeLastAuthApiBase(nextBase)
}

async function parseErrorResponse(r: Response, fallbackCode: string): Promise<AppError> {
  const j = (await r.json().catch(() => ({}))) as { code?: string; detail?: string }
  let code = j.code || fallbackCode
  const detail = j.detail
  if (r.status >= 500 && !j.code) {
    code = 'BACKEND_INIT_REQUIRED'
  }
  void logApiError(`${r.status} ${r.url} code=${code} detail=${detail || '-'}`)
  return new AppError(code, detail)
}

/** Catalog variant row returned to POS (no purchase_price). */
export type PosVariant = {
  id: string
  product: string
  product_name_uz: string
  product_name_ru?: string
  product_name_uz_cyrillic?: string | null
  product_custom_name_uz?: string
  product_custom_name_ru?: string
  product_custom_name_uz_cyrillic?: string | null
  category_name_uz?: string
  category_name_ru?: string
  barcode: string | null
  list_price: string | null
  stock_qty: number
  is_active: boolean
  deleted_at: string | null
  hide_selling_price?: boolean
}

export async function fetchCsrf(): Promise<string> {
  const liveBase = await resolveLatestRuntimeApiBase()
  if (liveBase) {
    writeRuntimeApiBase(liveBase)
  }
  return ''
}

export async function login(username: string, password: string): Promise<void> {
  const r = await fetch(`${API}/api/auth/login/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })
  if (!r.ok) {
    throw await parseErrorResponse(r, 'INVALID_CREDENTIALS')
  }
  const j = (await r.json().catch(() => ({}))) as { token?: string }
  writeToken((j.token || '').trim())
}

export type PinUser = { username: string; display_name: string; role: UserRole; pin_enabled: boolean }

export async function fetchPinUsers(): Promise<PinUser[]> {
  const r = await fetch(`${API}/api/auth/pin-users/`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_PIN_USERS_FAILED')
  const j = (await r.json()) as { results?: PinUser[] }
  return Array.isArray(j.results) ? j.results : []
}

export async function loginWithPin(username: string, pin: string): Promise<void> {
  const liveBase = await resolveLatestRuntimeApiBase()
  if (liveBase) {
    writeRuntimeApiBase(liveBase)
    await resetSessionOnBaseChange(liveBase)
  }
  const r = await fetch(`${API}/api/auth/pin-login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, pin }),
  })
  if (!r.ok) throw await parseErrorResponse(r, 'INVALID_PIN')
  const j = (await r.json().catch(() => ({}))) as { token?: string }
  writeToken((j.token || '').trim())
}

export async function setUserPin(username: string, pin: string, enabled = true): Promise<void> {
  const csrf = await fetchCsrf()
  const r = await fetch(`${API}/api/auth/set-pin/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify({ username, pin, enabled }),
  })
  if (!r.ok) throw await parseErrorResponse(r, 'SET_PIN_FAILED')
}

export async function logout(): Promise<void> {
  await fetch(`${API}/api/auth/logout/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  clearTokens()
}

export async function fetchVariantByBarcode(code: string): Promise<PosVariant> {
  const r = await fetch(
    `${API}/api/catalog/variants/by-barcode/?code=${encodeURIComponent(code)}`,
    { credentials: 'include' },
  )
  if (r.status === 404) {
    throw await parseErrorResponse(r, 'BARCODE_NOT_FOUND')
  }
  if (!r.ok) throw await parseErrorResponse(r, 'API_ERROR')
  return r.json() as Promise<PosVariant>
}

export async function fetchPosVariantSearch(q: string): Promise<PosVariant[]> {
  const trimmed = q.trim()
  if (trimmed.length < 2) return []
  const r = await fetch(
    `${API}/api/catalog/variants/pos-search/?q=${encodeURIComponent(trimmed)}&limit=30`,
    { credentials: 'include' },
  )
  if (!r.ok) throw await parseErrorResponse(r, 'API_ERROR')
  const j = (await r.json()) as { results?: PosVariant[] }
  return Array.isArray(j.results) ? j.results : []
}

export async function fetchPosVariantsByProduct(productId: string): Promise<PosVariant[]> {
  const qs = new URLSearchParams({ product_id: productId })
  const r = await fetch(`${API}/api/catalog/variants/pos-by-product/?${qs}`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'API_ERROR')
  const j = (await r.json()) as { results?: PosVariant[] }
  return Array.isArray(j.results) ? j.results : []
}

export async function updatePosVariantPrice(variantId: string, listPrice: string) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/catalog/variants/${variantId}/pos-price/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify({ list_price: listPrice }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'POS_PRICE_UPDATE_FAILED', j.detail)
  return j as PosVariant
}

export type CompleteSaleResponse = {
  sale_id: string
  public_sale_no?: string
  grand_total: string
  receipt?: unknown
}

export async function completeSale(body: object, idempotencyKey: string): Promise<CompleteSaleResponse> {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const requestInit: RequestInit = {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrf,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  }
  const url = `${API}/api/sales/complete/`
  let r: Response
  try {
    r = await fetch(url, requestInit)
  } catch (e: unknown) {
    const firstMsg = e instanceof Error ? e.message : String(e || 'Failed to fetch')
    // Runtime API base can become stale if backend port changes; refresh and retry once.
    const liveBase = await resolveLatestRuntimeApiBase()
    if (liveBase) {
      writeRuntimeApiBase(liveBase)
      try {
        r = await fetch(`${liveBase}/api/sales/complete/`, requestInit)
      } catch (e2: unknown) {
        const secondMsg = e2 instanceof Error ? e2.message : String(e2 || 'Failed to fetch')
        void logApiError(
          `FETCH_FAIL ${url} detail=${firstMsg}; retry_base=${liveBase} retry_detail=${secondMsg}`,
        )
        throw new AppError('API_ERROR', secondMsg)
      }
    } else {
      void logApiError(`FETCH_FAIL ${url} detail=${firstMsg}; retry_skipped=no_live_base`)
      throw new AppError('API_ERROR', firstMsg)
    }
  }
  if (!r.ok) throw await parseErrorResponse(r, 'SALE_FAILED')
  return (await r.json()) as CompleteSaleResponse
}

export async function fetchReceiptEscpos(saleId: string): Promise<string | null> {
  const r = await fetch(`${API}/api/printing/receipt/${saleId}/escpos/`, {
    credentials: 'include',
  })
  if (!r.ok) return null
  const j = (await r.json()) as { raw_base64?: string | null; escpos_base64?: string | null }
  return j.raw_base64 ?? j.escpos_base64 ?? null
}

export async function fetchReceiptPlain(saleId: string): Promise<string | null> {
  const r = await fetch(`${API}/api/printing/receipt/${saleId}/`, {
    credentials: 'include',
  })
  if (!r.ok) return null
  const j = await r.json()
  return j.plain_text as string | null
}

export type UserRole = 'CASHIER' | 'ADMIN' | 'OWNER'

export type MeResponse = {
  username: string
  role: UserRole
}

function normalizeRole(role: unknown): UserRole {
  const raw = typeof role === 'string' ? role.toUpperCase() : ''
  // Accept strict values and enum-like values such as "Role.OWNER".
  if (raw === 'ADMIN' || raw.endsWith('.ADMIN')) return 'ADMIN'
  if (raw === 'OWNER' || raw.endsWith('.OWNER')) return 'OWNER'
  if (raw === 'CASHIER' || raw.endsWith('.CASHIER')) return 'CASHIER'
  return 'CASHIER'
}

export async function fetchMe(): Promise<MeResponse> {
  const r = await fetch(`${API}/api/auth/me/`, { credentials: 'include' })
  if (!r.ok) throw new Error('UNAUTHENTICATED')
  const j = (await r.json()) as { username?: unknown; role?: unknown }
  return {
    username: typeof j.username === 'string' ? j.username : '',
    role: normalizeRole(j.role),
  }
}

export type LicenseStatus = {
  enforcement: boolean
  valid: boolean
  license_key_masked: string
  expires_at: string | null
  last_check_ok: boolean
  last_check_message: string
  hardware_id_set?: boolean
  hardware_id?: string
  demo_days_total?: number
  demo_days_left?: number
  demo_expires_at?: string | null
  requires_activation?: boolean
}

export async function fetchLicenseStatus(): Promise<LicenseStatus> {
  const r = await fetch(`${API}/api/licensing/status/`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'LICENSE_STATUS_FAILED')
  return (await r.json()) as LicenseStatus
}

export async function activateLicense(hardware_id: string, activation_key: string): Promise<LicenseStatus> {
  const csrf = await fetchCsrf()
  const os =
    typeof navigator !== 'undefined' && navigator.platform
      ? String(navigator.platform).toLowerCase()
      : 'unknown'
  const r = await fetch(`${API}/api/licensing/activate/`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrf,
    },
    body: JSON.stringify({
      hardware_id,
      activation_key,
      client_meta: { app_version: 'desktop-tauri', os },
    }),
  })
  if (!r.ok) throw await parseErrorResponse(r, 'LICENSE_ACTIVATE_FAILED')
  return (await r.json()) as LicenseStatus
}

export type Category = { id: string; name_uz: string; name_ru: string }
export type Product = {
  id: string
  category: string
  name_uz: string
  name_ru: string
  color?: string
  is_active: boolean
  deleted_at: string | null
}
export type Variant = {
  id: string
  product: string
  product_name_uz: string
  product_name_ru?: string
  product_custom_name_uz?: string
  product_custom_name_ru?: string
  category_name_uz?: string
  category_name_ru?: string
  barcode: string | null
  purchase_price: string
  list_price: string | null
  stock_qty: number
  show_price_on_label: boolean
  hide_selling_price: boolean
  is_active: boolean
  deleted_at: string | null
  color?: string | null
}

/** Cashier read-only stock list (no purchase_price). */
export type CashierStockVariant = {
  id: string
  product: string
  product_name_uz: string
  product_name_ru: string
  product_custom_name_uz?: string
  product_custom_name_ru?: string
  category_name_uz?: string
  category_name_ru?: string
  barcode: string | null
  list_price: string | null
  purchase_price?: string
  stock_qty: number
  is_active: boolean
  hide_selling_price: boolean
  color?: string | null
}

export type CashierXReport = {
  cashier_username: string
  sales_count: number
  sales_amount: string
  total_discounts: string
  cash_total: string
  card_total: string
  debt_total: string
  refund_cash?: string
  refund_card?: string
  refund_debt?: string
  refund_total?: string
  avg_check: string
  gross_profit?: string
  range: { from: string; to: string }
}

export type Paginated<T> = {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

function toPaginated<T>(input: unknown): Paginated<T> {
  if (
    typeof input === 'object' &&
    input !== null &&
    'results' in input &&
    Array.isArray((input as { results: unknown[] }).results)
  ) {
    return input as Paginated<T>
  }
  const rows = Array.isArray(input) ? (input as T[]) : []
  return { count: rows.length, next: null, previous: null, results: rows }
}

export async function fetchCategories(): Promise<Category[]> {
  const r = await fetch(`${API}/api/catalog/categories/`, { credentials: 'include' })
  if (!r.ok) throw new Error('FETCH_CATEGORIES_FAILED')
  return r.json()
}

export async function createCategory(body: { name_uz: string; name_ru: string; sort_order?: number }) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/catalog/categories/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'CREATE_CATEGORY_FAILED', j.detail)
  return j as Category
}

export async function updateCategory(categoryId: string, body: { name_uz: string; name_ru: string; sort_order?: number }) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/catalog/categories/${categoryId}/`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'UPDATE_CATEGORY_FAILED', j.detail)
  return j as Category
}

export async function deleteCategory(categoryId: string) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/catalog/categories/${categoryId}/`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRFToken': csrf },
  })
  if (!r.ok) throw new AppError('DELETE_CATEGORY_FAILED')
}

export async function fetchProducts(params?: {
  includeDeleted?: boolean
  q?: string
  page?: number
  pageSize?: number
}): Promise<Paginated<Product>> {
  const q = new URLSearchParams()
  if (params?.includeDeleted) q.set('include_deleted', '1')
  if (params?.q) q.set('q', params.q)
  if (params?.page) q.set('page', String(params.page))
  if (params?.pageSize) q.set('page_size', String(params.pageSize))
  const qs = q.toString() ? `?${q.toString()}` : ''
  const r = await fetch(`${API}/api/catalog/products/${qs}`, { credentials: 'include' })
  if (!r.ok) throw new Error('FETCH_PRODUCTS_FAILED')
  return toPaginated<Product>(await r.json())
}

export async function createProduct(body: {
  category: string
  name_uz: string
  name_ru: string
  is_active?: boolean
}) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/catalog/products/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'CREATE_PRODUCT_FAILED', j.detail)
  return j as Product
}

export async function updateProduct(productId: string, body: {
  custom_name_uz?: string
  custom_name_ru?: string
  custom_name_uz_cyrillic?: string
  color?: string
}) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/catalog/products/${productId}/`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'UPDATE_PRODUCT_FAILED', j.detail)
  return j as Product
}

export async function deleteProduct(productId: string, hard = true) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const suffix = hard ? '?hard=1' : ''
  const r = await fetch(`${API}/api/catalog/products/${productId}/${suffix}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRFToken': csrf },
  })
  if (r.status === 204) return { code: 'HARD_DELETED' as const }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'DELETE_PRODUCT_FAILED', j.detail)
  return j as { code?: string }
}

export async function fetchVariants(params?: {
  includeDeleted?: boolean
  q?: string
  page?: number
  pageSize?: number
  ordering?: 'name' | 'recent'
  category_id?: string
  product_id?: string
}): Promise<Paginated<Variant>> {
  const q = new URLSearchParams()
  if (params?.includeDeleted) q.set('include_deleted', '1')
  if (params?.q) q.set('q', params.q)
  if (params?.page) q.set('page', String(params.page))
  if (params?.pageSize) q.set('page_size', String(params.pageSize))
  if (params?.ordering) q.set('ordering', params.ordering)
  if (params?.category_id) q.set('category_id', params.category_id)
  if (params?.product_id) q.set('product_id', params.product_id)
  const qs = q.toString() ? `?${q.toString()}` : ''
  const r = await fetch(`${API}/api/catalog/variants/${qs}`, { credentials: 'include' })
  if (!r.ok) throw new Error('FETCH_VARIANTS_FAILED')
  return toPaginated<Variant>(await r.json())
}

export async function fetchCashierStockVariants(params?: {
  q?: string
  page?: number
  pageSize?: number
}): Promise<Paginated<CashierStockVariant>> {
  const q = new URLSearchParams()
  if (params?.q) q.set('q', params.q)
  if (params?.page) q.set('page', String(params.page))
  if (params?.pageSize) q.set('page_size', String(params.pageSize))
  const qs = q.toString() ? `?${q.toString()}` : ''
  const r = await fetch(`${API}/api/catalog/variants/cashier-stock/${qs}`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_CASHIER_STOCK_FAILED')
  return toPaginated<CashierStockVariant>(await r.json())
}

export type BulkGridCell = {
  purchase_price: string
  list_price?: string
  initial_qty?: number
  barcode?: string
}

export async function createVariantBulkGrid(body: { product_id: string; matrix: BulkGridCell[] }) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/catalog/variants/bulk-grid/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'BULK_GRID_FAILED', j.detail)
  return j as Variant[]
}

export async function updateVariant(
  id: string,
  patch: Partial<{
    purchase_price: string
    list_price: string
    is_active: boolean
    barcode: string
    hide_selling_price: boolean
    show_price_on_label: boolean
  }>,
) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/catalog/variants/${id}/`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(patch),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.detail || 'UPDATE_VARIANT_FAILED')
  return j as Variant
}

export async function deleteVariant(id: string, hard = true) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const suffix = hard ? '?hard=1' : ''
  const r = await fetch(`${API}/api/catalog/variants/${id}/${suffix}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRFToken': csrf },
  })
  if (r.status === 204) return { code: 'HARD_DELETED' }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'DELETE_VARIANT_FAILED', j.detail)
  return j as { code?: string }
}

export type DebtRow = {
  id: string
  customer: string
  customer_name: string
  customer_phone: string
  status: 'OPEN' | 'PAID' | 'VOIDED'
  due_date?: string | null
  remaining_amount: string
  total_amount: string
  paid_amount: string
  created_at: string
}

export async function fetchOpenDebts(): Promise<DebtRow[]> {
  const r = await fetch(`${API}/api/debt/debts/open/`, { credentials: 'include' })
  if (!r.ok) throw new Error('FETCH_DEBTS_FAILED')
  return r.json()
}

export async function repayDebt(customerId: string, amount: string): Promise<DebtRow[]> {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/debt/payments/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify({ customer_id: customerId, amount }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'DEBT_PAYMENT_FAILED', j.detail)
  return j as DebtRow[]
}

export async function updateDebtCustomer(
  customerId: string,
  patch: { name: string; phone_normalized: string },
): Promise<{ id: string; name: string; phone_normalized: string }> {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/debt/customers/${customerId}/`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(patch),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'UPDATE_CUSTOMER_FAILED', j.detail)
  return j as { id: string; name: string; phone_normalized: string }
}

export type SaleReturnStatusHistory = 'none' | 'partial' | 'full'

export type SaleHistoryRow = {
  id: string
  public_sale_no?: string
  status: string
  cashier_username: string
  completed_at: string
  grand_total: string
  subtotal?: string
  discount_total?: string
  return_status?: SaleReturnStatusHistory
  refund_total?: string
  can_void?: boolean
}

export type DashboardSummary = {
  totals: {
    sales_count: number
    sales_amount: string
    today_sales_amount: string
    today_sales_count?: number
    today_items_sold_qty?: number
    today_return_move_count?: number
    today_return_qty?: number
    today_void_count?: number
    expense_total?: string
    today_expense_total?: string
    today_gross_profit?: string
    today_operating_profit?: string
    today_cash_total?: string
    today_card_total?: string
    today_debt_total?: string
    today_refund_cash?: string
    today_refund_card?: string
    today_refund_total?: string
    refund_total?: string
    void_count: number
    avg_check: string
    gross_profit: string
    total_discounts: string
    open_debt_count: number
    open_debt_total: string
    cash_total?: string
    card_total?: string
    debt_total?: string
    returned_total?: string
    returned_cogs?: string
    inventory_items?: number
    inventory_purchase_value?: string
    inventory_sale_value?: string
    turnover_amount?: string
    net_profit?: string
    operating_profit?: string
    net_sales_approx?: string
  }
  top_cashiers: Array<{
    cashier: string
    sales_count: number
    sales_amount: string
  }>
  top_products?: Array<{ name: string; qty: number; sales_amount?: string }>
  top_brands?: Array<{ name: string; qty: number; sales_amount?: string }>
  low_products?: Array<{ name: string; qty: number }>
  low_brands?: Array<{ name: string; qty: number }>
  range?: { from?: string; to?: string; year?: string | null }
}

export async function fetchSalesHistory(params?: {
  from?: string
  to?: string
  q?: string
  page?: number
}): Promise<Paginated<SaleHistoryRow>> {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  if (params?.q) q.set('q', params.q)
  if (params?.page) q.set('page', String(params.page))
  const qs = q.toString() ? `?${q.toString()}` : ''
  const r = await fetch(`${API}/api/sales/${qs}`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_SALES_FAILED')
  return r.json()
}

export async function fetchDashboardSummary(params?: { from?: string; to?: string; year?: string }) {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  if (params?.year) q.set('year', params.year)
  const qs = q.toString() ? `?${q.toString()}` : ''
  const r = await fetch(`${API}/api/reports/summary/${qs}`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_DASHBOARD_FAILED')
  return (await r.json()) as DashboardSummary
}

export type ExpenseCategory = 'RENT' | 'UTILITIES' | 'SUPPLIES' | 'SALARY' | 'OTHER'

export type ShopExpenseRow = {
  id: string
  recorded_at: string
  amount: string
  category: ExpenseCategory
  note: string
  cashier_username?: string
}

export type PaginatedExpenses = {
  count: number
  next: string | null
  previous: string | null
  results: ShopExpenseRow[]
}

export async function fetchShopExpenses(params?: {
  from?: string
  to?: string
  page?: number
  page_size?: number
}): Promise<PaginatedExpenses> {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  if (params?.page) q.set('page', String(params.page))
  if (params?.page_size) q.set('page_size', String(params.page_size))
  const qs = q.toString() ? `?${q.toString()}` : ''
  const r = await fetch(`${API}/api/expenses/${qs}`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_EXPENSES_FAILED')
  const j = await r.json()
  if (Array.isArray(j)) {
    return { count: j.length, next: null, previous: null, results: j as ShopExpenseRow[] }
  }
  return j as PaginatedExpenses
}

export async function updateShopExpense(
  id: string,
  payload: { amount?: string; category?: ExpenseCategory; note?: string },
): Promise<ShopExpenseRow> {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/expenses/${id}/`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(payload),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'UPDATE_EXPENSE_FAILED', j.detail)
  return j as ShopExpenseRow
}

export async function createShopExpense(payload: {
  amount: string
  category: ExpenseCategory
  note?: string
}): Promise<ShopExpenseRow> {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/expenses/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(payload),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'CREATE_EXPENSE_FAILED', j.detail)
  return j as ShopExpenseRow
}

export async function exportSalesXlsx(params?: { from?: string; to?: string }) {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  const qs = q.toString() ? `?${q.toString()}` : ''
  const r = await fetch(`${API}/api/sales/export/xlsx/${qs}`, { credentials: 'include' })
  if (!r.ok) throw new Error('EXPORT_SALES_XLSX_FAILED')
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'sales_history.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}

export type SalePaymentRow = {
  method: string
  amount: string
}

export type SaleReturnPreviewLine = {
  variant_id: string
  barcode: string
  category_name_uz: string
  category_name_ru: string
  product_name_uz: string
  product_name_ru: string
  qty: number
  list_unit_price: string
  net_unit_price: string
  line_discount: string
  line_total: string
  stock_qty: number
}

export type SaleSearchForReturnRow = {
  sale_id: string
  public_sale_no?: string
  completed_at: string
  cashier_username: string
  subtotal?: string
  discount_total?: string
  grand_total: string
  payments?: SalePaymentRow[]
  preview_lines?: SaleReturnPreviewLine[]
}

export async function fetchSalesSearchForReturn(q: string): Promise<{ results: SaleSearchForReturnRow[] }> {
  const r = await fetch(`${API}/api/sales/search/return/?q=${encodeURIComponent(q)}`, {
    credentials: 'include',
  })
  if (!r.ok) throw await parseErrorResponse(r, 'RETURN_SEARCH_FAILED')
  return r.json() as Promise<{ results: SaleSearchForReturnRow[] }>
}

export type SaleReturnEligibleLineRow = {
  variant_id: string
  barcode: string
  product_name_uz: string
  product_name_ru?: string
  category_name_uz?: string
  category_name_ru?: string
  sold_qty: number
  returned_qty: number
  remaining_qty: number
  list_unit_price?: string
  net_unit_price?: string
  line_discount?: string
  line_total_sold?: string
  stock_qty?: number
}

export type SaleReturnState = 'returnable' | 'fully_returned' | 'no_lines'

export type RefundMethod = 'CASH' | 'CARD' | 'DEBT'

export type SaleRefundRow = { method: RefundMethod; amount: string }

export async function fetchSaleReturnLines(saleId: string): Promise<{
  sale_id: string
  public_sale_no?: string
  completed_at?: string
  cashier_username?: string
  subtotal?: string
  discount_total?: string
  grand_total?: string
  payments?: SalePaymentRow[]
  refunds_already?: SaleRefundRow[]
  refund_capacity?: Partial<Record<RefundMethod, string>>
  return_state?: SaleReturnState
  total_remaining_qty?: number
  lines: SaleReturnEligibleLineRow[]
}> {
  const r = await fetch(`${API}/api/sales/${saleId}/return-lines/`, {
    credentials: 'include',
  })
  if (!r.ok) throw await parseErrorResponse(r, 'RETURN_LINES_FAILED')
  return r.json() as Promise<{
    sale_id: string
    public_sale_no?: string
    completed_at?: string
    cashier_username?: string
    subtotal?: string
    discount_total?: string
    grand_total?: string
    payments?: SalePaymentRow[]
    refunds_already?: SaleRefundRow[]
    refund_capacity?: Partial<Record<RefundMethod, string>>
    return_state?: SaleReturnState
    total_remaining_qty?: number
    lines: SaleReturnEligibleLineRow[]
  }>
}

export async function submitSaleReturn(
  saleId: string,
  payload: {
    lines: Array<{ variant_id: string; qty: number }>
    reason?: string
    auto_refund?: boolean
    skip_refund?: boolean
    refunds?: Array<{ method: RefundMethod; amount: string | number }>
  },
) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/sales/${saleId}/return/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(payload),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'RETURN_FAILED', j.detail)
  return j as {
    sale_id: string
    status: string
    lines: Array<{ variant_id: string; qty: number }>
    return_amount?: string
    refunds?: SaleRefundRow[]
  }
}

export async function voidSale(saleId: string, reason: string) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/sales/${saleId}/void/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify({ reason }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'VOID_FAILED', j.detail)
  return j
}

export type StoreSettings = {
  brand_name: string
  phone: string
  address: string
  footer_note: string
  transliterate_uz: boolean
  /** 'uz' | 'ru' | 'auto' (backend maps missing/invalid to 'uz' or 'ru'). */
  receipt_lang?: string
  receipt_printer_name: string
  receipt_printer_type: 'ESC_POS' | 'TSPL'
  receipt_printer_port?: string
  label_printer_name: string
  label_printer_type: 'ESC_POS' | 'TSPL'
  label_printer_port?: string
  receipt_width: '58mm' | '80mm'
  auto_print_on_sale: boolean
  scanner_mode: 'keyboard' | 'serial'
  scanner_prefix: string
  scanner_suffix: string
  lock_timeout_minutes?: number
  logo_url?: string | null
  low_stock_threshold?: number
  show_price_on_labels_default?: boolean
  show_selling_price_in_catalog?: boolean
}

export type HardwareConfig = Pick<
  StoreSettings,
  | 'receipt_printer_name'
  | 'receipt_printer_type'
  | 'receipt_printer_port'
  | 'label_printer_name'
  | 'label_printer_type'
  | 'label_printer_port'
  | 'receipt_width'
  | 'auto_print_on_sale'
  | 'scanner_mode'
  | 'scanner_prefix'
  | 'scanner_suffix'
  | 'lock_timeout_minutes'
>

export type IntegrationSettings = {
  telegram_bot_token: string
  telegram_chat_id: string
  whatsapp_provider: 'GREEN_API' | 'CUSTOM'
  whatsapp_api_base: string
  whatsapp_api_token: string
  whatsapp_sender: string
  greenapi_instance_id: string
  greenapi_api_token_instance: string
  primary_report_channel?: 'telegram' | 'whatsapp' | 'both'
  updated_at?: string
}

export async function fetchStoreSettings(): Promise<StoreSettings> {
  const r = await fetch(`${API}/api/printing/settings/`, { credentials: 'include' })
  if (!r.ok) throw new Error('FETCH_SETTINGS_FAILED')
  return r.json()
}

export async function updateStoreSettings(data: {
  brand_name: string
  phone: string
  address: string
  footer_note: string
  transliterate_uz: boolean
  receipt_printer_name: string
  receipt_printer_type: 'ESC_POS' | 'TSPL'
  receipt_printer_port?: string
  label_printer_name: string
  label_printer_type: 'ESC_POS' | 'TSPL'
  label_printer_port?: string
  receipt_width: '58mm' | '80mm'
  auto_print_on_sale: boolean
  receipt_lang?: string
  scanner_mode: 'keyboard' | 'serial'
  scanner_prefix: string
  scanner_suffix: string
  lock_timeout_minutes?: number
  low_stock_threshold?: number
  show_price_on_labels_default?: boolean
  show_selling_price_in_catalog?: boolean
  logo?: File | null
}) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const fd = new FormData()
  fd.append('brand_name', data.brand_name)
  fd.append('phone', data.phone)
  fd.append('address', data.address)
  fd.append('footer_note', data.footer_note)
  fd.append('transliterate_uz', data.transliterate_uz ? 'true' : 'false')
  fd.append('receipt_printer_name', data.receipt_printer_name)
  fd.append('receipt_printer_type', data.receipt_printer_type)
  fd.append('receipt_printer_port', data.receipt_printer_port || '')
  fd.append('label_printer_name', data.label_printer_name)
  fd.append('label_printer_type', data.label_printer_type)
  fd.append('label_printer_port', data.label_printer_port || '')
  fd.append('receipt_width', data.receipt_width)
  fd.append('auto_print_on_sale', data.auto_print_on_sale ? 'true' : 'false')
  fd.append('receipt_lang', data.receipt_lang || '')
  fd.append('scanner_mode', data.scanner_mode)
  fd.append('scanner_prefix', data.scanner_prefix)
  fd.append('scanner_suffix', data.scanner_suffix)
  fd.append('lock_timeout_minutes', String(Math.max(1, Number(data.lock_timeout_minutes || 5))))
  fd.append('low_stock_threshold', String(Math.max(1, Number(data.low_stock_threshold || 3))))
  fd.append('show_price_on_labels_default', data.show_price_on_labels_default ? 'true' : 'false')
  fd.append('show_selling_price_in_catalog', data.show_selling_price_in_catalog ? 'true' : 'false')
  if (data.logo) fd.append('logo', data.logo)
  const r = await fetch(`${API}/api/printing/settings/`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'X-CSRFToken': csrf },
    body: fd,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.detail || 'UPDATE_SETTINGS_FAILED')
  return j as StoreSettings
}

export async function fetchHardwareConfig(): Promise<HardwareConfig> {
  const r = await fetch(`${API}/api/printing/hardware-config/`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_HARDWARE_CONFIG_FAILED')
  return r.json()
}

export async function patchHardwareConfig(data: Partial<HardwareConfig>): Promise<HardwareConfig> {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/printing/hardware-config/`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw await parseErrorResponse(r, 'PATCH_HARDWARE_CONFIG_FAILED')
  return r.json() as Promise<HardwareConfig>
}

export async function fetchCashierXReport(params?: { from?: string; to?: string }): Promise<CashierXReport> {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  const qs = q.toString() ? `?${q.toString()}` : ''
  const r = await fetch(`${API}/api/reports/cashier-x/${qs}`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_CASHIER_X_REPORT_FAILED')
  return r.json() as Promise<CashierXReport>
}

export async function testReceiptPrintPayload() {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/printing/test-receipt/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRFToken': csrf },
  })
  if (!r.ok) throw await parseErrorResponse(r, 'TEST_RECEIPT_FAILED')
  return r.json() as Promise<{
    raw_base64: string
    escpos_base64: string
    printer_name: string
    printer_type: 'ESC_POS' | 'TSPL'
  }>
}

/** Sticker / label stock size (mm). TSPL uses SIZE w,h; ESC/POS uses column width + barcode scale. */
export type LabelStickerSize = '40x30' | '40x50' | '50x40' | '58mm'

export async function testLabelPrintPayload() {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/printing/test-label/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRFToken': csrf },
  })
  if (!r.ok) throw await parseErrorResponse(r, 'TEST_LABEL_FAILED')
  return r.json() as Promise<{
    raw_base64: string
    escpos_base64: string
    printer_name: string
    printer_type: 'ESC_POS' | 'TSPL'
    size: LabelStickerSize
  }>
}

export type StocktakeSession = {
  id: string
  status: 'OPEN' | 'APPLIED'
  note: string
  lines: Array<{
    id: string
    variant: string
    product_name_uz: string
    product_name_ru?: string
    product_name_uz_cyrillic?: string | null
    product_custom_name_uz?: string | null
    product_custom_name_ru?: string | null
    product_custom_name_uz_cyrillic?: string | null
    category_name_uz?: string
    category_name_ru?: string
    barcode: string
    color?: string | null
    expected_qty: number
    counted_qty: number | null
    variance_qty: number
  }>
}

export async function createStocktakeSession(note = ''): Promise<StocktakeSession> {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/inventory/stocktake/sessions/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify({ note }),
  })
  if (!r.ok) throw new Error('CREATE_STOCKTAKE_FAILED')
  return r.json()
}

export async function fetchStocktakeSession(id: string): Promise<StocktakeSession> {
  const r = await fetch(`${API}/api/inventory/stocktake/sessions/${id}/`, {
    credentials: 'include',
  })
  if (!r.ok) throw new Error('FETCH_STOCKTAKE_FAILED')
  return r.json()
}

export async function setStocktakeCount(
  sessionId: string,
  variantId: string,
  countedQty: number,
) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/inventory/stocktake/sessions/${sessionId}/count/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify({ variant_id: variantId, counted_qty: countedQty }),
  })
  if (!r.ok) throw new Error('SET_STOCKTAKE_COUNT_FAILED')
  return r.json()
}

export async function applyStocktake(sessionId: string) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/inventory/stocktake/sessions/${sessionId}/apply/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRFToken': csrf },
  })
  if (!r.ok) throw new Error('APPLY_STOCKTAKE_FAILED')
  return r.json()
}

export async function listStocktakeSessions(status?: 'OPEN' | 'APPLIED') {
  const q = status ? `?status=${status}` : ''
  const r = await fetch(`${API}/api/inventory/stocktake/sessions/list/${q}`, {
    credentials: 'include',
  })
  if (!r.ok) throw new Error('LIST_STOCKTAKE_FAILED')
  return r.json() as Promise<
    Array<{ id: string; status: 'OPEN' | 'APPLIED'; note: string; created_at: string }>
  >
}

export async function backupNow() {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/backup-now/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRFToken': csrf },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'BACKUP_FAILED', j.detail)
  return j as { ok: boolean; backup_path: string }
}

export async function runAutoBackup(opts?: { force?: boolean }) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const qs = opts?.force ? '?force=1' : ''
  const r = await fetch(`${API}/api/integrations/backup/auto-run/${qs}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRFToken': csrf },
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'BACKUP_UPLOAD_FAILED', j.detail)
  return j as {
    status: 'disabled' | 'skipped' | 'uploaded' | 'updated'
    reason?: string
    next_at?: string
    file_name?: string
    size_bytes?: number
    uploaded_at?: string
    hardware_id?: string
    forced?: boolean
  }
}

export async function fetchIntegrationSettings(): Promise<IntegrationSettings> {
  const r = await fetch(`${API}/api/integrations/settings/`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_INTEGRATIONS_FAILED')
  return r.json()
}

export async function updateIntegrationSettings(data: IntegrationSettings) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/integrations/settings/`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(data),
  })
  if (!r.ok) throw await parseErrorResponse(r, 'UPDATE_INTEGRATIONS_FAILED')
  return (await r.json()) as IntegrationSettings
}

export type SendZReportResponse = {
  ok: boolean
  details?: string
  lang?: 'uz' | 'ru' | string
  channel_results?: Partial<
    Record<'telegram' | 'whatsapp', { ok: boolean; details?: string }>
  >
}

export async function sendZReport() {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const headers = { 'X-CSRFToken': csrf, 'Accept-Language': getUiLanguageHeader() }
  const r = await fetch(`${API}/api/integrations/z-report/send/`, {
    method: 'POST',
    credentials: 'include',
    headers,
  })
  if (!r.ok) {
    // Transitional fallback for older backend deployments.
    const legacy = await fetch(`${API}/api/integrations/telegram/send-z-report/`, {
      method: 'POST',
      credentials: 'include',
      headers,
    })
    if (!legacy.ok) throw await parseErrorResponse(legacy, 'ZREPORT_SEND_FAILED')
    return legacy.json() as Promise<SendZReportResponse>
  }
  return r.json() as Promise<SendZReportResponse>
}

export async function sendWhatsAppReminder(customerId: string, amount: string) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/integrations/whatsapp/remind/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify({ customer_id: customerId, amount }),
  })
  if (!r.ok) throw await parseErrorResponse(r, 'WHATSAPP_SEND_FAILED')
  return r.json() as Promise<{ ok: boolean; details?: string }>
}

export async function receiveInventory(variantId: string, qty: number, note: string) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/inventory/receive/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify({ variant_id: variantId, qty, note }),
  })
  if (!r.ok) throw await parseErrorResponse(r, 'INVENTORY_RECEIVE_FAILED')
  return r.json() as Promise<{ variant_id: string; stock_qty: number }>
}

export type StockEvent = {
  movement_id: string
  variant_id: string
  qty_delta: number
  type: 'SALE' | 'RETURN' | 'ADJUST' | 'IN'
  stock_qty: number
  created_at: string
}

export async function fetchStockEvents(since?: string) {
  const q = since ? `?since=${encodeURIComponent(since)}` : ''
  const r = await fetch(`${API}/api/inventory/stock-events/${q}`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_STOCK_EVENTS_FAILED')
  const j = (await r.json()) as { events?: StockEvent[] }
  return Array.isArray(j.events) ? j.events : []
}

export async function adjustInventory(variantId: string, qtyDelta: number, note: string) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/inventory/adjust/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify({ variant_id: variantId, qty_delta: qtyDelta, note }),
  })
  if (!r.ok) throw await parseErrorResponse(r, 'INVENTORY_ADJUST_FAILED')
  return r.json() as Promise<{ variant_id: string; stock_qty: number }>
}

export async function fetchLabelEscpos(variantId: string, size: LabelStickerSize = '40x50', copies = 1, showPrice?: boolean) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const body: any = { variant_id: variantId, size, copies }
  if (showPrice !== undefined) {
    body.show_price = showPrice
  }
  const r = await fetch(`${API}/api/printing/labels/escpos/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw await parseErrorResponse(r, 'LABEL_PRINT_FAILED')
  return (await r.json()) as { raw_base64: string; escpos_base64: string }
}

export async function fetchLabelQueueEscpos(
  items: Array<{ variant_id: string; copies: number }>,
  size: LabelStickerSize = '40x50',
  showPrice?: boolean,
) {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const body: any = { size, items }
  if (showPrice !== undefined) {
    body.show_price = showPrice
  }
  const r = await fetch(`${API}/api/printing/labels/queue/escpos/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw await parseErrorResponse(r, 'LABEL_QUEUE_FAILED')
  return (await r.json()) as {
    size: LabelStickerSize
    items: Array<{ variant_id: string; barcode: string | null; raw_base64: string; escpos_base64: string }>
  }
}

// Supplier management API functions
export type Supplier = {
  id: string
  name_uz: string
  name_ru: string
  contact_person: string
  phone: string
  email: string
  address: string
  created_at: string
}

export type SupplierBalance = {
  supplier_id: string
  supplier_name_uz: string
  supplier_name_ru?: string
  total_debt: string | number
  total_paid: string | number
  balance: string | number
}

export type SupplierTransaction = {
  id: string
  supplier: string
  supplier_id: string
  supplier_name_uz: string
  supplier_name_ru: string
  type: 'PURCHASE' | 'PAYMENT' | 'RETURN' | 'CREDIT_MEMO'
  amount: string | number
  description_uz: string
  description_ru: string
  note: string
  recorded_by: string | null
  recorded_by_username: string | null
  created_at: string
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const r = await fetch(`${API}/api/catalog/suppliers/`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_SUPPLIERS_FAILED')
  const j = (await r.json()) as { results?: Supplier[] }
  return Array.isArray(j.results) ? j.results : []
}

export async function createSupplier(body: {
  name_uz: string
  name_ru: string
  contact_person: string
  phone: string
  email: string
  address: string
}): Promise<Supplier> {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/catalog/suppliers/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'CREATE_SUPPLIER_FAILED', j.detail)
  return j as Supplier
}

export async function updateSupplier(
  supplierId: string,
  body: {
    name_uz: string
    name_ru: string
    contact_person: string
    phone: string
    email: string
    address: string
  },
): Promise<Supplier> {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/catalog/suppliers/${supplierId}/`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'UPDATE_SUPPLIER_FAILED', j.detail)
  return j as Supplier
}

export async function deleteSupplier(supplierId: string): Promise<void> {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const r = await fetch(`${API}/api/catalog/suppliers/${supplierId}/`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRFToken': csrf },
  })
  if (!r.ok) throw await parseErrorResponse(r, 'DELETE_SUPPLIER_FAILED')
}

export async function fetchSupplierBalance(supplierId: string): Promise<SupplierBalance> {
  const r = await fetch(`${API}/api/catalog/suppliers/${supplierId}/balance/`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_SUPPLIER_BALANCE_FAILED')
  return (await r.json()) as SupplierBalance
}

export async function fetchSupplierTransactions(supplierId: string): Promise<SupplierTransaction[]> {
  const r = await fetch(`${API}/api/catalog/suppliers/${supplierId}/transactions/`, { credentials: 'include' })
  if (!r.ok) throw await parseErrorResponse(r, 'FETCH_SUPPLIER_TRANSACTIONS_FAILED')
  const j = (await r.json()) as { results?: SupplierTransaction[] }
  return Array.isArray(j.results) ? j.results : []
}

export async function recordSupplierPayment(
  supplierId: string,
  amount: number,
  note: string,
  txType?: 'PAYMENT' | 'PURCHASE',
): Promise<SupplierTransaction> {
  const csrf = (await fetchCsrf()) || getCookie('csrftoken') || ''
  const type =
    txType ?? (amount < 0 ? 'PAYMENT' : 'PURCHASE')
  const absoluteAmount = Math.abs(amount)

  const r = await fetch(`${API}/api/catalog/suppliers/${supplierId}/transactions/`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
    body: JSON.stringify({ type, amount: absoluteAmount, note }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new AppError(j.code || 'TRANSACTION_FAILED', j.detail)
  return j as SupplierTransaction
}
