import { useTranslation, getLanguageCode } from '../i18n'

interface PolicyContentProps {
  section: 'privacy' | 'disclaimer' | 'both'
}

function PrivacyPolicy() {
  const t = useTranslation()
  return (
    <div>
      <h2 style={{ fontFamily: "'Spectral', serif", fontSize: 20, fontWeight: 400, marginBottom: 16, color: 'var(--text-primary)' }}>
        {t['policy.privacyTitle']}
      </h2>

      <Section title={t['policy.whatWeStore']}>
        {t['policy.whatWeStoreBody']}
      </Section>

      <Section title={t['policy.howAiWorks']}>
        {t['policy.howAiWorksBody']}
      </Section>

      <Section title={t['policy.whoCanSee']}>
        {t['policy.whoCanSeeBody']}
      </Section>

      <Section title={t['policy.devicePreferences']}>
        {t['policy.devicePreferencesBody']}
      </Section>

      <Section title={t['policy.dataRetention']}>
        {t['policy.dataRetentionBody']}
      </Section>

      <Section title={t['policy.yourChoices']}>
        <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
          <li style={{ marginBottom: 6 }}>{t['policy.choiceExport']}</li>
          <li style={{ marginBottom: 6 }}>{t['policy.choiceDelete']}</li>
          <li>{t['policy.choiceSignOut']}</li>
        </ul>
      </Section>
    </div>
  )
}

function TherapeuticDisclaimer() {
  const t = useTranslation()
  const isEnglish = getLanguageCode() === 'en'

  return (
    <div>
      <h2 style={{ fontFamily: "'Spectral', serif", fontSize: 20, fontWeight: 400, marginBottom: 16, color: 'var(--text-primary)' }}>
        {t['policy.disclaimerTitle']}
      </h2>

      <Section title={t['policy.notTherapy']}>
        {t['policy.notTherapyBody']}
      </Section>

      <Section title={t['policy.groundingNotClinical']}>
        {t['policy.groundingNotClinicalBody']}
      </Section>

      <Section title={t['policy.needHelp']}>
        <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
          {isEnglish && (
            <>
              <li style={{ marginBottom: 6 }}>
                <strong>{t['crisis.988.name']}</strong> — {t['crisis.988.action']}{' '}
                <a href="tel:988" style={{ color: 'var(--color-still)', textDecoration: 'underline', textUnderlineOffset: 3 }}>988</a>
              </li>
              <li style={{ marginBottom: 6 }}>
                <strong>{t['crisis.textLine.name']}</strong> — {t['crisis.textLine.action']}{' '}
                <a href="sms:741741&body=HOME" style={{ color: 'var(--color-still)', textDecoration: 'underline', textUnderlineOffset: 3 }}>741741</a>
              </li>
            </>
          )}
          <li>
            {isEnglish ? <strong>{t['crisis.international']}</strong> : <strong>{t['crisis.internationalOnly']}</strong>}{' '}
            <a
              href="https://findahelpline.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-still)', textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              {t['crisis.findHelpline']}
            </a>
          </li>
        </ul>
      </Section>

      <Section title={t['policy.recommendation']}>
        {t['policy.recommendationBody']}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-secondary)',
        marginBottom: 6,
      }}>
        {title}
      </h3>
      <div style={{
        fontFamily: "'Inter', sans-serif",
        fontSize: 13,
        lineHeight: 1.7,
        color: 'var(--text-secondary)',
      }}>
        {children}
      </div>
    </div>
  )
}

export function PolicyContent({ section }: PolicyContentProps) {
  return (
    <div>
      {(section === 'privacy' || section === 'both') && <PrivacyPolicy />}
      {section === 'both' && <hr style={{ border: 'none', borderTop: '1px solid var(--border-light)', margin: '28px 0' }} />}
      {(section === 'disclaimer' || section === 'both') && <TherapeuticDisclaimer />}
    </div>
  )
}
