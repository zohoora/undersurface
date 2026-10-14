import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonalProtocol, ResearchEvent } from '../types'

const update = vi.fn(async () => {})
const researchGet = vi.hoisted(() => vi.fn<(id: string) => Promise<ResearchEvent | undefined>>())
const researchDeleteFields = vi.hoisted(() => vi.fn(async () => {}))
const outcomeDelete = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./db', () => ({
  db: {
    personalProtocols: { update },
    researchEvents: { get: researchGet, deleteFields: researchDeleteFields },
    interventionOutcomes: { delete: outcomeDelete },
  },
}))

const {
  discardSurfaceArcOutcome,
  advanceTransferPractice,
  pauseTransferPractice,
  restartTransferPractice,
  resumeTransferPractice,
  startTransferPractice,
} = await import('./personalScience')

const protocol: PersonalProtocol = {
  id: 'p1', findingKey: 'f1', title: 'Concrete first', protocolId: 'response-grammar-v1',
  preferredArm: 'make_concrete', evidenceEventIds: ['r1'], confidence: 'early',
  status: 'active', createdAt: 1, updatedAt: 1,
}

describe('writer-controlled transfer transitions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts, pauses, resumes, and restarts without automatic advancement', async () => {
    const started = await startTransferPractice(protocol)
    expect(started).toMatchObject({ transferStatus: 'learning', transferLevel: 'companion_led' })
    const paused = await pauseTransferPractice(started)
    expect(paused.transferStatus).toBe('paused')
    const resumed = await resumeTransferPractice(paused)
    expect(resumed).toMatchObject({ transferStatus: 'learning', transferLevel: 'companion_led' })
    const restarted = await restartTransferPractice({ ...resumed, transferLevel: 'minimal_cue' })
    expect(restarted).toMatchObject({ transferStatus: 'learning', transferLevel: 'companion_led' })
  })

  it('advances one adjacent rung at a time and graduates only from the final comparison', async () => {
    const userFirst = await advanceTransferPractice({ ...protocol, transferStatus: 'learning', transferLevel: 'companion_led' })
    expect(userFirst).toMatchObject({ transferStatus: 'learning', transferLevel: 'user_first' })
    const minimal = await advanceTransferPractice(userFirst)
    expect(minimal).toMatchObject({ transferStatus: 'learning', transferLevel: 'minimal_cue' })
    const graduated = await advanceTransferPractice(minimal)
    expect(graduated).toMatchObject({ transferStatus: 'graduated', transferLevel: 'independent' })
    expect(update).toHaveBeenCalledTimes(3)
  })
})

describe('discardSurfaceArcOutcome (grounding interrupts a surface arc)', () => {
  beforeEach(() => vi.clearAllMocks())

  const arcEvent = (outcomeId?: string): ResearchEvent => ({
    id: 'research-arc-o1', protocolId: 'surface-choreography-v1', protocolVersion: 1,
    assignmentKind: 'observational', status: 'delivered', source: 'talk', sessionId: 's1',
    eligibilityPoint: 'user-chosen-surface-arc', assignmentSeed: 'o1', assignedArm: 'journal_arc',
    provider: 'deterministic', promptVersion: 'personal-science-v1', appVersion: 'test',
    createdAt: 1, updatedAt: 1, ...(outcomeId ? { outcomeId } : {}),
  } as ResearchEvent)

  it('deletes the outcome row and clears the event\'s outcomeId so nothing dangles', async () => {
    researchGet.mockResolvedValue(arcEvent('o1'))
    await discardSurfaceArcOutcome('o1', 'research-arc-o1')
    expect(outcomeDelete).toHaveBeenCalledWith('o1')
    expect(researchDeleteFields).toHaveBeenCalledWith('research-arc-o1', ['outcomeId'], expect.objectContaining({ updatedAt: expect.any(Number) }))
  })

  it('leaves an event that already points at a different outcome alone', async () => {
    researchGet.mockResolvedValue(arcEvent('o2'))
    await discardSurfaceArcOutcome('o1', 'conductor-u4')
    expect(outcomeDelete).toHaveBeenCalledWith('o1')
    expect(researchDeleteFields).not.toHaveBeenCalled()
  })

  it('is a no-op on the event when it is missing', async () => {
    researchGet.mockResolvedValue(undefined)
    await discardSurfaceArcOutcome('o1', 'research-arc-o1')
    expect(researchDeleteFields).not.toHaveBeenCalled()
  })
})
