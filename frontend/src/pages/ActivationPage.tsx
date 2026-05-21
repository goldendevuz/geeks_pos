import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { activateLicense, type LicenseStatus, type UserRole } from '../api'
import { getTauriMachineId } from '../utils/tauriMachineId'

const SUPPORT_PHONE = '+998 (93) 911-31-23'

export function ActivationPage({
  role,
  initial,
  onActivated,
  onLogout,
}: {
  role: UserRole
  initial: LicenseStatus
  onActivated: () => void
  onLogout: () => void
}) {
  const { t } = useTranslation()
  const [licenseKey, setLicenseKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canActivate = role === 'OWNER' || role === 'ADMIN'

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      const hw = await getTauriMachineId()
      if (!hw) {
        setError(t('license.hardwareUnavailable'))
        setBusy(false)
        return
      }
      await activateLicense(hw, licenseKey.trim())
      onActivated()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950 p-6 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900/90 p-8 shadow-xl">
        <h1 className="text-xl font-semibold text-white">{t('license.title')}</h1>
        <p className="mt-3 text-sm text-slate-400">{t('license.body')}</p>
        <p className="mt-4 text-sm font-medium text-amber-200/90">
          {t('license.contact')}: <span className="select-all">{SUPPORT_PHONE}</span>
        </p>
        {initial.expires_at && (
          <p className="mt-2 text-xs text-slate-500">
            {t('license.expiresLabel')}: {initial.expires_at}
          </p>
        )}
        {initial.last_check_message && (
          <p className="mt-1 text-xs text-slate-500">{initial.last_check_message}</p>
        )}

        {canActivate ? (
          <div className="mt-6 space-y-4">
            <label className="block text-sm text-slate-300">{t('license.keyLabel')}</label>
            <input
              type="text"
              autoComplete="off"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
              placeholder={t('license.keyPlaceholder')}
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="button"
              disabled={busy || !licenseKey.trim()}
              onClick={() => void submit()}
              className="w-full rounded-lg bg-sky-600 py-2.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? t('admin.common.loading') : t('license.activate')}
            </button>
          </div>
        ) : (
          <p className="mt-6 text-sm text-slate-400">{t('license.cashierHint')}</p>
        )}

        <button
          type="button"
          onClick={onLogout}
          className="mt-8 w-full rounded-lg border border-slate-600 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          {t('header.logout')}
        </button>
      </div>
    </div>
  )
}
