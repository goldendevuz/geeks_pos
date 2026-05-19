import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type DashboardPeriodPreset = 'month' | 'today' | 'yesterday' | 'week' | 'year' | 'custom'

function localYmd(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + delta)
  return localYmd(dt)
}

function weekStartYmd(today = localYmd()): string {
  const [y, m, d] = today.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = dt.getDay()
  const mondayOffset = dow === 0 ? -6 : 1 - dow
  dt.setDate(dt.getDate() + mondayOffset)
  return localYmd(dt)
}

function monthStartYmd(today = localYmd()): string {
  const [y, m] = today.split('-')
  return `${y}-${m}-01`
}

export function detectDashboardPreset(filter: {
  from?: string
  to?: string
  year?: string
}): DashboardPeriodPreset {
  if (filter.year) return 'year'
  const today = localYmd()
  const from = filter.from
  const to = filter.to
  if (!from && !to) return 'month'
  if (from === today && to === today) return 'today'
  const yesterday = addDays(today, -1)
  if (from === yesterday && to === yesterday) return 'yesterday'
  if (from === weekStartYmd(today) && to === today) return 'week'
  if (from === monthStartYmd(today) && to === today) return 'month'
  return 'custom'
}

export function DashboardPeriodFilter({
  filter,
  onFilter,
}: {
  filter: { from?: string; to?: string; year?: string }
  onFilter: (from?: string, to?: string, year?: string) => void
}) {
  const { t } = useTranslation()
  const preset = useMemo(() => detectDashboardPreset(filter), [filter])
  const [customOpen, setCustomOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(filter.from || '')
  const [draftTo, setDraftTo] = useState(filter.to || '')
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (preset === 'custom') {
      setDraftFrom(filter.from || '')
      setDraftTo(filter.to || '')
    }
  }, [filter.from, filter.to, preset])

  useEffect(() => {
    if (!customOpen) return
    function onDoc(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setCustomOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [customOpen])

  function applyPreset(next: DashboardPeriodPreset) {
    const today = localYmd()
    if (next === 'month') {
      onFilter(undefined, undefined, undefined)
      setCustomOpen(false)
      return
    }
    if (next === 'today') {
      onFilter(today, today, undefined)
      setCustomOpen(false)
      return
    }
    if (next === 'yesterday') {
      const y = addDays(today, -1)
      onFilter(y, y, undefined)
      setCustomOpen(false)
      return
    }
    if (next === 'week') {
      onFilter(weekStartYmd(today), today, undefined)
      setCustomOpen(false)
      return
    }
    if (next === 'year') {
      onFilter(undefined, undefined, String(new Date().getFullYear()))
      setCustomOpen(false)
      return
    }
    setCustomOpen(true)
  }

  return (
    <div className="relative flex items-center gap-2 shrink-0" ref={popRef}>
      <label className="sr-only" htmlFor="dashboard-period-preset">
        {t('admin.dashboard.periodFilter')}
      </label>
      <select
        id="dashboard-period-preset"
        className="touch-btn min-h-10 max-w-[11rem] rounded-xl bg-slate-800 border border-slate-600 text-sm px-3 py-2 text-slate-100"
        value={preset}
        onChange={(e) => {
          const v = e.target.value as DashboardPeriodPreset
          if (v === 'custom') {
            setCustomOpen(true)
            setDraftFrom(filter.from || monthStartYmd())
            setDraftTo(filter.to || localYmd())
          } else {
            applyPreset(v)
          }
        }}
      >
        <option value="month">{t('admin.dashboard.periodMonth')}</option>
        <option value="today">{t('admin.dashboard.periodToday')}</option>
        <option value="yesterday">{t('admin.dashboard.periodYesterday')}</option>
        <option value="week">{t('admin.dashboard.periodWeek')}</option>
        <option value="year">{t('admin.dashboard.periodYear')}</option>
        <option value="custom">{t('admin.dashboard.periodCustom')}</option>
      </select>
      {customOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-slate-600 bg-slate-900 p-3 shadow-xl space-y-2">
          <label className="block text-xs text-slate-400">
            {t('admin.common.from')}
            <input
              type="date"
              className="touch-btn mt-1 w-full min-h-10 rounded-lg bg-slate-950 border border-slate-700 px-2 text-sm"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
            />
          </label>
          <label className="block text-xs text-slate-400">
            {t('admin.common.to')}
            <input
              type="date"
              className="touch-btn mt-1 w-full min-h-10 rounded-lg bg-slate-950 border border-slate-700 px-2 text-sm"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="touch-btn w-full min-h-10 rounded-xl bg-emerald-700/80 border border-emerald-600 text-sm font-medium"
            onClick={() => {
              onFilter(draftFrom || undefined, draftTo || undefined, undefined)
              setCustomOpen(false)
            }}
          >
            {t('admin.common.apply')}
          </button>
        </div>
      )}
    </div>
  )
}
