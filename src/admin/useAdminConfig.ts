import { useCallback, useEffect, useState } from 'react'
import type { GlobalConfig } from './adminTypes'
import { adminFetch } from './adminApi'

export interface AdminConfigMessage {
  type: 'success' | 'error'
  text: string
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
        setConfig(res.config ?? { ...defaults })
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
    setSaving(true)
    setMessage(null)
    setConfig((current) => {
      if (!current) return current
      adminFetch<{ config: GlobalConfig }>('updateConfig', { config: current })
        .then((result) => {
          setConfig(result.config)
          setMessage({ type: 'success', text: 'Settings saved' })
        })
        .catch((e) => {
          setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to save' })
        })
        .finally(() => setSaving(false))
      return current
    })
  }, [])

  const signalUpdate = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    setConfig((current) => {
      if (!current) return current
      const updated = { ...current, buildVersion: Date.now().toString() }
      adminFetch<{ config: GlobalConfig }>('updateConfig', { config: updated })
        .then((result) => {
          setConfig(result.config)
          setMessage({ type: 'success', text: 'Update signaled — users will see a refresh prompt' })
        })
        .catch((e) => {
          setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to signal' })
        })
        .finally(() => setSaving(false))
      return current
    })
  }, [])

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
