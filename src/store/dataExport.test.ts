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

  it('marks MMS image attachments without embedding provider media', () => {
    const md = buildMarkdownExport({
      smsMessages: [
        { direction: 'inbound', body: '', mediaCount: 1, createdAt: 1_700_000_000_000 },
      ],
    }, {})

    expect(md).toContain('[settings.sms.imageAttachment]')
  })

  it('exports personal-science provenance and writer-reviewed protocols', () => {
    const md = buildMarkdownExport({
      researchEvents: [{
        protocolId: 'subtraction-v1', status: 'delivered', assignedArm: 'designed_silence',
        deliveredArm: 'designed_silence', outcomeId: 'o1', createdAt: 1_700_000_000_000,
      }],
      personalProtocols: [{
        title: 'Quiet first when I am looping', status: 'active', confidence: 'early',
        transferStatus: 'graduated', transferLevel: 'independent',
        createdAt: 1_700_000_000_000,
      }],
      interventionOutcomes: [{
        source: 'talk', intervention: 'user_first', immediate: 'helped', agency: 'more',
        horizonOutcomes: [{ horizon: 'next_day', outcome: 'used', reportedAt: 1_700_086_400_000 }],
        prismFeedback: { hypotheses: [{ id: 'h1', text: 'Maybe tired.', fit: 'fits' }], noneFit: false, correctionEffort: 'easy', submittedAt: 1_700_000_000_001 },
        createdAt: 1_700_000_000_000,
      }],
      companionPreferences: [{
        id: 'current',
        fieldWindows: {
          enabled: true, timezone: 'America/Toronto', maxPerWeek: 2,
          windows: [{ label: 'After work', days: [1, 2, 3, 4, 5], startMinute: 1020, endMinute: 1140, purpose: 'settle', enabled: true }],
        },
      }],
      livingHypotheses: [{
        text: 'I may be buying time because this matters.', status: 'confirmed', source: 'writer_rewrite',
        createdAt: 1_700_000_000_000,
      }],
    }, {})

    expect(md).toContain('Personal science events')
    expect(md).toContain('subtraction-v1')
    expect(md).toContain('assigned designed_silence → delivered designed_silence → outcome o1')
    expect(md).toContain('Personal protocols')
    expect(md).toContain('Quiet first when I am looping')
    expect(md).toContain('transfer graduated at independent')
    expect(md).toContain('agency:more')
    expect(md).toContain('next_day:used')
    expect(md).toContain('Field window preferences')
    expect(md).toContain('After work')
    expect(md).toContain('prism:1 reviewed, effort:easy')
    expect(md).toContain('Living hypotheses')
    expect(md).toContain('buying time because this matters')
  })

  it('omits the conversations section entirely when there are no sessions', () => {
    const md = buildMarkdownExport({ entries: [] }, {})
    expect(md).not.toContain('conversations')
  })

  it('renders Room visits with their settings, outcome and transcript', () => {
    const collections = {
      roomSessions: [
        {
          id: 'r2', parentSessionId: 's1', startedAt: 1_700_000_600_000, endedAt: 1_700_000_660_000,
          approach: 'quiet_company', duration: 2, voiceDensity: 'quiet', audioTrack: 'forest',
          transcript: [], commands: [], completed: false, actualDurationMs: 60_000, memoryAperture: 'pattern',
        },
        {
          id: 'r1', parentSessionId: 's1', startedAt: 1_700_000_000_000, endedAt: 1_700_000_300_000,
          approach: 'listen_first', duration: 5, voiceDensity: 'sparse', audioTrack: 'ocean',
          transcript: [
            { role: 'user', content: 'My shoulders are tight.', atMs: 12_000 },
            { role: 'companion', content: 'Let them be tight for a moment.', atMs: 75_000 },
            { role: 'user', content: '   ', atMs: 80_000 },
          ],
          commands: ['less_voice'], completed: true, actualDurationMs: 300_000, memoryAperture: 'pattern',
        },
      ],
    }

    const md = buildMarkdownExport(collections, {})

    expect(md).toContain('## room')
    expect(md).toContain('**room.approach:** room.approach.listen.title')
    expect(md).toContain('**room.length:** 5 min')
    expect(md).toContain('**room.sound:** room.sound.ocean')
    expect(md).toContain('**room.voiceDensity:** room.density.sparse')
    expect(md).toContain('**room.elapsed:** 5 min')
    expect(md).toContain('**room.completed:** yes')
    expect(md).toContain('**room.transcript:**')
    expect(md).toContain('**you · 0:12:** My shoulders are tight.')
    expect(md).toContain('**companion · 1:15:** Let them be tight for a moment.')
    // Visits are chronological; the ended-early visit has no transcript block.
    expect(md.indexOf('room.sound.ocean')).toBeLessThan(md.indexOf('room.sound.forest'))
    expect(md).toContain('**room.completed:** no')
    expect(md.match(/room\.transcript/g)).toHaveLength(1)
  })

  it('renders letters from parts', () => {
    const md = buildMarkdownExport({
      parts: [{ id: 'watcher', name: 'The Watcher' }],
      letters: [{ id: 'l1', partIds: ['watcher'], content: 'Dear you,\n\nWe noticed.', triggerType: 'milestone', createdAt: 1_700_000_000_000, isRead: false }],
    }, {})
    expect(md).toContain('## letters')
    expect(md).toContain('### letterFrom The Watcher')
    expect(md).toContain('We noticed.')
  })

  it('omits the Room section when there are no Room visits', () => {
    expect(buildMarkdownExport({ roomSessions: [] }, {})).not.toContain('## room')
  })
})
