import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const DEFAULT_LANG = 'uz'

function readPersistedLang(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem('geeks_pos_lang')
  } catch {
    return null
  }
}

const persistedLang = readPersistedLang()

void i18n.use(initReactI18next).init({
  resources: {},
  partialBundledLanguages: true,
  lng: persistedLang || DEFAULT_LANG,
  fallbackLng: DEFAULT_LANG,
  interpolation: { escapeValue: false },
})

export async function loadLocale(lang: string) {
  if (i18n.hasResourceBundle(lang, 'translation')) return
  const mod = lang === 'ru'
    ? await import('./locales/ru.json')
    : lang === 'uz-cyrl'
    ? await import('./locales/uz-cyrl.json')
    : await import('./locales/uz.json')
  const targetLang = lang === 'ru' ? 'ru' : lang === 'uz-cyrl' ? 'uz-cyrl' : 'uz'
  i18n.addResourceBundle(targetLang, 'translation', mod.default, true, true)
}

i18n.on('languageChanged', (lng) => {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('geeks_pos_lang', lng)
    } catch {
      // storage blocked
    }
  }
  void loadLocale(lng).catch((err) => {
    console.warn('loadLocale failed', err)
  })
})

void loadLocale(persistedLang || DEFAULT_LANG).catch((err) => {
  console.warn('initial loadLocale failed', err)
})

export default i18n
