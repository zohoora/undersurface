import { Capacitor } from '@capacitor/core'

export async function installBackButton(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  // Lazy: keeps @capacitor/app out of the web bundle.
  const { App } = await import('@capacitor/app')
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else App.exitApp()
  })
}
