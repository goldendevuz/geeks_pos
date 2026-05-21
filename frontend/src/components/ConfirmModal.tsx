import { AlertCircle } from 'lucide-react'

export function ConfirmModal({
  title,
  message,
  cancelText = 'Cancel',
  confirmText = 'Confirm',
  isDangerous = false,
  isLoading = false,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  cancelText?: string
  confirmText?: string
  isDangerous?: boolean
  isLoading?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 max-w-sm w-full">
        <div className="flex items-start gap-3 mb-4">
          <AlertCircle className={`h-5 w-5 shrink-0 mt-0.5 ${isDangerous ? 'text-red-400' : 'text-amber-400'}`} />
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            <p className="text-sm text-slate-400 mt-1">{message}</p>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="touch-btn flex-1 min-h-12 px-4 rounded-xl bg-slate-700 border border-slate-600 text-slate-300 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`touch-btn flex-1 min-h-12 px-4 rounded-xl border font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
              isDangerous
                ? 'bg-red-700 border-red-500 text-white'
                : 'bg-emerald-700 border-emerald-500 text-white'
            }`}
          >
            {isLoading ? '...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
