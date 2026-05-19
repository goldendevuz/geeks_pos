export type BootStage =
  | 'boot_init'
  | 'runtime_check'
  | 'backend_spawn'
  | 'backend_wait'
  | 'timeout_warn'
  | 'boot_failed'
  | 'app_loading'

const stageText: Record<BootStage, string> = {
  boot_init: 'Geeks POS yuklanmoqda...',
  runtime_check: 'Tizim komponentlari tekshirilmoqda...',
  backend_spawn: 'Backend ishga tushirilmoqda...',
  backend_wait: 'Serverga ulanilmoqda...',
  timeout_warn: 'Ishga tushish odatdagidan uzoq davom etmoqda...',
  boot_failed: 'Backend ishga tushmadi.',
  app_loading: 'Ilova yuklanmoqda...',
}

export function BootScreen({
  stage,
  detail,
  onRetry,
  onOpenLog,
}: {
  stage: BootStage
  detail?: string
  onRetry?: () => void
  onOpenLog?: () => void
}) {
  const isFailed = stage === 'boot_failed'
  const isWarn = stage === 'timeout_warn'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
      <div className="text-center space-y-3 max-w-xl px-5">
        {!isFailed && (
          <div className="mx-auto h-10 w-10 rounded-full border-4 border-slate-700 border-t-emerald-500 animate-spin" />
        )}
        <div className="text-xl font-semibold">{stageText[stage]}</div>
        <div className="text-sm text-slate-400">{detail || 'Iltimos kuting, tizim tayyorlanmoqda.'}</div>
        {isWarn && (
          <div className="text-xs text-amber-300">Server 5 soniyadan ko&apos;p kutilyapti. Qayta urinish mumkin.</div>
        )}
        {(isWarn || isFailed) && (onRetry || onOpenLog) && (
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {onRetry && (
              <button
                type="button"
                className="touch-btn min-h-12 px-4 rounded-xl bg-emerald-700 border border-emerald-500"
                onClick={onRetry}
              >
                {isWarn ? 'Server ishga tushmadi — qayta urinish' : 'Qayta urinish'}
              </button>
            )}
            {onOpenLog && (
              <button
                type="button"
                className="touch-btn min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-600"
                onClick={onOpenLog}
              >
                Log manzili
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
