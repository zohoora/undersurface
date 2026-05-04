import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Part } from '../types'

vi.mock('../store/settings', () => ({
  getSettings: vi.fn(() => ({ language: 'en', timezone: 'America/Los_Angeles' })),
}))
vi.mock('../i18n', () => ({
  getLanguageCode: vi.fn(() => 'en'),
  getLLMLanguageName: vi.fn(() => 'English'),
}))

import { buildInteractionReply, buildDisagreementPrompt } from './partPrompts'

function makePart(overrides: Partial<Part> = {}): Part {
  return {
    id: 'tender',
    name: 'The Tender',
    color: '#B58548',
    colorLight: '#B5854825',
    ifsRole: 'exile',
    voiceDescription: 'Quiet, honest, sometimes painfully direct about feelings.',
    concern: 'Being seen, vulnerability, old wounds.',
    systemPrompt: 'You are The Tender. SAFETY rules baked in via SHARED_INSTRUCTIONS.',
    isSeeded: true,
    createdAt: Date.now(),
    ...overrides,
  } as Part
}

describe('buildInteractionReply — grounding contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('omits the grounding directive when isGrounding is false', () => {
    const messages = buildInteractionReply(
      makePart(),
      'original part thought',
      'user response text',
      'current entry text',
      { isGrounding: false },
    )

    const systemContent = messages[0].content
    expect(systemContent).not.toMatch(/in distress/i)
    expect(systemContent).not.toMatch(/be gentle, slow, grounding/i)
  })

  it('omits the grounding directive when no options passed', () => {
    const messages = buildInteractionReply(
      makePart(),
      'original part thought',
      'user response text',
      'current entry text',
    )

    expect(messages[0].content).not.toMatch(/in distress/i)
  })

  it('injects the grounding directive when isGrounding is true', () => {
    const messages = buildInteractionReply(
      makePart(),
      'original part thought',
      'user response text',
      'current entry text',
      { isGrounding: true },
    )

    const systemContent = messages[0].content
    expect(systemContent).toMatch(/in distress/i)
    expect(systemContent).toMatch(/be gentle, slow, grounding/i)
    expect(systemContent).toMatch(/offer presence, safety, and calm/i)
  })

  it('preserves the part system prompt content alongside the grounding directive', () => {
    const part = makePart({ systemPrompt: 'You are The Tender. Custom voice instructions.' })

    const messages = buildInteractionReply(
      part,
      'thought',
      'response',
      'text',
      { isGrounding: true },
    )

    const systemContent = messages[0].content
    expect(systemContent).toContain('You are The Tender. Custom voice instructions.')
    expect(systemContent).toMatch(/in distress/i)
  })
})

describe('buildDisagreementPrompt — grounding contract', () => {
  it('omits the grounding directive when isGrounding is false', () => {
    const messages = buildDisagreementPrompt(
      makePart(),
      'The Spark',
      'original thought',
      'current text',
      { isGrounding: false },
    )

    expect(messages[0].content).not.toMatch(/in distress/i)
  })

  it('injects the grounding directive when isGrounding is true', () => {
    const messages = buildDisagreementPrompt(
      makePart(),
      'The Spark',
      'original thought',
      'current text',
      { isGrounding: true },
    )

    expect(messages[0].content).toMatch(/in distress/i)
    expect(messages[0].content).toMatch(/be gentle, slow, grounding/i)
  })
})
