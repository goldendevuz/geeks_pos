import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExpenseCategory, ShopExpenseRow } from '../api'
import { createShopExpense, fetchShopExpenses } from '../api'
import { formatMoney } from '../utils/money'
import { ActionToast } from '../components/ActionToast'
import { requestAdminDataRefresh } from '../utils/adminDataRefresh'

const CATEGORY_OPTIONS: ExpenseCategory[] = ['RENT', 'UTILITIES', 'SUPPLIES', 'SALARY', 'OTHER']

export function ExpensesPage() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ShopExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('OTHER')
  const [note, setNote] = useState('')
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="p-2 whitespace-nowrap">{new Date(r.recorded_at).toLocaleString()}</td>
                  <td className="p-2 text-right tabular-nums">{formatMoney(r.amount)}</td>
                  <td className="p-2">{t(`admin.expenses.cat.${r.category}`)}</td>
                  <td className="p-2 max-w-[12rem] truncate">{r.note || '—'}</td>
                  <td className="p-2 text-slate-400">{r.cashier_username ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
