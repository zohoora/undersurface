import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Part, IFSRole } from '../types'

const globalConfigMock = vi.fn(() => null as Record<string, unknown> | null)
vi.mock('../store/globalConfig', () => ({
  getGlobalConfig: () => globalConfigMock(),
}))

const chatCompletionMock = vi.fn()
vi.mock('../ai/openrouter', () => ({
  chatCompletion: (...a: unknown[]) => chatCompletionMock(...a),
}))

vi.mock('../ai/promptSafety', () => ({
  wrapUserContent: (s: string) => `[diary]${s}[/diary]`,
  sanitizeForPrompt: (s: string) => s,
  UNTRUSTED_CONTENT_PREAMBLE: '',
}))

const isGroundingActiveMock = vi.fn(() => false)
vi.mock('../store/groundingState', () => ({
  isGroundingActive: () => isGroundingActiveMock(),
}))

const { DisagreementEngine } = await import('./disagreementEngine')

const NOW = Date.parse('2026-05-12T12:00:00Z')

function makePart(over: Partial<Part>): Part {
  return {
    id: 'p1',
    name: 'Watcher',
    color: '#abc',
    colorLight: '#abc25',
    ifsRole: 'protector',
    voiceDescription: 'quiet',
    concern: 'a',
    systemPrompt: 'STUB_SYSTEM',
    isSeeded: true,
    createdAt: 0,
    ...over,
  } as Part
}

function makeParts(roles: IFSRole[]): Part[] {
  return roles.map((r, i) => makePart({ id: `p${i}`, ifsRole: r }))
}

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(NOW)
  globalConfigMock.mockReset()
  globalConfigMock.mockReturnValue({
    features: { partsDisagreeing: true },
    partIntelligence: { disagreeChance: 1.0, disagreeMinParts: 3 },
  })
  chatCompletionMock.mockReset()
  isGroundingActiveMock.mockReset()
  isGroundingActiveMock.mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DisagreementEngine.shouldDisagree — gating', () => {
  it('returns null when the feature flag is off', () => {
    globalConfigMock.mockReturnValue({ features: { partsDisagreeing: false } })
    const original = makePart({ id: 'orig', ifsRole: 'protector' })
    const all = [original, ...makeParts(['exile', 'manager'])]
    expect(new DisagreementEngine().shouldDisagree(original, all)).toBeNull()
  })

  it('returns null when globalConfig is null', () => {
    globalConfigMock.mockReturnValue(null)
    const original = makePart({ id: 'orig', ifsRole: 'protector' })
    expect(new DisagreementEngine().shouldDisagree(original, [original])).toBeNull()
  })

  it('returns null when grounding is active (load-bearing — parts arguing during distress is jarring)', () => {
    isGroundingActiveMock.mockReturnValue(true)
    const original = makePart({ id: 'orig', ifsRole: 'protector' })
    const all = [original, ...makeParts(['exile', 'manager'])]
    expect(new DisagreementEngine().shouldDisagree(original, all)).toBeNull()
  })

  it('returns null on probabilistic skip (Math.random() > disagreeChance)', () => {
    globalConfigMock.mockReturnValue({
      features: { partsDisagreeing: true },
      partIntelligence: { disagreeChance: 0.1, disagreeMinParts: 3 },
    })
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const original = makePart({ id: 'orig', ifsRole: 'protector' })
    const all = [original, ...makeParts(['exile', 'manager'])]
    expect(new DisagreementEngine().shouldDisagree(original, all)).toBeNull()
    spy.mockRestore()
  })

  it('returns null when fewer parts exist than disagreeMinParts', () => {
    const original = makePart({ id: 'orig', ifsRole: 'protector' })
    const all = [original, makePart({ id: 'p2', ifsRole: 'exile' })]
    expect(new DisagreementEngine().shouldDisagree(original, all)).toBeNull()
  })
})

describe('DisagreementEngine.shouldDisagree — role opposition', () => {
  it('returns an opposing exile when original is a protector', () => {
    const original = makePart({ id: 'orig', ifsRole: 'protector' })
    const all = [
      original,
      makePart({ id: 'exile1', ifsRole: 'exile' }),
      makePart({ id: 'mgr1', ifsRole: 'manager' }),
    ]
    const result = new DisagreementEngine().shouldDisagree(original, all)
    expect(result?.ifsRole).toBe('exile')
  })

  it('returns an opposing firefighter when original is a manager', () => {
    const original = makePart({ id: 'orig', ifsRole: 'manager' })
    const all = [
      original,
      makePart({ id: 'ff1', ifsRole: 'firefighter' }),
      makePart({ id: 'exile1', ifsRole: 'exile' }),
    ]
    const result = new DisagreementEngine().shouldDisagree(original, all)
    expect(result?.ifsRole).toBe('firefighter')
  })

  it('returns null when the original is "self" (no opposition defined)', () => {
    const original = makePart({ id: 'orig', ifsRole: 'self' })
    const all = [
      original,
      makePart({ id: 'p2', ifsRole: 'protector' }),
      makePart({ id: 'p3', ifsRole: 'exile' }),
    ]
    expect(new DisagreementEngine().shouldDisagree(original, all)).toBeNull()
  })

  it('returns null when no other part has an opposing role', () => {
    const original = makePart({ id: 'orig', ifsRole: 'protector' })
    // No exile present.
    const all = [
      original,
      makePart({ id: 'mgr', ifsRole: 'manager' }),
      makePart({ id: 'ff', ifsRole: 'firefighter' }),
    ]
    expect(new DisagreementEngine().shouldDisagree(original, all)).toBeNull()
  })

  it('does not return the same part as the original even if it shares the opposing role', () => {
    // If somehow the original itself has the opposing role to itself (shouldn't
    // happen with ROLE_OPPOSITION, but guard the filter logic): the filter is
    // `p.id !== originalPart.id`, so the original is always excluded.
    const original = makePart({ id: 'orig', ifsRole: 'protector' })
    const all = [original, makePart({ id: 'orig', ifsRole: 'exile' }) /* same id as original */]
    // Need at least disagreeMinParts (3), so pad:
    all.push(makePart({ id: 'pad', ifsRole: 'manager' }))
    const result = new DisagreementEngine().shouldDisagree(original, all)
    // Both candidates with id 'orig' are excluded; no others match exile.
    expect(result).toBeNull()
  })
})

describe('DisagreementEngine.shouldDisagree — rate limit', () => {
  it('honors the 15-minute floor after a successful generation', async () => {
    chatCompletionMock.mockResolvedValue('My response.')
    const engine = new DisagreementEngine()
    const target = makePart({ id: 'target', ifsRole: 'exile' })

    // Generate one successful disagreement to set lastDisagreementTime.
    await engine.generateDisagreement(target, 'original thought', 'diary text')

    // 10 minutes later — still in the rate-limit window.
    vi.setSystemTime(NOW + 10 * 60 * 1000)
    const original = makePart({ id: 'orig', ifsRole: 'protector' })
    const all = [original, target, makePart({ id: 'pad', ifsRole: 'manager' })]
    expect(engine.shouldDisagree(original, all)).toBeNull()

    // 16 minutes later — past the window.
    vi.setSystemTime(NOW + 16 * 60 * 1000)
    expect(engine.shouldDisagree(original, all)?.id).toBe('target')
  })
})

describe('DisagreementEngine.generateDisagreement', () => {
  it('returns the LLM response and stamps lastDisagreementTime', async () => {
    chatCompletionMock.mockResolvedValue('I see it differently.')
    const engine = new DisagreementEngine()
    const target = makePart({ id: 'target', ifsRole: 'exile' })
    const result = await engine.generateDisagreement(target, 'they said', 'diary content')
    expect(result).toBe('I see it differently.')
    expect(chatCompletionMock).toHaveBeenCalledOnce()

    // Now within 15 minutes, shouldDisagree should be rate-limited.
    const original = makePart({ id: 'orig', ifsRole: 'protector' })
    const all = [original, target, makePart({ id: 'pad', ifsRole: 'manager' })]
    expect(engine.shouldDisagree(original, all)).toBeNull()
  })

  it('returns "" when grounding flips on between schedule and execution (belt-and-suspenders)', async () => {
    isGroundingActiveMock.mockReturnValue(true)
    const engine = new DisagreementEngine()
    const target = makePart({ id: 'target', ifsRole: 'exile' })
    const result = await engine.generateDisagreement(target, 'orig', 'diary')
    expect(result).toBe('')
    expect(chatCompletionMock).not.toHaveBeenCalled()
  })

  it('returns "" and does not throw when chatCompletion rejects', async () => {
    chatCompletionMock.mockRejectedValue(new Error('LLM down'))
    const engine = new DisagreementEngine()
    const target = makePart({ id: 'target', ifsRole: 'exile' })
    const result = await engine.generateDisagreement(target, 'orig', 'diary')
    expect(result).toBe('')
  })

  it('passes the original thought into the system prompt', async () => {
    chatCompletionMock.mockResolvedValue('reply')
    const engine = new DisagreementEngine()
    const target = makePart({ id: 'target', ifsRole: 'exile', systemPrompt: 'TARGET_SYS' })
    await engine.generateDisagreement(target, 'the original thought', 'diary content')

    const [messages] = chatCompletionMock.mock.calls[0]
    const sys = (messages as Array<{ role: string, content: string }>).find((m) => m.role === 'system')!
    expect(sys.content).toContain('TARGET_SYS')
    expect(sys.content).toContain('the original thought')
  })

  it('wraps current diary text via wrapUserContent in the user message', async () => {
    chatCompletionMock.mockResolvedValue('reply')
    const engine = new DisagreementEngine()
    const target = makePart({ id: 'target', ifsRole: 'exile' })
    await engine.generateDisagreement(target, 'orig', 'today I wrote')

    const [messages] = chatCompletionMock.mock.calls[0]
    const user = (messages as Array<{ role: string, content: string }>).find((m) => m.role === 'user')!
    // The mock for wrapUserContent prepends/appends [diary] markers.
    expect(user.content).toContain('[diary]today I wrote[/diary]')
  })
})
