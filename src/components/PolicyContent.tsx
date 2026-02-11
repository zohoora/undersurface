interface PolicyContentProps {
  section: 'privacy' | 'disclaimer' | 'both'
}

function PrivacyPolicy() {
  return (
    <div>
      <h2 style={{ fontFamily: "'Spectral', serif", fontSize: 20, fontWeight: 400, marginBottom: 16, color: 'var(--text-primary)' }}>
        Privacy Policy
      </h2>

      <Section title="What we store">
        Your diary entries, inner voices (parts), memories, thoughts, emotional patterns, entry summaries,
        and user profile are stored in our database, tied to your Google account. This data is what makes
        your inner voices learn and grow with you over time.
      </Section>

      <Section title="How AI works here">
        When you write, your text is sent to a third-party AI service (OpenRouter) to generate responses
        from your inner voices. The AI provider processes your writing to create responses but does not
        permanently store your content.
      </Section>

      <Section title="Who can see your data">
        Administrators can view user data for support and to improve the experience. We do not sell or
        share your data with anyone else.
      </Section>

      <Section title="Device preferences">
        Settings like your theme, scroll behavior, and autocorrect preferences are stored locally on your
        device (in localStorage). These never leave your browser.
      </Section>

      <Section title="Data retention">
        Your data is stored for as long as your account exists. You can export all your data or delete
        your account at any time from Settings.
      </Section>

      <Section title="Your choices">
        <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
          <li style={{ marginBottom: 6 }}>Export your data anytime (Settings &rarr; Export all data)</li>
          <li style={{ marginBottom: 6 }}>Delete your account and all data (Settings &rarr; Delete account)</li>
          <li>Sign out to end your session</li>
        </ul>
      </Section>
    </div>
  )
}

function TherapeuticDisclaimer() {
  return (
    <div>
      <h2 style={{ fontFamily: "'Spectral', serif", fontSize: 20, fontWeight: 400, marginBottom: 16, color: 'var(--text-primary)' }}>
        Therapeutic Disclaimer
      </h2>

      <Section title="This is not therapy">
        UnderSurface is a writing tool, not a therapeutic service. The inner voices are AI writing
        companions — they are not therapists, counselors, or clinical tools. They cannot diagnose, treat, or replace professional mental health care.
      </Section>

      <Section title="Grounding mode is not clinical">
        When the app detects distress in your writing, it may shift to a calming mode. This is a
        comfort feature, not a clinical intervention.
      </Section>

      <Section title="If you need help now">
        <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
          <li style={{ marginBottom: 6 }}>
            <strong>988 Suicide &amp; Crisis Lifeline</strong> — Call or text{' '}
            <a href="tel:988" style={{ color: 'var(--color-still)', textDecoration: 'underline', textUnderlineOffset: 3 }}>988</a>
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Crisis Text Line</strong> — Text HOME to{' '}
            <a href="sms:741741&body=HOME" style={{ color: 'var(--color-still)', textDecoration: 'underline', textUnderlineOffset: 3 }}>741741</a>
          </li>
          <li>
            <strong>Outside the US?</strong>{' '}
            <a
              href="https://findahelpline.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-still)', textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              findahelpline.com
            </a>
          </li>
        </ul>
      </Section>

      <Section title="Our recommendation">
        We encourage using UnderSurface alongside professional support, not instead of it. Writing with
        inner voices can be a meaningful companion to your process — but it is not a substitute for
        the care of a trained professional.
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
