import { useEffect, useState } from 'react'
import { db } from '../../store/db'
import type { CompanionPreferences, MemoryAperture, PartMemory, PersonalFacts, Session, UserProfile } from '../../types'

const DEFAULTS: CompanionPreferences = {
  id: 'current',
  defaultMemoryAperture: 'pattern',
  fieldMosaicEnabled: true,
  outcomeSampling: 'light',
  updatedAt: 0,
}

async function savePreferences(next: CompanionPreferences, exists: boolean) {
  if (exists) await db.companionPreferences.update('current', next)
  else await db.companionPreferences.add(next)
}

async function changeProfileItem(
  profile: UserProfile,
  key: 'recurringThemes' | 'emotionalPatterns' | 'avoidancePatterns' | 'growthSignals',
  index: number,
  value: string | null,
): Promise<UserProfile> {
  const next = [...profile[key]]
  if (value === null) next.splice(index, 1)
  else next[index] = value.trim()
  const updated = { ...profile, [key]: next, lastUpdated: Date.now() }
  await db.userProfile.update('current', { [key]: next, lastUpdated: updated.lastUpdated })
  return updated
}

async function changePersonalFact(
  facts: PersonalFacts,
  key: 'people' | 'dates' | 'context' | 'currentThreads',
  index: number,
  value: string | null,
): Promise<PersonalFacts> {
  const next = [...facts[key]] as Array<Record<string, unknown>>
  if (value === null) next.splice(index, 1)
  else {
    const current = next[index]
    if (key === 'people') next[index] = { ...current, name: value.trim() }
    if (key === 'dates') next[index] = { ...current, event: value.trim() }
    if (key === 'context') next[index] = { ...current, value: value.trim() }
    if (key === 'currentThreads') next[index] = { ...current, topic: value.trim() }
  }
  const updated = { ...facts, [key]: next, lastUpdated: Date.now() } as PersonalFacts
  await db.personalFacts.update('current', { [key]: next, lastUpdated: updated.lastUpdated })
  return updated
}

function withPreference<K extends keyof CompanionPreferences>(preferences: CompanionPreferences, key: K, value: CompanionPreferences[K]): CompanionPreferences {
  return { ...preferences, [key]: value, updatedAt: Date.now() }
}

async function changeInnerLandscape(profile: UserProfile, value: string): Promise<UserProfile> {
  const updated = { ...profile, innerLandscape: value.trim(), lastUpdated: Date.now() }
  await db.userProfile.update('current', { innerLandscape: updated.innerLandscape, lastUpdated: updated.lastUpdated })
  return updated
}

async function changeLexicon(facts: PersonalFacts, index: number, value: string | null): Promise<PersonalFacts> {
  const lexicon = [...(facts.lexicon ?? [])]
  if (value === null) lexicon.splice(index, 1)
  else lexicon[index] = value.trim()
  const updated = { ...facts, lexicon, lastUpdated: Date.now() }
  await db.personalFacts.update('current', { lexicon, lastUpdated: updated.lastUpdated })
  return updated
}

function MemoryLedger() {
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [facts, setFacts] = useState<PersonalFacts | null>(null)
  const [memories, setMemories] = useState<PartMemory[]>([])
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    if (!open) return
    void Promise.all([
      db.userProfile.get('current'),
      db.personalFacts.get('current'),
      db.memories.orderBy('timestamp').reverse().limit(20).toArray(),
      db.sessions.orderBy('startedAt').reverse().limit(12).toArray(),
    ]).then(([nextProfile, nextFacts, nextMemories, nextSessions]) => {
      setProfile(nextProfile ?? null)
      setFacts(nextFacts ?? null)
      setMemories(nextMemories)
      setSessions(nextSessions.filter(session => Boolean(session.sessionNote)))
    })
  }, [open])

  const updateProfileItem = async (key: 'recurringThemes' | 'emotionalPatterns' | 'avoidancePatterns' | 'growthSignals', index: number, value: string | null) => {
    if (!profile) return
    setProfile(await changeProfileItem(profile, key, index, value))
  }

  const updateFact = async (key: 'people' | 'dates' | 'context' | 'currentThreads', index: number, value: string | null) => {
    if (!facts) return
    setFacts(await changePersonalFact(facts, key, index, value))
  }

  const row = (id: string, source: string, value: string, date: number | undefined, onSave: (value: string) => void, onForget: () => void) => (
    <div key={id} style={{ padding: '8px 0', borderTop: '1px solid var(--border-light)' }}>
      <textarea
        defaultValue={value}
        aria-label="Remembered detail"
        rows={2}
        onBlur={(event) => {
          const next = event.target.value.trim()
          if (next && next !== value) onSave(next)
        }}
        style={{ width: '100%', resize: 'vertical', border: 0, background: 'transparent', color: 'var(--text-primary)', font: "11px/1.45 'Inter', sans-serif", padding: 0 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--text-ghost)', fontSize: 9 }}>
        <span>{source} · {date ? new Date(date).toLocaleDateString() : 'date unavailable'}</span>
        <button onClick={onForget} style={{ border: 0, background: 'none', color: 'var(--text-secondary)', fontSize: 9, cursor: 'pointer' }}>forget</button>
      </div>
    </div>
  )

  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={() => setOpen(value => !value)} aria-expanded={open} style={{ width: '100%', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '6px 10px', background: 'none', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer' }}>
        {open ? 'Hide what the companion remembers' : 'Review what the companion remembers'}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{ color: 'var(--text-ghost)', fontSize: 10, lineHeight: 1.4, marginBottom: 8 }}>These are working notes, not facts about who you are. Correct or forget anything.</div>
          {profile && (['recurringThemes', 'emotionalPatterns', 'avoidancePatterns', 'growthSignals'] as const).flatMap(key =>
            profile[key].map((value, index) => row(`profile-${key}-${index}`, 'inferred across sessions', value, profile.lastUpdated, next => void updateProfileItem(key, index, next), () => void updateProfileItem(key, index, null))),
          )}
          {profile?.innerLandscape && row('profile-landscape', 'inferred across sessions', profile.innerLandscape, profile.lastUpdated, next => void changeInnerLandscape(profile, next).then(setProfile), () => void changeInnerLandscape(profile, '').then(setProfile))}
          {facts && facts.people.map((item, index) => row(`person-${index}`, 'concrete detail', item.name, facts.lastUpdated, next => void updateFact('people', index, next), () => void updateFact('people', index, null)))}
          {facts && facts.dates.map((item, index) => row(`date-${index}`, `date: ${item.date}`, item.event, facts.lastUpdated, next => void updateFact('dates', index, next), () => void updateFact('dates', index, null)))}
          {facts && facts.context.map((item, index) => row(`context-${index}`, item.category, item.value, facts.lastUpdated, next => void updateFact('context', index, next), () => void updateFact('context', index, null)))}
          {facts && facts.currentThreads.map((item, index) => row(`thread-${index}`, 'current thread', item.topic, item.addedAt, next => void updateFact('currentThreads', index, next), () => void updateFact('currentThreads', index, null)))}
          {facts && (facts.lexicon ?? []).map((phrase, index) => row(`phrase-${index}`, 'your own phrase', phrase, facts.lastUpdated, next => void changeLexicon(facts, index, next).then(setFacts), () => void changeLexicon(facts, index, null).then(setFacts)))}
          {sessions.map(session => row(`session-${session.id}`, 'session note', session.sessionNote ?? '', session.endedAt ?? session.startedAt, next => {
            setSessions(list => list.map(item => item.id === session.id ? { ...item, sessionNote: next } : item))
            void db.sessions.update(session.id, { sessionNote: next })
          }, () => {
            setSessions(list => list.filter(item => item.id !== session.id))
            void db.sessions.update(session.id, { sessionNote: null })
          }))}
          {memories.map(memory => row(`memory-${memory.id}`, memory.source ?? memory.type ?? 'session memory', memory.content, memory.timestamp, next => {
            setMemories(list => list.map(item => item.id === memory.id ? { ...item, content: next } : item))
            void db.memories.update(memory.id, { content: next })
          }, () => {
            setMemories(list => list.filter(item => item.id !== memory.id))
            void db.memories.delete(memory.id)
          }))}
          {!profile && !facts && memories.length === 0 && sessions.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-ghost)' }}>No durable memory yet.</div>}
        </div>
      )}
    </div>
  )
}

export function CompanionPreferencesSection({ isOpen }: { isOpen: boolean }) {
  const [preferences, setPreferences] = useState(DEFAULTS)
  const [exists, setExists] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    void db.companionPreferences.get('current').then(value => {
      if (value) {
        setExists(true)
        setPreferences({ ...DEFAULTS, ...value })
      }
    })
  }, [isOpen])

  const change = <K extends keyof CompanionPreferences>(key: K, value: CompanionPreferences[K]) => {
    const next = withPreference(preferences, key, value)
    setPreferences(next)
    void savePreferences(next, exists).then(() => setExists(true))
  }

  const apertures: Array<{ value: MemoryAperture; label: string }> = [
    { value: 'fresh', label: 'Fresh eyes' },
    { value: 'light', label: 'Light' },
    { value: 'pattern', label: 'Patterns' },
    { value: 'counterstory', label: 'Counterstory' },
  ]

  return (
    <div className="settings-section">
      <div className="settings-section-label">Companion memory</div>
      <div style={{ color: 'var(--text-ghost)', fontSize: 10, lineHeight: 1.45, marginBottom: 8 }}>Choose how much history enters new Talk, Speak, and SMS conversations.</div>
      <select value={preferences.defaultMemoryAperture} onChange={event => change('defaultMemoryAperture', event.target.value as MemoryAperture)} style={{ width: '100%', padding: '5px 7px', border: '1px solid var(--border-subtle)', borderRadius: 4, background: 'var(--surface-primary)', color: 'var(--text-primary)', fontSize: 11 }}>
        {apertures.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10, color: 'var(--text-secondary)', fontSize: 11 }}>
        Field mosaic
        <input type="checkbox" checked={preferences.fieldMosaicEnabled} onChange={event => change('fieldMosaicEnabled', event.target.checked)} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8, color: 'var(--text-secondary)', fontSize: 11 }}>
        Occasional outcome check-ins
        <input type="checkbox" checked={preferences.outcomeSampling === 'light'} onChange={event => change('outcomeSampling', event.target.checked ? 'light' : 'off')} />
      </label>
      <MemoryLedger />
    </div>
  )
}
