import { describe, expect, it } from 'vitest'
import { buildRoomInstructions } from './roomPrompts'

describe('buildRoomInstructions', () => {
  it('keeps Room organic and interruptible', () => {
    const prompt = buildRoomInstructions({
      companionInstructions: 'base companion',
      approach: 'listen_first',
      duration: 5,
      voiceDensity: 'sparse',
    })
    expect(prompt).toContain('same living companion')
    expect(prompt).toContain('interrupt at any moment')
    expect(prompt).toContain('never a meditation narrator')
    expect(prompt).toContain('Do not turn each response into a question')
    expect(prompt).toContain('base companion')
  })

  it('uses prior Room shapes as background rather than a script', () => {
    const prompt = buildRoomInstructions({
      companionInstructions: 'base companion',
      approach: 'lead_me',
      duration: 2,
      voiceDensity: 'present',
      roomHistory: ['listen_first, 5 minutes, sparse voice, ocean; controls used: less_voice'],
    })
    expect(prompt).toContain('Recent Room preferences')
    expect(prompt).toContain('Their present choice always wins')
    expect(prompt).toContain('less_voice')
  })
})
