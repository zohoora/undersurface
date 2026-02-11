import { useState, useEffect, lazy, Suspense } from 'react'
import { useSettings, updateSettings } from '../../store/settings'
import type { AppSettings } from '../../store/settings'
import { useAuth } from '../../auth/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { exportAllData } from '../../store/db'
import { submitContactMessage } from '../../api/accountApi'
import { trackEvent } from '../../services/analytics'

const PolicyModal = lazy(() => import('../PolicyModal'))
const DeleteAccountModal = lazy(() => import('../DeleteAccountModal'))

const dataButtonBase = {
  fontSize: 11,
  fontFamily: "'Inter', sans-serif",
  background: 'none',
  border: '1px solid var(--border-subtle)',
  borderRadius: 4,
  padding: '6px 12px',
  cursor: 'pointer',
  width: '100%',
} as const

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

function OptionGroup<T extends string>({
  value, options, onChange,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="settings-option-group">
      {options.map(opt => (
        <button
          key={opt.value}
          className={`settings-option ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
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
  useTheme()
  const [policyOpen, setPolicyOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [contactMessage, setContactMessage] = useState('')
  const [contactSending, setContactSending] = useState(false)
  const [contactSent, setContactSent] = useState(false)
  const [contactError, setContactError] = useState<string | null>(null)

  useEffect(() => {
    if (!contactSent) return
    const timer = setTimeout(() => setContactSent(false), 3000)
    return () => clearTimeout(timer)
  }, [contactSent])

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    updateSettings({ [key]: value })
  }

  return (
    <div className="settings-panel">
      <button
        className={`settings-gear-btn${isOpen ? ' active' : ''}`}
        onClick={onToggle}
        aria-label="Toggle settings"
        aria-expanded={isOpen}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
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
                <span style={{ fontSize: 11, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.displayName || user.email}
                </span>
                <button
                  onClick={signOut}
                  style={{
                    fontSize: 10,
                    color: 'var(--text-ghost)',
                    background: 'none',
                    border: '1px solid var(--border-light)',
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

          {/* Appearance */}
          <div className="settings-section">
            <div className="settings-section-label">Appearance</div>
            <SettingRow label="Theme">
              <OptionGroup
                value={settings.theme}
                options={[
                  { value: 'system', label: 'Auto' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
                onChange={(v) => set('theme', v)}
              />
            </SettingRow>
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

          {/* Editor */}
          <div className="settings-section">
            <div className="settings-section-label">Editor</div>
            <SettingRow label="Auto-scroll">
              <OptionGroup
                value={settings.typewriterScroll}
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'typewriter', label: 'Typewriter' },
                ]}
                onChange={(v) => set('typewriterScroll', v)}
              />
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

          {/* Contact Us */}
          <div className="settings-section">
            <div className="settings-section-label">Contact Us</div>
            {contactSent ? (
              <div style={{
                fontSize: 12,
                color: 'var(--color-still)',
                lineHeight: 1.5,
                padding: '8px 0',
              }}>
                Message sent — thank you!
              </div>
            ) : (
              <>
                <textarea
                  value={contactMessage}
                  onChange={(e) => {
                    setContactMessage(e.target.value)
                    setContactError(null)
                  }}
                  disabled={contactSending}
                  placeholder="Your message..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12,
                    lineHeight: 1.5,
                    background: 'var(--surface-primary)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    resize: 'vertical',
                    marginBottom: 6,
                  }}
                />
                {contactError && (
                  <div style={{
                    fontSize: 11,
                    color: 'var(--color-tender)',
                    marginBottom: 6,
                  }}>
                    {contactError}
                  </div>
                )}
                <button
                  onClick={async () => {
                    if (!contactMessage.trim() || contactSending) return
                    setContactSending(true)
                    setContactError(null)
                    try {
                      await submitContactMessage(contactMessage)
                      setContactSent(true)
                      setContactMessage('')
                    } catch (err) {
                      setContactError(err instanceof Error ? err.message : 'Failed to send')
                    } finally {
                      setContactSending(false)
                    }
                  }}
                  disabled={!contactMessage.trim() || contactSending}
                  style={{
                    fontSize: 11,
                    fontFamily: "'Inter', sans-serif",
                    color: contactMessage.trim() ? 'var(--bg-primary)' : 'var(--text-ghost)',
                    background: contactMessage.trim() ? 'var(--text-primary)' : 'var(--border-light)',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 12px',
                    cursor: contactMessage.trim() && !contactSending ? 'pointer' : 'default',
                    width: '100%',
                    opacity: contactSending ? 0.6 : 1,
                  }}
                >
                  {contactSending ? 'Sending...' : 'Send'}
                </button>
              </>
            )}
          </div>

          {/* Data */}
          <div className="settings-section">
            <div className="settings-section-label">Data</div>
            <button
              onClick={() => { trackEvent('export_data'); exportAllData() }}
              style={{ ...dataButtonBase, color: 'var(--text-primary)', marginBottom: 6 }}
            >
              Export all data
            </button>
            <button
              onClick={() => setPolicyOpen(true)}
              style={{ ...dataButtonBase, color: 'var(--text-secondary)', marginBottom: 6 }}
            >
              Privacy &amp; Terms
            </button>
            <button
              onClick={() => setDeleteOpen(true)}
              style={{
                ...dataButtonBase,
                color: 'var(--color-tender)',
                borderColor: 'var(--color-tender)',
              }}
            >
              Delete account
            </button>
          </div>
          <Suspense fallback={null}>
            {policyOpen && <PolicyModal isOpen={policyOpen} onClose={() => setPolicyOpen(false)} />}
            {deleteOpen && <DeleteAccountModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} />}
          </Suspense>
        </div>
      )}
    </div>
  )
}
