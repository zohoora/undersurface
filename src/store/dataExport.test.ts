import { describe, it, expect, vi } from 'vitest'

// dataExport imports db (Firestore) and i18n; stub the heavy/DOM-touching parts
// so we can exercise the pure buildMarkdownExport renderer.
vi.mock('./db', () => ({ db: {}, sessionMessages: { getAll: vi.fn() } }))
vi.mock('../i18n', () => ({
  // Render the key's leaf as a stable English-ish label so assertions are
  // locale-independent.
  t: (key: string) => key.replace(/^export\./, ''),
  getLanguageCode: () => 'en',
  getPartDisplayName: (p: { name?: string; id: string }) => p.name ?? p.id,
}))

const { buildMarkdownExport } = await import('./dataExport')

describe('buildMarkdownExport — completeness (C-8)', () => {
  it('renders full session transcripts and session notes, not just the summary table', () => {
    const collections = {
      sessions: [{ id: 's1', startedAt: 1_700_000_000_000, sessionNote: 'We explored avoidance.' }],
      sessionLog: [],
    }
    const messages = {
      s1: [
        { id: 'm1', speaker: 'user', content: 'I keep putting it off.', timestamp: 1 },
        { id: 'm2', speaker: 'therapist', content: 'What happens right before you stop?', timestamp: 2 },
      ],
    } as never

    const md = buildMarkdownExport(collections, messages)

    expect(md).toContain('conversations')
    expect(md).toContain('I keep putting it off.')
    expect(md).toContain('What happens right before you stop?')
    expect(md).toContain('We explored avoidance.')
  })

  it('renders the personalFacts section (people/dates/context/threads)', () => {
    const collections = {
      personalFacts: [{
        people: [{ name: 'Sam', description: 'brother' }],
        dates: [{ event: 'anniversary', date: 'June 3' }],
        context: ['moved cities recently'],
        currentThreads: [{ thread: 'career change' }],
      }],
    }

    const md = buildMarkdownExport(collections, {})

    expect(md).toContain('personalFacts')
    expect(md).toContain('Sam')
    expect(md).toContain('anniversary')
    expect(md).toContain('moved cities recently')
    expect(md).toContain('career change')
  })

  it('renders consent records', () => {
    const collections = {
      consent: [{ id: 'camera-hrv', grantedAt: 1_700_000_000_000 }],
    }
    const md = buildMarkdownExport(collections, {})
    expect(md).toContain('consent')
    expect(md).toContain('camera-hrv')
  })

  it('renders SMS field messages in the portable conversation export', () => {
    const md = buildMarkdownExport({
      smsMessages: [
        { direction: 'inbound', body: 'I expected to freeze.', createdAt: 1_700_000_000_000 },
        { direction: 'outbound', body: 'What actually happened?', createdAt: 1_700_000_000_100 },
      ],
    }, {})

    expect(md).toContain('conversations — SMS')
    expect(md).toContain('I expected to freeze.')
    expect(md).toContain('What actually happened?')
  })

  it('omits the conversations section entirely when there are no sessions', () => {
    const md = buildMarkdownExport({ entries: [] }, {})
    expect(md).not.toContain('conversations')
  })
})
