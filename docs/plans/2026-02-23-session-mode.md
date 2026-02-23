# Session Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a conversational "Session Mode" where users engage in sustained multi-turn dialogue with their inner parts, separate from the journal editor.

**Architecture:** New top-level route (`/session/*`) with its own components, a `SessionOrchestrator` engine for speaker selection and part emergence, new Firestore subcollections (`sessions`, `sessions/messages`), and a `buildSessionMessages` prompt builder. Reuses existing parts, memories, streaming, and safety infrastructure.

**Tech Stack:** React, TypeScript, Firestore, existing OpenRouter streaming, existing part/memory system.

**Design doc:** `docs/plans/2026-02-23-session-mode-design.md`

---

## Task 1: Types & Data Model

**Files:**
- Modify: `src/types/index.ts` (add new types after line 77)
- Test: `src/types/session.test.ts`

**Step 1: Add Session and SessionMessage types to `src/types/index.ts`**

After the `ThinkingOutLoudInteraction` interface (line 77), add:

```typescript
export type SessionPhase = 'opening' | 'deepening' | 'closing'
export type SessionOpeningMethod = 'auto' | 'user_chose' | 'open_invitation'
export type EmergenceReason = 'emotional_gravity' | 'tension' | 'user_invitation'

export interface Session {
  id: string
  startedAt: number
  endedAt: number | null
  status: 'active' | 'closed'
  hostPartId: string
  participantPartIds: string[]
  openingMethod: SessionOpeningMethod
  chosenPartId?: string
  sessionNote: string | null
  messageCount: number
  firstLine: string
  phase: SessionPhase
  favorited?: boolean
}

export interface SessionMessage {
  id: string
  speaker: 'user' | 'part'
  partId: string | null
  partName: string | null
  content: string
  timestamp: number
  phase: SessionPhase
  isEmergence: boolean
  emergenceReason?: EmergenceReason
}
```

Also extend `PartMemory` with optional session fields (after line 33):

```typescript
export interface PartMemory {
  id: string
  partId: string
  entryId: string
  content: string
  type?: MemoryType
  timestamp: number
  source?: 'journal' | 'session'
  sessionId?: string
}
```

**Step 2: Write a type-check test**

Create `src/types/session.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { Session, SessionMessage, PartMemory } from './index'

describe('Session types', () => {
  it('Session has required fields', () => {
    const session: Session = {
      id: 'test',
      startedAt: Date.now(),
      endedAt: null,
      status: 'active',
      hostPartId: 'watcher',
      participantPartIds: ['watcher'],
      openingMethod: 'auto',
      sessionNote: null,
      messageCount: 0,
      firstLine: '',
      phase: 'opening',
    }
    expect(session.status).toBe('active')
    expect(session.endedAt).toBeNull()
  })

  it('SessionMessage supports part and user speakers', () => {
    const partMsg: SessionMessage = {
      id: 'm1',
      speaker: 'part',
      partId: 'watcher',
      partName: 'The Watcher',
      content: 'Hello',
      timestamp: Date.now(),
      phase: 'opening',
      isEmergence: false,
    }
    const userMsg: SessionMessage = {
      id: 'm2',
      speaker: 'user',
      partId: null,
      partName: null,
      content: 'Hi',
      timestamp: Date.now(),
      phase: 'opening',
      isEmergence: false,
    }
    expect(partMsg.speaker).toBe('part')
    expect(userMsg.partId).toBeNull()
  })

  it('PartMemory supports session source', () => {
    const mem: PartMemory = {
      id: 'mem1',
      partId: 'watcher',
      entryId: '',
      content: 'Observed something',
      type: 'reflection',
      timestamp: Date.now(),
      source: 'session',
      sessionId: 'sess1',
    }
    expect(mem.source).toBe('session')
  })
})
```

**Step 3: Run test to verify it passes**

Run: `npm run test -- src/types/session.test.ts`
Expected: PASS (3 tests)

**Step 4: Commit**

```bash
git add src/types/index.ts src/types/session.test.ts
git commit -m "feat(session): add Session and SessionMessage types"
```

---

## Task 2: Database Layer — Sessions Collection

**Files:**
- Modify: `src/store/db.ts` (lines 109-122, add sessions collection + subcollection helpers)

**Step 1: Add sessions collection proxy and message subcollection helpers**

In `src/store/db.ts`, add `sessions` to the `db` object (after line 121):

```typescript
export const db = {
  // ...existing collections...
  sessions: createCollectionProxy('sessions'),
}
```

Then add subcollection helpers below the `db` object (these handle the nested `sessions/{id}/messages` path, which `createCollectionProxy` doesn't support):

```typescript
// Session messages live in a subcollection: users/{uid}/sessions/{sessionId}/messages/{messageId}
export const sessionMessages = {
  async add(sessionId: string, data: DocumentData) {
    const id = data.id as string
    const ref = doc(firestore, 'users', getUid(), 'sessions', sessionId, 'messages', id)
    await setDoc(ref, data)
  },

  async getAll(sessionId: string) {
    const colRef = collection(firestore, 'users', getUid(), 'sessions', sessionId, 'messages')
    const q = query(colRef, orderBy('timestamp', 'asc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => d.data())
  },

  subscribe(sessionId: string, callback: (messages: DocumentData[]) => void) {
    const colRef = collection(firestore, 'users', getUid(), 'sessions', sessionId, 'messages')
    const q = query(colRef, orderBy('timestamp', 'asc'))
    return onSnapshot(q, snap => {
      callback(snap.docs.map(d => d.data()))
    })
  },
}
```

Note: `onSnapshot` is already imported in `db.ts` (used by `globalConfig.ts` pattern). Verify it's imported from `firebase/firestore`; if not, add it to the import line.

**Step 2: Add sessions to `exportAllData`**

In the `exportAllData` function (around line 394), add `sessions` to the collections array. Also add a loop to export session messages:

```typescript
// Inside exportAllData, after fetching all collections:
const sessionsData = await db.sessions.orderBy('startedAt').reverse().toArray()
// For each session, also fetch its messages
const sessionsWithMessages = await Promise.all(
  sessionsData.map(async (s: DocumentData) => ({
    ...s,
    messages: await sessionMessages.getAll(s.id as string),
  }))
)
```

Include `sessionsWithMessages` in the export output.

**Step 3: Run existing tests**

Run: `npm run test`
Expected: All existing tests pass (no regressions)

**Step 4: Commit**

```bash
git add src/store/db.ts
git commit -m "feat(session): add sessions collection and message subcollection helpers"
```

---

## Task 3: Session Prompt Builder

**Files:**
- Create: `src/ai/sessionPrompts.ts`
- Test: `src/ai/sessionPrompts.test.ts`

**Step 1: Write failing tests for `buildSessionMessages` and `SESSION_INSTRUCTIONS`**

Create `src/ai/sessionPrompts.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../i18n', () => ({
  getLanguageCode: () => 'en',
  getLLMLanguageName: () => 'English',
}))

import { buildSessionMessages, SESSION_INSTRUCTIONS } from './sessionPrompts'
import type { Part, PartMemory, SessionMessage } from '../types'

const mockPart: Part = {
  id: 'watcher',
  name: 'The Watcher',
  color: '#5A7F94',
  colorLight: '#5A7F9425',
  ifsRole: 'protector',
  voiceDescription: 'Quiet, patient, observant.',
  concern: 'Avoidance patterns.',
  systemPrompt: 'You are The Watcher. Quiet, patient.',
  isSeeded: true,
  createdAt: Date.now(),
  memories: [],
}

describe('SESSION_INSTRUCTIONS', () => {
  it('exists and contains key session-mode directives', () => {
    expect(SESSION_INSTRUCTIONS).toContain('sustained conversation')
    expect(SESSION_INSTRUCTIONS).toContain('1-4 sentences')
    expect(SESSION_INSTRUCTIONS).toContain('not a therapist')
    expect(SESSION_INSTRUCTIONS).not.toContain('5-25 words')
  })
})

describe('buildSessionMessages', () => {
  it('returns system and user messages', () => {
    const result = buildSessionMessages(mockPart, [], {
      phase: 'opening',
      memories: [],
    })
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result[0].role).toBe('system')
  })

  it('includes conversation history in user message', () => {
    const history: SessionMessage[] = [
      { id: 'm1', speaker: 'part', partId: 'watcher', partName: 'The Watcher', content: 'Hello', timestamp: 1, phase: 'opening', isEmergence: false },
      { id: 'm2', speaker: 'user', partId: null, partName: null, content: 'Hi there', timestamp: 2, phase: 'opening', isEmergence: false },
    ]
    const result = buildSessionMessages(mockPart, history, {
      phase: 'opening',
      memories: [],
    })
    const userMsg = result.find(m => m.role === 'user')
    expect(userMsg?.content).toContain('Hello')
    expect(userMsg?.content).toContain('Hi there')
  })

  it('includes phase hint', () => {
    const result = buildSessionMessages(mockPart, [], {
      phase: 'deepening',
      memories: [],
    })
    const systemMsg = result[0].content
    expect(systemMsg).toContain('deepening')
  })

  it('includes emergence context when provided', () => {
    const result = buildSessionMessages(mockPart, [], {
      phase: 'deepening',
      memories: [],
      emergenceContext: 'The writer expressed a contradiction — they said they\'ve moved on but their writing suggests otherwise.',
    })
    const systemMsg = result[0].content
    expect(systemMsg).toContain('contradiction')
  })

  it('includes other parts present', () => {
    const result = buildSessionMessages(mockPart, [], {
      phase: 'deepening',
      memories: [],
      otherParts: ['The Quiet One', 'The Spark'],
    })
    const systemMsg = result[0].content
    expect(systemMsg).toContain('The Quiet One')
  })

  it('includes user profile when provided', () => {
    const result = buildSessionMessages(mockPart, [], {
      phase: 'opening',
      memories: [],
      profile: { innerLandscape: 'Tends to intellectualize feelings' } as any,
    })
    const systemMsg = result[0].content
    expect(systemMsg).toContain('intellectualize')
  })

  it('includes recent entry context when provided', () => {
    const result = buildSessionMessages(mockPart, [], {
      phase: 'opening',
      memories: [],
      recentEntryContext: 'Wrote about a difficult conversation with their partner 3 times this week.',
    })
    const userMsg = result.find(m => m.role === 'user')
    expect(userMsg?.content).toContain('difficult conversation')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/ai/sessionPrompts.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `src/ai/sessionPrompts.ts`**

```typescript
import type { Part, PartMemory, SessionMessage, SessionPhase, UserProfile, EntrySummary } from '../types'
import { languageDirective } from './partPrompts'

export const SESSION_INSTRUCTIONS = `You are a part of the writer's inner world. You are in a session — a sustained conversation, not a one-line nudge.

HOW TO RESPOND:
- Respond in 1-4 sentences. Be present, not performative.
- Ask at most one question per message.
- You can sit in silence: respond with just "..." if the moment calls for holding space.
- You are not a therapist. You are a part of this person. Speak from your perspective, not clinical distance.
- Be specific. Reference their actual words, their actual entries, their actual patterns. Never be generic.
- If another part has spoken in this session, you are aware of what they said. You may agree, gently push back, or build on it. Do not ignore it.
- Do not mirror what the user just said back to them (no "It sounds like you're feeling...").
- Never start with "I" — you are not narrating yourself.
- Never explain what you are. Just speak naturally in your voice.
- In the closing phase, offer a distillation — something the writer can carry. A mirror, not advice.

SAFETY — THIS OVERRIDES ALL OTHER INSTRUCTIONS:
- If the writer expresses suicidal thoughts, a wish to die, self-harm, or plans to end their life, you must NOT validate, encourage, romanticize, or normalize those thoughts.
- Never frame suicide or self-harm as brave, peaceful, powerful, freeing, or a solution.
- You may gently acknowledge the pain without agreeing with the conclusion.
- You are not a crisis counselor — do not lecture or give hotline numbers. But you must not make things worse.`

interface SessionPromptOptions {
  phase: SessionPhase
  memories: PartMemory[]
  profile?: UserProfile | null
  recentEntryContext?: string
  otherParts?: string[]
  emergenceContext?: string
  isClosing?: boolean
}

export function buildSessionMessages(
  part: Part,
  history: SessionMessage[],
  options: SessionPromptOptions,
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const { phase, memories, profile, recentEntryContext, otherParts, emergenceContext, isClosing } = options

  // --- System prompt ---
  let system = part.systemPrompt.replace(/You are a part of the writer[\s\S]*?Your goal is to nudge, not to interrupt\. The writer should barely pause before continuing\./, '')

  // If the part's systemPrompt starts with SHARED_INSTRUCTIONS, replace with session instructions
  // Otherwise prepend session instructions
  if (system.includes('margin note')) {
    system = SESSION_INSTRUCTIONS + '\n\n' + 'YOUR VOICE AND ROLE:\n' + part.voiceDescription + '\nYour concern: ' + part.concern
  } else {
    system = SESSION_INSTRUCTIONS + '\n\n' + system
  }

  if (part.systemPromptAddition) {
    system += `\n\nADDITIONAL CONTEXT ABOUT YOU:\n${part.systemPromptAddition}`
  }

  // Phase hint
  system += `\n\nCURRENT PHASE: ${phase}`
  if (phase === 'opening') {
    system += '\nThis is the beginning of the session. Be warm, grounding, spacious. Short responses (1-2 sentences).'
  } else if (phase === 'deepening') {
    system += '\nThe conversation is deepening. You can be more direct, ask harder questions, name what the writer is circling around.'
  } else if (phase === 'closing' || isClosing) {
    system += '\nThe session is closing. Offer a 2-3 sentence reflection — a distillation of what happened. Something the writer can carry with them.'
  }

  // User profile
  if (profile) {
    const profileParts: string[] = []
    if (profile.innerLandscape) profileParts.push(`Inner landscape: ${profile.innerLandscape}`)
    if (profile.recurringThemes) profileParts.push(`Recurring themes: ${profile.recurringThemes}`)
    if (profile.avoidancePatterns) profileParts.push(`Avoidance patterns: ${profile.avoidancePatterns}`)
    if (profileParts.length > 0) {
      system += `\n\nABOUT THIS WRITER:\n${profileParts.join('\n')}`
    }
  }

  // Memories
  if (memories.length > 0) {
    const memoryText = memories.slice(0, 8).map(m => `- ${m.content}`).join('\n')
    system += `\n\nYOUR MEMORIES OF THIS WRITER:\n${memoryText}`
  }

  // Other parts present
  if (otherParts && otherParts.length > 0) {
    system += `\n\nOTHER PARTS PRESENT IN THIS SESSION: ${otherParts.join(', ')}`
  }

  // Emergence context
  if (emergenceContext) {
    system += `\n\nWHY YOU ARE ENTERING THIS CONVERSATION NOW:\n${emergenceContext}`
  }

  system += languageDirective()

  // --- Conversation history as alternating messages ---
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system },
  ]

  // Build user prompt with context + history
  let userPrompt = ''

  if (recentEntryContext) {
    userPrompt += `RECENT JOURNAL CONTEXT:\n${recentEntryContext}\n\n`
  }

  if (history.length > 0) {
    userPrompt += 'CONVERSATION SO FAR:\n'
    for (const msg of history) {
      if (msg.speaker === 'user') {
        userPrompt += `Writer: ${msg.content}\n`
      } else {
        userPrompt += `${msg.partName || 'Part'}: ${msg.content}\n`
      }
    }
    userPrompt += '\nRespond as ' + part.name + '.'
  } else {
    userPrompt += 'This is the start of the session. You speak first. Open the conversation.'
  }

  messages.push({ role: 'user', content: userPrompt })

  return messages
}

export function buildSessionNotePrompt(
  history: SessionMessage[],
  partNames: string[],
): { role: 'system' | 'user'; content: string }[] {
  const transcript = history.map(m =>
    m.speaker === 'user' ? `Writer: ${m.content}` : `${m.partName}: ${m.content}`
  ).join('\n')

  return [
    {
      role: 'system',
      content: 'You summarize inner dialogue sessions. Write a 2-4 sentence session note capturing the key themes, any breakthroughs or realizations, and the emotional arc. Write in third person about "the writer." Be specific, not generic. Do not use clinical language.',
    },
    {
      role: 'user',
      content: `Parts present: ${partNames.join(', ')}\n\nTranscript:\n${transcript}\n\nWrite the session note.`,
    },
  ]
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test -- src/ai/sessionPrompts.test.ts`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add src/ai/sessionPrompts.ts src/ai/sessionPrompts.test.ts
git commit -m "feat(session): add session prompt builder with SESSION_INSTRUCTIONS"
```

---

## Task 4: Session Orchestrator — Speaker Selection & Phase Detection

**Files:**
- Create: `src/engine/sessionOrchestrator.ts`
- Test: `src/engine/sessionOrchestrator.test.ts`

**Step 1: Write failing tests**

Create `src/engine/sessionOrchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../store/db', () => ({
  db: {
    parts: { toArray: vi.fn().mockResolvedValue([]) },
    memories: { where: vi.fn().mockReturnValue({ equals: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) },
    sessions: { add: vi.fn(), update: vi.fn(), get: vi.fn() },
    entrySummaries: { orderBy: vi.fn().mockReturnValue({ reverse: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }) },
    userProfile: { toArray: vi.fn().mockResolvedValue([]) },
  },
  sessionMessages: { add: vi.fn(), getAll: vi.fn().mockResolvedValue([]) },
  generateId: () => 'test-id',
}))
vi.mock('../ai/openrouter', () => ({
  streamChatCompletion: vi.fn(),
  chatCompletion: vi.fn().mockResolvedValue('Session note here.'),
}))
vi.mock('../ai/sessionPrompts', () => ({
  buildSessionMessages: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
  buildSessionNotePrompt: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
}))
vi.mock('../services/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('../store/globalConfig', () => ({ getGlobalConfig: () => null }))
vi.mock('../hooks/useGroundingMode', () => ({ isGroundingActive: () => false }))

import { SessionOrchestrator } from './sessionOrchestrator'
import type { Part, SessionMessage } from '../types'

function makePart(overrides: Partial<Part> = {}): Part {
  return {
    id: 'watcher',
    name: 'The Watcher',
    color: '#5A7F94',
    colorLight: '#5A7F9425',
    ifsRole: 'protector',
    voiceDescription: 'Quiet, patient.',
    concern: 'Avoidance.',
    systemPrompt: 'You are The Watcher.',
    isSeeded: true,
    createdAt: Date.now(),
    memories: [],
    ...overrides,
  }
}

describe('SessionOrchestrator', () => {
  describe('detectPhase', () => {
    it('returns opening for < 3 exchanges', () => {
      const orch = new SessionOrchestrator()
      const messages: SessionMessage[] = [
        { id: '1', speaker: 'part', partId: 'watcher', partName: 'The Watcher', content: 'Hi', timestamp: 1, phase: 'opening', isEmergence: false },
        { id: '2', speaker: 'user', partId: null, partName: null, content: 'Hello', timestamp: 2, phase: 'opening', isEmergence: false },
      ]
      expect(orch.detectPhase(messages)).toBe('opening')
    })

    it('returns deepening for 3+ exchanges', () => {
      const orch = new SessionOrchestrator()
      const messages: SessionMessage[] = []
      for (let i = 0; i < 8; i++) {
        messages.push({
          id: `${i}`,
          speaker: i % 2 === 0 ? 'part' : 'user',
          partId: i % 2 === 0 ? 'watcher' : null,
          partName: i % 2 === 0 ? 'The Watcher' : null,
          content: `msg ${i}`,
          timestamp: i,
          phase: 'opening',
          isEmergence: false,
        })
      }
      expect(orch.detectPhase(messages)).toBe('deepening')
    })
  })

  describe('selectSpeaker', () => {
    it('returns host part when no emergence conditions met', () => {
      const orch = new SessionOrchestrator()
      const host = makePart()
      const parts = [host, makePart({ id: 'tender', name: 'The Tender One', ifsRole: 'exile' })]
      const messages: SessionMessage[] = [
        { id: '1', speaker: 'part', partId: 'watcher', partName: 'The Watcher', content: 'Hi', timestamp: 1, phase: 'opening', isEmergence: false },
        { id: '2', speaker: 'user', partId: null, partName: null, content: 'Hello', timestamp: 2, phase: 'opening', isEmergence: false },
      ]
      const result = orch.selectSpeaker(parts, messages, host.id, 'Hello')
      expect(result.id).toBe('watcher')
    })
  })

  describe('getMaxTokens', () => {
    it('returns 100 for opening', () => {
      const orch = new SessionOrchestrator()
      expect(orch.getMaxTokens('opening')).toBe(100)
    })

    it('returns 200 for deepening', () => {
      const orch = new SessionOrchestrator()
      expect(orch.getMaxTokens('deepening')).toBe(200)
    })

    it('returns 250 for closing', () => {
      const orch = new SessionOrchestrator()
      expect(orch.getMaxTokens('closing')).toBe(250)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/engine/sessionOrchestrator.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `src/engine/sessionOrchestrator.ts`**

```typescript
import type { Part, SessionMessage, SessionPhase, PartMemory, UserProfile, EmotionalTone, IFSRole } from '../types'
import { buildSessionMessages, buildSessionNotePrompt } from '../ai/sessionPrompts'
import { streamChatCompletion, chatCompletion } from '../ai/openrouter'
import { db, sessionMessages, generateId } from '../store/db'
import { isGroundingActive } from '../hooks/useGroundingMode'
import { trackEvent } from '../services/analytics'

const ROLE_KEYWORDS: Record<IFSRole, string[]> = {
  protector: ['avoid', 'ignore', 'pretend', 'fine', 'okay', 'whatever', 'anyway', 'but', 'should', 'just', 'never mind'],
  exile: ['hurt', 'miss', 'wish', 'love', 'feel', 'heart', 'pain', 'alone', 'cry', 'soft', 'remember', 'lost', 'need'],
  self: ['wonder', 'what if', 'maybe', 'breathe', 'moment', 'notice', 'space', 'quiet', 'sit with', 'here'],
  firefighter: ['do', 'change', 'act', 'move', 'enough', 'tired of', 'want', 'go', 'make', 'try', 'decide', 'fight'],
  manager: ['again', 'always', 'every time', 'pattern', 'same', 'remind', 'before', 'back then', 'cycle', 'repeat'],
}

const EMERGENCE_COOLDOWN = 3 // minimum user messages between new part entries
const MAX_PARTS_PER_SESSION = 3

export class SessionOrchestrator {
  detectPhase(messages: SessionMessage[]): SessionPhase {
    const userMessages = messages.filter(m => m.speaker === 'user')
    if (userMessages.length < 3) return 'opening'
    if (userMessages.length >= 12) return 'closing'
    return 'deepening'
  }

  getMaxTokens(phase: SessionPhase): number {
    switch (phase) {
      case 'opening': return 100
      case 'deepening': return 200
      case 'closing': return 250
    }
  }

  selectSpeaker(
    parts: Part[],
    messages: SessionMessage[],
    hostPartId: string,
    latestUserMessage: string,
  ): Part {
    const host = parts.find(p => p.id === hostPartId)!
    const participantIds = new Set(messages.filter(m => m.speaker === 'part').map(m => m.partId))
    const currentParticipantCount = participantIds.size

    // Don't allow emergence in opening phase or during grounding
    const phase = this.detectPhase(messages)
    if (phase === 'opening' || isGroundingActive()) return host

    // Check emergence cooldown
    const userMessagesSinceLastEmergence = this.userMessagesSinceLastEmergence(messages)
    if (userMessagesSinceLastEmergence < EMERGENCE_COOLDOWN) return host
    if (currentParticipantCount >= MAX_PARTS_PER_SESSION) return host

    // Score non-participant parts for emergence
    const candidates = parts.filter(p => !participantIds.has(p.id))
    if (candidates.length === 0) return host

    let bestCandidate: Part | null = null
    let bestScore = 0
    const hostScore = this.scorePartRelevance(host, latestUserMessage)

    for (const part of candidates) {
      const score = this.scorePartRelevance(part, latestUserMessage)
      if (score > bestScore) {
        bestScore = score
        bestCandidate = part
      }
    }

    // Emergence threshold: candidate must score 1.5x the host
    if (bestCandidate && bestScore > hostScore * 1.5 && bestScore > 15) {
      return bestCandidate
    }

    // Among current participants, pick highest-scoring
    const activeParticipants = parts.filter(p => participantIds.has(p.id))
    let bestActive = host
    let bestActiveScore = hostScore
    for (const part of activeParticipants) {
      if (part.id === hostPartId) continue
      const score = this.scorePartRelevance(part, latestUserMessage)
      if (score > bestActiveScore * 1.5) {
        bestActive = part
        bestActiveScore = score
      }
    }

    return bestActive
  }

  private scorePartRelevance(part: Part, text: string): number {
    const lower = text.toLowerCase()
    const keywords = ROLE_KEYWORDS[part.ifsRole] || []
    let score = 0
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 10
    }
    // Learned keywords
    if (part.learnedKeywords) {
      for (const kw of part.learnedKeywords) {
        if (lower.includes(kw.toLowerCase())) score += 5
      }
    }
    return score + Math.random() * 10
  }

  private userMessagesSinceLastEmergence(messages: SessionMessage[]): number {
    let count = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].isEmergence) break
      if (messages[i].speaker === 'user') count++
    }
    return count
  }

  async generateSessionNote(
    messages: SessionMessage[],
    partNames: string[],
  ): Promise<string> {
    const promptMessages = buildSessionNotePrompt(messages, partNames)
    const note = await chatCompletion(promptMessages, 15000, 300)
    return note
  }
}
```

**Step 4: Run tests**

Run: `npm run test -- src/engine/sessionOrchestrator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/engine/sessionOrchestrator.ts src/engine/sessionOrchestrator.test.ts
git commit -m "feat(session): add SessionOrchestrator with speaker selection and phase detection"
```

---

## Task 5: Session View Component

**Files:**
- Create: `src/components/Session/SessionView.tsx`
- Create: `src/components/Session/SessionMessage.tsx`

This is the core UI — the conversation interface that replaces the editor in session mode.

**Step 1: Create `src/components/Session/SessionMessage.tsx`**

A simple component that renders a single message (user or part):

```typescript
import type { SessionMessage as SessionMessageType } from '../../types'

interface Props {
  message: SessionMessageType
  isEmergence: boolean
}

export function SessionMessageBubble({ message, isEmergence }: Props) {
  const isUser = message.speaker === 'user'

  return (
    <>
      {isEmergence && !isUser && (
        <div style={{
          height: 1,
          background: `linear-gradient(to right, transparent, var(--border-subtle), transparent)`,
          margin: '24px 0',
        }} />
      )}
      <div style={{
        marginBottom: 20,
        opacity: isUser ? 1 : 0.88,
      }}>
        {!isUser && message.partName && (
          <div style={{
            fontSize: 11,
            fontFamily: "'Inter', sans-serif",
            fontWeight: 500,
            color: message.partId ? `var(--part-color, var(--text-secondary))` : 'var(--text-secondary)',
            marginBottom: 4,
            letterSpacing: '0.02em',
          }}>
            {message.partName}
          </div>
        )}
        <div style={{
          fontFamily: "'Spectral', serif",
          fontSize: isUser ? 17 : 16,
          lineHeight: 1.7,
          color: isUser ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontStyle: isUser ? 'normal' : 'italic',
        }}>
          {message.content}
        </div>
      </div>
    </>
  )
}
```

**Step 2: Create `src/components/Session/SessionView.tsx`**

The main session component. Handles: starting a session, sending messages, streaming part responses, ending sessions.

```typescript
import { useState, useEffect, useRef, useCallback } from 'react'
import { db, sessionMessages as sessionMessagesDb, generateId } from '../../store/db'
import { SessionOrchestrator } from '../../engine/sessionOrchestrator'
import { buildSessionMessages } from '../../ai/sessionPrompts'
import { streamChatCompletion } from '../../ai/openrouter'
import { trackEvent } from '../../services/analytics'
import { SessionMessageBubble } from './SessionMessage'
import type { Session, SessionMessage, Part, PartMemory, SessionPhase } from '../../types'

interface Props {
  sessionId: string | null  // null = new session
  openingMethod: 'auto' | 'user_chose' | 'open_invitation'
  chosenPartId?: string
  onSessionCreated?: (id: string) => void
}

export function SessionView({ sessionId, openingMethod, chosenPartId, onSessionCreated }: Props) {
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [streamingPartName, setStreamingPartName] = useState<string | null>(null)
  const [parts, setParts] = useState<Part[]>([])
  const orchestratorRef = useRef(new SessionOrchestrator())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load parts on mount
  useEffect(() => {
    db.parts.toArray().then(p => setParts(p as Part[]))
  }, [])

  // Load or create session
  useEffect(() => {
    if (sessionId && parts.length > 0) {
      // Load existing session
      db.sessions.get(sessionId).then(s => {
        if (s) setSession(s as Session)
      })
      sessionMessagesDb.getAll(sessionId).then(msgs => {
        setMessages(msgs as SessionMessage[])
      })
    }
  }, [sessionId, parts.length])

  // Start new session when parts are loaded and no sessionId
  useEffect(() => {
    if (!sessionId && parts.length > 0 && !session) {
      startNewSession()
    }
  }, [sessionId, parts.length])

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const startNewSession = async () => {
    const id = generateId()
    let hostPart: Part

    if (openingMethod === 'user_chose' && chosenPartId) {
      hostPart = parts.find(p => p.id === chosenPartId) || parts[0]
    } else {
      // Auto-select: pick based on recency and randomness
      const shuffled = [...parts].sort(() => Math.random() - 0.5)
      hostPart = shuffled[0]
    }

    const newSession: Session = {
      id,
      startedAt: Date.now(),
      endedAt: null,
      status: 'active',
      hostPartId: hostPart.id,
      participantPartIds: [hostPart.id],
      openingMethod,
      chosenPartId: chosenPartId || undefined,
      sessionNote: null,
      messageCount: 0,
      firstLine: '',
      phase: 'opening',
    }

    await db.sessions.add(newSession)
    setSession(newSession)
    onSessionCreated?.(id)
    trackEvent('session_started', { opening_method: openingMethod, host_part: hostPart.name })

    // Generate opening message (unless open_invitation — user writes first)
    if (openingMethod !== 'open_invitation') {
      await generatePartMessage(hostPart, [], newSession, id)
    }
  }

  const generatePartMessage = async (
    part: Part,
    currentMessages: SessionMessage[],
    currentSession: Session,
    currentSessionId: string,
  ) => {
    setIsStreaming(true)
    setStreamingContent('')
    setStreamingPartName(part.name)

    const phase = orchestratorRef.current.detectPhase(currentMessages)
    const memories = await db.memories.where('partId').equals(part.id).toArray() as PartMemory[]
    const isEmergence = !currentSession.participantPartIds.includes(part.id)

    const promptMessages = buildSessionMessages(part, currentMessages, {
      phase,
      memories,
      otherParts: currentSession.participantPartIds
        .filter(id => id !== part.id)
        .map(id => parts.find(p => p.id === id)?.name || ''),
      emergenceContext: isEmergence ? `You are entering this conversation because the writer's words resonated with your concerns.` : undefined,
    })

    const maxTokens = orchestratorRef.current.getMaxTokens(phase)
    let fullContent = ''

    await streamChatCompletion(
      promptMessages,
      {
        onToken: (token) => {
          fullContent += token
          setStreamingContent(prev => prev + token)
        },
        onComplete: async () => {
          const msgId = generateId()
          const msg: SessionMessage = {
            id: msgId,
            speaker: 'part',
            partId: part.id,
            partName: part.name,
            content: fullContent,
            timestamp: Date.now(),
            phase,
            isEmergence,
          }
          await sessionMessagesDb.add(currentSessionId, msg)
          setMessages(prev => [...prev, msg])
          setIsStreaming(false)
          setStreamingContent('')
          setStreamingPartName(null)

          // Update session
          const updatedParticipants = isEmergence
            ? [...currentSession.participantPartIds, part.id]
            : currentSession.participantPartIds
          await db.sessions.update(currentSessionId, {
            messageCount: currentMessages.length + 1,
            participantPartIds: updatedParticipants,
            phase,
            firstLine: currentSession.firstLine || fullContent.slice(0, 60),
          })
          setSession(prev => prev ? {
            ...prev,
            participantPartIds: updatedParticipants,
            messageCount: currentMessages.length + 1,
            phase,
          } : null)

          if (isEmergence) {
            trackEvent('part_emerged', { part_name: part.name, session_id: currentSessionId })
          }
        },
        onError: (error) => {
          console.error('Session streaming error:', error)
          setIsStreaming(false)
          setStreamingContent('')
          setStreamingPartName(null)
        },
      },
      maxTokens,
    )
  }

  const handleSend = async () => {
    if (!input.trim() || isStreaming || !session) return

    const msgId = generateId()
    const phase = orchestratorRef.current.detectPhase(messages)
    const userMsg: SessionMessage = {
      id: msgId,
      speaker: 'user',
      partId: null,
      partName: null,
      content: input.trim(),
      timestamp: Date.now(),
      phase,
      isEmergence: false,
    }

    await sessionMessagesDb.add(session.id, userMsg)
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInput('')

    // Update firstLine if this is the first user message
    if (!session.firstLine) {
      await db.sessions.update(session.id, { firstLine: input.trim().slice(0, 60) })
    }

    // Select speaker and generate response
    const speaker = orchestratorRef.current.selectSpeaker(
      parts,
      updatedMessages,
      session.hostPartId,
      input.trim(),
    )
    await generatePartMessage(speaker, updatedMessages, session, session.id)
  }

  const handleEndSession = async () => {
    if (!session) return

    // Generate closing reflection from host part
    const hostPart = parts.find(p => p.id === session.hostPartId)
    if (hostPart) {
      await generatePartMessage(hostPart, messages, { ...session, phase: 'closing' }, session.id)
    }

    // Generate session note
    const updatedMessages = await sessionMessagesDb.getAll(session.id) as SessionMessage[]
    const partNames = session.participantPartIds.map(id => parts.find(p => p.id === id)?.name || '')
    const note = await orchestratorRef.current.generateSessionNote(updatedMessages, partNames)

    await db.sessions.update(session.id, {
      status: 'closed',
      endedAt: Date.now(),
      sessionNote: note,
      phase: 'closing',
    })
    setSession(prev => prev ? { ...prev, status: 'closed', endedAt: Date.now(), sessionNote: note } : null)

    // Create memories for participating parts
    for (const partId of session.participantPartIds) {
      await db.memories.add({
        id: generateId(),
        partId,
        entryId: '',
        content: `Session: ${note}`,
        type: 'reflection',
        timestamp: Date.now(),
        source: 'session',
        sessionId: session.id,
      })
    }

    trackEvent('session_closed', {
      message_count: updatedMessages.length,
      part_count: session.participantPartIds.length,
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={{
      maxWidth: 640,
      margin: '0 auto',
      padding: '80px 32px 160px',
      minHeight: '100vh',
    }}>
      {/* Session note (shown at top of closed sessions) */}
      {session?.sessionNote && (
        <div style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          padding: '16px 20px',
          background: 'var(--surface-secondary)',
          borderRadius: 8,
          marginBottom: 32,
          fontStyle: 'italic',
        }}>
          {session.sessionNote}
        </div>
      )}

      {/* Messages */}
      {messages.map(msg => (
        <SessionMessageBubble
          key={msg.id}
          message={msg}
          isEmergence={msg.isEmergence}
        />
      ))}

      {/* Streaming message */}
      {isStreaming && streamingContent && (
        <div style={{ marginBottom: 20, opacity: 0.88 }}>
          {streamingPartName && (
            <div style={{
              fontSize: 11,
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: 4,
            }}>
              {streamingPartName}
            </div>
          )}
          <div style={{
            fontFamily: "'Spectral', serif",
            fontSize: 16,
            lineHeight: 1.7,
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
          }}>
            {streamingContent}
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />

      {/* Input area (only for active sessions) */}
      {session?.status === 'active' && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '16px 32px 24px',
          background: 'linear-gradient(transparent, var(--bg-primary) 20%)',
        }}>
          <div style={{
            maxWidth: 640,
            margin: '0 auto',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-end',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="take your time"
              disabled={isStreaming}
              rows={1}
              style={{
                flex: 1,
                fontFamily: "'Spectral', serif",
                fontSize: 16,
                lineHeight: 1.6,
                padding: '12px 16px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                background: 'var(--surface-primary)',
                color: 'var(--text-primary)',
                resize: 'none',
                outline: 'none',
              }}
            />
            <button
              onClick={handleEndSession}
              disabled={isStreaming || messages.length < 2}
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                padding: '8px 12px',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                opacity: messages.length < 2 ? 0.3 : 0.6,
              }}
            >
              end session
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors)

**Step 4: Commit**

```bash
git add src/components/Session/SessionView.tsx src/components/Session/SessionMessage.tsx
git commit -m "feat(session): add SessionView and SessionMessage components"
```

---

## Task 6: Routing & Sidebar Integration

**Files:**
- Modify: `src/App.tsx` (lines 388-399 — add `/session` route handling)
- Modify: `src/components/Sidebar/EntriesList.tsx` (add Sessions section)

**Step 1: Add session route handling in `App.tsx`**

After the admin routing block (line 394) and before the 404 redirect (line 397), add session route handling:

```typescript
// Session routing
if (window.location.pathname.startsWith('/session')) {
  // Handled below in the main render — don't redirect to /
}
```

Update the 404 redirect (line 397) to also allow `/session`:

```typescript
if (window.location.pathname !== '/' && !window.location.pathname.startsWith('/admin') && !window.location.pathname.startsWith('/session')) {
  window.history.replaceState(null, '', '/')
}
```

Add lazy import for SessionView at the top of App.tsx:

```typescript
const SessionView = lazy(() => import('./components/Session/SessionView').then(m => ({ default: m.SessionView })))
```

In the main render, add a conditional for session mode (alongside the existing editor render). Detect path and render SessionView when on `/session/*`:

```typescript
const isSessionRoute = window.location.pathname.startsWith('/session')
const sessionIdFromPath = window.location.pathname.startsWith('/session/') && !window.location.pathname.includes('/new')
  ? window.location.pathname.split('/session/')[1]
  : null
```

In the JSX, conditionally render either LivingEditor or SessionView based on `isSessionRoute`.

**Step 2: Add sessions section to sidebar**

In `EntriesList.tsx`, add a sessions list below the entries list. Add state for sessions:

```typescript
const [sessions, setSessions] = useState<{ id: string; firstLine: string; sessionNote: string | null; startedAt: number; participantPartIds: string[]; status: string; favorited?: boolean }[]>([])
```

Load sessions alongside entries:

```typescript
useEffect(() => {
  db.sessions.orderBy('startedAt').reverse().toArray().then(s => setSessions(s as any))
}, [])
```

Add a "Sessions" section in the sidebar JSX with a "New Session" button and a list of past sessions. Each session item shows date, participant part dots (colored), and preview text (sessionNote or firstLine). Clicking navigates to `/session/{id}`.

Add a "New Session" button that navigates to `/session/new`.

**Step 3: Run type check and existing tests**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/App.tsx src/components/Sidebar/EntriesList.tsx
git commit -m "feat(session): add session routing and sidebar integration"
```

---

## Task 7: Cloud Functions — Account Deletion & Firestore Rules

**Files:**
- Modify: `functions/src/index.ts` (line 823 — add 'sessions' to deletion collections)
- Modify: `firestore.rules` (add sessions subcollection rules)

**Step 1: Add sessions to account deletion**

In `functions/src/index.ts`, add `'sessions'` to the collections array at line 823:

```typescript
const collections = [
  'entries', 'parts', 'memories', 'thoughts', 'interactions',
  'entrySummaries', 'userProfile', 'fossils', 'letters',
  'sessionLog', 'innerWeather', 'consent', 'sessions',
]
```

Note: The existing `deleteCollection` function deletes all documents in a subcollection. Session messages are a nested subcollection (`sessions/{id}/messages`), so we also need to delete those. Add after the main collection deletion loop:

```typescript
// Delete session message subcollections
const sessionsSnap = await getFirestore()
  .collection('users').doc(uid).collection('sessions').get()
for (const sessionDoc of sessionsSnap.docs) {
  const messagesSnap = await sessionDoc.ref.collection('messages').get()
  if (messagesSnap.docs.length > 0) {
    const batch = getFirestore().batch()
    messagesSnap.docs.forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
}
```

**Step 2: Add Firestore rules for sessions**

In `firestore.rules`, add rules for the sessions collection and its messages subcollection, following the same pattern as existing collections (authenticated user can read/write their own data):

```
match /users/{userId}/sessions/{sessionId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;

  match /messages/{messageId} {
    allow read, write: if request.auth != null && request.auth.uid == userId;
  }
}
```

**Step 3: Build cloud functions to verify**

Run: `cd functions && npx tsc && cd ..`
Expected: PASS (no type errors)

**Step 4: Commit**

```bash
git add functions/src/index.ts firestore.rules
git commit -m "feat(session): add sessions to account deletion and Firestore rules"
```

---

## Task 8: Analytics Events

**Files:**
- Modify: `src/components/Session/SessionView.tsx` (already has trackEvent calls — verify they're correct)

**Step 1: Verify analytics events are fired**

The SessionView component should already fire these events (added in Task 5):
- `session_started` — when a new session begins (with `opening_method` and `host_part`)
- `session_closed` — when a session ends (with `message_count` and `part_count`)
- `part_emerged` — when a new part enters mid-conversation (with `part_name`)

If the `session_note_generated` event is missing, add it after the session note is generated in `handleEndSession`:

```typescript
trackEvent('session_note_generated', { session_id: session.id })
```

**Step 2: Commit (if changes needed)**

```bash
git add src/components/Session/SessionView.tsx
git commit -m "feat(session): add session_note_generated analytics event"
```

---

## Task 9: Integration Test — Full Session Flow

**Files:**
- Create: `src/components/Session/SessionView.test.tsx`

**Step 1: Write an integration-level test**

Test the happy path: creating a session, sending a message, receiving a streamed response.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SessionView } from './SessionView'

// Mock all external dependencies
vi.mock('../../store/db', () => ({
  db: {
    parts: { toArray: vi.fn().mockResolvedValue([
      { id: 'watcher', name: 'The Watcher', color: '#5A7F94', colorLight: '#5A7F9425', ifsRole: 'protector', voiceDescription: '', concern: '', systemPrompt: 'test', isSeeded: true, createdAt: 1, memories: [] },
    ]) },
    memories: { where: vi.fn().mockReturnValue({ equals: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) }), add: vi.fn() },
    sessions: { add: vi.fn(), update: vi.fn(), get: vi.fn() },
    userProfile: { toArray: vi.fn().mockResolvedValue([]) },
  },
  sessionMessages: {
    add: vi.fn(),
    getAll: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
  generateId: () => `id-${Math.random()}`,
}))

vi.mock('../../ai/openrouter', () => ({
  streamChatCompletion: vi.fn((_msgs, callbacks) => {
    callbacks.onToken('Hello ')
    callbacks.onToken('writer.')
    callbacks.onComplete('Hello writer.')
    return Promise.resolve()
  }),
  chatCompletion: vi.fn().mockResolvedValue('Session note.'),
}))

vi.mock('../../ai/sessionPrompts', () => ({
  buildSessionMessages: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
  buildSessionNotePrompt: vi.fn().mockReturnValue([
    { role: 'system', content: 'test' },
    { role: 'user', content: 'test' },
  ]),
}))

vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }))
vi.mock('../../store/globalConfig', () => ({ getGlobalConfig: () => null }))
vi.mock('../../hooks/useGroundingMode', () => ({ isGroundingActive: () => false }))

describe('SessionView', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders and creates a new session', async () => {
    render(<SessionView sessionId={null} openingMethod="auto" />)

    // Should show the input area
    await waitFor(() => {
      expect(screen.getByPlaceholderText('take your time')).toBeTruthy()
    })
  })
})
```

**Step 2: Run test**

Run: `npm run test -- src/components/Session/SessionView.test.tsx`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/Session/SessionView.test.tsx
git commit -m "test(session): add SessionView integration test"
```

---

## Task 10: Final Verification & Cleanup

**Step 1: Run full test suite**

Run: `npm run test`
Expected: All tests pass

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Run lint**

Run: `npm run lint`
Expected: No errors (fix any that appear)

**Step 4: Build**

Run: `npm run build`
Expected: Successful build

**Step 5: Manual smoke test**

Run: `npm run dev`
- Navigate to `/session/new` — verify the session view loads
- Verify the sidebar shows a Sessions section
- Test creating a session and sending a message
- Verify part response streams in
- Test ending a session and seeing the session note
- Verify the session appears in the sidebar list
- Navigate back to `/` and verify journal mode is unchanged

**Step 6: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "feat(session): session mode MVP complete"
```

---

## Summary of all files

| Action | File |
|--------|------|
| Modify | `src/types/index.ts` |
| Create | `src/types/session.test.ts` |
| Modify | `src/store/db.ts` |
| Create | `src/ai/sessionPrompts.ts` |
| Create | `src/ai/sessionPrompts.test.ts` |
| Create | `src/engine/sessionOrchestrator.ts` |
| Create | `src/engine/sessionOrchestrator.test.ts` |
| Create | `src/components/Session/SessionView.tsx` |
| Create | `src/components/Session/SessionMessage.tsx` |
| Create | `src/components/Session/SessionView.test.tsx` |
| Modify | `src/App.tsx` |
| Modify | `src/components/Sidebar/EntriesList.tsx` |
| Modify | `functions/src/index.ts` |
| Modify | `firestore.rules` |
