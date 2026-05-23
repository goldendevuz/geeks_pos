import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExpenseCategory, ShopExpenseRow } from '../api'
import { createShopExpense, deleteShopExpense, fetchShopExpenses, updateShopExpense } from '../api'
import { formatMoney } from '../utils/money'
import { ActionToast } from '../components/ActionToast'
import { requestAdminDataRefresh } from '../utils/adminDataRefresh'

const CATEGORY_OPTIONS: ExpenseCategory[] = ['RENT', 'UTILITIES', 'SUPPLIES', 'SALARY', 'OTHER']

type EditDraft = { amount: string; category: ExpenseCategory; note: string }

export function ExpensesPage({ isManager = false }: { isManager?: boolean }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ShopExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('OTHER')
  const [note, setNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const data = await fetchShopExpenses({ from: from || undefined, to: to || undefined })
      setRows(data)
    } catch {
      setToast({ kind: 'err', msg: t('admin.expenses.loadFail') })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [from, to])

  function startEdit(row: ShopExpenseRow) {
    setEditingId(row.id)
    setEditDraft({
      amount: String(Math.round(parseFloat(row.amount) || 0)),
      category: row.category,
      note: row.note || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft(null)
  }

  return (
    <div className="p-4 space-y-6 max-w-4xl">
      <h2 className="text-xl font-semibold">{t('admin.expenses.title')}</h2>
      {toast && <ActionToast kind={toast.kind === 'ok' ? 'ok' : 'err'} message={toast.msg} onClose={() => setToast(null)} />}
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
        <div className="text-sm font-medium text-slate-200">{t('admin.expenses.add')}</div>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-slate-400 flex flex-col gap-1">
            {t('admin.expenses.amount')}
            <input
              type="number"
              min={1}
              className="touch-btn min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-600"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="text-xs text-slate-400 flex flex-col gap-1">
            {t('admin.expenses.category')}
            <select
              className="touch-btn min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-600"
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {t(`admin.expenses.cat.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400 flex flex-col gap-1 flex-1 min-w-[12rem]">
            {t('admin.expenses.note')}
            <input
              className="touch-btn min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-600 w-full"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!amount.trim() || Number(amount) <= 0}
            className="touch-btn min-h-12 px-6 rounded-xl bg-emerald-700 border border-emerald-500 disabled:opacity-40"
            onClick={async () => {
              try {
                await createShopExpense({
                  amount: Number(amount).toFixed(0),
                  category,
                  note: note.trim(),
                })
                setAmount('')
                setNote('')
                setToast({ kind: 'ok', msg: t('admin.expenses.saved') })
                void load()
                requestAdminDataRefresh('shop-expense')
              } catch {
                setToast({ kind: 'err', msg: t('admin.expenses.saveFail') })
              }
            }}
          >
            {t('admin.expenses.save')}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input type="date" className="touch-btn min-h-12 px-3 rounded-xl bg-slate-900 border border-slate-700" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="touch-btn min-h-12 px-3 rounded-xl bg-slate-900 border border-slate-700" value={to} onChange={(e) => setTo(e.target.value)} />
        <button type="button" className="touch-btn min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-600" onClick={() => void load()}>
          {t('admin.expenses.reload')}
        </button>
      </div>
      {loading ? (
        <p className="text-slate-400">{t('admin.common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">{t('admin.expenses.empty')}</p>
      ) : (
        <div className="rounded-xl border border-slate-800 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="text-left p-2">{t('admin.expenses.when')}</th>
                <th className="text-left p-2">{t('admin.expenses.amount')}</th>
                <th className="text-left p-2">{t('admin.expenses.category')}</th>
                <th className="text-left p-2">{t('admin.expenses.note')}</th>
                <th className="text-left p-2">{t('admin.expenses.cashier')}</th>
                {isManager && <th className="text-right p-2">{t('admin.common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const editing = editingId === r.id && editDraft
                return (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td className="p-2 whitespace-nowrap">{new Date(r.recorded_at).toLocaleString()}</td>
                    {editing ? (
                      <>
                        <td className="p-2">
                          <input
                            type="number"
                            min={1}
                            className="touch-btn min-h-10 w-28 px-2 rounded-lg bg-slate-950 border border-slate-600"
                            value={editDraft.amount}
                            onChange={(e) => setEditDraft({ ...editDraft, amount: e.target.value })}
                          />
                        </td>
                        <td className="p-2">
                          <select
                            className="touch-btn min-h-10 px-2 rounded-lg bg-slate-950 border border-slate-600"
                            value={editDraft.category}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, category: e.target.value as ExpenseCategory })
                            }
                          >
                            {CATEGORY_OPTIONS.map((c) => (
                              <option key={c} value={c}>
                                {t(`admin.expenses.cat.${c}`)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            className="touch-btn min-h-10 w-full min-w-[8rem] px-2 rounded-lg bg-slate-950 border border-slate-600"
                            value={editDraft.note}
                            onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })}
                          />
                        </td>
                        <td className="p-2 text-slate-400">{r.cashier_username ?? '—'}</td>
                        {isManager && (
                          <td className="p-2 text-right whitespace-nowrap space-x-2">
                            <button
                              type="button"
                              disabled={busyId === r.id || !editDraft.amount.trim() || Number(editDraft.amount) <= 0}
                              className="touch-btn px-3 py-2 rounded-lg bg-emerald-800 border border-emerald-600 text-xs disabled:opacity-40"
                              onClick={async () => {
                                setBusyId(r.id)
                                try {
                                  await updateShopExpense(r.id, {
                                    amount: Number(editDraft.amount).toFixed(0),
                                    category: editDraft.category,
                                    note: editDraft.note.trim(),
                                  })
                                  cancelEdit()
                                  setToast({ kind: 'ok', msg: t('admin.expenses.updated') })
                                  void load()
                                  requestAdminDataRefresh('shop-expense')
                                } catch {
                                  setToast({ kind: 'err', msg: t('admin.expenses.updateFail') })
                                } finally {
                                  setBusyId(null)
                                }
                              }}
                            >
                              {t('admin.common.save')}
                            </button>
                            <button
                              type="button"
                              className="touch-btn px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-xs"
                              onClick={cancelEdit}
                            >
                              {t('admin.common.cancel')}
                            </button>
                          </td>
                        )}
                      </>
                    ) : (
                      <>
                        <td className="p-2 text-right tabular-nums">{formatMoney(r.amount)}</td>
                        <td className="p-2">{t(`admin.expenses.cat.${r.category}`)}</td>
                        <td className="p-2 max-w-[12rem] truncate">{r.note || '—'}</td>
                        <td className="p-2 text-slate-400">{r.cashier_username ?? '—'}</td>
                        {isManager && (
                          <td className="p-2 text-right whitespace-nowrap space-x-2">
                            <button
                              type="button"
                              className="touch-btn px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-xs"
                              onClick={() => startEdit(r)}
                            >
                              {t('admin.common.edit')}
                            </button>
                            <button
                              type="button"
                              disabled={busyId === r.id}
                              className="touch-btn px-3 py-2 rounded-lg bg-red-900/80 border border-red-700 text-xs disabled:opacity-40"
                              onClick={async () => {
                                if (!window.confirm(t('admin.expenses.deleteConfirm'))) return
                                setBusyId(r.id)
                                try {
                                  await deleteShopExpense(r.id)
                                  if (editingId === r.id) cancelEdit()
                                  setToast({ kind: 'ok', msg: t('admin.expenses.deleted') })
                                  void load()
                                  requestAdminDataRefresh('shop-expense')
                                } catch {
                                  setToast({ kind: 'err', msg: t('admin.expenses.deleteFail') })
                                } finally {
                                  setBusyId(null)
                                }
                              }}
                            >
                              {t('admin.common.delete')}
                            </button>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
