import { useEffect, useState } from 'react'
import {
  createSmsLinkCode,
  getSmsStatus,
  unlinkSms,
  type SmsLinkCodeResult,
  type SmsStatus,
} from '../../api/accountApi'
import { useTranslation } from '../../i18n'
import { FieldWindowSettings } from './FieldWindowSettings'

const buttonStyle = {
  fontSize: 11,
  fontFamily: "'Inter', sans-serif",
  background: 'none',
  border: '1px solid var(--border-subtle)',
  borderRadius: 4,
  padding: '6px 12px',
  cursor: 'pointer',
  width: '100%',
} as const

function interpolate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  )
}

export function SmsSettingsSection({ isOpen }: { isOpen: boolean }) {
  const t = useTranslation()
  const [status, setStatus] = useState<SmsStatus | null>(null)
  const [linkCode, setLinkCode] = useState<SmsLinkCodeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setLoading(true)
    setError(false)
    getSmsStatus()
      .then(next => { if (!cancelled) setStatus(next) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !linkCode || status?.linked) return
    const poll = window.setInterval(() => {
      if (Date.now() >= linkCode.expiresAt) {
        window.clearInterval(poll)
        setLinkCode(null)
        return
      }
      void getSmsStatus().then(next => {
        setStatus(next)
        if (next.linked) setLinkCode(null)
      }).catch(() => {})
    }, 3000)
    return () => window.clearInterval(poll)
  }, [isOpen, linkCode, status?.linked])

  const handleCreateCode = async () => {
    if (loading) return
    setLoading(true)
    setError(false)
    try {
      const result = await createSmsLinkCode()
      setLinkCode(result)
      setStatus(current => current ?? {
        linked: false,
        phoneNumber: result.phoneNumber,
        phoneNumberE164: result.phoneNumberE164,
      })
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  const handleUnlink = async () => {
    if (unlinking) return
    setUnlinking(true)
    setError(false)
    try {
      await unlinkSms()
      const next = await getSmsStatus()
      setStatus(next)
      setLinkCode(null)
    } catch {
      setError(true)
    } finally {
      setUnlinking(false)
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-label">{t['settings.sms.title']}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
        {t['settings.sms.description']}
      </div>

      {loading && !status ? (
        <div style={{ fontSize: 11, color: 'var(--text-ghost)' }}>{t['settings.sms.loading']}</div>
      ) : status?.linked ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--color-still)' }}>
            {interpolate(t['settings.sms.connected'], { last4: status.phoneLast4 ?? '' })}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-ghost)', lineHeight: 1.5 }}>
            {t['settings.sms.guidance']}
          </div>
          <FieldWindowSettings isOpen={isOpen} />
          <button
            type="button"
            onClick={() => void handleUnlink()}
            disabled={unlinking}
            style={{ ...buttonStyle, color: 'var(--color-tender)', borderColor: 'var(--color-tender)' }}
          >
            {unlinking ? t['settings.sms.unlinking'] : t['settings.sms.unlink']}
          </button>
        </div>
      ) : linkCode ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {interpolate(t['settings.sms.linkInstruction'], {
              code: linkCode.code,
              number: linkCode.phoneNumber,
            })}
          </div>
          <div style={{
            fontFamily: 'monospace',
            fontSize: 20,
            letterSpacing: 3,
            textAlign: 'center',
            padding: '8px 10px',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            color: 'var(--text-primary)',
          }}>
            {linkCode.code}
          </div>
          <a
            href={`sms:${linkCode.phoneNumberE164}?&body=${encodeURIComponent(`LINK ${linkCode.code}`)}`}
            style={{ ...buttonStyle, color: 'var(--text-primary)', textAlign: 'center', textDecoration: 'none' }}
          >
            {t['settings.sms.textNow']}
          </a>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void handleCreateCode()}
          disabled={loading}
          style={{ ...buttonStyle, color: 'var(--text-primary)' }}
        >
          {loading ? t['settings.sms.creating'] : t['settings.sms.createCode']}
        </button>
      )}

      {error && (
        <div style={{ fontSize: 11, color: 'var(--color-tender)', marginTop: 7 }}>
          {t['settings.sms.error']}
        </div>
      )}
    </div>
  )
}
