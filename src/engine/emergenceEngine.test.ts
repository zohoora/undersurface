import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Part } from '../types'

const chatCompletionMock = vi.fn()
vi.mock('../ai/openrouter', () => ({
  chatCompletion: (...a: unknown[]) => chatCompletionMock(...a),
}))

vi.mock('../ai/partPrompts', () => ({
  buildEmergenceAnalysis: () => [{ role: 'system', content: 'STUB' }],
  SHARED_INSTRUCTIONS: 'STUB_SHARED',
}))

const dbPartsAdd = vi.fn()
const generateIdMock = vi.fn(() => 'emergent-id')
vi.mock('../store/db', () => ({
  db: {
    parts: {
      add: (...a: unknown[]) => dbPartsAdd(...a),
    },
  },
  generateId: () => generateIdMock(),
}))

const engineLogMock = vi.fn()
vi.mock('../services/diagnostics', () => ({
  engineLog: (...a: unknown[]) => engineLogMock(...a),
}))

const { EmergenceEngine } = await import('./emergenceEngine')

const NOW = Date.parse('2026-05-12T12:00:00Z')
const CHECK_INTERVAL = 120000

function makePart(over: Partial<Part>): Part {
  return {
    id: 'p',
    name: 'Existing',
    color: '#abc',
    colorLight: '#abc25',
    ifsRole: 'protector',
    voiceDescription: 'voice',
    concern: 'concern',
    systemPrompt: 'sys',
    isSeeded: true,
    createdAt: 0,
    ...over,
  } as Part
}

function longText(): string {
  return 'a '.repeat(200).trim() + '. that is enough text to clear the 300-char gate.'
}

/**
 * Run the engine's checks 2x without invoking the LLM, then return the engine.
 * After this, the next call to checkForEmergence with appropriately-advanced
 * time will invoke chatCompletion (checkCount=3).
 */
async function primeToWarmedUp(engine: InstanceType<typeof EmergenceEngine>): Promise<void> {
  await engine.checkForEmergence(longText(), [])
  vi.setSystemTime(NOW + CHECK_INTERVAL + 1)
  await engine.checkForEmergence(longText(), [])
  vi.setSystemTime(NOW + 2 * CHECK_INTERVAL + 2)
}

beforeEach(() => {
  vi.useFakeTimers().setSystemTime(NOW)
  chatCompletionMock.mockReset()
  dbPartsAdd.mockReset()
  generateIdMock.mockReset()
  generateIdMock.mockReturnValue('emergent-id')
  engineLogMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EmergenceEngine.checkForEmergence — gating', () => {
  it('returns {detected:false} when called twice within CHECK_INTERVAL', async () => {
    const engine = new EmergenceEngine()
    const first = await engine.checkForEmergence(longText(), [])
    expect(first).toEqual({ detected: false })
    // Advance well below the 2-minute interval.
    vi.setSystemTime(NOW + 30000)
    const second = await engine.checkForEmergence(longText(), [])
    expect(second).toEqual({ detected: false })
    expect(chatCompletionMock).not.toHaveBeenCalled()
  })

  it('returns {detected:false} when currentText is below the 300-char minimum', async () => {
    const engine = new EmergenceEngine()
    const result = await engine.checkForEmergence('too short', [])
    expect(result).toEqual({ detected: false })
    expect(chatCompletionMock).not.toHaveBeenCalled()
  })

  it('returns {detected:false} when emerged-part count is at the cap (4)', async () => {
    const engine = new EmergenceEngine()
    const emerged = [
      makePart({ id: 'e1', isSeeded: false }),
      makePart({ id: 'e2', isSeeded: false }),
      makePart({ id: 'e3', isSeeded: false }),
      makePart({ id: 'e4', isSeeded: false }),
    ]
    const result = await engine.checkForEmergence(longText(), emerged)
    expect(result).toEqual({ detected: false })
    expect(chatCompletionMock).not.toHaveBeenCalled()
  })

  it('does not count seeded parts toward the emerged cap', async () => {
    const engine = new EmergenceEngine()
    // 4 seeded parts — all isSeeded=true; should NOT trip the cap.
    const seeded = Array.from({ length: 4 }, (_, i) => makePart({ id: `s${i}`, isSeeded: true }))
    await primeToWarmedUp(engine)
    chatCompletionMock.mockResolvedValue(JSON.stringify({ detected: false }))
    await engine.checkForEmergence(longText(), seeded)
    // It got far enough to call the LLM.
    expect(chatCompletionMock).toHaveBeenCalledOnce()
  })

  it('returns {detected:false} on the first 2 calls (warmup), invokes LLM on the 3rd', async () => {
    const engine = new EmergenceEngine()
    chatCompletionMock.mockResolvedValue(JSON.stringify({ detected: false }))

    expect((await engine.checkForEmergence(longText(), [])).detected).toBe(false)
    expect(chatCompletionMock).not.toHaveBeenCalled()

    vi.setSystemTime(NOW + CHECK_INTERVAL + 1)
    expect((await engine.checkForEmergence(longText(), [])).detected).toBe(false)
    expect(chatCompletionMock).not.toHaveBeenCalled()

    vi.setSystemTime(NOW + 2 * CHECK_INTERVAL + 2)
    await engine.checkForEmergence(longText(), [])
    expect(chatCompletionMock).toHaveBeenCalledOnce()
  })
})

describe('EmergenceEngine.checkForEmergence — happy path', () => {
  const validResponse = {
    detected: true,
    name: 'The Tide',
    color: '#3366aa',
    ifsRole: 'protector',
    voice: 'patient and slow',
    concern: 'overwhelm',
    firstWords: 'I am here, just at the edge.',
  }

  it('returns the emerged Part shape and persists it', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    chatCompletionMock.mockResolvedValue(JSON.stringify(validResponse))

    const result = await engine.checkForEmergence(longText(), [])

    expect(result.detected).toBe(true)
    expect(result.firstWords).toBe('I am here, just at the edge.')
    expect(result.part).toMatchObject({
      id: 'emergent-id',
      name: 'The Tide',
      color: '#3366aa',
      colorLight: '#3366aa25', // color + '25'
      ifsRole: 'protector',
      voiceDescription: 'patient and slow',
      concern: 'overwhelm',
      isSeeded: false,
    })
    expect(result.part?.systemPrompt).toContain('You are The Tide')
    expect(dbPartsAdd).toHaveBeenCalledOnce()
  })

  it('does not include `memories` in the persisted db record', async () => {
    // The Part returned has `memories: []` but the persisted shape excludes it.
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    chatCompletionMock.mockResolvedValue(JSON.stringify(validResponse))

    await engine.checkForEmergence(longText(), [])
    const [persisted] = dbPartsAdd.mock.calls[0]
    expect(persisted).not.toHaveProperty('memories')
    expect(persisted).toMatchObject({ id: 'emergent-id', isSeeded: false })
  })

  it('returns {detected:false} when the LLM says detected=false', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    chatCompletionMock.mockResolvedValue(JSON.stringify({ detected: false }))

    const result = await engine.checkForEmergence(longText(), [])
    expect(result).toEqual({ detected: false })
    expect(dbPartsAdd).not.toHaveBeenCalled()
  })
})

describe('EmergenceEngine.checkForEmergence — error paths', () => {
  it('returns {detected:false} when the LLM response is not valid JSON', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    chatCompletionMock.mockResolvedValue('garbage not json')

    const result = await engine.checkForEmergence(longText(), [])
    expect(result).toEqual({ detected: false })
    expect(dbPartsAdd).not.toHaveBeenCalled()
  })

  it('returns {detected:false} when chatCompletion rejects', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    chatCompletionMock.mockRejectedValue(new Error('LLM down'))

    const result = await engine.checkForEmergence(longText(), [])
    expect(result).toEqual({ detected: false })
    expect(dbPartsAdd).not.toHaveBeenCalled()
  })

  it('returns {detected:false} when db.parts.add throws', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    chatCompletionMock.mockResolvedValue(JSON.stringify({
      detected: true,
      name: 'X',
      color: '#000',
      ifsRole: 'protector',
      voice: 'v',
      concern: 'c',
      firstWords: 'hi',
    }))
    dbPartsAdd.mockRejectedValueOnce(new Error('db down'))

    const result = await engine.checkForEmergence(longText(), [])
    expect(result).toEqual({ detected: false })
  })
})

// gpt-5.5 frequently wraps JSON in markdown code fences even when prompted
// for raw JSON. Same defensive pattern as sessionReflectionEngine and
// partGrowthEngine — previously a bare `JSON.parse` would throw on these.
describe('EmergenceEngine.checkForEmergence — markdown fence tolerance', () => {
  const validPayload = {
    detected: true,
    name: 'The Tide',
    color: '#3366aa',
    ifsRole: 'protector',
    voice: 'patient and slow',
    concern: 'overwhelm',
    firstWords: 'I am here.',
  }

  it('parses a ```json fenced response and emerges the part', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    chatCompletionMock.mockResolvedValue('```json\n' + JSON.stringify(validPayload) + '\n```')

    const result = await engine.checkForEmergence(longText(), [])

    expect(result.detected).toBe(true)
    expect(result.part?.name).toBe('The Tide')
    expect(dbPartsAdd).toHaveBeenCalledOnce()
  })

  it('parses an unlabeled ``` fenced response', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    chatCompletionMock.mockResolvedValue('```\n' + JSON.stringify(validPayload) + '\n```')

    const result = await engine.checkForEmergence(longText(), [])

    expect(result.detected).toBe(true)
    expect(result.part?.name).toBe('The Tide')
  })
})

describe('EmergenceEngine.checkForEmergence — telemetry', () => {
  it('logs `emergence.parse_failed` when the response cannot be parsed as JSON', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    chatCompletionMock.mockResolvedValue('this is not json at all, just prose')

    await engine.checkForEmergence(longText(), [])

    const warnCalls = engineLogMock.mock.calls.filter((c) => c[0] === 'warn' && c[1] === 'emergence.parse_failed')
    expect(warnCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('logs `emergence.parse_failed` and returns false when detected=true but required fields are missing', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    // LLM claims detection but omits name/color — previously would create a
    // malformed Part with undefined fields. Now flagged and rejected.
    chatCompletionMock.mockResolvedValue(JSON.stringify({ detected: true, ifsRole: 'protector' }))

    const result = await engine.checkForEmergence(longText(), [])

    expect(result).toEqual({ detected: false })
    expect(dbPartsAdd).not.toHaveBeenCalled()
    const warnCalls = engineLogMock.mock.calls.filter((c) => c[0] === 'warn' && c[1] === 'emergence.parse_failed')
    expect(warnCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects emergence when ifsRole is outside the IFS taxonomy', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    // LLM hallucinates an off-taxonomy role. Original bare-parse code would
    // have persisted a Part with an invalid role; now flagged and rejected.
    chatCompletionMock.mockResolvedValue(JSON.stringify({
      detected: true,
      name: 'X',
      color: '#000',
      ifsRole: 'overseer', // not in protector|exile|manager|firefighter|self
      voice: 'v',
      concern: 'c',
      firstWords: 'hi',
    }))

    const result = await engine.checkForEmergence(longText(), [])

    expect(result).toEqual({ detected: false })
    expect(dbPartsAdd).not.toHaveBeenCalled()
    const warnCalls = engineLogMock.mock.calls.filter((c) => c[0] === 'warn' && c[1] === 'emergence.parse_failed')
    expect(warnCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('does not log on the happy path', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    chatCompletionMock.mockResolvedValue(JSON.stringify({
      detected: true,
      name: 'X',
      color: '#000',
      ifsRole: 'protector',
      voice: 'v',
      concern: 'c',
      firstWords: 'hi',
    }))

    await engine.checkForEmergence(longText(), [])

    expect(engineLogMock).not.toHaveBeenCalled()
  })

  it('does not log on the detected=false fast path', async () => {
    const engine = new EmergenceEngine()
    await primeToWarmedUp(engine)
    chatCompletionMock.mockResolvedValue(JSON.stringify({ detected: false }))

    await engine.checkForEmergence(longText(), [])

    expect(engineLogMock).not.toHaveBeenCalled()
  })
})
