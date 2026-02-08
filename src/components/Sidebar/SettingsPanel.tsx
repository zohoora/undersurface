import { useState } from 'react'
import { useSettings, updateSettings } from '../../store/settings'
import type { AppSettings } from '../../store/settings'
import { useAuth } from '../../auth/useAuth'
import { ModelSelector } from './ModelSelector'
import { exportAllData } from '../../store/db'

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className="settings-toggle"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className={`settings-toggle-knob ${checked ? 'on' : ''}`} />
    </button>
  )
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      {children}
    </div>
  )
}

interface SettingsPanelProps {
  isOpen: boolean
  onToggle: () => void
}

export function SettingsPanel({ isOpen, onToggle }: SettingsPanelProps) {
  const settings = useSettings()
  const { user, signOut } = useAuth()
  const [showKey, setShowKey] = useState(false)
  const [keyValid, setKeyValid] = useState<boolean | null>(null)

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    updateSettings({ [key]: value })
  }

  const validateKey = async (key: string) => {
    if (!key) { setKeyValid(null); return }
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` },
      })
      setKeyValid(res.ok)
    } catch {
      setKeyValid(false)
    }
  }

  return (
    <div className="settings-panel">
      <button
        className="settings-gear-btn"
        onClick={onToggle}
        aria-label="Toggle settings"
        aria-expanded={isOpen}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85" />
        </svg>
        <span>Settings</span>
      </button>

      {isOpen && (
        <div className="settings-body">
          {/* Account */}
          {user && (
            <div className="settings-section">
              <div className="settings-section-label">Account</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                {user.photoURL && (
                  <img
                    src={user.photoURL}
                    alt=""
                    style={{ width: 24, height: 24, borderRadius: '50%' }}
                    referrerPolicy="no-referrer"
                  />
                )}
                <span style={{ fontSize: 11, color: '#4A453F', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.displayName || user.email}
                </span>
                <button
                  onClick={signOut}
                  style={{
                    fontSize: 10,
                    color: '#A09A94',
                    background: 'none',
                    border: '1px solid #E8E4DF',
                    borderRadius: 4,
                    padding: '2px 8px',
                    cursor: 'pointer',
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          )}

          {/* AI Settings */}
          <div className="settings-section">
            <div className="settings-section-label">AI</div>
            {!settings.openRouterApiKey && (
              <div style={{ fontSize: 11, color: '#A09A94', padding: '2px 0 6px', lineHeight: 1.4 }}>
                AI features disabled — add API key to enable
              </div>
            )}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: '#A09A94', marginBottom: 4 }}>API Key</div>
              <div style={{ position: 'relative' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={settings.openRouterApiKey}
                  onChange={(e) => {
                    set('openRouterApiKey', e.target.value)
                    setKeyValid(null)
                  }}
                  onBlur={(e) => validateKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  style={{
                    width: '100%',
                    padding: '6px 28px 6px 8px',
                    border: '1px solid #D5D0CA',
                    borderRadius: 4,
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 11,
                    background: 'white',
                    color: '#4A453F',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={() => setShowKey((s) => !s)}
                  style={{
                    position: 'absolute',
                    right: 4,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: '#A09A94',
                    padding: '2px 4px',
                  }}
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? '◉' : '○'}
                </button>
              </div>
              {keyValid !== null && (
                <div style={{ fontSize: 10, marginTop: 2, color: keyValid ? '#7A9E7E' : '#C4935A' }}>
                  {keyValid ? '✓ Valid' : '✗ Invalid key'}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#A09A94', marginBottom: 4 }}>Model</div>
              <ModelSelector />
            </div>
          </div>

          {/* Part Responsiveness */}
          <div className="settings-section">
            <div className="settings-section-label">Responsiveness</div>
            <SettingRow label="Response speed">
              <div className="settings-slider-row">
                <span className="settings-slider-label">Slower</span>
                <input
                  type="range"
                  className="settings-slider"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={settings.responseSpeed}
                  onChange={(e) => set('responseSpeed', parseFloat(e.target.value))}
                />
                <span className="settings-slider-label">Faster</span>
              </div>
            </SettingRow>
          </div>

          {/* Visual Effects */}
          <div className="settings-section">
            <div className="settings-section-label">Visual effects</div>
            <SettingRow label="Paragraph fade">
              <Toggle checked={settings.paragraphFade} onChange={(v) => set('paragraphFade', v)} />
            </SettingRow>
            <SettingRow label="Ink weight">
              <Toggle checked={settings.inkWeight} onChange={(v) => set('inkWeight', v)} />
            </SettingRow>
            <SettingRow label="Color bleed">
              <Toggle checked={settings.colorBleed} onChange={(v) => set('colorBleed', v)} />
            </SettingRow>
            <SettingRow label="Breathing background">
              <Toggle checked={settings.breathingBackground} onChange={(v) => set('breathingBackground', v)} />
            </SettingRow>
          </div>

          {/* Autocorrect */}
          <div className="settings-section">
            <div className="settings-section-label">Autocorrect</div>
            <SettingRow label="Auto-capitalize">
              <Toggle checked={settings.autoCapitalize} onChange={(v) => set('autoCapitalize', v)} />
            </SettingRow>
            <SettingRow label="Autocorrect">
              <Toggle checked={settings.autocorrect} onChange={(v) => set('autocorrect', v)} />
            </SettingRow>
          </div>

          {/* Data */}
          <div className="settings-section">
            <div className="settings-section-label">Data</div>
            <button
              onClick={exportAllData}
              style={{
                fontSize: 11,
                fontFamily: "'Inter', sans-serif",
                color: '#4A453F',
                background: 'none',
                border: '1px solid #D5D0CA',
                borderRadius: 4,
                padding: '6px 12px',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              Export all data
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
