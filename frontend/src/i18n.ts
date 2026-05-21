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
  fallbackLng: ['uz', DEFAULT_LANG],
  interpolation: { escapeValue: false },
  lowerCaseLng: true,
  react: {
    useSuspense: false,
  }
})

export async function loadLocale(lang: string) {
  // Normalize language code
  const normalizedLang = lang === 'ru' ? 'ru' : lang === 'uz-cyrl' || lang === 'uz_CYRL' ? 'uz-cyrl' : 'uz'
  
  // If already on this language and bundle is loaded, skip
  if (i18n.language === normalizedLang && i18n.hasResourceBundle(normalizedLang, 'translation')) {
    return
  }
  
  try {
    // Load bundle if not already loaded
    if (!i18n.hasResourceBundle(normalizedLang, 'translation')) {
      const mod = normalizedLang === 'ru'
        ? await import('./locales/ru.json')
        : normalizedLang === 'uz-cyrl'
        ? await import('./locales/uz-cyrl.json')
        : await import('./locales/uz.json')
      
      i18n.addResourceBundle(normalizedLang, 'translation', mod.default || mod, true, true)
    }
    
    // Always change language to trigger UI update
    await i18n.changeLanguage(normalizedLang)
  } catch (err) {
    console.error(`Failed to load locale for ${normalizedLang}:`, err)
    // Fall back to uz
    if (normalizedLang !== 'uz') {
      try {
        if (!i18n.hasResourceBundle('uz', 'translation')) {
          const mod = await import('./locales/uz.json')
          i18n.addResourceBundle('uz', 'translation', mod.default || mod, true, true)
        }
        await i18n.changeLanguage('uz')
      } catch (fallbackErr) {
        console.error('Failed to load fallback locale:', fallbackErr)
      }
    }
  }
}

// Persist language changes to localStorage
i18n.on('languageChanged', (lng) => {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('geeks_pos_lang', lng)
    } catch {
      // storage blocked
    }
  }
})

// Load initial locale
void loadLocale(persistedLang || DEFAULT_LANG).catch((err) => {
  console.warn('initial loadLocale failed', err)
})

export default i18n
