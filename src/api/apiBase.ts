import { Capacitor } from '@capacitor/core'

const PROD_ORIGIN = 'https://undersurface.me'

export function apiUrl(path: string): string {
  return Capacitor.isNativePlatform() ? `${PROD_ORIGIN}${path}` : path
}
