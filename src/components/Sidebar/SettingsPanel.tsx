import { useState, useEffect, lazy, Suspense } from 'react'
import { useSettings, updateSettings } from '../../store/settings'
import type { AppSettings } from '../../store/settings'
import { useGlobalConfig } from '../../store/globalConfig'
import { useAuth } from '../../auth/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { exportAllData } from '../../store/db'
import { submitContactMessage } from '../../api/accountApi'
import { trackEvent } from '../../services/analytics'
import { useTranslation, SUPPORTED_LANGUAGES, getLanguageCode } from '../../i18n'

const TIMEZONE_VALUES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Halifax',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Helsinki',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const

function getTimezoneName(iana: string, locale: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: iana,
      timeZoneName: 'long',
    }).formatToParts(new Date())
    return parts.find(p => p.type === 'timeZoneName')?.value ?? iana
  } catch {
    return iana
  }
}

const PolicyModal = lazy(() => import('../PolicyModal').catch(() => { window.location.reload(); return new Promise(() => {}) }))
const DeleteAccountModal = lazy(() => import('../DeleteAccountModal').catch(() => { window.location.reload(); return new Promise(() => {}) }))

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
  const globalConfig = useGlobalConfig()
  const { user, signOut } = useAuth()
  const t = useTranslation()
  useTheme()
  const [policyOpen, setPolicyOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [contactMessage, setContactMessage] = useState('')
  const [contactSending, setContactSending] = useState(false)
  const [contactSent, setContactSent] = useState(false)
  const [contactError, setContactError] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState<{ id: string; name: string; createdAt: number } | null>(null)
  const [apiKeyLoading, setApiKeyLoading] = useState(true)
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)

  useEffect(() => {
    if (!contactSent) return
    const timer = setTimeout(() => setContactSent(false), 3000)
    return () => clearTimeout(timer)
  }, [contactSent])

  useEffect(() => {
    if (!user) return
    import('../../store/db').then(({ db }) => {
      db.apiKeys.toArray().then((keys) => {
        if (keys.length > 0) {
          const k = keys[0]
          setApiKey({
            id: k.id,
            name: k.name || 'Default',
            createdAt: k.createdAt,
          })
        }
        setApiKeyLoading(false)
      }).catch(() => setApiKeyLoading(false))
    })
  }, [user])

  const handleGenerateKey = async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    const rawKey = `us_${hex}`

    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))
    const hash = Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('')

    const keyId = crypto.randomUUID()
    const now = Date.now()
    const { db } = await import('../../store/db')
    await db.apiKeys.add({
      id: keyId,
      hash,
      name: 'Default',
      createdAt: now,
      lastUsedAt: null,
    })

    setApiKey({ id: keyId, name: 'Default', createdAt: now })
    setGeneratedKey(rawKey)
  }

  const handleRevokeKey = async () => {
    if (!apiKey) return
    const { db } = await import('../../store/db')
    await db.apiKeys.delete(apiKey.id)
    setApiKey(null)
    setGeneratedKey(null)
  }

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
        <span>{t['settings.title']}</span>
      </button>

      {isOpen && (
        <div className="settings-body">
          {/* Account */}
          {user && (
            <div className="settings-section">
              <div className="settings-section-label">{t['settings.account']}</div>
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
                  {t['settings.signOut']}
                </button>
              </div>
            </div>
          )}

          {/* Language */}
          <div className="settings-section">
            <div className="settings-section-label">{t['settings.language']}</div>
            <SettingRow label={t['settings.language']}>
              <select
                value={settings.language}
                onChange={(e) => set('language', e.target.value)}
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 11,
                  color: 'var(--text-primary)',
                  background: 'var(--surface-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 4,
                  padding: '3px 6px',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>{lang.nativeName}</option>
                ))}
              </select>
            </SettingRow>
          </div>

          {/* Timezone */}
          <div className="settings-section">
            <div className="settings-section-label">{t['settings.timezone']}</div>
            <SettingRow label={t['settings.timezone']}>
              <select
                value={settings.timezone}
                onChange={(e) => set('timezone', e.target.value)}
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 11,
                  color: 'var(--text-primary)',
                  background: 'var(--surface-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 4,
                  padding: '3px 6px',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                {TIMEZONE_VALUES.map((tz) => (
                  <option key={tz} value={tz}>{getTimezoneName(tz, getLanguageCode())}</option>
                ))}
              </select>
            </SettingRow>
          </div>

          {/* Appearance */}
          <div className="settings-section">
            <div className="settings-section-label">{t['settings.appearance']}</div>
            <SettingRow label={t['settings.theme']}>
              <OptionGroup
                value={settings.theme}
                options={[
                  { value: 'system', label: t['settings.themeAuto'] },
                  { value: 'light', label: t['settings.themeLight'] },
                  { value: 'dark', label: t['settings.themeDark'] },
                ]}
                onChange={(v) => set('theme', v)}
              />
            </SettingRow>
          </div>

          {/* Part Responsiveness */}
          <div className="settings-section">
            <div className="settings-section-label">{t['settings.responsiveness']}</div>
            <SettingRow label={t['settings.responseSpeed']}>
              <div className="settings-slider-row">
                <span className="settings-slider-label">{t['settings.slower']}</span>
                <input
                  type="range"
                  className="settings-slider"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={settings.responseSpeed}
                  onChange={(e) => set('responseSpeed', parseFloat(e.target.value))}
                />
                <span className="settings-slider-label">{t['settings.faster']}</span>
              </div>
            </SettingRow>
          </div>


          {/* AI Interactions — only show when admin has enabled features */}
          {(globalConfig?.features?.textHighlights === true || globalConfig?.features?.ghostText === true || globalConfig?.features?.bilateralStimulation === true) && (
            <div className="settings-section">
              <div className="settings-section-label">{t['settings.aiInteractions']}</div>
              {globalConfig?.features?.textHighlights === true && (
                <SettingRow label={t['settings.textHighlights']}>
                  <Toggle checked={settings.textHighlights} onChange={(v) => set('textHighlights', v)} />
                </SettingRow>
              )}
              {globalConfig?.features?.ghostText === true && (
                <SettingRow label={t['settings.ghostText']}>
                  <Toggle checked={settings.ghostText} onChange={(v) => set('ghostText', v)} />
                </SettingRow>
              )}
              {globalConfig?.features?.bilateralStimulation === true && (
                <SettingRow label={t['settings.bilateralStimulation']}>
                  <Toggle checked={settings.bilateralStimulation} onChange={(v) => set('bilateralStimulation', v)} />
                </SettingRow>
              )}
            </div>
          )}

          {/* Autocorrect — works in all languages via LLM */}
          <div className="settings-section">
            <div className="settings-section-label">{t['settings.autocorrect']}</div>
            <SettingRow label={t['settings.autocorrect']}>
              <Toggle checked={settings.autocorrect} onChange={(v) => { set('autocorrect', v); set('autoCapitalize', v) }} />
            </SettingRow>
          </div>

          {/* Developer */}
          <div className="settings-section">
            <div className="settings-section-label">Developer</div>
            {apiKeyLoading ? (
              <div style={{ fontSize: 11, color: 'var(--text-ghost)', padding: '4px 0' }}>
                Loading...
              </div>
            ) : generatedKey ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--color-tender)', lineHeight: 1.4 }}>
                  Copy this key now — it won't be shown again.
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    readOnly
                    value={generatedKey}
                    style={{
                      flex: 1,
                      fontFamily: 'monospace',
                      fontSize: 10,
                      padding: '6px 8px',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 4,
                      background: 'var(--surface-primary)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(generatedKey)
                      setKeyCopied(true)
                      setTimeout(() => setKeyCopied(false), 2000)
                    }}
                    style={{
                      fontSize: 10,
                      fontFamily: "'Inter', sans-serif",
                      padding: '4px 10px',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 4,
                      background: 'var(--surface-primary)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {keyCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <button
                  onClick={() => setGeneratedKey(null)}
                  style={{
                    fontSize: 11,
                    fontFamily: "'Inter', sans-serif",
                    color: 'var(--text-ghost)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    textAlign: 'left',
                  }}
                >
                  Done
                </button>
              </div>
            ) : apiKey ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  API key active — created{' '}
                  {new Date(apiKey.createdAt).toLocaleDateString()}
                </div>
                <button
                  onClick={handleRevokeKey}
                  style={{
                    ...dataButtonBase,
                    color: 'var(--color-tender)',
                    borderColor: 'var(--color-tender)',
                  }}
                >
                  Revoke Key
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-ghost)', lineHeight: 1.4 }}>
                  Generate an API key to connect AI agents to your diary via MCP.
                </div>
                <button
                  onClick={handleGenerateKey}
                  style={{
                    ...dataButtonBase,
                    color: 'var(--text-primary)',
                  }}
                >
                  Generate API Key
                </button>
              </div>
            )}
          </div>

          {/* Contact Us */}
          <div className="settings-section">
            <div className="settings-section-label">{t['settings.contactUs']}</div>
            {contactSent ? (
              <div style={{
                fontSize: 12,
                color: 'var(--color-still)',
                lineHeight: 1.5,
                padding: '8px 0',
              }}>
                {t['settings.contactSent']}
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
                  placeholder={t['settings.contactPlaceholder']}
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
                  {contactSending ? t['settings.contactSending'] : t['settings.contactSend']}
                </button>
              </>
            )}
          </div>

          {/* Data */}
          <div className="settings-section">
            <div className="settings-section-label">{t['settings.data']}</div>
            <button
              onClick={() => { trackEvent('export_data'); exportAllData() }}
              style={{ ...dataButtonBase, color: 'var(--text-primary)', marginBottom: 6 }}
            >
              {t['settings.exportAll']}
            </button>
            <button
              onClick={() => setPolicyOpen(true)}
              style={{ ...dataButtonBase, color: 'var(--text-secondary)', marginBottom: 6 }}
            >
              {t['settings.privacyTerms']}
            </button>
            <button
              onClick={() => setDeleteOpen(true)}
              style={{
                ...dataButtonBase,
                color: 'var(--color-tender)',
                borderColor: 'var(--color-tender)',
              }}
            >
              {t['settings.deleteAccount']}
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
