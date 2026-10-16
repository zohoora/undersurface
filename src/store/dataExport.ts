import type { DocumentData } from 'firebase/firestore'
import { db, folioTraceEntries, sessionMessages } from './db'
import type { SessionMessage } from '../types'
import { t, getLanguageCode, getPartDisplayName } from '../i18n'
import type { TranslationKey } from '../i18n'

// ── Markdown export helpers ──

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(getLanguageCode(), {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(getLanguageCode(), {
    hour: 'numeric', minute: '2-digit',
  })
}

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}min` : `${h}h`
}

// m:ss offset from the start of a Room visit.
function fmtOffset(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

const ROOM_APPROACH_KEYS: Record<string, TranslationKey> = {
  listen_first: 'room.approach.listen.title',
  lead_me: 'room.approach.lead.title',
  quiet_company: 'room.approach.quiet.title',
}

const ROOM_SOUND_KEYS: Record<string, TranslationKey> = {
  none: 'room.sound.none',
  ocean: 'room.sound.ocean',
  forest: 'room.sound.forest',
  drone: 'room.sound.drone',
  binaural: 'room.sound.binaural',
}

const ROOM_DENSITY_KEYS: Record<string, TranslationKey> = {
  quiet: 'export.room.density.quiet',
  sparse: 'export.room.density.sparse',
  present: 'export.room.density.present',
}

// Known values render through i18n; anything unexpected is shown verbatim
// rather than dropped.
function label(keys: Record<string, TranslationKey>, value: unknown): string {
  const key = typeof value === 'string' ? keys[value] : undefined
  return key ? t(key) : String(value ?? '—')
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return map
}

export function buildMarkdownExport(
  collections: Record<string, DocumentData[]>,
  sessionMessagesById: Record<string, SessionMessage[]> = {},
  traceEntriesById: Record<string, DocumentData[]> = {},
): string {
  const entries = (collections.entries ?? []).sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
  const parts = collections.parts ?? []
  const memories = collections.memories ?? []
  const thoughts = collections.thoughts ?? []
  const interactions = collections.interactions ?? []
  const summaries = collections.entrySummaries ?? []
  const profiles = collections.userProfile ?? []
  const fossils = collections.fossils ?? []
  const letters = collections.letters ?? []
  const sessions = (collections.sessionLog ?? []).sort((a, b) => (a.startedAt as number) - (b.startedAt as number))

  // Part name lookup (uses translated display names for seeded parts)
  const partLookup = new Map<string, DocumentData>()
  for (const p of parts) partLookup.set(p.id as string, p)
  const pn = (id: string) => {
    const p = partLookup.get(id)
    if (!p) return t('export.unknownVoice')
    return getPartDisplayName({ id: p.id as string, name: p.name as string, isSeeded: p.isSeeded as boolean | undefined })
  }

  // Index by entryId
  const thoughtsByEntry = groupBy(thoughts, (th) => th.entryId as string)
  const interactionsByEntry = groupBy(interactions, (ix) => ix.entryId as string)
  const summariesByEntry = groupBy(summaries, (s) => s.entryId as string)
  const fossilsByEntry = groupBy(fossils, (f) => f.entryId as string)
  const memoriesByPart = groupBy(memories, (m) => m.partId as string)

  const lines: string[] = []
  const ln = (s = '') => lines.push(s)

  // ── Header ──
  ln(`# ${t('export.title')}`)
  ln(`*${t('export.exportedOn')} ${fmtDate(Date.now())}*`)
  ln()

  // ── User Profile ──
  const profile = profiles[0] as DocumentData | undefined
  if (profile) {
    ln('---')
    ln()
    ln(`## ${t('export.aboutYou')}`)
    ln()
    if (profile.innerLandscape) {
      ln(`> ${(profile.innerLandscape as string).replace(/\n/g, '\n> ')}`)
      ln()
    }
    const fields: [string, string][] = [
      [t('export.recurringThemes'), 'recurringThemes'],
      [t('export.emotionalPatterns'), 'emotionalPatterns'],
      [t('export.growthSignals'), 'growthSignals'],
      [t('export.avoidancePatterns'), 'avoidancePatterns'],
    ]
    for (const [label, key] of fields) {
      const arr = profile[key] as string[] | undefined
      if (arr?.length) ln(`**${label}:** ${arr.join(', ')}`)
    }
    ln()
  }

  // ── Inner Voices ──
  if (parts.length) {
    ln('---')
    ln()
    ln(`## ${t('export.innerVoices')}`)
    ln()
    for (const p of parts) {
      const displayName = getPartDisplayName({ id: p.id as string, name: p.name as string, isSeeded: p.isSeeded as boolean | undefined })
      ln(`### ${displayName}`)
      ln(`*${t('export.role')}: ${p.ifsRole}*`)
      ln()
      if (p.voiceDescription) ln((p.voiceDescription as string))
      if (p.concern) ln(`\n**${t('export.concern')}:** ${p.concern}`)
      if (p.systemPromptAddition) ln(`\n**${t('export.growth')}:** ${p.systemPromptAddition}`)
      const pMems = memoriesByPart.get(p.id as string) ?? []
      const reflections = pMems.filter((m) => m.type === 'reflection' || m.type === 'pattern')
      if (reflections.length) {
        ln()
        ln(`**${t('export.keyReflections')}:**`)
        for (const m of reflections.slice(-5)) {
          ln(`- ${(m.content as string).replace(/\n/g, ' ')}`)
        }
      }
      ln()
    }
  }

  // ── Journal Entries ──
  if (entries.length) {
    ln('---')
    ln()
    ln(`## ${t('export.journal')}`)
    ln()

    const byDate = groupBy(entries, (e) => fmtDate(e.createdAt as number))

    for (const [date, dayEntries] of byDate) {
      ln(`### ${date}`)
      ln()

      for (const entry of dayEntries) {
        const eid = entry.id as string
        const text = (entry.plainText as string || '').trim()
        const intention = entry.intention as string | undefined

        ln(`#### ${fmtTime(entry.createdAt as number)}`)
        ln()
        if (intention) ln(`*${t('export.intention')}: ${intention}*\n`)
        ln(text || `*${t('export.emptyEntry')}*`)
        ln()

        // Thoughts from inner voices
        const eThoughts = (thoughtsByEntry.get(eid) ?? [])
          .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
        if (eThoughts.length) {
          for (const th of eThoughts) {
            const anchor = th.anchorText as string
            const prefix = anchor ? ` *(${t('export.respondingTo')}: "${anchor}")*` : ''
            ln(`> **${pn(th.partId as string)}:**${prefix} ${th.content}`)
            ln()
          }
        }

        // Thinking Out Loud interactions
        const eInteractions = (interactionsByEntry.get(eid) ?? [])
          .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
        for (const ix of eInteractions) {
          ln(`**${t('export.conversationWith')} ${pn(ix.partId as string)}:**`)
          if (ix.partOpening) ln(`> *${pn(ix.partId as string)}:* ${ix.partOpening}`)
          if (ix.userResponse) ln(`>\n> *${t('export.you')}:* ${ix.userResponse}`)
          if (ix.partReply) ln(`>\n> *${pn(ix.partId as string)}:* ${ix.partReply}`)
          ln()
        }

        // Entry summary
        const eSummaries = summariesByEntry.get(eid) ?? []
        if (eSummaries.length) {
          const s = eSummaries[0]
          const themes = s.themes as string[] | undefined
          const arc = s.emotionalArc as string | undefined
          const moments = s.keyMoments as string[] | undefined
          if (themes?.length || arc || moments?.length) {
            ln(`**${t('export.reflection')}:**`)
            if (themes?.length) ln(`- ${t('export.themes')}: ${themes.join(', ')}`)
            if (arc) ln(`- ${t('export.emotionalArc')}: ${arc}`)
            if (moments?.length) ln(`- ${t('export.keyMoments')}: ${moments.join('; ')}`)
            ln()
          }
        }

        // Fossils (voice commentary on past entries)
        const eFossils = fossilsByEntry.get(eid) ?? []
        for (const f of eFossils) {
          ln(`> **${pn(f.partId as string)}** ${t('export.reflectedOn')}: ${f.commentary}`)
          ln()
        }

        ln('---')
        ln()
      }
    }
  }

  // ── Letters ──
  if (letters.length) {
    ln(`## ${t('export.letters')}`)
    ln()
    const sorted = [...letters].sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
    for (const l of sorted) {
      const names = (l.partIds as string[]).map(pn).join(' & ')
      ln(`### ${t('export.letterFrom')} ${names}`)
      ln(`*${fmtDate(l.createdAt as number)} — ${l.triggerType}*`)
      ln()
      ln(l.content as string)
      ln()
      ln('---')
      ln()
    }
  }

  // ── Writing Sessions ──
  if (sessions.length) {
    ln(`## ${t('export.sessions')}`)
    ln()
    ln(`| ${t('export.date')} | ${t('export.time')} | ${t('export.duration')} | ${t('export.words')} |`)
    ln('|------|------|----------|-------|')
    for (const s of sessions) {
      const dur = s.duration ? fmtDuration(s.duration as number) : '—'
      ln(`| ${fmtDate(s.startedAt as number)} | ${fmtTime(s.startedAt as number)} | ${dur} | ${s.wordCount ?? '—'} |`)
    }
    ln()
  }

  // ── Personal facts ──
  const facts = (collections.personalFacts ?? [])[0] as DocumentData | undefined
  if (facts) {
    const factLists: [string, string][] = [
      [t('export.people'), 'people'],
      [t('export.importantDates'), 'dates'],
      [t('export.context'), 'context'],
      [t('export.currentThreads'), 'currentThreads'],
    ]
    const rendered = factLists.filter(([, key]) => (facts[key] as unknown[] | undefined)?.length)
    if (rendered.length) {
      ln('---')
      ln()
      ln(`## ${t('export.personalFacts')}`)
      ln()
      for (const [label, key] of rendered) {
        const items = facts[key] as DocumentData[]
        ln(`**${label}:**`)
        for (const item of items) {
          // Fact entries are small objects; render their human-readable fields.
          const text = typeof item === 'string' ? item
            : [item.name, item.date, item.value, item.description, item.thread, item.event, item.context]
                .filter((v): v is string => typeof v === 'string' && v.length > 0)
                .join(' — ')
          if (text) ln(`- ${text}`)
        }
        ln()
      }
    }
  }

  // ── Conversations (full transcripts) ──
  const sessionDocs = (collections.sessions ?? []).sort((a, b) => (a.startedAt as number) - (b.startedAt as number))
  const transcribed = sessionDocs.filter(s => (sessionMessagesById[s.id as string]?.length ?? 0) > 0 || s.sessionNote)
  if (transcribed.length) {
    ln('---')
    ln()
    ln(`## ${t('export.conversations')}`)
    ln()
    for (const s of transcribed) {
      const id = s.id as string
      ln(`### ${fmtDate(s.startedAt as number)} · ${fmtTime(s.startedAt as number)}`)
      ln()
      if (s.sessionNote) {
        ln(`> ${t('export.sessionNote')}: ${(s.sessionNote as string).replace(/\n/g, '\n> ')}`)
        ln()
      }
      for (const m of sessionMessagesById[id] ?? []) {
        const who = m.speaker === 'user' ? t('export.you') : t('export.companion')
        ln(`**${who}:** ${m.content}`)
        ln()
      }
    }
  }

  // ── Room visits ──
  const roomSessions = [...(collections.roomSessions ?? [])]
    .filter(room => typeof room.startedAt === 'number')
    .sort((a, b) => (a.startedAt as number) - (b.startedAt as number))
  if (roomSessions.length) {
    ln('---')
    ln()
    ln(`## ${t('export.room')}`)
    ln()
    for (const room of roomSessions) {
      const startedAt = room.startedAt as number
      ln(`### ${fmtDate(startedAt)} · ${fmtTime(startedAt)}`)
      ln()
      ln(`- **${t('export.room.approach')}:** ${label(ROOM_APPROACH_KEYS, room.approach)}`)
      if (typeof room.duration === 'number') ln(`- **${t('export.room.length')}:** ${fmtDuration(room.duration * 60_000)}`)
      ln(`- **${t('export.room.sound')}:** ${label(ROOM_SOUND_KEYS, room.audioTrack)}`)
      ln(`- **${t('export.room.voiceDensity')}:** ${label(ROOM_DENSITY_KEYS, room.voiceDensity)}`)
      if (typeof room.actualDurationMs === 'number') ln(`- **${t('export.room.elapsed')}:** ${fmtDuration(room.actualDurationMs)}`)
      ln(`- **${t('export.room.completed')}:** ${room.completed === true ? t('export.yes') : t('export.no')}`)
      ln()
      const transcript = Array.isArray(room.transcript)
        ? (room.transcript as Array<Record<string, unknown>>).filter(item => typeof item.content === 'string' && item.content.trim())
        : []
      if (transcript.length) {
        ln(`**${t('export.room.transcript')}:**`)
        ln()
        for (const item of transcript) {
          const who = item.role === 'user' ? t('export.you') : t('export.companion')
          const at = typeof item.atMs === 'number' ? ` · ${fmtOffset(item.atMs)}` : ''
          ln(`**${who}${at}:** ${String(item.content).trim()}`)
          ln()
        }
      }
    }
  }

  // ── Consent records ──
  const consent = collections.consent ?? []
  if (consent.length) {
    ln('---')
    ln()
    ln(`## ${t('export.consent')}`)
    ln()
    for (const c of consent) {
      const when = c.grantedAt ? fmtDate(c.grantedAt as number) : c.timestamp ? fmtDate(c.timestamp as number) : '—'
      ln(`- ${c.id ?? c.type ?? 'consent'}: ${when}`)
    }
    ln()
  }

  const smsMessages = [...(collections.smsMessages ?? [])]
    .filter(message => typeof message.body === 'string' && typeof message.createdAt === 'number')
    .sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
  if (smsMessages.length > 0) {
    ln(`## ${t('export.conversations')} — SMS`)
    ln()
    for (const message of smsMessages) {
      const who = message.direction === 'inbound' ? t('export.you') : t('export.companion')
      ln(`**${who} · ${fmtDate(message.createdAt as number)}:**`)
      ln()
      const body = String(message.body).trim()
      if (body) ln(body)
      if (Number(message.mediaCount) > 0) ln(`[${t('settings.sms.imageAttachment')}]`)
      ln()
    }
  }

  const fieldMoments = [...(collections.fieldMoments ?? [])]
    .filter(moment => typeof moment.text === 'string' && typeof moment.createdAt === 'number')
    .sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
  if (fieldMoments.length > 0) {
    ln(`## Field mosaic`)
    ln()
    for (const moment of fieldMoments) {
      ln(`- **${fmtDate(moment.createdAt as number)} · ${String(moment.source)} · ${String(moment.status)}:** ${String(moment.text)}`)
      if (moment.userMeaning) ln(`  - Your meaning: ${String(moment.userMeaning)}`)
      if (Array.isArray(moment.mediaPaths) && moment.mediaPaths.length > 0) {
        ln(`  - ${moment.mediaPaths.length} private image attachment(s)`)
      }
    }
    ln()
  }

  const outcomes = [...(collections.interventionOutcomes ?? [])]
    .filter(outcome => typeof outcome.createdAt === 'number')
    .sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
  if (outcomes.length > 0) {
    ln(`## Intervention outcomes`)
    ln()
    for (const outcome of outcomes) {
      const horizons = Array.isArray(outcome.horizonOutcomes)
        ? outcome.horizonOutcomes.map((row: Record<string, unknown>) => `${String(row.horizon)}:${String(row.outcome)}`)
        : []
      const prism = outcome.prismFeedback && typeof outcome.prismFeedback === 'object'
        ? `prism:${Array.isArray(outcome.prismFeedback.hypotheses) ? outcome.prismFeedback.hypotheses.length : 0} reviewed${outcome.prismFeedback.noneFit === true ? ', none fit' : ''}${outcome.prismFeedback.correctionEffort ? `, effort:${String(outcome.prismFeedback.correctionEffort)}` : ''}`
        : ''
      const result = [outcome.immediate, outcome.delayed, ...horizons, prism, outcome.agency ? `agency:${String(outcome.agency)}` : '', outcome.nextStep ? `next:${String(outcome.nextStep)}` : ''].filter(Boolean).join(' → ') || 'not rated'
      ln(`- **${fmtDate(outcome.createdAt as number)} · ${String(outcome.source)} · ${String(outcome.intervention)}:** ${result}`)
    }
    ln()
  }

  const companionPreferences = collections.companionPreferences?.find(item => item.id === 'current')
  const fieldWindows = companionPreferences?.fieldWindows as Record<string, unknown> | undefined
  if (fieldWindows) {
    ln(`## Field window preferences`)
    ln()
    ln(`- **Status:** ${fieldWindows.enabled === true ? 'enabled' : 'disabled'}`)
    ln(`- **Timezone:** ${String(fieldWindows.timezone ?? 'not set')}`)
    ln(`- **Maximum proactive messages per week:** ${String(fieldWindows.maxPerWeek ?? 'not set')}`)
    const windows = Array.isArray(fieldWindows.windows) ? fieldWindows.windows as Array<Record<string, unknown>> : []
    for (const window of windows) {
      ln(`- **${String(window.label ?? 'Field window')}:** days ${Array.isArray(window.days) ? window.days.join(',') : ''} · minutes ${String(window.startMinute)}–${String(window.endMinute)} · ${String(window.purpose)} · ${window.enabled === false ? 'disabled' : 'enabled'}`)
    }
    ln()
  }

  const researchEvents = [...(collections.researchEvents ?? [])]
    .filter(event => typeof event.createdAt === 'number')
    .sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
  if (researchEvents.length > 0) {
    ln(`## Personal science events`)
    ln()
    for (const event of researchEvents) {
      const delivery = event.deliveredArm ? ` → delivered ${String(event.deliveredArm)}` : ''
      const outcome = event.outcomeId ? ` → outcome ${String(event.outcomeId)}` : ''
      const fidelity = event.deliveryFidelity ? ` · ${String(event.deliveryFidelity)}` : ''
      ln(`- **${fmtDate(event.createdAt as number)} · ${String(event.protocolId)} · ${String(event.status)}${fidelity}:** assigned ${String(event.assignedArm)}${delivery}${outcome}`)
    }
    ln()
  }

  const personalProtocols = [...(collections.personalProtocols ?? [])]
    .filter(protocol => typeof protocol.title === 'string' && typeof protocol.createdAt === 'number')
    .sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
  if (personalProtocols.length > 0) {
    ln(`## Personal protocols`)
    ln()
    for (const protocol of personalProtocols) {
      const transfer = protocol.transferStatus
        ? ` · transfer ${String(protocol.transferStatus)}${protocol.transferLevel ? ` at ${String(protocol.transferLevel)}` : ''}`
        : ''
      ln(`- **${String(protocol.status)} · ${String(protocol.confidence)}${transfer}:** ${String(protocol.title)}`)
    }
    ln()
  }

  const livingHypotheses = [...(collections.livingHypotheses ?? [])]
    .filter(item => typeof item.text === 'string' && typeof item.createdAt === 'number')
    .sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
  if (livingHypotheses.length > 0) {
    ln(`## Living hypotheses`)
    ln()
    for (const item of livingHypotheses) {
      ln(`- **${String(item.status)} · ${String(item.source)}:** ${String(item.text)}`)
    }
    ln()
  }

  // ── Folio (docs/vision/2026-10-15-folio-v4.md §6.8): each page in its
  // linear form, the distance written as a line plus blank lines.
  const folioPages = (collections.folioPages ?? []).sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
  if (folioPages.length > 0) {
    ln(`## ${t('folio.door')}`)
    ln()
    // The companion's own words (involvement level 5) are labelled as its own.
    const piece = (c: { text?: string; type?: string; marks?: { type: string }[] }) => {
      if (c.type === 'hardBreak') return '  \n'
      const text = c.marks?.some((m) => m.type === 'italic') ? `*${c.text ?? ''}*` : c.text ?? ''
      return c.marks?.some((m) => m.type === 'companionText') ? `[${t('folio.ask.label')}: ${text}]` : text
    }
    const inline = (node: { content?: { text?: string; type?: string; marks?: { type: string }[] }[] }) =>
      (node.content ?? []).map(piece).join('')
    const blankLines = [0, 1, 3, 7, 15]
    for (const page of folioPages) {
      ln(`### ${fmtDate(page.createdAt as number)}`)
      ln()
      let parsed: { content?: { type: string; attrs?: Record<string, unknown>; content?: { type: string; content?: { type?: string; content?: unknown[] }[] }[] }[] } = {}
      try { parsed = JSON.parse(page.doc as string) } catch { parsed = {} }
      for (const node of parsed.content ?? []) {
        if (node.type === 'paragraph') { ln(inline(node as never)); ln(); continue }
        if (node.type !== 'underside') continue
        const gap = Math.max(0, Math.min(4, Number(node.attrs?.gap) || 0))
        if (gap > 0) { ln(`(${t(`folio.distance.${gap}` as never)})`); for (let i = 0; i < blankLines[gap]; i++) ln('&nbsp;') }
        for (const passage of node.content ?? []) {
          const label = passage.type === 'between' ? t('folio.between') : t('folio.beneath')
          ln(`> **${label}:**`)
          for (const p of passage.content ?? []) ln(`> ${inline(p as never)}`)
          ln()
        }
      }
      // The companion's notes the writer kept, labelled as the companion's (H2).
      const notes = Array.isArray((parsed as { attrs?: { folioNotes?: unknown } }).attrs?.folioNotes)
        ? ((parsed as { attrs: { folioNotes: { text?: string; createdAt?: number }[] } }).attrs.folioNotes)
        : []
      if (notes.length > 0) {
        ln(`#### ${t('folio.notes.title')}`)
        ln()
        for (const note of notes) ln(`- ${note.createdAt ? `${fmtDate(note.createdAt)}: ` : ''}${String(note.text ?? '')}`)
        ln()
      }
      ln('---')
      ln()
    }
  }

  // ── Folio's kept things (§3.7, §6.8): each composition as it was kept, then
  // what was added beside it, dated. Oldest first, like the pages.
  const folioTraces = (collections.folioTraces ?? []).sort((a, b) => (a.keptAt as number) - (b.keptAt as number))
  if (folioTraces.length > 0) {
    ln(`## ${t('folio.kept.title')}`)
    ln()
    const inline = (content: { text?: string; type?: string; marks?: { type: string }[] }[] | undefined) =>
      (content ?? []).map((c) => {
        if (c.type === 'hardBreak') return '  \n'
        const text = c.marks?.some((m) => m.type === 'italic') ? `*${c.text ?? ''}*` : c.text ?? ''
        return c.marks?.some((m) => m.type === 'companionText') ? `[${t('folio.ask.label')}: ${text}]` : text
      }).join('')
    for (const trace of folioTraces) {
      const title = typeof trace.title === 'string' && trace.title.trim() ? trace.title : String(trace.surface ?? '')
      ln(`### ${title} · ${fmtDate(trace.keptAt as number)}${trace.keptBy === 'companion' ? ` · ${t('folio.companion.keptBy')}` : ''}`)
      ln()
      let c: { line?: { text?: string; type?: string; marks?: { type: string }[] }[]; gap?: number; between?: { content?: [] }[] | null; beneath?: { content?: [] }[] } = {}
      try { c = JSON.parse(trace.composition as string) } catch { c = {} }
      ln(inline(c.line) || String(trace.surface ?? ''))
      ln()
      const gap = Math.max(0, Math.min(4, Number(c.gap) || 0))
      if (gap > 0) ln(`(${t(`folio.distance.${gap}` as never)})`)
      for (const [label, passage] of [[t('folio.between'), c.between], [t('folio.beneath'), c.beneath]] as const) {
        if (!passage || passage.length === 0) continue
        ln(`> **${label}:**`)
        for (const p of passage) ln(`> ${inline(p.content)}`)
        ln()
      }
      for (const entry of traceEntriesById[trace.id as string] ?? []) {
        ln(`- **${fmtDate(entry.addedAt as number)}:** ${String(entry.text ?? '')}`)
      }
      ln('---')
      ln()
    }
  }

  return lines.join('\n')
}

export async function exportAllData() {
  const collectionNames = [
    'entries', 'parts', 'memories', 'thoughts', 'interactions',
    'entrySummaries', 'userProfile', 'personalFacts', 'fossils', 'letters',
    'sessionLog', 'innerWeather', 'consent', 'sessions',
    'hrvSessions', 'relaxSessions', 'driftSessions', 'roomSessions', 'companionSignals', 'userParts',
    'sessionIntentions', 'stanceProfile', 'userValues', 'companionPromises',
    'companionPreferences', 'fieldMoments', 'interventionOutcomes', 'smsMessages',
    'researchEvents', 'personalProtocols', 'livingHypotheses',
    'folioPages', 'folioPreferences', 'folioTraces',
  ] as const

  const results = await Promise.all(
    collectionNames.map((name) => db[name].toArray()),
  )

  const data: Record<string, DocumentData[]> = {}
  collectionNames.forEach((name, i) => { data[name] = results[i] })

  // Fetch the actual conversation transcripts (sessions/{id}/messages) — the
  // summary table alone omitted every word the user and their companion said.
  const sessionDocs = data.sessions ?? []
  const messagesById: Record<string, SessionMessage[]> = {}
  await Promise.all(sessionDocs.map(async (s) => {
    const id = s.id as string
    messagesById[id] = await sessionMessages.getAll(id)
  }))

  const traceEntriesById: Record<string, DocumentData[]> = {}
  await Promise.all((data.folioTraces ?? []).map(async (tr) => {
    traceEntriesById[tr.id as string] = await folioTraceEntries(tr.id as string)
  }))

  const md = buildMarkdownExport(data, messagesById, traceEntriesById)

  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `undersurface-export-${new Date().toISOString().split('T')[0]}.md`
  a.click()
  URL.revokeObjectURL(url)
}
