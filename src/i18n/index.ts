import { useSyncExternalStore } from 'react'
import { getSettings, registerSettingsInvalidator } from '../store/settings'
import { getLanguage } from './languages'
import type { TranslationKey, TranslationStrings } from './translations/en'
import en from './translations/en'

// Lazy loaders for non-English translations — only the current language is fetched
const translationLoaders = import.meta.glob<{ default: Record<string, string> }>([
  './translations/*.ts',
  '!./translations/sessionCopy.ts',
  '!./translations/en.ts',
])

const translationMap = new Map<string, Record<string, string>>()
translationMap.set('en', en)

type TranslationLoaders = Record<string, () => Promise<{ default: Record<string, string> }>>

// Pre-load the current language at module init (resolves before first render
// in most cases). Returns the load promise, which never rejects.
export function preloadLanguage(lang: string, loaders: TranslationLoaders = translationLoaders): Promise<void> {
  if (lang === 'en' || translationMap.has(lang)) return Promise.resolve()
  const path = `./translations/${lang}.ts`
  const loader = loaders[path]
  if (!loader) return Promise.resolve()
  return loader().then(mod => {
    if (mod.default) {
      translationMap.set(lang, mod.default)
      invalidateTranslationCache()
    }
  }).catch(error => {
    // A stale locale chunk after a deploy (or a flaky network) must not become
    // an unhandled rejection; the UI simply stays on the English fallback and
    // the next language change or reload retries.
    console.warn(`[i18n] could not load the "${lang}" translations`, error)
  })
}

void preloadLanguage(getSettings().language ?? 'en')

let cachedStrings: TranslationStrings | null = null
let cachedLang = ''

function resolveStrings(): TranslationStrings {
  const lang = getSettings().language ?? 'en'
  if (cachedStrings && cachedLang === lang) return cachedStrings

  if (lang === 'en') {
    cachedStrings = en
    cachedLang = lang
    return en
  }

  const langStrings = translationMap.get(lang)
  if (!langStrings) {
    cachedStrings = en
    cachedLang = lang
    return en
  }

  // Merge with English fallback for missing keys
  cachedStrings = { ...en, ...langStrings } as TranslationStrings
  cachedLang = lang
  return cachedStrings
}

/** Non-React translation function — reads current language synchronously */
export function t(key: TranslationKey): string {
  return resolveStrings()[key]
}

// ── Reactive hook via useSyncExternalStore ──

const listeners = new Set<() => void>()

function subscribe(callback: () => void) {
  listeners.add(callback)
  return () => { listeners.delete(callback) }
}

function getSnapshot(): TranslationStrings {
  return resolveStrings()
}

/** React hook — re-renders when language changes */
export function useTranslation(): TranslationStrings {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Called when language changes to bust the cache */
export function invalidateTranslationCache() {
  cachedStrings = null
  cachedLang = ''
  // Pre-load the new language if not yet loaded
  void preloadLanguage(getSettings().language ?? 'en')
  for (const fn of listeners) fn()
}

registerSettingsInvalidator(invalidateTranslationCache)

/** Current language code (e.g. 'es') */
export function getLanguageCode(): string {
  return getSettings().language ?? 'en'
}

/** LLM-friendly language name (e.g. 'Spanish') for prompt directives */
export function getLLMLanguageName(): string {
  const code = getLanguageCode()
  return getLanguage(code).llmName
}

/** Seeded part display name — translated for seeded parts, passthrough for emerged */
const SEEDED_PART_KEYS: Record<string, TranslationKey> = {
  watcher: 'part.watcher',
  tender: 'part.tender',
  still: 'part.still',
  spark: 'part.spark',
  weaver: 'part.weaver',
  open: 'part.open',
}

export function getPartDisplayName(part: { id: string; name: string; isSeeded?: boolean }): string {
  if (part.isSeeded && SEEDED_PART_KEYS[part.id]) {
    return t(SEEDED_PART_KEYS[part.id])
  }
  return part.name
}

export { SUPPORTED_LANGUAGES } from './languages'
export type { TranslationKey } from './translations/en'
