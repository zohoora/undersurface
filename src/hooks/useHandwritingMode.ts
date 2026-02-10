import { useEffect, useRef } from 'react'
import { useGlobalConfig } from '../store/globalConfig'

function buildGoogleFontUrl(fontName: string): string {
  const encoded = fontName.replace(/\s+/g, '+')
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;700&display=swap`
}

export function useHandwritingMode(): void {
  const config = useGlobalConfig()
  const enabled = config?.features?.handwritingMode === true
  const linkRef = useRef<HTMLLinkElement | null>(null)

  useEffect(() => {
    if (!enabled) {
      // Clean up if disabled
      if (linkRef.current) {
        linkRef.current.remove()
        linkRef.current = null
      }
      document.documentElement.removeAttribute('data-handwriting')
      document.documentElement.style.removeProperty('--handwriting-font')
      return
    }

    const fontName = config?.atmosphere?.handwritingFont ?? 'Caveat'

    // Inject Google Fonts <link> if not already present
    if (linkRef.current) {
      linkRef.current.remove()
      linkRef.current = null
    }

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = buildGoogleFontUrl(fontName)
    document.head.appendChild(link)
    linkRef.current = link

    document.documentElement.setAttribute('data-handwriting', 'true')
    document.documentElement.style.setProperty('--handwriting-font', `'${fontName}', cursive`)

    return () => {
      if (linkRef.current) {
        linkRef.current.remove()
        linkRef.current = null
      }
      document.documentElement.removeAttribute('data-handwriting')
      document.documentElement.style.removeProperty('--handwriting-font')
    }
  }, [enabled, config?.atmosphere?.handwritingFont])
}
