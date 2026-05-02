import { Capacitor } from '@capacitor/core'

// Capacitor plugin imports are lazy so they don't ship in the web bundle.
// Each function returns early on web; the dynamic import only resolves on native.

export async function initNative(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Light })
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#FAF8F5' })
    }
  } catch {
    // status bar APIs are best-effort; some platforms reject silently
  }
}

export async function dismissSplash(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch {
    // splash already dismissed or unavailable
  }
}

export async function lightHaptic(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle.Light })
  } catch {
    // haptics not supported on this device — silent
  }
}
