import { describe, it, expect } from 'vitest'
import en from './translations/en'
import deLocale from './translations/de'
import esLocale from './translations/es'
import frLocale from './translations/fr'
import hiLocale from './translations/hi'
import idLocale from './translations/id'
import itLocale from './translations/it'
import jaLocale from './translations/ja'
import koLocale from './translations/ko'
import nlLocale from './translations/nl'
import plLocale from './translations/pl'
import ptLocale from './translations/pt'
import ruLocale from './translations/ru'
import thLocale from './translations/th'
import trLocale from './translations/tr'
import viLocale from './translations/vi'
import zhLocale from './translations/zh'

const locales = {
  de: deLocale,
  es: esLocale,
  fr: frLocale,
  hi: hiLocale,
  id: idLocale,
  it: itLocale,
  ja: jaLocale,
  ko: koLocale,
  nl: nlLocale,
  pl: plLocale,
  pt: ptLocale,
  ru: ruLocale,
  th: thLocale,
  tr: trLocale,
  vi: viLocale,
  zh: zhLocale,
}
const enKeys = new Set(Object.keys(en))

describe('i18n key parity', () => {
  for (const [name, locale] of Object.entries(locales)) {
    it(`${name} has every English key`, () => {
      const missing = [...enKeys].filter(k => !(k in locale))
      expect(missing).toEqual([])
    })
  }
})
