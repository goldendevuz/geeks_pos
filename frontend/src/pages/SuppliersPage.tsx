import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Edit, Trash2, Building2, DollarSign, ChevronLeft, Search } from 'lucide-react'
import { formatMoney } from '../utils/money'
import { ConfirmModal } from '../components/ConfirmModal'
import { ActionToast } from '../components/ActionToast'
import {
  fetchSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  fetchSupplierBalance,
  fetchSupplierTransactions,
  recordSupplierPayment,
  type Supplier,
  type SupplierBalance,
  type SupplierTransaction,
} from '../api'

export type SupplierWithDebt = Supplier & {
  opening_balance?: string | number
}

export function SuppliersPage() {
  const { t, i18n } = useTranslation()
  const langRu = i18n.language.toLowerCase().startsWith('ru')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [balances, setBalances] = useState<Record<string, SupplierBalance>>({})
  const [transactions, setTransactions] = useState<Record<string, SupplierTransaction[]>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [paymentModal, setPaymentModal] = useState<{ supplier_id: string; supplier_name: string } | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [paymentType, setPaymentType] = useState<'payment' | 'debt'>('payment')
  const [paymentBusy, setPaymentBusy] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; message: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [form, setForm] = useState({
    name_uz: '',
    name_ru: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    opening_balance: ''
  })

  useEffect(() => {
    loadSuppliers()
  }, [])

  const loadSuppliers = async () => {
    try {
      setLoading(true)
      const supplierList = await fetchSuppliers()
      setSuppliers(supplierList)
      
      // Load balances and transactions for each supplier
      for (const supplier of supplierList) {
        try {
          await loadSupplierBalance(supplier.id)
          await loadSupplierTransactions(supplier.id)
        } catch (error) {
          console.error(`Failed to load data for supplier ${supplier.id}:`, error)
        }
      }
    } catch (error) {
      console.error('Failed to load suppliers:', error)
      const msg = error instanceof Error ? error.message : 'Failed to load suppliers'
      setToast({ kind: 'err', message: msg })
    } finally {
      setLoading(false)
    }
  }

  const loadSupplierBalance = async (supplierId: string) => {
    try {
      const data = await fetchSupplierBalance(supplierId)
      setBalances(prev => ({ ...prev, [supplierId]: data }))
    } catch (error) {
      console.error(`Failed to load balance for supplier ${supplierId}:`, error)
    }
  }

  const loadSupplierTransactions = async (supplierId: string) => {
    try {
      const txList = await fetchSupplierTransactions(supplierId)
      setTransactions(prev => ({ ...prev, [supplierId]: txList }))
    } catch (error) {
      console.error(`Failed to load transactions for supplier ${supplierId}:`, error)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    try {
      const supplierData = {
        name_uz: form.name_uz,
        name_ru: form.name_ru,
        contact_person: form.contact_person,
        phone: form.phone,
        email: form.email,
        address: form.address
      }
      
      let supplierId: string
      if (editingId) {
        await updateSupplier(editingId, supplierData)
        supplierId = editingId
      } else {
        const newSupplier = await createSupplier(supplierData)
        supplierId = newSupplier.id
      }

      // Record opening balance if provided (only for new suppliers)
      // Positive amount = PURCHASE (debt owed TO the supplier)
      const openingBalance = parseFloat(form.opening_balance || '0')
      if (!editingId && openingBalance > 0) {
        // Record as PURCHASE with a clear note
        await recordSupplierPayment(supplierId, openingBalance, `Boshlang'ich qarz / Opening debt: ${openingBalance}`)
      }

      await loadSuppliers()
      setShowForm(false)
      setEditingId(null)
      setForm({ name_uz: '', name_ru: '', contact_person: '', phone: '', email: '', address: '', opening_balance: '' })
      setToast({ kind: 'ok', message: t('admin.common.saved', 'Saved') })
    } catch (error) {
      console.error('Failed to save supplier:', error)
      const msg = error instanceof Error ? error.message : 'Failed to save supplier'
      setToast({ kind: 'err', message: msg })
    }
  }

  const handleEdit = (supplier: Supplier) => {
    setForm({
      name_uz: supplier.name_uz,
      name_ru: supplier.name_ru,
      contact_person: supplier.contact_person,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address,
      opening_balance: ''
    })
    setEditingId(supplier.id)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    setDeleteConfirm(id)
  }

  const confirmDelete = async (id: string) => {
    setDeleteBusy(true)
    try {
      await deleteSupplier(id)
      await loadSuppliers()
      setDeleteConfirm(null)
      setToast({ kind: 'ok', message: t('admin.suppliers.deleted', 'Supplier deleted') })
    } catch (error) {
      console.error('Failed to delete supplier:', error)
      setToast({ kind: 'err', message: t('admin.common.error', 'Error') })
    } finally {
      setDeleteBusy(false)
    }
  }

  const handleRecordPayment = async () => {
    if (!paymentModal) return
    const amount = parseFloat(paymentAmount || '0')
    if (amount <= 0) {
      setToast({ kind: 'err', message: t('admin.suppliers.invalidAmount', 'Please enter a valid amount') })
      return
    }

    setPaymentBusy(true)
    try {
      // For payment: negative amount (reduces debt)
      // For debt: positive amount (increases debt)
      const actualAmount = paymentType === 'payment' ? -amount : amount
      await recordSupplierPayment(paymentModal.supplier_id, actualAmount, paymentNote || `${paymentType === 'payment' ? 'Payment' : 'Debt'} recorded`)
      setPaymentAmount('')
      setPaymentNote('')
      setPaymentType('payment')
      setPaymentModal(null)
      // Reload the balance and transactions after successful operation
      await loadSupplierBalance(paymentModal.supplier_id)
      await loadSupplierTransactions(paymentModal.supplier_id)
      setToast({ kind: 'ok', message: t('admin.suppliers.transactionRecorded', 'Transaction recorded') })
    } catch (error) {
      console.error('Failed to record transaction:', error)
      const msg = error instanceof Error ? error.message : 'Error recording transaction'
      setToast({ kind: 'err', message: msg })
    } finally {
      setPaymentBusy(false)
    }
  }

  const filteredSuppliers = suppliers.filter(s => {
    const name = langRu ? s.name_ru : s.name_uz
    return name.toLowerCase().includes(searchQuery.toLowerCase())
  })

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="text-center py-12">
          <div className="text-slate-400">{t('admin.common.loading')}</div>
        </div>
      </div>
    )
  }

  if (selectedSupplier) {
    const balance = balances[selectedSupplier.id]
    const txList = transactions[selectedSupplier.id] || []
    const supplierName = langRu ? selectedSupplier.name_ru : selectedSupplier.name_uz

    return (
      <div className="p-4 sm:p-6 space-y-4">
        <button
          onClick={() => setSelectedSupplier(null)}
          className="touch-btn inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-300 hover:bg-slate-700"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('admin.common.back')}
        </button>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-100 mb-4">{supplierName}</h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-400 mb-1">{t('admin.suppliers.contactPerson')}</div>
              <div className="text-slate-100 font-medium">{selectedSupplier.contact_person || '—'}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-400 mb-1">{t('admin.suppliers.phone')}</div>
              <div className="text-slate-100 font-medium">{selectedSupplier.phone || '—'}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-400 mb-1">{t('admin.suppliers.email')}</div>
              <div className="text-slate-100 font-medium text-sm break-all">{selectedSupplier.email || '—'}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-400 mb-1">{t('admin.suppliers.address')}</div>
              <div className="text-slate-100 font-medium text-sm">{selectedSupplier.address || '—'}</div>
            </div>
          </div>

          {balance && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-amber-950/30 border border-amber-700/50 rounded-lg p-4">
                <div className="text-xs text-amber-400 mb-1">{t('admin.suppliers.totalDebt')}</div>
                <div className="text-lg sm:text-xl font-bold text-amber-200">{formatMoney(String(balance.total_debt))}</div>
              </div>
              <div className="bg-emerald-950/30 border border-emerald-700/50 rounded-lg p-4">
                <div className="text-xs text-emerald-400 mb-1">{t('admin.suppliers.totalPaid')}</div>
                <div className="text-lg sm:text-xl font-bold text-emerald-200">{formatMoney(String(balance.total_paid))}</div>
              </div>
              <div className={`${Number(balance.balance) > 0 ? 'bg-red-950/30 border-red-700/50' : 'bg-slate-800 border-slate-700'} border rounded-lg p-4`}>
                <div className={`text-xs mb-1 ${Number(balance.balance) > 0 ? 'text-red-400' : 'text-slate-400'}`}>{t('admin.suppliers.balance')}</div>
                <div className={`text-lg sm:text-xl font-bold ${Number(balance.balance) > 0 ? 'text-red-200' : 'text-slate-200'}`}>
                  {Number(balance.balance) > 0 ? '+' : ''}{formatMoney(String(balance.balance))}
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => setPaymentModal({ supplier_id: selectedSupplier.id, supplier_name: supplierName })}
            className="touch-btn w-full min-h-12 px-4 rounded-xl bg-emerald-700 border border-emerald-500 text-white font-medium flex items-center justify-center gap-2"
          >
            <DollarSign className="h-5 w-5" />
            {t('admin.suppliers.recordPayment')}
          </button>
        </div>

        {txList.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">{t('admin.suppliers.transactions')}</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {txList.map((tx) => (
                <div key={tx.id} className="bg-slate-800 rounded-lg p-3 flex justify-between items-start">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-100">
                      {tx.type === 'PAYMENT' ? t('admin.suppliers.payment') : t('admin.suppliers.purchase')}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {new Date(tx.created_at).toLocaleDateString()} {new Date(tx.created_at).toLocaleTimeString()}
                    </div>
                    {tx.note && <div className="text-xs text-slate-500 mt-1">{tx.note}</div>}
                  </div>
                  <div className={`text-sm font-bold ml-2 ${tx.type === 'PAYMENT' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {tx.type === 'PAYMENT' ? '-' : '+'}{formatMoney(String(tx.amount))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{t('admin.sidebar.suppliers')}</h1>
          <p className="text-sm text-slate-400 mt-1">{t('admin.suppliers.hint', 'Manage your suppliers and track payments')}</p>
        </div>
        <button
          onClick={() => {
            setShowForm(true)
            setEditingId(null)
            setForm({ name_uz: '', name_ru: '', contact_person: '', phone: '', email: '', address: '', opening_balance: '' })
          }}
          className="touch-btn min-h-12 px-4 rounded-xl bg-emerald-700 border border-emerald-500 text-white font-medium flex items-center justify-center gap-2"
        >
          <Plus className="h-5 w-5" />
          {t('admin.suppliers.add')}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4">
            {editingId ? t('admin.suppliers.edit') : t('admin.suppliers.add')}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('admin.suppliers.nameUz')}</label>
                <input
                  type="text"
                  placeholder={t('admin.suppliers.namePlaceholder', 'Uzbek name')}
                  value={form.name_uz}
                  onChange={(e) => setForm({ ...form, name_uz: e.target.value })}
                  className="touch-btn w-full min-h-10 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('admin.suppliers.nameRu')}</label>
                <input
                  type="text"
                  placeholder={t('admin.suppliers.namePlaceholder', 'Russian name')}
                  value={form.name_ru}
                  onChange={(e) => setForm({ ...form, name_ru: e.target.value })}
                  className="touch-btn w-full min-h-10 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('admin.suppliers.contactPerson')}</label>
                <input
                  type="text"
                  placeholder={t('admin.suppliers.contactPersonPlaceholder', 'Contact person')}
                  value={form.contact_person}
                  onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                  className="touch-btn w-full min-h-10 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('admin.suppliers.phone')}</label>
                <input
                  type="tel"
                  placeholder={t('admin.suppliers.phonePlaceholder', '+998...')}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="touch-btn w-full min-h-10 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-slate-400 block mb-1">{t('admin.suppliers.email')}</label>
                <input
                  type="email"
                  placeholder={t('admin.suppliers.emailPlaceholder', 'email@example.com')}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="touch-btn w-full min-h-10 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('admin.suppliers.address')}</label>
              <textarea
                placeholder={t('admin.suppliers.addressPlaceholder', 'Address')}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="touch-btn w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
                rows={3}
              />
            </div>
            {!editingId && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('admin.suppliers.openingDebt', 'Opening Debt (Old Debt)')}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={t('admin.suppliers.openingDebtPlaceholder', 'Enter if supplier has existing debt')}
                  value={form.opening_balance}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                      setForm({ ...form, opening_balance: val })
                    }
                  }}
                  className="touch-btn w-full min-h-10 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
                />
                <div className="text-xs text-slate-500 mt-1">{t('admin.suppliers.openingDebtHint', 'This will be recorded as initial debt from the supplier')}</div>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="touch-btn flex-1 min-h-12 px-4 rounded-xl bg-emerald-700 border border-emerald-500 text-white font-medium"
              >
                {t('admin.common.save')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setEditingId(null)
                  setForm({ name_uz: '', name_ru: '', contact_person: '', phone: '', email: '', address: '', opening_balance: '' })
                }}
                className="touch-btn flex-1 min-h-12 px-4 rounded-xl bg-slate-700 border border-slate-600 text-slate-300 font-medium"
              >
                {t('admin.common.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-4">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder={t('admin.common.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="touch-btn flex-1 min-h-10 px-3 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm"
          />
        </div>
      </div>

      {filteredSuppliers.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <Building2 className="h-12 w-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400">{t('admin.suppliers.empty')}</p>
          <p className="text-sm text-slate-500 mt-1">{t('admin.suppliers.emptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSuppliers.map((supplier) => {
            const balance = balances[supplier.id]
            const supplierName = langRu ? supplier.name_ru : supplier.name_uz
            return (
              <button
                key={supplier.id}
                onClick={() => setSelectedSupplier(supplier)}
                className="touch-btn text-left bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-slate-700 hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-100 text-sm sm:text-base">{supplierName}</h3>
                    <p className="text-xs text-slate-400 mt-1">{supplier.contact_person || '—'}</p>
                  </div>
                  <Building2 className="h-5 w-5 text-slate-600 shrink-0 ml-2" />
                </div>
                
                {balance && (
                  <div className="space-y-2 pt-3 border-t border-slate-800">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">{t('admin.suppliers.balance')}</span>
                      <span className={Number(balance.balance) > 0 ? 'text-red-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                        {Number(balance.balance) > 0 ? '+' : ''}{formatMoney(String(balance.balance))}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">{t('admin.suppliers.totalPaid')}</span>
                      <span className="text-slate-300">{formatMoney(String(balance.total_paid))}</span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-4 pt-3 border-t border-slate-800">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEdit(supplier)
                    }}
                    className="touch-btn flex-1 min-h-9 px-2 rounded-lg bg-blue-900/30 border border-blue-700/50 text-blue-400 text-xs font-medium hover:bg-blue-900/50"
                  >
                    <Edit className="h-3.5 w-3.5 mx-auto" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setPaymentModal({ supplier_id: supplier.id, supplier_name: supplierName })
                    }}
                    className="touch-btn flex-1 min-h-9 px-2 rounded-lg bg-emerald-900/30 border border-emerald-700/50 text-emerald-400 text-xs font-medium hover:bg-emerald-900/50"
                  >
                    <DollarSign className="h-3.5 w-3.5 mx-auto" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(supplier.id)
                    }}
                    className="touch-btn flex-1 min-h-9 px-2 rounded-lg bg-red-900/30 border border-red-700/50 text-red-400 text-xs font-medium hover:bg-red-900/50"
                  >
                    <Trash2 className="h-3.5 w-3.5 mx-auto" />
                  </button>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Payment Modal */}
      {paymentModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 max-w-sm w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-400" />
              {t('admin.suppliers.recordPayment')}
            </h2>
            
            <div className="mb-6 p-4 bg-slate-800 rounded-lg border border-slate-700">
              <div className="text-xs text-slate-400 mb-1">{t('admin.suppliers.supplier')}</div>
              <div className="text-slate-100 font-medium">{paymentModal.supplier_name}</div>
              {balances[paymentModal.supplier_id] && (
                <div className="mt-3 pt-3 border-t border-slate-700">
                  <div className="text-xs text-slate-400 mb-1">{t('admin.suppliers.currentDebt')}</div>
                  <div className={`text-sm font-semibold ${Number(balances[paymentModal.supplier_id].balance) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {Number(balances[paymentModal.supplier_id].balance) > 0 ? '+' : ''}{formatMoney(String(balances[paymentModal.supplier_id].balance || 0))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('admin.suppliers.paymentType', 'Transaction Type')}</label>
                <select
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value as 'payment' | 'debt')}
                  className="touch-btn w-full min-h-10 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
                >
                  <option value="payment">{t('admin.suppliers.payment', 'Payment to supplier')}</option>
                  <option value="debt">{t('admin.suppliers.addDebt', 'Record new debt/purchase')}</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('admin.suppliers.amount', 'Amount')}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="500000"
                  value={paymentAmount}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                      setPaymentAmount(val)
                    }
                  }}
                  className="touch-btn w-full min-h-12 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-lg"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('admin.common.note')}</label>
                <textarea
                  placeholder={t('admin.inventory.noteOptional', 'Optional note...')}
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  className="touch-btn w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
                  rows={3}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleRecordPayment}
                  disabled={!paymentAmount || paymentBusy}
                  className="touch-btn flex-1 min-h-12 px-4 rounded-xl bg-emerald-700 border border-emerald-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {paymentBusy ? t('admin.common.loading') : t('admin.common.save')}
                </button>
                <button
                  onClick={() => {
                    setPaymentModal(null)
                    setPaymentAmount('')
                    setPaymentNote('')
                    setPaymentType('payment')
                  }}
                  className="touch-btn flex-1 min-h-12 px-4 rounded-xl bg-slate-700 border border-slate-600 text-slate-300 font-medium"
                >
                  {t('admin.common.cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <ConfirmModal
          title={t('admin.suppliers.deleteSupplier', 'Delete Supplier')}
          message={t('admin.suppliers.deleteSupplierConfirm', 'Are you sure you want to delete this supplier?')}
          cancelText={t('admin.common.cancel')}
          confirmText={t('admin.common.delete')}
          isDangerous
          isLoading={deleteBusy}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => confirmDelete(deleteConfirm)}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <ActionToast
          kind={toast.kind}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}
