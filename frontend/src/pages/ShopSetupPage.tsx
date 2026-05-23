import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Footprints, Shirt, Layers } from 'lucide-react'
import { completeSetup, type ShopMode } from '../api'

const MODES: Array<{ id: ShopMode; icon: typeof Footprints }> = [
  { id: 'FOOTWEAR_ONLY', icon: Footprints },
  { id: 'CLOTHING_ONLY', icon: Shirt },
  { id: 'MIXED', icon: Layers },
]

export function ShopSetupPage({ onDone }: { onDone: () => void | Promise<void> }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<ShopMode | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!selected) return
    setErr(null)
    setBusy(true)
    try {
      await completeSetup(selected)
      await onDone()
    } catch (e: unknown) {
      const code = (e as Error & { code?: string }).code
      setErr(t(`err.${code || 'SETUP_COMPLETE_FAILED'}`, { defaultValue: t('msg.errorGeneric') }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 lg:p-6 flex items-center justify-center">
      <div className="w-full max-w-3xl space-y-6">
        <div className="text-center space-y-2">
          <img
            src="/resized-logo.png"
            alt="logo"
            className="h-16 w-16 rounded-xl bg-white p-1 object-contain mx-auto"
          />
          <h1 className="text-2xl font-semibold text-emerald-400">{t('setup.title')}</h1>
          <p className="text-slate-400 text-sm max-w-lg mx-auto">{t('setup.subtitle')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {MODES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              disabled={busy}
              onClick={() => setSelected(id)}
              className={`touch-btn min-h-[140px] rounded-2xl border p-4 text-left flex flex-col gap-3 transition-colors ${
                selected === id
                  ? 'border-emerald-500 bg-emerald-950/50 ring-2 ring-emerald-500/40'
                  : 'border-slate-700 bg-slate-800/80 hover:border-slate-600'
              }`}
            >
              <Icon className={`h-8 w-8 ${selected === id ? 'text-emerald-400' : 'text-slate-400'}`} />
              <div>
                <div className="font-semibold text-base">{t(`setup.mode.${id}.title`)}</div>
                <div className="text-xs text-slate-400 mt-1">{t(`setup.mode.${id}.hint`)}</div>
              </div>
            </button>
          ))}
        </div>

        {err && <div className="text-sm text-red-300 text-center">{err}</div>}

        <button
          type="button"
          disabled={!selected || busy}
          onClick={() => void submit()}
          className="touch-btn w-full min-h-14 rounded-xl bg-emerald-700 border border-emerald-500 font-semibold disabled:opacity-40"
        >
          {busy ? t('setup.working') : t('setup.continue')}
        </button>
      </div>
    </div>
  )
}
