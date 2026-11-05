import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import chinese from './ui/locales/zh-CN.json'
import english from './ui/locales/en.json'

export { useTranslation } from 'react-i18next'
export type UiLanguage = 'zh-CN' | 'en'
const storageKey = 'questbranch-language'

export function readLanguage(storage?: Pick<Storage, 'getItem'>): UiLanguage {
  try {
    return storage?.getItem(storageKey) === 'en' ? 'en' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

function initialLanguage(): UiLanguage {
  try {
    return readLanguage(typeof window === 'undefined' ? undefined : window.localStorage)
  } catch {
    return 'zh-CN'
  }
}

void i18n.use(initReactI18next).init({
  lng: initialLanguage(),
  fallbackLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en'],
  load: 'currentOnly',
  initAsync: false,
  returnEmptyString: false,
  resources: { 'zh-CN': { translation: chinese }, en: { translation: english } },
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
})

function applyLanguage(language: string) {
  if (typeof document !== 'undefined') document.documentElement.lang = language
}
i18n.on('languageChanged', applyLanguage)
applyLanguage(i18n.language)

/** An application preference; it never rewrites research records or model prompts. */
export async function chooseLanguage(language: UiLanguage): Promise<boolean> {
  if (language !== 'zh-CN' && language !== 'en') throw new Error('Unsupported UI language')
  await i18n.changeLanguage(language)
  try {
    localStorage.setItem(storageKey, language)
    return true
  } catch {
    return false
  }
}

export const t = i18n.t.bind(i18n)
export const uiLocale = () => (i18n.resolvedLanguage === 'en' ? 'en' : 'zh-CN')
export default i18n
