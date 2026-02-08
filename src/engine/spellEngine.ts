import Typo from 'typo-js'

let typo: Typo | null = null
let initPromise: Promise<void> | null = null

function damerauLevenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      )
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[m][n]
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function shouldSkipWord(word: string, sentenceStart: boolean): boolean {
  if (word.length < 2) return true
  if (/^[A-Z]{2,}$/.test(word)) return true
  if (/\d/.test(word)) return true
  if (/[a-z][A-Z]/.test(word)) return true
  if (/^[A-Z]/.test(word) && !sentenceStart) return true
  return false
}

export const spellEngine = {
  async init() {
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        const [affData, dicData] = await Promise.all([
          fetch('/dictionaries/en.aff').then((r) => r.text()),
          fetch('/dictionaries/en.dic').then((r) => r.text()),
        ])
        typo = new Typo('en', affData, dicData)
      } catch (err) {
        console.warn('Spell engine: failed to load dictionaries', err)
        initPromise = null
      }
    })()
    return initPromise
  },

  check(word: string): boolean {
    if (!typo) return true
    return typo.check(word)
  },

  suggest(word: string, sentenceStart = false): string | null {
    if (!typo) return null
    if (shouldSkipWord(word, sentenceStart)) return null

    const needsCapitalize = sentenceStart && /^[A-Z]/.test(word)
    const checkWord = sentenceStart ? word.toLowerCase() : word

    if (typo.check(checkWord)) return null

    // Try adjacent transpositions first (Hunspell misses these)
    for (let i = 0; i < checkWord.length - 1; i++) {
      const swapped = checkWord.slice(0, i) + checkWord[i + 1] + checkWord[i] + checkWord.slice(i + 2)
      if (typo.check(swapped)) {
        return needsCapitalize ? capitalize(swapped) : swapped
      }
    }

    // Fall back to Hunspell suggestions, ranked by Damerau-Levenshtein distance
    const suggestions = typo.suggest(checkWord, 5)
    if (suggestions.length === 0) return null

    let best = suggestions[0]
    let bestDist = damerauLevenshtein(checkWord, best.toLowerCase())
    let bestSameStart = checkWord[0] === best[0].toLowerCase()

    for (let i = 1; i < suggestions.length; i++) {
      const candidate = suggestions[i]
      const dist = damerauLevenshtein(checkWord, candidate.toLowerCase())
      const sameStart = checkWord[0] === candidate[0].toLowerCase()
      if (dist < bestDist || (dist === bestDist && sameStart && !bestSameStart)) {
        best = candidate
        bestDist = dist
        bestSameStart = sameStart
      }
    }

    if (bestDist > 2) return null

    return needsCapitalize ? capitalize(best) : best
  },
}
