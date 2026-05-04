import { useEffect, useState } from 'react'
import { playUiSound } from '../utils/uiSound'

export function ActionToast({
  kind,
  message,
  durationMs = 4000,
  muteSound = false,
  onClose,
}: {
  kind: 'ok' | 'err' | 'info'
  message: string
  durationMs?: number
  muteSound?: boolean
  onClose?: () => void
}) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(true)
    if (!muteSound) {
      if (kind === 'ok') playUiSound('success')
      else if (kind === 'err') playUiSound('error')
      else playUiSound('info')
    }
    const timer = window.setTimeout(() => {
      setVisible(false)
      onClose?.()
    }, durationMs)
    return () => window.clearTimeout(timer)
  }, [durationMs, kind, message, muteSound, onClose])

  if (!visible) return null

  const cls =
    kind === 'ok'
      ? 'bg-emerald-950/95 border-emerald-700 text-emerald-100'
      : kind === 'err'
        ? 'bg-red-950/95 border-red-700 text-red-100'
        : 'bg-slate-900/95 border-slate-700 text-slate-100'

  return (
    <div className="fixed top-4 right-4 z-[130] max-w-sm w-[calc(100vw-2rem)] pointer-events-none">
      <div className={`pointer-events-auto px-4 py-3 rounded-xl text-sm border shadow-2xl backdrop-blur ${cls}`}>
        {message}
      </div>
    </div>
  )
}
