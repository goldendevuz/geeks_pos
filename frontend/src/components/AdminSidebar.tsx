import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Tags,
  Wallet,
  History,
  Settings,
  LogOut,
  PackageSearch,
  LineChart,
  Landmark,
  RotateCcw,
  Truck,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type Section =
  | 'dashboard'
  | 'pos'
  | 'catalog'
  | 'inventory'
  | 'debts'
  | 'sales'
  | 'settings'
  | 'stock'
  | 'shift'
  | 'expenses'
  | 'returns'
  | 'suppliers'

const ITEMS: Array<{ id: Section; labelKey: string; icon: LucideIcon }> = [
  { id: 'dashboard', labelKey: 'admin.sidebar.dashboard', icon: LayoutDashboard },
  { id: 'pos', labelKey: 'admin.sidebar.pos', icon: ShoppingCart },
  { id: 'shift', labelKey: 'admin.sidebar.shift', icon: LineChart },
  { id: 'expenses', labelKey: 'admin.sidebar.expenses', icon: Landmark },
  { id: 'stock', labelKey: 'admin.sidebar.stock', icon: PackageSearch },
  { id: 'inventory', labelKey: 'admin.sidebar.inventory', icon: Package },
  { id: 'catalog', labelKey: 'admin.sidebar.catalog', icon: Tags },
  { id: 'suppliers', labelKey: 'admin.sidebar.suppliers', icon: Truck },
  { id: 'debts', labelKey: 'admin.sidebar.debts', icon: Wallet },
  { id: 'returns', labelKey: 'admin.sidebar.returns', icon: RotateCcw },
  { id: 'sales', labelKey: 'admin.sidebar.sales', icon: History },
  { id: 'settings', labelKey: 'admin.sidebar.settings', icon: Settings },
]
const CASHIER_MENU: Section[] = ['pos', 'sales', 'returns', 'debts', 'expenses', 'shift', 'stock']

export function AdminSidebar({
  active,
  onSelect,
  role,
  onLogout,
}: {
  active: Section
  onSelect: (s: Section) => void
  role: 'CASHIER' | 'ADMIN' | 'OWNER'
  onLogout: () => void | Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const visibleItems =
    role === 'CASHIER'
      ? ITEMS.filter((item) => CASHIER_MENU.includes(item.id))
      : ITEMS

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-64 shrink-0 border-r border-slate-800 bg-slate-950 p-3 flex flex-col h-dvh overflow-hidden">
      <div className="text-xs uppercase tracking-wide text-slate-500 px-2 pb-2">{t('admin.sidebar.title')}</div>
      <nav className="space-y-2 flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y kiosk-scrollbar py-1 -my-1 pr-1">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`touch-btn w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm border ${
                isActive
                  ? 'bg-emerald-700 border-emerald-400 ring-2 ring-emerald-500/50 text-white'
                  : 'bg-slate-900 border-slate-700 text-slate-100 hover:bg-slate-800'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
              <span className="font-medium leading-tight">{t(item.labelKey)}</span>
            </button>
          )
        })}
      </nav>
      <div className="mt-auto pt-3 border-t border-slate-800 space-y-2 shrink-0">
        <div className="text-xs uppercase tracking-wide text-slate-500 px-2">{t('admin.sidebar.language')}</div>
        <div className="flex gap-1 px-0">
          <button
            type="button"
            className={`touch-btn flex-1 text-xs px-2 py-2 rounded-xl border ${
              i18n.language === 'uz'
                ? 'bg-emerald-700 border-emerald-500 text-white'
                : 'bg-slate-800 border-slate-600 text-slate-200'
            }`}
            onClick={() => i18n.changeLanguage('uz')}
          >
            {t('lang.uz')}
          </button>
          <button
            type="button"
            className={`touch-btn flex-1 text-xs px-2 py-2 rounded-xl border ${
              i18n.language === 'uz-cyrl'
                ? 'bg-emerald-700 border-emerald-500 text-white'
                : 'bg-slate-800 border-slate-600 text-slate-200'
            }`}
            onClick={() => i18n.changeLanguage('uz-cyrl')}
          >
            Ўз
          </button>
          <button
            type="button"
            className={`touch-btn flex-1 text-xs px-2 py-2 rounded-xl border ${
              i18n.language === 'ru'
                ? 'bg-emerald-700 border-emerald-500 text-white'
                : 'bg-slate-800 border-slate-600 text-slate-200'
            }`}
            onClick={() => i18n.changeLanguage('ru')}
          >
            {t('lang.ru')}
          </button>
        </div>
        <button
          type="button"
          className="touch-btn w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm border bg-slate-900 border-slate-700 text-slate-100 hover:bg-slate-800"
          onClick={() => void onLogout()}
        >
          <LogOut className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
          <span className="font-medium">{t('header.logout')}</span>
        </button>
      </div>
    </aside>
  )
}

