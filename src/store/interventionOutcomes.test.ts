import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterventionOutcome, SessionMessage } from '../types'

const get = vi.hoisted(() => vi.fn<() => Promise<InterventionOutcome | undefined>>())
const add = vi.hoisted(() => vi.fn(async () => {}))
const update = vi.hoisted(() => vi.fn(async () => {}))
const link = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('./db', () => ({
  db: { interventionOutcomes: { get, add, update } },
}))
vi.mock('./personalScience', () => ({ linkResearchOutcome: link }))

import { writeAmbientTurnOutcome } from './interventionOutcomes'

const companion: SessionMessage = {
  id: 'a1', speaker: 'therapist', partId: null, partName: null,
  content: 'What feels most alive in that?', timestamp: 1, phase: 'exploration',
  isEmergence: false, surface: 'talk', responseMode: 'reflect', researchEventId: 'r1',
}
const writer: SessionMessage = {
  id: 'u2', speaker: 'user', partId: null, partName: null,
  content: 'The choice I keep avoiding.', timestamp: 2, phase: 'exploration', isEmergence: false,
}

describe('writeAmbientTurnOutcome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    get.mockResolvedValue(undefined)
  })

  it('stores a deterministic, linked ambient outcome without transcript text', async () => {
    await writeAmbientTurnOutcome(companion, writer, 's1', {
      fit: 'landed', movement: 'deepened', agency: 'more', confidence: 'high',
      state: 'open', capacity: 'stay', need: 'perspective',
    })

    expect(add).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ambient-a1-u2', sessionId: 's1', sourceId: 'a1', researchEventId: 'r1',
      assessmentSource: 'ambient_turn', assessedUserMessageId: 'u2', immediate: 'helped',
      ambientFit: 'landed', ambientMovement: 'deepened', ambientAgency: 'more',
      ambientConfidence: 'high', agency: 'more', evaluatorModel: 'gpt-5.5',
    }))
    const stored = add.mock.calls[0][0] as Record<string, unknown>
    expect(stored).not.toHaveProperty('content')
    expect(link).toHaveBeenCalledWith('r1', 'ambient-a1-u2')
  })

  it('updates the same turn pair idempotently and leaves unclear fit unrated', async () => {
    get.mockResolvedValue({ id: 'ambient-a1-u2' } as InterventionOutcome)
    await writeAmbientTurnOutcome(companion, writer, 's1', {
      fit: 'unclear', movement: 'unclear', agency: 'unclear', confidence: 'low',
      state: 'unclear', capacity: 'unclear', need: 'unclear',
    })

    expect(add).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('ambient-a1-u2', expect.not.objectContaining({ immediate: expect.anything() }))
  })
})
