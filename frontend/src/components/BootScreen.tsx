import { useTranslation } from 'react-i18next'

export type BootStage =
  | 'boot_init'
  | 'runtime_check'
  | 'backend_spawn'
  | 'backend_wait'
  | 'timeout_warn'
  | 'boot_failed'
  | 'app_loading'

const STAGE_KEYS: Record<BootStage, string> = {
  boot_init: 'boot.init',
  runtime_check: 'boot.runtimeCheck',
  backend_spawn: 'boot.backendSpawn',
  backend_wait: 'boot.backendWait',
  timeout_warn: 'boot.timeoutWarn',
  boot_failed: 'boot.failed',
  app_loading: 'boot.appLoading',
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
  const { t } = useTranslation()
  const isFailed = stage === 'boot_failed'
  const isWarn = stage === 'timeout_warn'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
      <div className="text-center space-y-3 max-w-xl px-5">
        {!isFailed && (
          <div className="mx-auto h-10 w-10 rounded-full border-4 border-slate-700 border-t-emerald-500 animate-spin" />
        )}
        <div className="text-xl font-semibold">{t(STAGE_KEYS[stage])}</div>
        <div className="text-sm text-slate-400">{detail || t('boot.pleaseWait')}</div>
        {isWarn && <div className="text-xs text-amber-300">{t('boot.timeoutHint')}</div>}
        {(isWarn || isFailed) && (onRetry || onOpenLog) && (
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {onRetry && (
              <button
                type="button"
                className="touch-btn min-h-12 px-4 rounded-xl bg-emerald-700 border border-emerald-500"
                onClick={onRetry}
              >
                {isWarn ? t('boot.retryServer') : t('admin.common.retry')}
              </button>
            )}
            {onOpenLog && (
              <button
                type="button"
                className="touch-btn min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-600"
                onClick={onOpenLog}
              >
                {t('boot.openLog')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
