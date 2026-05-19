import { LayoutDashboard, LogOut, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DashboardPeriodFilter } from './DashboardPeriodFilter'

export function AdminTopNavbar({
  section,
  onLogout,
  dashboardFilter,
  onDashboardFilter,
}: {
  section: 'dashboard' | 'settings'
  onLogout: () => void
  dashboardFilter?: { from?: string; to?: string; year?: string }
  onDashboardFilter?: (from?: string, to?: string, year?: string) => void
}) {
  const { t } = useTranslation()
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900">
      <div className="flex items-center gap-3 min-w-0">
        <img src="/resized-logo.png" alt="logo" className="h-9 w-9 rounded-lg bg-white p-1 object-contain" />
        <div className="min-w-0">
          <div className="font-semibold truncate">{t('app.title')}</div>
          <div className="text-xs text-slate-400 inline-flex items-center gap-1">
            {section === 'dashboard' ? <LayoutDashboard className="h-3.5 w-3.5" /> : <Settings className="h-3.5 w-3.5" />}
            {section === 'dashboard' ? t('admin.dashboard.title') : t('admin.settings.title')}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap justify-end">
        {section === 'dashboard' && onDashboardFilter && dashboardFilter && (
          <DashboardPeriodFilter filter={dashboardFilter} onFilter={onDashboardFilter} />
        )}
        <button
          type="button"
          className="touch-btn inline-flex items-center gap-2 text-sm px-4 py-2 rounded-xl bg-slate-800 border border-slate-600 text-slate-200"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" />
          {t('header.logout')}
        </button>
      </div>
    </header>
  )
}
