export interface Language {
  code: string
  name: string
  nativeName: string
  llmName: string
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English', llmName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', llmName: 'Spanish' },
  { code: 'fr', name: 'French', nativeName: 'Français', llmName: 'French' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', llmName: 'German' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', llmName: 'Portuguese' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', llmName: 'Italian' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', llmName: 'Russian' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', llmName: 'Simplified Chinese' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', llmName: 'Japanese' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', llmName: 'Korean' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', llmName: 'Turkish' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', llmName: 'Dutch' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', llmName: 'Vietnamese' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', llmName: 'Hindi' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', llmName: 'Indonesian' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', llmName: 'Thai' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', llmName: 'Polish' },
]

export function getLanguage(code: string): Language {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code) ?? SUPPORTED_LANGUAGES[0]
}

export function detectBrowserLanguage(): string {
  if (typeof navigator === 'undefined') return 'en'
  const browserLang = navigator.language?.split('-')[0] ?? 'en'
  const supported = SUPPORTED_LANGUAGES.find((l) => l.code === browserLang)
  return supported ? supported.code : 'en'
}
