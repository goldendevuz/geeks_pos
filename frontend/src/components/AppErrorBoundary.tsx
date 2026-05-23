import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../i18n'

type Props = { children: ReactNode }

type State = { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri')
        await invoke('append_app_log', {
          level: 'ERROR',
          message: `React boundary: ${error.message}\n${info.componentStack ?? ''}`,
        })
      } catch {
        // dev / no Tauri
      }
    })()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg space-y-4 text-center">
            <div className="text-xl font-semibold text-red-300">{i18n.t('error.boundaryTitle')}</div>
            <p className="text-sm text-slate-400 break-words">{this.state.error.message}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className="touch-btn min-h-12 px-4 rounded-xl bg-emerald-700 border border-emerald-500"
                onClick={() => window.location.reload()}
              >
                {i18n.t('admin.common.reloadPage')}
              </button>
              <button
                type="button"
                className="touch-btn min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-600"
                onClick={() => this.setState({ error: null })}
              >
                {i18n.t('admin.common.retry')}
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
