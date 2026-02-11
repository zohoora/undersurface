import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
  writeBatch,
  getCountFromServer,
  where,
  deleteDoc,
} from 'firebase/firestore'
import type { DocumentData } from 'firebase/firestore'
import { firestore } from '../firebase'
import { getAuth } from 'firebase/auth'
import { SEEDED_PARTS } from '../ai/partPrompts'

function getUid(): string {
  const user = getAuth().currentUser
  if (!user) throw new Error('Not authenticated')
  return user.uid
}

function userCollection(name: string) {
  return collection(firestore, 'users', getUid(), name)
}

function userDoc(collectionName: string, id: string) {
  return doc(firestore, 'users', getUid(), collectionName, id)
}

// Wrapper that mimics the Dexie API used throughout the codebase
function createCollectionProxy(name: string) {
  return {
    async add(data: DocumentData) {
      const id = data.id as string
      await setDoc(userDoc(name, id), data)
    },

    async get(id: string) {
      const snap = await getDoc(userDoc(name, id))
      return snap.exists() ? (snap.data() as DocumentData) : undefined
    },

    async update(id: string, partial: DocumentData) {
      await updateDoc(userDoc(name, id), partial)
    },

    async delete(id: string) {
      await deleteDoc(userDoc(name, id))
    },

    async bulkPut(items: DocumentData[]) {
      const batch = writeBatch(firestore)
      for (const item of items) {
        batch.set(userDoc(name, item.id as string), item)
      }
      await batch.commit()
    },

    async count() {
      const snap = await getCountFromServer(userCollection(name))
      return snap.data().count
    },

    async toArray() {
      const snap = await getDocs(userCollection(name))
      return snap.docs.map((d) => d.data())
    },

    orderBy(field: string) {
      return {
        reverse() {
          return {
            async toArray() {
              const q = query(userCollection(name), orderBy(field, 'desc'))
              const snap = await getDocs(q)
              return snap.docs.map((d) => d.data())
            },
          }
        },
        async toArray() {
          const q = query(userCollection(name), orderBy(field, 'asc'))
          const snap = await getDocs(q)
          return snap.docs.map((d) => d.data())
        },
      }
    },

    where(field: string) {
      return {
        equals(value: unknown) {
          return {
            async toArray() {
              const q = query(userCollection(name), where(field, '==', value))
              const snap = await getDocs(q)
              return snap.docs.map((d) => d.data())
            },
          }
        },
      }
    },
  }
}

export const db = {
  entries: createCollectionProxy('entries'),
  parts: createCollectionProxy('parts'),
  memories: createCollectionProxy('memories'),
  thoughts: createCollectionProxy('thoughts'),
  interactions: createCollectionProxy('interactions'),
  entrySummaries: createCollectionProxy('entrySummaries'),
  userProfile: createCollectionProxy('userProfile'),
  fossils: createCollectionProxy('fossils'),
  letters: createCollectionProxy('letters'),
  sessionLog: createCollectionProxy('sessionLog'),
  innerWeather: createCollectionProxy('innerWeather'),
  consent: createCollectionProxy('consent'),
}

export async function initializeDB() {
  const existingParts = await db.parts.count()
  if (existingParts === 0) {
    await db.parts.bulkPut(
      SEEDED_PARTS.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        colorLight: p.colorLight,
        ifsRole: p.ifsRole,
        voiceDescription: p.voiceDescription,
        concern: p.concern,
        systemPrompt: p.systemPrompt,
        isSeeded: p.isSeeded,
        createdAt: p.createdAt,
      })),
    )
  }
}

export function generateId(): string {
  return crypto.randomUUID()
}

// ── Markdown export helpers ──

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
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

function buildMarkdownExport(collections: Record<string, DocumentData[]>): string {
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

  // Part name lookup
  const partName = new Map<string, string>()
  for (const p of parts) partName.set(p.id as string, p.name as string)
  const pn = (id: string) => partName.get(id) ?? 'Unknown Voice'

  // Index by entryId
  const thoughtsByEntry = groupBy(thoughts, (t) => t.entryId as string)
  const interactionsByEntry = groupBy(interactions, (t) => t.entryId as string)
  const summariesByEntry = groupBy(summaries, (t) => t.entryId as string)
  const fossilsByEntry = groupBy(fossils, (t) => t.entryId as string)
  const memoriesByPart = groupBy(memories, (m) => m.partId as string)

  const lines: string[] = []
  const ln = (s = '') => lines.push(s)

  // ── Header ──
  ln('# UnderSurface — Journal Export')
  ln(`*Exported on ${fmtDate(Date.now())}*`)
  ln()

  // ── User Profile ──
  const profile = profiles[0] as DocumentData | undefined
  if (profile) {
    ln('---')
    ln()
    ln('## About You')
    ln()
    if (profile.innerLandscape) {
      ln(`> ${(profile.innerLandscape as string).replace(/\n/g, '\n> ')}`)
      ln()
    }
    const fields: [string, string][] = [
      ['Recurring Themes', 'recurringThemes'],
      ['Emotional Patterns', 'emotionalPatterns'],
      ['Growth Signals', 'growthSignals'],
      ['Avoidance Patterns', 'avoidancePatterns'],
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
    ln('## Your Inner Voices')
    ln()
    for (const p of parts) {
      ln(`### ${p.name}`)
      ln(`*Role: ${p.ifsRole}*`)
      ln()
      if (p.voiceDescription) ln((p.voiceDescription as string))
      if (p.concern) ln(`\n**Concern:** ${p.concern}`)
      if (p.systemPromptAddition) ln(`\n**Growth:** ${p.systemPromptAddition}`)
      const pMems = memoriesByPart.get(p.id as string) ?? []
      const reflections = pMems.filter((m) => m.type === 'reflection' || m.type === 'pattern')
      if (reflections.length) {
        ln()
        ln('**Key reflections:**')
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
    ln('## Journal')
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
        if (intention) ln(`*Intention: ${intention}*\n`)
        ln(text || '*Empty entry*')
        ln()

        // Thoughts from inner voices
        const eThoughts = (thoughtsByEntry.get(eid) ?? [])
          .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
        if (eThoughts.length) {
          for (const t of eThoughts) {
            const anchor = t.anchorText as string
            const prefix = anchor ? ` *(responding to: "${anchor}")*` : ''
            ln(`> **${pn(t.partId as string)}:**${prefix} ${t.content}`)
            ln()
          }
        }

        // Thinking Out Loud interactions
        const eInteractions = (interactionsByEntry.get(eid) ?? [])
          .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))
        for (const ix of eInteractions) {
          ln(`**Conversation with ${pn(ix.partId as string)}:**`)
          if (ix.partOpening) ln(`> *${pn(ix.partId as string)}:* ${ix.partOpening}`)
          if (ix.userResponse) ln(`>\n> *You:* ${ix.userResponse}`)
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
            ln('**Reflection:**')
            if (themes?.length) ln(`- Themes: ${themes.join(', ')}`)
            if (arc) ln(`- Emotional arc: ${arc}`)
            if (moments?.length) ln(`- Key moments: ${moments.join('; ')}`)
            ln()
          }
        }

        // Fossils (voice commentary on past entries)
        const eFossils = fossilsByEntry.get(eid) ?? []
        for (const f of eFossils) {
          ln(`> **${pn(f.partId as string)}** reflected on this entry: ${f.commentary}`)
          ln()
        }

        ln('---')
        ln()
      }
    }
  }

  // ── Letters ──
  if (letters.length) {
    ln('## Letters from Your Voices')
    ln()
    const sorted = [...letters].sort((a, b) => (a.createdAt as number) - (b.createdAt as number))
    for (const l of sorted) {
      const names = (l.partIds as string[]).map(pn).join(' & ')
      ln(`### Letter from ${names}`)
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
    ln('## Writing Sessions')
    ln()
    ln('| Date | Time | Duration | Words |')
    ln('|------|------|----------|-------|')
    for (const s of sessions) {
      const dur = s.duration ? fmtDuration(s.duration as number) : '—'
      ln(`| ${fmtDate(s.startedAt as number)} | ${fmtTime(s.startedAt as number)} | ${dur} | ${s.wordCount ?? '—'} |`)
    }
    ln()
  }

  return lines.join('\n')
}

export async function exportAllData() {
  const collectionNames = [
    'entries', 'parts', 'memories', 'thoughts', 'interactions',
    'entrySummaries', 'userProfile', 'fossils', 'letters',
    'sessionLog', 'innerWeather', 'consent',
  ] as const

  const results = await Promise.all(
    collectionNames.map((name) => db[name].toArray()),
  )

  const data: Record<string, DocumentData[]> = {}
  collectionNames.forEach((name, i) => { data[name] = results[i] as DocumentData[] })

  const md = buildMarkdownExport(data)

  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `undersurface-export-${new Date().toISOString().split('T')[0]}.md`
  a.click()
  URL.revokeObjectURL(url)
}
