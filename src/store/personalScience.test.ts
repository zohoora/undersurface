import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersonalProtocol } from '../types'

const update = vi.fn(async () => {})
vi.mock('./db', () => ({ db: { personalProtocols: { update } } }))

const {
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
