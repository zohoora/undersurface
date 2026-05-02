import { Capacitor } from '@capacitor/core'

interface ShareableEntry {
  plainText?: string
  title?: string
}

export async function shareEntry(entry: ShareableEntry): Promise<void> {
  const text = (entry.plainText ?? '').trim()
  if (!text) return

  const title = entry.title?.trim() || 'A page from UnderSurface'

  if (Capacitor.isNativePlatform()) {
    const { Share } = await import('@capacitor/share')
    await Share.share({ title, text, dialogTitle: 'Share entry' })
    return
  }

  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    try {
      await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share({ title, text })
      return
    } catch {
      // fall through to clipboard fallback
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
  }
}
