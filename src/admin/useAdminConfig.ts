import { useCallback, useEffect, useState } from 'react'
import type { GlobalConfig } from './adminTypes'
import { adminFetch } from './adminApi'
import { withoutRetiredFeatures, withoutRetiredGrounding } from './featureFlags'

export interface AdminConfigMessage {
  type: 'success' | 'error'
  text: string
}

export function editableConfigUpdate(config: GlobalConfig): Partial<GlobalConfig> {
  return {
    defaultResponseSpeed: config.defaultResponseSpeed,
    features: withoutRetiredFeatures(config.features),
    atmosphere: config.atmosphere,
    partIntelligence: config.partIntelligence,
    engagement: config.engagement,
    grounding: withoutRetiredGrounding(config.grounding),
    voice: config.voice,
    announcement: config.announcement,
  }
}

function withDefaults(defaults: GlobalConfig, config: GlobalConfig | null): GlobalConfig {
  if (!config) return { ...defaults }
  return {
    ...defaults,
    ...config,
    features: { ...defaults.features, ...config.features },
    atmosphere: { ...defaults.atmosphere, ...config.atmosphere },
    partIntelligence: { ...defaults.partIntelligence, ...config.partIntelligence },
    engagement: { ...defaults.engagement, ...config.engagement },
    grounding: { ...defaults.grounding, ...config.grounding },
    voice: { ...defaults.voice, ...config.voice },
  }
}

// Owns the AdminSettings page's config state + save/reset/signal-refresh
// actions. The hook is extracted from AdminSettings.tsx so the load-bearing
// round-trip (writes appConfig/global, which every authenticated user reads)
// can be tested without rendering the form.
export function useAdminConfig(defaults: GlobalConfig) {
  const [config, setConfig] = useState<GlobalConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<AdminConfigMessage | null>(null)

  useEffect(() => {
    adminFetch<{ config: GlobalConfig | null }>('getConfig')
      .then((res) => {
        setConfig(withDefaults(defaults, res.config))
        setLoading(false)
      })
      .catch((e) => {
        setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to load' })
        setLoading(false)
      })
  // defaults is only consulted on the bootstrap path; freezing it at first
  // mount avoids re-fetching when the parent re-renders with a new object
  // identity but the same value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useCallback(async () => {
    if (!config) return
    setSaving(true)
    setMessage(null)
    try {
      const result = await adminFetch<{ config: GlobalConfig }>('updateConfig', { config: editableConfigUpdate(config) })
      setConfig(withDefaults(defaults, result.config))
      setMessage({ type: 'success', text: 'Settings saved' })
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }, [config, defaults])

  const signalUpdate = useCallback(async () => {
    if (!config) return
    setSaving(true)
    setMessage(null)
    const buildVersion = Date.now().toString()
    try {
      const result = await adminFetch<{ config: GlobalConfig }>('updateConfig', { config: { buildVersion } })
      setConfig(withDefaults(defaults, result.config))
      setMessage({ type: 'success', text: 'Update signaled — users will see a refresh prompt' })
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to signal' })
    } finally {
      setSaving(false)
    }
  }, [config, defaults])

  const resetDefaults = useCallback(() => {
    setConfig((current) => {
      if (!current) return current
      return {
        ...defaults,
        // Preserve identity / audit fields — reset only the tunable surface.
        buildVersion: current.buildVersion,
        announcement: current.announcement,
        updatedAt: current.updatedAt,
        updatedBy: current.updatedBy,
      }
    })
    setMessage({ type: 'success', text: 'Reset to defaults — click Save to apply' })
  }, [defaults])

  // Update a single key inside a nested section (features, atmosphere, etc).
  // Pure setState — no network call. Save is explicit via `save()`.
  const updateSection = useCallback(
    <K extends keyof GlobalConfig>(section: K, key: string, value: unknown) => {
      setConfig((current) => {
        if (!current) return current
        return {
          ...current,
          [section]: { ...(current[section] as object), [key]: value },
        }
      })
    },
    [],
  )

  return {
    config,
    setConfig,
    loading,
    saving,
    message,
    setMessage,
    save,
    signalUpdate,
    resetDefaults,
    updateSection,
  }
}
