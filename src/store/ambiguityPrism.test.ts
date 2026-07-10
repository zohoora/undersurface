import { beforeEach, describe, expect, it, vi } from 'vitest'

let existingOutcome: Record<string, unknown> | undefined
const outcomeAdd = vi.fn(async () => {})
const outcomeUpdate = vi.fn(async () => {})
const bulkPut = vi.fn(async () => {})
const linkResearchOutcome = vi.fn(async () => {})

vi.mock('./db', () => ({
  db: {
    interventionOutcomes: { get: async () => existingOutcome, add: outcomeAdd, update: outcomeUpdate },
    researchEvents: { get: async () => ({ context: { state: 'looping', need: 'perspective' } }) },
    livingHypotheses: { bulkPut },
  },
}))
vi.mock('./personalScience', () => ({ linkResearchOutcome }))

const { recordAmbiguityPrismFeedback } = await import('./ambiguityPrism')

const message = {
  id: 'm1', speaker: 'therapist', partId: null, partName: null, content: 'Several possibilities.',
  timestamp: 1, phase: 'exploration', isEmergence: false, surface: 'talk',
  responseMode: 'reflect', researchEventId: 'r1', researchArm: 'ambiguity_prism',
} as const

beforeEach(() => {
  existingOutcome = undefined
  vi.clearAllMocks()
})

describe('ambiguity prism persistence', () => {
  it('stores reviewed outcomes and only writer-governed hypothesis states', async () => {
    await recordAmbiguityPrismFeedback({
      message,
      sessionId: 's1',
      hypotheses: [
        { id: 'h1', text: 'Fear of disappointing them.', fit: 'fits' },
        { id: 'h2', text: 'Anger translated into duty.', fit: 'maybe' },
        { id: 'h3', text: 'Mostly exhausted.', fit: 'not_this' },
      ],
      noneFit: false,
      betterFrame: 'I am buying time because the choice matters.',
      correctionEffort: 'some_work',
    })
    expect(outcomeAdd).toHaveBeenCalledWith(expect.objectContaining({
      prismFeedback: expect.objectContaining({ correctionEffort: 'some_work' }),
    }))
    expect(linkResearchOutcome).toHaveBeenCalledWith('r1', 'message-m1')
    expect(bulkPut).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'hypothesis-m1-h1', status: 'confirmed', source: 'prism' }),
      expect.objectContaining({ id: 'hypothesis-m1-h2', status: 'candidate' }),
      expect.objectContaining({ id: 'hypothesis-m1-h3', status: 'contested' }),
      expect.objectContaining({ id: 'hypothesis-m1-writer', status: 'confirmed', source: 'writer_rewrite' }),
    ]))
  })

  it('merges into an existing immediate outcome instead of erasing it', async () => {
    existingOutcome = { immediate: 'helped' }
    await recordAmbiguityPrismFeedback({
      message, sessionId: 's1', hypotheses: [{ id: 'h1', text: 'No fit.', fit: 'not_this' }], noneFit: true,
    })
    expect(outcomeUpdate).toHaveBeenCalledWith('message-m1', expect.objectContaining({ prismFeedback: expect.any(Object) }))
    expect(outcomeAdd).not.toHaveBeenCalled()
  })
})
