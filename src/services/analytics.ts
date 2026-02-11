import type { Analytics } from 'firebase/analytics'

let analytics: Analytics | null = null
let initialized = false

async function getAnalyticsInstance(): Promise<Analytics | null> {
  if (initialized) return analytics
  initialized = true

  try {
    if (typeof window === 'undefined') return null
    const [{ getAnalytics, isSupported }, { getApp }] = await Promise.all([
      import('firebase/analytics'),
      import('firebase/app'),
    ])
    const supported = await isSupported()
    if (!supported) return null
    analytics = getAnalytics(getApp())
    return analytics
  } catch {
    return null
  }
}

export async function trackEvent(
  name: string,
  params?: Record<string, string | number | boolean>,
): Promise<void> {
  try {
    const instance = await getAnalyticsInstance()
    if (!instance) return
    const { logEvent } = await import('firebase/analytics')
    logEvent(instance, name, params)
  } catch {
    // Analytics is non-critical
  }
}

export async function setAnalyticsUser(uid: string): Promise<void> {
  try {
    const instance = await getAnalyticsInstance()
    if (!instance) return
    const { setUserId } = await import('firebase/analytics')
    setUserId(instance, uid)
  } catch {
    // Non-critical
  }
}

export async function clearAnalyticsUser(): Promise<void> {
  try {
    const instance = await getAnalyticsInstance()
    if (!instance) return
    const { setUserId } = await import('firebase/analytics')
    setUserId(instance, '')
  } catch {
    // Non-critical
  }
}
