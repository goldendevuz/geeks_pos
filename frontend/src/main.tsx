import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import i18n, { loadLocale } from './i18n'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { BootScreen, type BootStage } from './components/BootScreen'

const RUNTIME_API_KEY = 'geeks_pos_runtime_api_base'
const HEALTH_FETCH_MS = 2000

async function appendUiLog(level: 'INFO' | 'ERROR', message: string) {
  try {
    const { invoke } = await import('@tauri-apps/api/tauri')
    await invoke('append_app_log', { level, message })
  } catch {
    // ignore logging failures in web/dev mode
  }
}

window.addEventListener('error', (event) => {
  void appendUiLog('ERROR', `window.error: ${event.message || 'unknown'}`)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason)
  void appendUiLog('ERROR', `unhandledrejection: ${reason}`)
})

function renderBoot(root: ReturnType<typeof createRoot>, stage: BootStage, opts?: { detail?: string; onRetry?: () => void }) {
  root.render(
    <BootScreen
      stage={stage}
      detail={opts?.detail}
      onRetry={opts?.onRetry}
      onOpenLog={
        stage === 'boot_failed' || stage === 'timeout_warn'
          ? () => {
              void openBootLog()
            }
          : undefined
      }
    />,
  )
}

async function openBootLog() {
  let logPath = '%APPDATA%\\GeeksPOS\\logs\\backend_boot.log'
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri')
      logPath = await invoke<string>('get_backend_boot_log_path')
    } catch {
      // keep fallback
    }
  }
  try {
    const { open } = await import('@tauri-apps/api/shell')
    await open(logPath)
  } catch {
    try {
      await navigator.clipboard.writeText(logPath)
    } catch {
      // ignore
    }
  }
}

async function fetchHealthOk(base: string, signal: AbortSignal): Promise<boolean> {
  try {
    const health = await fetch(`${base}/api/health/`, { credentials: 'include', signal })
    return health.ok
  } catch {
    return false
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== 'undefined'
}

function shouldUseDevProxy(): boolean {
  if (typeof window === 'undefined') return false
  return (
    isTauriRuntime() &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
    window.location.hostname === 'localhost'
  )
}

async function bootstrap() {
  const el = document.getElementById('root')
  if (!el) {
    document.body.innerHTML =
      '<p style="padding:1rem;font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc">#root elementi topilmadi.</p>'
    return
  }

  const root = createRoot(el)
  let bootInFlight = false

  const run = async (): Promise<void> => {
    if (bootInFlight) return
    bootInFlight = true
    renderBoot(root, 'boot_init')

    try {
      renderBoot(root, 'runtime_check')
      await new Promise((resolve) => window.setTimeout(resolve, 80))
      renderBoot(root, 'backend_spawn')

      const tauriRuntime = isTauriRuntime()
      if (tauriRuntime) {
        const { invoke } = await import('@tauri-apps/api/tauri')
        const base = await invoke<string>('get_backend_base_url')
        try {
          if (shouldUseDevProxy()) {
            window.localStorage.removeItem(RUNTIME_API_KEY)
          } else {
            window.localStorage.setItem(RUNTIME_API_KEY, base)
          }
        } catch {
          // private mode / blocked storage
        }

        let backendReady = false
        const started = Date.now()
        for (let attempt = 0; attempt < 140; attempt++) {
          const elapsed = Date.now() - started
          if (elapsed >= 5000 && elapsed < 30000) {
            renderBoot(root, 'timeout_warn', {
              onRetry: () => {
                void retryBoot()
              },
            })
          } else {
            renderBoot(root, 'backend_wait', {
              onRetry: () => {
                void retryBoot()
              },
            })
          }

          const controller = new AbortController()
          const timer = window.setTimeout(() => controller.abort(), HEALTH_FETCH_MS)
          try {
            if (await fetchHealthOk(base, controller.signal)) {
              backendReady = true
              break
            }
          } finally {
            window.clearTimeout(timer)
          }

          if (elapsed >= 35000) {
            throw new Error('Backend healthcheck timeout')
          }
          await new Promise((resolve) => window.setTimeout(resolve, 250))
        }

        if (!backendReady) {
          throw new Error('Backend healthcheck timeout')
        }
      }

      renderBoot(root, 'app_loading')
      await loadLocale(i18n.language || 'uz')
      const { default: App } = await import('./App.tsx')
      root.render(
        <StrictMode>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </StrictMode>,
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown'
      void appendUiLog('ERROR', `Boot failed: ${message}`)
      renderBoot(root, 'boot_failed', {
        detail: i18n.t('boot.failedDetail', { message }),
        onRetry: () => {
          void retryBoot()
        },
      })
    } finally {
      bootInFlight = false
    }
  }

  async function retryBoot(): Promise<void> {
    if (bootInFlight) return
    if (isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri')
        await invoke('retry_backend_start')
      } catch {
        // degraded or still failing — continue into full boot flow
      }
    }
    await run()
  }

  await run()
}

void bootstrap()
