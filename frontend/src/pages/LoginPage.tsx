import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchLicenseStatus, fetchPinUsers, loginWithPin, type LicenseStatus } from '../api'
import { getTauriMachineId } from '../utils/tauriMachineId'
import { PinNumpadPanel } from '../components/PinNumpadPanel'
import { loadLocale } from '../i18n'

export function LoginPage({ onDone }: { onDone: () => void | Promise<void> }) {
  const { t, i18n } = useTranslation()
  const [users, setUsers] = useState<Array<{ username: string; display_name: string; role: string; pin_enabled: boolean }>>([])
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submitInFlightRef = useRef(false)
  const [licenseInfo, setLicenseInfo] = useState<LicenseStatus | null>(null)
  const [hardwareId, setHardwareId] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const rows = await fetchPinUsers()
        setUsers(rows)
        setU(rows[0]?.username || '')
      } catch {
        setUsers([])
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        setLicenseInfo(await fetchLicenseStatus())
      } catch {
        setLicenseInfo(null)
      }
      setHardwareId(await getTauriMachineId())
    })()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitInFlightRef.current) return
    submitInFlightRef.current = true
    setErr(null)
    setBusy(true)
    try {
      await loginWithPin(u, p)
      await onDone()
    } catch (ex: unknown) {
      const code = (ex as Error & { code?: string }).code
      setErr(t(`err.${code || 'INVALID_CREDENTIALS'}`, { defaultValue: t('msg.errorGeneric') }))
    } finally {
      setBusy(false)
      submitInFlightRef.current = false
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 lg:p-6 flex items-center justify-center">
      <div className="w-full max-w-6xl grid gap-4 lg:grid-cols-[1.05fr_1fr]">
        <section className="rounded-xl border border-slate-700 bg-slate-800/70 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <img src="/resized-logo.png" alt="logo" className="h-14 w-14 rounded-xl bg-white p-1 object-contain" />
            <h1 className="text-2xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-emerald-600">
              {t('app.title')}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`touch-btn text-sm px-4 py-2 rounded-xl border ${
                i18n.language === 'uz'
                  ? 'bg-emerald-700 border-emerald-500 text-white'
                  : 'bg-slate-700 border-slate-600 text-slate-200'
              }`}
              onClick={() => void loadLocale('uz')}
            >
              {t('lang.uz')}
            </button>
            <button
              type="button"
              className={`touch-btn text-sm px-4 py-2 rounded-xl border ${
                i18n.language === 'uz-cyrl'
                  ? 'bg-emerald-700 border-emerald-500 text-white'
                  : 'bg-slate-700 border-slate-600 text-slate-200'
              }`}
              onClick={() => void loadLocale('uz-cyrl')}
            >
              {t('lang.uz-cyrl')}
            </button>
            <button
              type="button"
              className={`touch-btn text-sm px-4 py-2 rounded-xl border ${
                i18n.language.startsWith('ru')
                  ? 'bg-emerald-700 border-emerald-500 text-white'
                  : 'bg-slate-700 border-slate-600 text-slate-200'
              }`}
              onClick={() => void loadLocale('ru')}
            >
              {t('lang.ru')}
            </button>
          </div>

          {licenseInfo && licenseInfo.enforcement && (licenseInfo.requires_activation ?? true) && (
            <div className="rounded-xl border border-amber-700 bg-amber-950/30 p-3 text-sm space-y-2">
              <p className="font-semibold text-amber-100">
                {t('license.demoCardTitle', {
                  defaultValue: 'Demo muddat: {{left}} kun qoldi',
                  left: licenseInfo.demo_days_left ?? 0,
                })}
              </p>
              <p className="text-amber-100/90">
                {t('license.demoCardBody', {
                  defaultValue:
                    "Dastur ishga tushgan kundan 14 kun demo ishlaydi. Faollashtirish uchun admin Settings -> Security bo'limida activation key yuboradi.",
                })}
              </p>
              <div className="text-xs text-amber-200 space-y-1">
                <p>
                  {t('license.demoExpires', { defaultValue: 'Demo tugash sanasi' })}: {licenseInfo.demo_expires_at || ''}
                </p>
                <p className="break-all">
                  {t('license.hardwareIdLabel', { defaultValue: 'Hardware ID' })}: {hardwareId || t('admin.common.na')}
                </p>
              </div>
            </div>
          )}
        </section>

        <form
          onSubmit={submit}
          className="rounded-xl border border-slate-700 bg-slate-800 p-5 space-y-4"
        >
          <label className="block text-sm">
            {t('auth.userSelect', { defaultValue: t('auth.username') })}
            <select
              className="touch-btn mt-1 w-full min-h-14 rounded-xl bg-slate-950 border border-slate-600 px-4 py-3 text-base"
              value={u}
              onChange={(e) => setU(e.target.value)}
            >
              {users.map((row) => (
                <option key={row.username} value={row.username}>
                  {row.display_name} ({row.role})
                </option>
              ))}
            </select>
          </label>
          <div className="block text-sm space-y-2">
            <span className="block">{t('auth.pin', { defaultValue: 'PIN' })}</span>
            <PinNumpadPanel pin={p} setPin={setP} label={t('auth.pin', { defaultValue: 'PIN' })} />
          </div>
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="touch-btn w-full min-h-14 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-lg font-semibold"
          >
            {busy ? t('auth.logging') : t('auth.login')}
          </button>
          <p className="text-xs text-slate-400 text-center">{t('auth.pinHint', { defaultValue: '4 xonali PIN kiriting' })}</p>
          <button
            type="button"
            className="touch-btn w-full min-h-12 py-3 rounded-xl bg-slate-900 border border-slate-600 text-slate-200 text-sm"
            onClick={async () => {
              try {
                const { invoke } = await import('@tauri-apps/api/tauri')
                await invoke('request_app_exit')
              } catch {
                window.close()
              }
            }}
          >
            {t('auth.quitApp', { defaultValue: "Dasturni yopish" })}
          </button>
        </form>
      </div>
    </div>
  )
}
