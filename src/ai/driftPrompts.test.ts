import { describe, it, expect } from 'vitest'
import { SAFETY_RULES } from './therapistPrompts'
import { UNTRUSTED_CONTENT_PREAMBLE } from './promptSafety'
import {
  DRIFT_DECLINE_LOOP,
  INTERWEAVE_FRAGMENTS,
  buildDriftSystemPrompt,
  buildDriftVoiceInstructions,
} from './driftPrompts'

describe('buildDriftSystemPrompt (text)', () => {
  it('embeds SAFETY_RULES verbatim and the untrusted-content preamble', () => {
    const p = buildDriftSystemPrompt({ interweave: null })
    expect(p).toContain(SAFETY_RULES)
    expect(p).toContain(UNTRUSTED_CONTENT_PREAMBLE)
  })

  it('never names EMDR', () => {
    expect(buildDriftSystemPrompt({ interweave: null })).not.toMatch(/emdr/i)
    expect(buildDriftSystemPrompt({ interweave: 'parts' })).not.toMatch(/emdr/i)
  })

  it('always includes the decline-the-loop rule', () => {
    expect(buildDriftSystemPrompt({ interweave: null })).toContain(DRIFT_DECLINE_LOOP)
  })

  it('includes exactly the selected interweave fragment and none of the others', () => {
    const p = buildDriftSystemPrompt({ interweave: 'rain' })
    expect(p).toContain(INTERWEAVE_FRAGMENTS.rain)
    expect(p).not.toContain(INTERWEAVE_FRAGMENTS.defusion)
    expect(p).not.toContain(INTERWEAVE_FRAGMENTS.parts)
    expect(p).not.toContain(INTERWEAVE_FRAGMENTS.focusing)
  })

  it('includes no interweave fragment when interweave is null', () => {
    const p = buildDriftSystemPrompt({ interweave: null })
    for (const frag of Object.values(INTERWEAVE_FRAGMENTS)) expect(p).not.toContain(frag)
  })

  it('wraps user part names as untrusted content', () => {
    const p = buildDriftSystemPrompt({ interweave: null, userPartNames: ['The Critic'] })
    expect(p).toContain('<user_part_names>The Critic</user_part_names>')
  })

  it('renders hrvContext as corroboration with a never-state-as-fact rule', () => {
    const p = buildDriftSystemPrompt({ interweave: null, hrvContext: 'their body may be settling' })
    expect(p).toContain('their body may be settling')
    expect(p).toMatch(/never state/i)
  })

  it('contains no numeric distress scale', () => {
    expect(buildDriftSystemPrompt({ interweave: 'rain' })).not.toMatch(/\b0\s*(–|-|to)\s*10\b/)
  })
})

describe('buildDriftVoiceInstructions', () => {
  it('embeds SAFETY_RULES and the untrusted-content preamble', () => {
    const p = buildDriftVoiceInstructions({})
    expect(p).toContain(SAFETY_RULES)
    expect(p).toContain(UNTRUSTED_CONTENT_PREAMBLE)
  })

  it('never names EMDR', () => {
    expect(buildDriftVoiceInstructions({})).not.toMatch(/emdr/i)
  })

  it('teaches all four interweave moves with the at-most-one rule', () => {
    const p = buildDriftVoiceInstructions({})
    expect(p).toContain(INTERWEAVE_FRAGMENTS.rain)
    expect(p).toContain(INTERWEAVE_FRAGMENTS.defusion)
    expect(p).toContain(INTERWEAVE_FRAGMENTS.parts)
    expect(p).toContain(INTERWEAVE_FRAGMENTS.focusing)
    expect(p).toContain('at most one')
  })

  it('includes the decline-the-loop rule', () => {
    expect(buildDriftVoiceInstructions({})).toContain(DRIFT_DECLINE_LOOP)
  })

  it('pins one-way, app-directed spoken guidance and the verbatim-cue directive', () => {
    const p = buildDriftVoiceInstructions({})
    expect(p).toContain('writer responds by tapping the screen')
    expect(p).toContain('Do not start a conversation')
    expect(p).toContain('word for word')
  })

  it('wraps user part names as untrusted content', () => {
    expect(buildDriftVoiceInstructions({ userPartNames: ['The Critic'] }))
      .toContain('<user_part_names>The Critic</user_part_names>')
  })

  it('contains no numeric distress scale', () => {
    expect(buildDriftVoiceInstructions({})).not.toMatch(/\b0\s*(–|-|to)\s*10\b/)
  })
})
