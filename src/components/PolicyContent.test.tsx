import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import en from '../i18n/translations/en'
import { PolicyContent } from './PolicyContent'

describe('PolicyContent', () => {
  it('renders every privacy-policy section, in order, with the last-updated line', () => {
    const { container } = render(<PolicyContent section="privacy" />)
    expect(screen.getByText(en['policy.lastUpdated'])).toBeInTheDocument()
    const headings = [...container.querySelectorAll('h3')].map(h => h.textContent)
    expect(headings).toEqual([
      en['policy.whatWeStore'],
      en['policy.howAiWorks'],
      en['policy.voice'],
      en['policy.sms'],
      en['policy.biometrics'],
      en['policy.whoCanSee'],
      en['policy.providers'],
      en['policy.devicePreferences'],
      en['policy.dataRetention'],
      en['policy.yourChoices'],
    ])
    for (const key of ['policy.voiceBody', 'policy.smsBody', 'policy.biometricsBody', 'policy.providersBody'] as const) {
      expect(screen.getByText(en[key])).toBeInTheDocument()
    }
  })
})
