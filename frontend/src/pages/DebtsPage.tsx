import { useMemo, useState } from 'react'
import Decimal from 'decimal.js'
import { List, type RowComponentProps } from 'react-window'
import type { DebtRow } from '../api'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '../utils/money'
import { ActionToast } from '../components/ActionToast'

export function DebtsPage({
  debts,
  onRepay,
  onSendReminder,
  onUpdateCustomer,
}: {
  debts: DebtRow[]
  onRepay: (customerId: string, amount: string) => Promise<void>
  onSendReminder: (customerId: string, amount: string) => Promise<void>
  onUpdateCustomer: (customerId: string, name: string, phone: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [amountByCustomer, setAmountByCustomer] = useState<Record<string, string>>({})
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [busyCustomerId, setBusyCustomerId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null)
  const groupedRows = useMemo(() => {
    const grouped = new Map<string, { row: DebtRow; total: Decimal; count: number }>()
    for (const d of debts) {
      const existing = grouped.get(d.customer)
      if (!existing) {
        grouped.set(d.customer, {
          row: d,
          total: new Decimal(d.remaining_amount || '0'),
          count: 1,
        })
      } else {
        existing.total = existing.total.plus(d.remaining_amount || '0')
        existing.count += 1
      }
    }
    return Array.from(grouped.entries()).map(([customerId, item]) => ({
      customerId,
      row: item.row,
      total: item.total,
      count: item.count,
    }))
  }, [debts])
  const useVirtualRows = groupedRows.length > 12

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-semibold">{t('admin.debts.title')}</h2>
      {toast && <ActionToast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}
      <p className="text-xs text-slate-400">{t('admin.debts.hint')}</p>
      <div className="rounded border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="text-left p-2">{t('admin.debts.customer')}</th>
              <th className="text-left p-2">{t('admin.debts.phone')}</th>
              <th className="text-left p-2">{t('admin.debts.createdAt')}</th>
              <th className="text-left p-2">{t('admin.debts.dueDate')}</th>
              <th className="text-right p-2">{t('admin.debts.openCount')}</th>
              <th className="text-right p-2">{t('admin.debts.totalRemaining')}</th>
              <th className="text-right p-2">{t('admin.debts.repay')}</th>
              <th className="text-right p-2">{t('admin.debts.reminder')}</th>
            </tr>
          </thead>
          {!useVirtualRows && (
          <tbody>
            {groupedRows.map(({ customerId, total, row, count }) => {
              return (
                <tr key={customerId} className="border-t border-slate-800">
                  <td className="p-2">
                    {editingCustomerId === customerId ? (
                      <input
                        className="touch-btn min-h-12 w-full px-3 rounded-xl bg-slate-950 border border-slate-700 text-sm"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder={t('admin.debts.customer')}
                      />
                    ) : (
                      row.customer_name
                    )}
                  </td>
                  <td className="p-2">
                    {editingCustomerId === customerId ? (
                      <input
                        className="touch-btn min-h-12 w-full px-3 rounded-xl bg-slate-950 border border-slate-700 text-sm"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, ''))}
                        placeholder="998901112233"
                      />
                    ) : (
                      row.customer_phone
                    )}
                  </td>
                  <td className="p-2">{new Date(row.created_at).toLocaleDateString()}</td>
                  <td className="p-2">
                    {row.due_date ? (
                      <span className={new Date(row.due_date) < new Date() ? 'text-amber-300' : ''}>
                        {new Date(row.due_date).toLocaleDateString()}
                        {new Date(row.due_date) < new Date() ? ` (${t('admin.debts.overdue')})` : ''}
                      </span>
                    ) : (
                      <span className="text-slate-500">{t('admin.debts.noDueDate')}</span>
                    )}
                  </td>
                  <td className="p-2 text-right">{count}</td>
                  <td className="p-2 text-right">{formatMoney(total.toFixed(0))}</td>
                  <td className="p-2 text-right">
                    <div className="inline-flex gap-2">
                      <input
                        className="touch-btn min-h-12 px-3 rounded-xl bg-slate-950 border border-slate-700 w-28 text-sm"
                        placeholder={t('admin.debts.amountPlaceholder')}
                        value={amountByCustomer[customerId] ?? ''}
                        onChange={(e) =>
                          setAmountByCustomer((p) => ({ ...p, [customerId]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        disabled={busyCustomerId === customerId}
                        className="touch-btn min-h-12 px-4 rounded-xl bg-emerald-700 border border-emerald-500 text-sm font-medium"
                        onClick={async () => {
                          setBusyCustomerId(customerId)
                          try {
                            await onRepay(customerId, amountByCustomer[customerId] || '0')
                            setToast({ kind: 'ok', message: t('admin.debts.repaySuccess') })
                          } catch (e: unknown) {
                            const code = (e as Error & { code?: string }).code
                            setToast({ kind: 'err', message: t(`err.${code || 'DEBT_PAYMENT_FAILED'}`) })
                          } finally {
                            setBusyCustomerId(null)
                          }
                        }}
                      >
                        {t('admin.debts.repay')}
                      </button>
                    </div>
                  </td>
                  <td className="p-2 text-right">
                    <div className="inline-flex gap-2">
                      {editingCustomerId === customerId ? (
                        <>
                          <button
                            type="button"
                            disabled={busyCustomerId === customerId || !editName.trim() || !editPhone.trim()}
                            className="touch-btn min-h-12 px-4 rounded-xl bg-emerald-700 border border-emerald-500 text-sm font-medium disabled:opacity-50"
                            onClick={async () => {
                              if (!/^\d{9,15}$/.test(editPhone.trim())) {
                                setToast({
                                  kind: 'err',
                                  message: t('admin.debts.phoneFormat'),
                                })
                                return
                              }
                              setBusyCustomerId(customerId)
                              try {
                                await onUpdateCustomer(customerId, editName.trim(), editPhone.trim())
                                setToast({ kind: 'ok', message: t('admin.common.save') })
                                setEditingCustomerId(null)
                              } catch (e: unknown) {
                                const code = (e as Error & { code?: string }).code
                                setToast({ kind: 'err', message: t(`err.${code || 'VALIDATION_ERROR'}`) })
                              } finally {
                                setBusyCustomerId(null)
                              }
                            }}
                          >
                            {t('admin.common.save')}
                          </button>
                          <button
                            type="button"
                            disabled={busyCustomerId === customerId}
                            className="touch-btn min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-600 text-sm"
                            onClick={() => setEditingCustomerId(null)}
                          >
                            {t('admin.common.cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busyCustomerId === customerId}
                            className="touch-btn min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-600 text-sm hidden"
                            onClick={async () => {
                              setBusyCustomerId(customerId)
                              try {
                                await onSendReminder(customerId, total.toFixed(0))
                                setToast({ kind: 'ok', message: t('admin.debts.reminderSuccess') })
                              } catch (e: unknown) {
                                const code = (e as Error & { code?: string }).code
                                setToast({ kind: 'err', message: t(`err.${code || 'WHATSAPP_SEND_FAILED'}`) })
                              } finally {
                                setBusyCustomerId(null)
                              }
                            }}
                          >
                            {t('admin.debts.reminder')}
                          </button>
                          <button
                            type="button"
                            disabled={busyCustomerId === customerId}
                            className="touch-btn min-h-12 px-4 rounded-xl bg-indigo-700 border border-indigo-500 text-sm"
                            onClick={() => {
                              setEditingCustomerId(customerId)
                              setEditName(row.customer_name)
                              setEditPhone(row.customer_phone)
                            }}
                          >
                            {t('admin.catalog.edit')}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {groupedRows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-slate-500">
                  {t('admin.debts.empty')}
                </td>
              </tr>
            )}
          </tbody>
          )}
        </table>
        {useVirtualRows && (
          <List
            defaultHeight={Math.min(600, Math.max(240, groupedRows.length * 76))}
            rowCount={groupedRows.length}
            rowHeight={76}
            style={{ height: Math.min(600, Math.max(240, groupedRows.length * 76)), width: '100%' }}
            rowComponent={({ index, style, rows }: RowComponentProps<{ rows: typeof groupedRows }>) => {
              const { customerId, row, count, total } = rows[index]
              return (
                <div style={style} className="grid grid-cols-[1.2fr_1fr_0.9fr_0.9fr_0.5fr_0.8fr_1.4fr_0.9fr] items-center border-b border-slate-800 px-2 text-sm">
                  <div>{row.customer_name}</div>
                  <div>{row.customer_phone}</div>
                  <div>{new Date(row.created_at).toLocaleDateString()}</div>
                  <div>{row.due_date ? new Date(row.due_date).toLocaleDateString() : t('admin.debts.noDueDate')}</div>
                  <div className="text-right">{count}</div>
                  <div className="text-right">{formatMoney(total.toFixed(0))}</div>
                  <div className="inline-flex gap-2 justify-end">
                    <input
                      className="touch-btn min-h-10 px-3 rounded-xl bg-slate-950 border border-slate-700 w-28 text-sm"
                      placeholder={t('admin.debts.amountPlaceholder')}
                      value={amountByCustomer[customerId] ?? ''}
                      onChange={(e) =>
                        setAmountByCustomer((p) => ({ ...p, [customerId]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      disabled={busyCustomerId === customerId}
                      className="touch-btn min-h-10 px-4 rounded-xl bg-emerald-700 border border-emerald-500 text-sm font-medium"
                      onClick={async () => {
                        setBusyCustomerId(customerId)
                        try {
                          await onRepay(customerId, amountByCustomer[customerId] || '0')
                          setToast({ kind: 'ok', message: t('admin.debts.repaySuccess') })
                        } catch (e: unknown) {
                          const code = (e as Error & { code?: string }).code
                          setToast({ kind: 'err', message: t(`err.${code || 'DEBT_PAYMENT_FAILED'}`) })
                        } finally {
                          setBusyCustomerId(null)
                        }
                      }}
                    >
                      {t('admin.debts.repay')}
                    </button>
                  </div>
                  <div className="text-right">
                    <button
                      type="button"
                      disabled={busyCustomerId === customerId}
                      className="touch-btn min-h-10 px-4 rounded-xl bg-indigo-700 border border-indigo-500 text-sm"
                      onClick={() => {
                        setEditingCustomerId(customerId)
                        setEditName(row.customer_name)
                        setEditPhone(row.customer_phone)
                      }}
                    >
                      {t('admin.catalog.edit')}
                    </button>
                  </div>
                </div>
              )
            }}
            rowProps={{ rows: groupedRows }}
            className="border-t border-slate-800"
          />
        )}
      </div>
    </div>
  )
}
