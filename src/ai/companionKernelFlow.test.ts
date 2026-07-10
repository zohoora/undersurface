import { describe, expect, it } from 'vitest'
import { buildTherapistSystemPrompt } from './therapistPrompts'

describe('companion kernel channel flow', () => {
  it('shares durable context between Talk and Voice', () => {
    const continuity = {
      phase: 'deepening' as const,
      recentSessionNotes: [{ note: 'The job decision remains open.', date: Date.now() }],
      activeValues: [{ name: 'freedom', description: 'having room to choose' }],
    }
    const talk = buildTherapistSystemPrompt({ ...continuity, channel: 'web' })
    const voice = buildTherapistSystemPrompt({ ...continuity, channel: 'voice' })
    expect(talk).toContain('The job decision remains open.')
    expect(voice).toContain('The job decision remains open.')
    expect(talk).toContain('having room to choose')
    expect(voice).toContain('having room to choose')
  })

  it('enforces voice capabilities even if a caller requests web-only mechanics', () => {
    const voice = buildTherapistSystemPrompt({
      channel: 'voice',
      phase: 'closing',
      isFirstTurn: false,
      allowRecommendations: true,
      includeRiskPreamble: true,
      intentionOffer: true,
      promiseInvite: true,
      allowPresence: true,
      partProposal: { id: 'part-1', tentativeName: 'planner', description: 'plans', quote: 'I plan' },
      valueProposal: { id: 'value-1', tentativeName: 'freedom', description: 'choice', quote: 'I need room' },
      duePromises: [{ id: 'promise-1', text: 'ask about the interview' }],
    })
    expect(voice).toContain('CURRENT CHANNEL: live voice')
    expect(voice).not.toContain('<<RISK:0>>')
    expect(voice).not.toContain('#switch:')
    expect(voice).not.toContain('#offer-intention')
    expect(voice).not.toContain('#promise')
    expect(voice).not.toContain('#presence')
    expect(voice).not.toContain('#propose-part')
    expect(voice).not.toContain('#propose-value')
    expect(voice).not.toContain('#kept-promise')
    expect(voice).toContain('cannot record a promise as delivered')
  })
})
