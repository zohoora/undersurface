import { useState, useEffect } from 'react'
import { adminFetch } from './adminApi'
import type { GlobalConfig } from './adminTypes'

export function AdminSettings() {
  const [config, setConfig] = useState<GlobalConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    adminFetch<{ config: GlobalConfig | null }>('getConfig')
      .then((res) => {
        setConfig(res.config ?? {
          defaultModel: 'google/gemini-3-flash-preview',
          defaultResponseSpeed: 1.0,
          defaultTypewriterScroll: 'typewriter',
          features: {
            partsEnabled: true,
            visualEffectsEnabled: true,
            autocorrectEnabled: true,
          },
          announcement: null,
          updatedAt: 0,
          updatedBy: '',
        })
        setLoading(false)
      })
      .catch((e) => {
        setMessage({ type: 'error', text: e.message })
        setLoading(false)
      })
  }, [])

  const handleSave = async () => {
    if (!config) return
    setSaving(true)
    setMessage(null)
    try {
      const result = await adminFetch<{ config: GlobalConfig }>('updateConfig', { config })
      setConfig(result.config)
      setMessage({ type: 'success', text: 'Settings saved' })
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  const handleSignalUpdate = async () => {
    if (!config) return
    setSaving(true)
    setMessage(null)
    try {
      const updated = { ...config, buildVersion: Date.now().toString() }
      const result = await adminFetch<{ config: GlobalConfig }>('updateConfig', { config: updated })
      setConfig(result.config)
      setMessage({ type: 'success', text: 'Update signaled — users will see a refresh prompt' })
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to signal' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>Loading...</div>
  if (!config) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>No config loaded</div>

  const inputStyle = {
    padding: '8px 12px',
    fontSize: 13,
    border: '1px solid #E8E4DF',
    borderRadius: 6,
    fontFamily: "'Inter', sans-serif",
    color: '#2D2B29',
    width: '100%',
    boxSizing: 'border-box' as const,
    background: '#FFFFFF',
  }

  const labelStyle = {
    fontSize: 12,
    fontWeight: 500 as const,
    color: '#6B6560',
    marginBottom: 6,
    display: 'block' as const,
  }

  const sectionStyle = {
    background: '#FFFFFF',
    borderRadius: 8,
    padding: 24,
    border: '1px solid #E8E4DF',
    marginBottom: 20,
  }

  return (
    <div style={{ maxWidth: 600 }}>
      {message && (
        <div style={{
          padding: '10px 16px',
          marginBottom: 16,
          borderRadius: 6,
          fontSize: 13,
          background: message.type === 'success' ? '#F0FDF4' : '#FEF2F2',
          color: message.type === 'success' ? '#166534' : '#B91C1C',
          border: `1px solid ${message.type === 'success' ? '#BBF7D0' : '#FECACA'}`,
        }}>
          {message.text}
        </div>
      )}

      <div style={sectionStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 500, marginTop: 0, marginBottom: 20 }}>Defaults</h3>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Default Model</label>
          <input
            type="text"
            value={config.defaultModel}
            onChange={(e) => setConfig({ ...config, defaultModel: e.target.value })}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Default Response Speed ({config.defaultResponseSpeed})</label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={config.defaultResponseSpeed}
            onChange={(e) => setConfig({ ...config, defaultResponseSpeed: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginBottom: 0 }}>
          <label style={labelStyle}>Default Typewriter Scroll</label>
          <select
            value={config.defaultTypewriterScroll}
            onChange={(e) => setConfig({ ...config, defaultTypewriterScroll: e.target.value as GlobalConfig['defaultTypewriterScroll'] })}
            style={inputStyle}
          >
            <option value="off">Off</option>
            <option value="comfortable">Comfortable</option>
            <option value="typewriter">Typewriter</option>
          </select>
        </div>
      </div>

      <div style={sectionStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 500, marginTop: 0, marginBottom: 20 }}>Feature Flags</h3>

        <ToggleRow
          label="Parts (AI thoughts)"
          checked={config.features.partsEnabled}
          onChange={(v) => setConfig({ ...config, features: { ...config.features, partsEnabled: v } })}
        />
        <ToggleRow
          label="Visual Effects"
          checked={config.features.visualEffectsEnabled}
          onChange={(v) => setConfig({ ...config, features: { ...config.features, visualEffectsEnabled: v } })}
        />
        <ToggleRow
          label="Autocorrect"
          checked={config.features.autocorrectEnabled}
          onChange={(v) => setConfig({ ...config, features: { ...config.features, autocorrectEnabled: v } })}
        />
      </div>

      <div style={sectionStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 500, marginTop: 0, marginBottom: 20 }}>Announcement</h3>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Message (empty = no announcement)</label>
          <textarea
            value={config.announcement?.message ?? ''}
            onChange={(e) => {
              if (!e.target.value) {
                setConfig({ ...config, announcement: null })
              } else {
                setConfig({
                  ...config,
                  announcement: {
                    message: e.target.value,
                    type: config.announcement?.type ?? 'info',
                    dismissible: config.announcement?.dismissible ?? true,
                  },
                })
              }
            }}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>

        {config.announcement && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Type</label>
              <select
                value={config.announcement.type}
                onChange={(e) => setConfig({
                  ...config,
                  announcement: { ...config.announcement!, type: e.target.value as 'info' | 'warning' },
                })}
                style={inputStyle}
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
              </select>
            </div>

            <ToggleRow
              label="Dismissible"
              checked={config.announcement.dismissible}
              onChange={(v) => setConfig({
                ...config,
                announcement: { ...config.announcement!, dismissible: v },
              })}
            />
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 32px',
            fontSize: 13,
            fontFamily: "'Inter', sans-serif",
            background: saving ? '#E8E4DF' : '#2D2B29',
            color: saving ? '#A09A94' : '#FFFFFF',
            border: 'none',
            borderRadius: 6,
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        <button
          onClick={handleSignalUpdate}
          disabled={saving}
          style={{
            padding: '10px 24px',
            fontSize: 13,
            fontFamily: "'Inter', sans-serif",
            background: 'none',
            color: saving ? '#A09A94' : '#6B6560',
            border: '1px solid #E8E4DF',
            borderRadius: 6,
            cursor: saving ? 'default' : 'pointer',
          }}
        >
          Signal Update
        </button>
      </div>
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 0',
      fontSize: 13,
      cursor: 'pointer',
    }}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, cursor: 'pointer' }}
      />
    </label>
  )
}
