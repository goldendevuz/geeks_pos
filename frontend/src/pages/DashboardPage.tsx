import type { DashboardSummary } from '../api'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '../utils/money'
import { ActionToast } from '../components/ActionToast'
import {
  BadgeDollarSign,
  Ban,
  RotateCcw,
  CircleDollarSign,
  CreditCard,
  MessageCircle,
  Package,
  Send,
  ShoppingCart,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react'

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: ReactNode
  hint?: string
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded border border-slate-700 bg-slate-900 p-4">
      <div className="text-sm text-slate-400 inline-flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4" />}
        {label}
      </div>
      <div className="text-2xl mt-1 tabular-nums">{value}</div>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

export function DashboardPage({
  summary,
  licenseStatus,
  primaryChannel,
  onSendZReport,
}: {
  summary: DashboardSummary | null
  licenseStatus?: { valid?: boolean; expires_at?: string | null; last_check_message?: string } | null
  filter?: { from?: string; to?: string; year?: string }
  primaryChannel: 'telegram' | 'whatsapp' | 'both'
  onFilter?: (from?: string, to?: string, year?: string) => void
  onSendZReport: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const totals = summary?.totals
  const ReportIcon = primaryChannel === 'whatsapp' ? MessageCircle : Send
  const periodLabel =
    summary?.range?.year
      ? t('admin.dashboard.periodRangeYear', { year: summary.range.year })
      : summary?.range?.from && summary?.range?.to
        ? t('admin.dashboard.periodRange', { from: summary.range.from, to: summary.range.to })
        : t('admin.dashboard.periodMonth')

  return (
    <div className="p-4 space-y-6">
      {toast && <ActionToast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}

      <section className="space-y-3">
        <h3 className="text-lg font-medium">{t('admin.dashboard.periodSectionTitle', { period: periodLabel })}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            icon={CircleDollarSign}
            label={t('admin.dashboard.periodSalesAmount')}
            value={formatMoney(totals?.sales_amount)}
          />
          <KpiCard
            icon={TrendingUp}
            label={t('admin.dashboard.periodNetProfit')}
            value={formatMoney(totals?.operating_profit ?? totals?.net_profit)}
          />
          <KpiCard
            icon={TrendingUp}
            label={t('admin.dashboard.grossProfit')}
            value={formatMoney(totals?.gross_profit)}
          />
          <KpiCard
            icon={TrendingDown}
            label={t('admin.dashboard.periodExpenses')}
            value={formatMoney(totals?.expense_total)}
          />
          <KpiCard
            icon={ShoppingCart}
            label={t('admin.dashboard.periodSalesCount')}
            value={totals?.sales_count ?? 0}
          />
          <KpiCard
            icon={CircleDollarSign}
            label={t('admin.dashboard.netSalesApprox')}
            value={formatMoney(totals?.net_sales_approx)}
          />
          <KpiCard
            icon={TrendingDown}
            label={t('admin.dashboard.totalDiscounts')}
            value={formatMoney(totals?.total_discounts)}
          />
          <KpiCard icon={CircleDollarSign} label={t('admin.dashboard.avgCheck')} value={formatMoney(totals?.avg_check)} />
          <KpiCard icon={Ban} label={t('admin.dashboard.periodVoidCount')} value={totals?.void_count ?? 0} />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-medium">{t('admin.dashboard.todayReportTitle')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/40 p-4">
            <div className="text-sm text-emerald-200/80 inline-flex items-center gap-2">
              <CircleDollarSign className="h-4 w-4" />
              {t('admin.dashboard.todaySalesHero')}
            </div>
            <div className="text-3xl mt-2 font-semibold tabular-nums">{formatMoney(totals?.today_sales_amount)}</div>
            <p className="text-xs text-slate-500 mt-1">
              {t('admin.dashboard.todayTxCount')}: {totals?.today_sales_count ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-4">
            <div className="text-sm text-amber-200/80 inline-flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              {t('admin.dashboard.todayExpenseHero')}
            </div>
            <div className="text-3xl mt-2 font-semibold tabular-nums">{formatMoney(totals?.today_expense_total)}</div>
          </div>
          <div className="rounded-xl border border-sky-800/60 bg-sky-950/30 p-4">
            <div className="text-sm text-sky-200/80 inline-flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              {t('admin.dashboard.todayNetProfitHero')}
            </div>
            <div className="text-3xl mt-2 font-semibold tabular-nums">{formatMoney(totals?.today_operating_profit)}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard
            icon={BadgeDollarSign}
            label={t('admin.dashboard.todayCash')}
            value={formatMoney(totals?.today_cash_total)}
            hint={t('admin.dashboard.todayCashHint')}
          />
          <KpiCard icon={CreditCard} label={t('admin.dashboard.todayCard')} value={formatMoney(totals?.today_card_total)} />
          <KpiCard icon={WalletCards} label={t('admin.dashboard.todayDebt')} value={formatMoney(totals?.today_debt_total)} />
          <KpiCard
            icon={ShoppingCart}
            label={t('admin.dashboard.todayItemsSoldQty')}
            value={totals?.today_items_sold_qty ?? 0}
          />
          <KpiCard
            icon={RotateCcw}
            label={t('admin.dashboard.todayReturns')}
            value={
              <>
                {totals?.today_return_move_count ?? 0}
                <span className="text-sm text-slate-500 font-normal ml-1">
                  / {totals?.today_return_qty ?? 0} {t('admin.dashboard.todayReturnUnits')}
                </span>
              </>
            }
          />
          <KpiCard icon={Ban} label={t('admin.dashboard.todayVoidCount')} value={totals?.today_void_count ?? 0} />
        </div>
        <p className="text-xs text-slate-500">{t('admin.dashboard.debtCashFootnote')}</p>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-medium">{t('admin.dashboard.snapshotSectionTitle')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <KpiCard
            icon={WalletCards}
            label={t('admin.dashboard.openDebts')}
            value={
              <>
                {totals?.open_debt_count ?? 0}
                <span className="text-base font-normal text-slate-400 ml-2">
                  ({formatMoney(totals?.open_debt_total)})
                </span>
              </>
            }
            hint={t('admin.dashboard.snapshotHint')}
          />
          <KpiCard icon={Package} label={t('admin.dashboard.inventoryItems')} value={totals?.inventory_items ?? 0} />
          <KpiCard
            icon={Package}
            label={t('admin.dashboard.inventoryPurchaseValue')}
            value={formatMoney(totals?.inventory_purchase_value)}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded border border-slate-700 bg-slate-900 p-3">
          <h3 className="font-medium mb-1">{t('admin.dashboard.topProducts')}</h3>
          <p className="text-xs text-slate-500 mb-2">{periodLabel}</p>
          <ul className="text-sm space-y-1">
            {(summary?.top_products ?? []).map((p) => (
              <li key={p.name} className="flex justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="tabular-nums shrink-0">
                  {p.qty}
                  {p.sales_amount != null && (
                    <span className="text-slate-500 ml-1">· {formatMoney(p.sales_amount)}</span>
                  )}
                </span>
              </li>
            ))}
            {(summary?.top_products ?? []).length === 0 && (
              <li className="py-4 text-center text-slate-400">{t('admin.sales.empty')}</li>
            )}
          </ul>
        </div>
        <div className="rounded border border-slate-700 bg-slate-900 p-3">
          <h3 className="font-medium mb-1">{t('admin.dashboard.lowProducts')}</h3>
          <p className="text-xs text-slate-500 mb-2">{periodLabel}</p>
          <ul className="text-sm space-y-1">
            {(summary?.low_products ?? []).map((p) => (
              <li key={p.name} className="flex justify-between">
                <span>{p.name}</span>
                <span>{p.qty}</span>
              </li>
            ))}
            {(summary?.low_products ?? []).length === 0 && (
              <li className="py-4 text-center text-slate-400">{t('admin.sales.empty')}</li>
            )}
          </ul>
        </div>
      </section>

      <div className="rounded border border-slate-700 bg-slate-900 p-3">
        <h3 className="font-medium mb-2">{t('admin.dashboard.topCashiers')}</h3>
        <table className="w-full text-sm">
          <thead className="text-slate-400">
            <tr>
              <th className="text-left p-2">{t('admin.sales.cashier')}</th>
              <th className="text-right p-2">{t('admin.dashboard.periodSalesCount')}</th>
              <th className="text-right p-2">{t('admin.sales.total')}</th>
            </tr>
          </thead>
          <tbody>
            {(summary?.top_cashiers ?? []).map((row) => (
              <tr key={row.cashier} className="border-t border-slate-800">
                <td className="p-2">{row.cashier}</td>
                <td className="p-2 text-right">{row.sales_count}</td>
                <td className="p-2 text-right tabular-nums">{formatMoney(row.sales_amount)}</td>
              </tr>
            ))}
            {(summary?.top_cashiers ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="p-4 text-center text-slate-500">
                  {t('admin.sales.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard
          icon={ShieldCheck}
          label={t('license.title', { defaultValue: 'License' })}
          value={
            <span className={licenseStatus?.valid === false ? 'text-red-300 text-lg' : 'text-emerald-300 text-lg'}>
              {licenseStatus?.valid === false ? t('status.BLOCKED') : t('status.ACTIVE')}
            </span>
          }
          hint={
            licenseStatus?.expires_at
              ? `${t('license.expiresLabel', { defaultValue: 'Expires' })}: ${licenseStatus.expires_at}`
              : undefined
          }
        />
        <div className="rounded border border-slate-700 bg-slate-900 p-4 md:col-span-2">
          <div className="text-sm text-slate-400 mb-2">{t('admin.dashboard.quickActions')}</div>
          <button
            type="button"
            disabled={busy}
            className="touch-btn min-h-12 px-5 py-3 rounded-xl bg-slate-800 border border-slate-600 disabled:opacity-40 text-sm font-medium"
            onClick={async () => {
              setBusy(true)
              try {
                const out = (await onSendZReport()) as {
                  ok?: boolean
                  channel_results?: Partial<Record<'telegram' | 'whatsapp', { ok: boolean }>>
                }
                const tg = out.channel_results?.telegram?.ok
                const wa = out.channel_results?.whatsapp?.ok
                const bothOk = tg && wa
                const msg = bothOk
                  ? t('admin.bots.zReportSentBoth')
                  : tg
                    ? t('admin.bots.zReportSentTelegram')
                    : wa
                      ? t('admin.bots.zReportSentWhatsapp')
                      : t('admin.bots.zReportSent')
                setToast({ kind: 'ok', message: msg })
              } catch (e: unknown) {
                const code = (e as Error & { code?: string }).code
                setToast({ kind: 'err', message: t(`err.${code || 'ZREPORT_SEND_FAILED'}`) })
              } finally {
                setBusy(false)
              }
            }}
          >
            <ReportIcon className="h-4 w-4 inline mr-2" />
            {t('admin.bots.sendZReport')}
          </button>
        </div>
      </div>
    </div>
  )
}
