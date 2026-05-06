type UiSoundKind = 'success' | 'error' | 'info' | 'confirm'

/** Sound effects are disabled globally by business request. */
export function playUiSound(_kind: UiSoundKind) {
  // no-op
}

