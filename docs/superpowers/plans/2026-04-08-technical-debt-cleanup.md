# Technical Debt Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all 18 identified technical debt items across type safety, architecture, performance, code deduplication, and testing.

**Architecture:** Four phases — (A) foundations & type safety, (B) code deduplication & extraction, (C) App.tsx decomposition & performance, (D) testing. Each phase produces independently working, testable software.

**Tech Stack:** TypeScript, React 18, Vite, Firebase/Firestore, TipTap, Vitest

---

## Phase A: Foundations & Type Safety

### Task 1: Type the Firestore boundary (Item #2)

Make `createCollectionProxy` generic so callers get typed results without casting.

**Files:**
- Modify: `src/store/db.ts:37-108`
- Modify: All engine files that cast db results (~15 files)

- [ ] **Step 1: Make `createCollectionProxy` generic**

In `src/store/db.ts`, change the function signature and all method return types:

```typescript
function createCollectionProxy<T extends DocumentData = DocumentData>(name: string) {
  const col = () => collection(firestore, `users/${getAuth().currentUser!.uid}/${name}`)

  return {
    async add(data: T) {
      const ref = doc(col(), (data as DocumentData).id as string)
      await setDoc(ref, data)
    },
    async get(id: string): Promise<T | undefined> {
      const snap = await getDoc(doc(col(), id))
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : undefined
    },
    async update(id: string, partial: Partial<T>) {
      await updateDoc(doc(col(), id), partial as DocumentData)
    },
    async delete(id: string) {
      await deleteDoc(doc(col(), id))
    },
    async bulkPut(items: T[]) {
      const batch = writeBatch(firestore)
      for (const item of items) {
        batch.set(doc(col(), (item as DocumentData).id as string), item)
      }
      await batch.commit()
    },
    async count(): Promise<number> {
      const snap = await getCountFromServer(col())
      return snap.data().count
    },
    async toArray(): Promise<T[]> {
      const snap = await getDocs(col())
      return snap.docs.map(d => ({ id: d.id, ...d.data() }) as T)
    },
    orderBy(field: string) {
      const q = (dir: 'asc' | 'desc') => query(col(), orderBy(field, dir))
      return {
        reverse() {
          return {
            async toArray(): Promise<T[]> {
              const snap = await getDocs(q('desc'))
              return snap.docs.map(d => ({ id: d.id, ...d.data() }) as T)
            },
          }
        },
        async toArray(): Promise<T[]> {
          const snap = await getDocs(q('asc'))
          return snap.docs.map(d => ({ id: d.id, ...d.data() }) as T)
        },
      }
    },
    where(field: string) {
      return {
        equals(value: unknown) {
          return {
            async toArray(): Promise<T[]> {
              const snap = await getDocs(query(col(), where(field, '==', value)))
              return snap.docs.map(d => ({ id: d.id, ...d.data() }) as T)
            },
          }
        },
      }
    },
  }
}
```

- [ ] **Step 2: Type the `db` export object**

```typescript
import type { DiaryEntry, Part, PartMemory, PartThought, PartInteraction, EntrySummary, UserProfile, Fossil, Letter, SessionLogEntry, InnerWeather, CameraHrvConsent, Session, ApiKey, HrvSessionData } from '../types'

export const db = {
  entries: createCollectionProxy<DiaryEntry>('entries'),
  parts: createCollectionProxy<Part>('parts'),
  memories: createCollectionProxy<PartMemory>('memories'),
  thoughts: createCollectionProxy<PartThought>('thoughts'),
  interactions: createCollectionProxy<PartInteraction>('interactions'),
  entrySummaries: createCollectionProxy<EntrySummary>('entrySummaries'),
  userProfile: createCollectionProxy<UserProfile>('userProfile'),
  fossils: createCollectionProxy<Fossil>('fossils'),
  letters: createCollectionProxy<Letter>('letters'),
  sessionLog: createCollectionProxy<SessionLogEntry>('sessionLog'),
  innerWeather: createCollectionProxy<InnerWeather>('innerWeather'),
  consent: createCollectionProxy<CameraHrvConsent>('consent'),
  sessions: createCollectionProxy<Session>('sessions'),
  apiKeys: createCollectionProxy<ApiKey>('apiKeys'),
  hrvSessions: createCollectionProxy<HrvSessionData>('hrvSessions'),
}
```

- [ ] **Step 3: Remove `as T` casts from all engine files**

Search for `as Part[]`, `as unknown as Session`, `as unknown as SessionMessage[]`, `as EntrySummary[]`, etc. across all files. Remove the casts since the proxy now returns typed results. Key files:
- `src/components/Session/SessionView.tsx:114,119` — remove `as unknown as Session`, `as unknown as SessionMessage[]`
- `src/components/Sidebar/EntriesList.tsx:81` — remove `as unknown as Session[]`
- `src/engine/reflectionEngine.ts` — remove ~8 casts
- `src/engine/sessionReflectionEngine.ts:223,240` — remove `as unknown as PartMemory[]`
- `src/engine/partOrchestrator.ts` — remove ~4 casts
- `src/engine/fossilEngine.ts`, `blankPageEngine.ts`, `explorationEngine.ts` — remove ~2-3 casts each
- `src/App.tsx:289` — remove `as { id: string; content: string; ... }` cast

- [ ] **Step 4: Verify types compile and tests pass**

Run: `npx tsc --noEmit && npm run test -- --run`

- [ ] **Step 5: Commit**

```bash
git add src/store/db.ts src/types/ src/engine/ src/components/ src/App.tsx
git commit -m "refactor: type Firestore boundary with generic createCollectionProxy"
```

---

### Task 2: Extract grounding state from hooks/ to store/ (Item #8)

**Files:**
- Create: `src/store/groundingState.ts`
- Modify: `src/hooks/useGroundingMode.ts`
- Modify: `src/engine/partOrchestrator.ts:8`
- Modify: `src/engine/sessionOrchestrator.ts:4`
- Modify: `src/engine/explorationEngine.ts:5`

- [ ] **Step 1: Create `src/store/groundingState.ts`**

Extract the module-level state and non-React functions from `useGroundingMode.ts`:

```typescript
import { getGlobalConfig } from './globalConfig'
import { trackEvent } from '../services/analytics'

let groundingActive = false
let autoExitTimer: ReturnType<typeof setTimeout> | null = null

const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

function resetAutoExit() {
  if (autoExitTimer) {
    clearTimeout(autoExitTimer)
    autoExitTimer = null
  }
  const config = getGlobalConfig()
  const ms = (config?.features as Record<string, unknown>)?.groundingAutoExitMinutes
  const minutes = typeof ms === 'number' ? ms : 10
  autoExitTimer = setTimeout(() => {
    groundingActive = false
    autoExitTimer = null
    notify()
  }, minutes * 60_000)
}

export function activateGrounding(trigger: 'auto' | 'manual' = 'auto'): void {
  if (groundingActive) return
  groundingActive = true
  trackEvent('grounding_activated', { trigger })
  resetAutoExit()
  notify()
}

export function deactivateGrounding(): void {
  if (!groundingActive) return
  groundingActive = false
  if (autoExitTimer) {
    clearTimeout(autoExitTimer)
    autoExitTimer = null
  }
  trackEvent('grounding_deactivated')
  notify()
}

export function isGroundingActive(): boolean {
  return groundingActive
}

export function subscribeGrounding(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
```

- [ ] **Step 2: Simplify `src/hooks/useGroundingMode.ts` to re-export + hook**

```typescript
import { useSyncExternalStore } from 'react'
import { isGroundingActive, subscribeGrounding } from '../store/groundingState'

export { activateGrounding, deactivateGrounding, isGroundingActive } from '../store/groundingState'

export function useGroundingMode(): boolean {
  return useSyncExternalStore(subscribeGrounding, isGroundingActive)
}
```

- [ ] **Step 3: Update engine imports to use `store/groundingState`**

In `src/engine/partOrchestrator.ts:8`:
```typescript
import { activateGrounding, isGroundingActive } from '../store/groundingState'
```

In `src/engine/sessionOrchestrator.ts:4`:
```typescript
import { activateGrounding } from '../store/groundingState'
```

In `src/engine/explorationEngine.ts:5`:
```typescript
import { isGroundingActive } from '../store/groundingState'
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/store/groundingState.ts src/hooks/useGroundingMode.ts src/engine/partOrchestrator.ts src/engine/sessionOrchestrator.ts src/engine/explorationEngine.ts
git commit -m "refactor: extract grounding state from hooks/ to store/"
```

---

### Task 3: Add public accessor to PartOrchestrator (Item #10)

**Files:**
- Modify: `src/engine/partOrchestrator.ts:72`
- Modify: `src/components/Editor/LivingEditor.tsx` (6 occurrences)

- [ ] **Step 1: Add `getParts()` method and `addPart()` to PartOrchestrator**

After the `private parts: Part[] = []` field at line 72, add:

```typescript
getParts(): readonly Part[] {
  return this.parts
}

addPart(part: Part): void {
  this.parts.push(part)
}
```

- [ ] **Step 2: Replace bracket access in LivingEditor**

Replace all 6 occurrences:
- `orchestratorRef.current?.['parts'] as Part[] | undefined` → `orchestratorRef.current?.getParts()`
- `orchestrator['parts'].find(...)` → `orchestrator.getParts().find(...)`
- `orchestrator['parts'] as Part[]` → `orchestrator.getParts()`
- `orchestrator['parts'].push(result.part)` → `orchestrator.addPart(result.part)`

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/engine/partOrchestrator.ts src/components/Editor/LivingEditor.tsx
git commit -m "refactor: replace bracket access on private parts with public accessor"
```

---

### Task 4: Fix openrouter.ts unsafe field access (Item #17)

**Files:**
- Modify: `src/ai/openrouter.ts:58`

- [ ] **Step 1: Add optional chaining to chatCompletion return**

Change line 58 from:
```typescript
return data.choices[0].message.content
```
To:
```typescript
const content = data?.choices?.[0]?.message?.content
if (!content) throw new Error('Empty response from OpenRouter')
return content
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/ai/openrouter.ts
git commit -m "fix: add optional chaining to chatCompletion response access"
```

---

### Task 5: Move PartOrchestrator localStorage to settings store (Item #18)

**Files:**
- Modify: `src/engine/partOrchestrator.ts:266,448`

- [ ] **Step 1: Replace localStorage with settings store**

At line 266, change:
```typescript
const lastSpoke = localStorage.getItem('quietOneLastSpokeEntry')
```
To:
```typescript
const lastSpoke = this.quietOneLastSpokeEntry
```

At line 448, change:
```typescript
localStorage.setItem('quietOneLastSpokeEntry', this.entryId)
```
To:
```typescript
this.quietOneLastSpokeEntry = this.entryId
```

Add the field to the class:
```typescript
private quietOneLastSpokeEntry: string | null = null
```

Note: This is instance-level state that doesn't need to persist across sessions — the quiet one cooldown is entry-scoped.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/engine/partOrchestrator.ts
git commit -m "refactor: replace localStorage with instance field in PartOrchestrator"
```

---

## Phase B: Code Deduplication & Extraction

### Task 6: Extract autocorrect to shared hook (Item #3)

**Files:**
- Create: `src/hooks/useAutocorrect.ts`
- Modify: `src/components/Editor/LivingEditor.tsx:155-289`
- Modify: `src/components/Session/SessionView.tsx:576-660`

- [ ] **Step 1: Create `src/hooks/useAutocorrect.ts`**

```typescript
import { useRef, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { extractCompletedSentence, correctSentence, shouldTriggerAutocorrect } from '../ai/llmCorrect'
import { getLanguageCode } from '../i18n'
import { getGlobalConfig } from '../store/globalConfig'

interface AutocorrectState {
  original: string
  correction: string
  wordStart: number
  delimiter: string
}

interface AutocorrectOptions {
  autocorrect: boolean
  autoCapitalize: boolean
}

export function useAutocorrect(options: AutocorrectOptions) {
  const lastAutocorrectRef = useRef<AutocorrectState | null>(null)

  const handleKeyDown = useCallback((editor: Editor, event: KeyboardEvent): boolean => {
    if (event.metaKey || event.ctrlKey || event.altKey) return false

    // Undo autocorrect on Backspace
    if (event.key === 'Backspace' && lastAutocorrectRef.current) {
      const { original, correction, wordStart, delimiter } = lastAutocorrectRef.current
      const cursor = editor.state.selection.from
      const expectedEnd = wordStart + correction.length + delimiter.length
      if (cursor === expectedEnd) {
        const docText = editor.state.doc.textBetween(wordStart, expectedEnd)
        if (docText === correction + delimiter) {
          event.preventDefault()
          editor.view.dispatch(
            editor.state.tr.replaceWith(
              wordStart,
              expectedEnd,
              editor.state.schema.text(original + delimiter),
            ),
          )
          lastAutocorrectRef.current = null
          return true
        }
      }
      lastAutocorrectRef.current = null
    }

    if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') {
      if (event.key !== 'Backspace') lastAutocorrectRef.current = null

      // Auto-capitalize
      if (options.autoCapitalize && event.key.length === 1) {
        const from = editor.state.selection.from
        const parentOffset = editor.state.selection.$from.parentOffset

        if (/[a-z]/.test(event.key)) {
          const shouldCapitalize = parentOffset === 0
            || /[.!?]\s$/.test(editor.state.doc.textBetween(Math.max(0, from - 3), from))

          if (shouldCapitalize) {
            event.preventDefault()
            editor.commands.insertContent(event.key.toUpperCase())
            return true
          }
        }

        // Fix standalone "i" to "I"
        if (getLanguageCode() === 'en' && /[\s,.'!?;:]/.test(event.key) && from >= 1) {
          const lookback = editor.state.doc.textBetween(Math.max(0, from - 2), from)
          if (/(?:^|\s)i$/.test(lookback)) {
            editor.view.dispatch(
              editor.state.tr.replaceWith(from - 1, from, editor.state.schema.text('I'))
            )
          }
        }
      }

      // Autocorrect on sentence-ending punctuation
      if (options.autocorrect && getGlobalConfig()?.features?.autocorrectEnabled !== false) {
        const $pos = editor.state.selection.$from
        const textBefore = $pos.parent.textBetween(0, $pos.parentOffset)
        if (shouldTriggerAutocorrect(event.key, textBefore)) {
          const textForExtraction = event.key === ' ' ? textBefore + ' ' : textBefore
          const extracted = extractCompletedSentence(textForExtraction)
          if (extracted) {
            const absStart = $pos.start() + extracted.start
            const absEnd = $pos.start() + extracted.end
            const originalSentence = extracted.sentence
            correctSentence(originalSentence).then((corrected) => {
              if (!corrected) return
              const currentState = editor.state
              if (absEnd > currentState.doc.content.size) return
              let currentText: string
              try { currentText = currentState.doc.textBetween(absStart, absEnd) } catch { return }
              if (currentText !== originalSentence) return
              editor.view.dispatch(
                currentState.tr.replaceWith(
                  absStart,
                  absEnd,
                  currentState.schema.text(corrected),
                ),
              )
              lastAutocorrectRef.current = { original: originalSentence, correction: corrected, wordStart: absStart, delimiter: '' }
            })
          }
        }
      }
    }
    return false
  }, [options.autocorrect, options.autoCapitalize])

  return { handleKeyDown }
}
```

- [ ] **Step 2: Update LivingEditor to use the hook**

Remove the duplicated autocorrect logic from `handleKeyDown` (lines 155-289). Import and use the hook:

```typescript
import { useAutocorrect } from '../../hooks/useAutocorrect'

// Inside the component:
const { handleKeyDown: handleAutocorrect } = useAutocorrect({
  autocorrect: settings.autocorrect,
  autoCapitalize: settings.autoCapitalize,
})
```

In `editorProps.handleKeyDown`, after the Enter key check, call:
```typescript
const autocorrectResult = handleAutocorrect(editor, event)
if (autocorrectResult) return true
```

Keep the LivingEditor-specific logic (typing intensity tracking at lines 180-202) in LivingEditor.

- [ ] **Step 3: Update SessionView to use the hook**

Remove the duplicated autocorrect logic from `handleKeyDown` (lines 576-660). Import and use the same hook:

```typescript
import { useAutocorrect } from '../../hooks/useAutocorrect'

// Inside the component:
const { handleKeyDown: handleAutocorrect } = useAutocorrect({
  autocorrect: settings.autocorrect,
  autoCapitalize: settings.autoCapitalize ?? true,
})
```

In `inputEditor`'s `handleKeyDown`, after the Enter key check, call:
```typescript
const autocorrectResult = inputEditor ? handleAutocorrect(inputEditor, event) : false
if (autocorrectResult) return true
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/hooks/useAutocorrect.ts src/components/Editor/LivingEditor.tsx src/components/Session/SessionView.tsx
git commit -m "refactor: extract shared autocorrect hook, eliminate duplication"
```

---

### Task 7: Extract HRV and typewriter hooks from SessionView (Item #7)

**Files:**
- Create: `src/hooks/useTypewriter.ts`
- Create: `src/hooks/useHrvSession.ts`
- Modify: `src/components/Session/SessionView.tsx`

- [ ] **Step 1: Create `src/hooks/useTypewriter.ts`**

Extract the typewriter effect (streamBufferRef, displayedLengthRef, typingTimerRef, revealNextChar):

```typescript
import { useRef, useCallback, useState } from 'react'

export function useTypewriter() {
  const [displayedContent, setDisplayedContent] = useState('')
  const bufferRef = useRef('')
  const displayedLengthRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCompleteRef = useRef<((fullText: string) => void) | null>(null)

  const revealNextChar = useCallback(() => {
    if (displayedLengthRef.current < bufferRef.current.length) {
      const remaining = bufferRef.current.length - displayedLengthRef.current
      const burst = remaining > 20 ? 3 : remaining > 5 ? 2 : 1
      displayedLengthRef.current = Math.min(
        displayedLengthRef.current + burst,
        bufferRef.current.length,
      )
      setDisplayedContent(bufferRef.current.slice(0, displayedLengthRef.current))
      const delay = 25 + Math.random() * 30
      timerRef.current = setTimeout(revealNextChar, delay)
    } else if (onCompleteRef.current) {
      const cb = onCompleteRef.current
      onCompleteRef.current = null
      cb(bufferRef.current)
    } else {
      timerRef.current = null
    }
  }, [])

  const appendToken = useCallback((token: string) => {
    bufferRef.current += token
    if (!timerRef.current) revealNextChar()
  }, [revealNextChar])

  const setOnComplete = useCallback((cb: (fullText: string) => void) => {
    onCompleteRef.current = cb
    if (!timerRef.current) revealNextChar()
  }, [revealNextChar])

  const reset = useCallback(() => {
    bufferRef.current = ''
    displayedLengthRef.current = 0
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    onCompleteRef.current = null
    setDisplayedContent('')
  }, [])

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    onCompleteRef.current = null
  }, [])

  return { displayedContent, appendToken, setOnComplete, reset, cleanup }
}
```

- [ ] **Step 2: Create `src/hooks/useHrvSession.ts`**

Extract all HRV state, engine lifecycle, and data flushing from SessionView:

```typescript
import { useState, useRef, useCallback } from 'react'
import { HrvEngine } from '../engine/hrvEngine'
import { HrvTimeline } from '../engine/hrvTimeline'
import { getGlobalConfig } from '../store/globalConfig'
import { db } from '../store/db'
import { trackEvent } from '../services/analytics'
import type { HrvMeasurement, HrvError, HrvSessionData } from '../types'

export function useHrvSession(sessionIdRef: React.RefObject<string | null>) {
  const [enabled, setEnabled] = useState(false)
  const [latestMeasurement, setLatestMeasurement] = useState<HrvMeasurement | null>(null)
  const [measurementCount, setMeasurementCount] = useState(0)
  const [calibrating, setCalibrating] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showConsent, setShowConsent] = useState(false)

  const engineRef = useRef<HrvEngine | null>(null)
  const timelineRef = useRef(new HrvTimeline())
  const startTimeRef = useRef<number>(0)
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const responseStartedRef = useRef(false)

  const flushData = useCallback(async () => {
    const sessionId = sessionIdRef.current
    const timeline = timelineRef.current
    if (!sessionId || timeline.getMeasurements().length === 0) return

    const measurements = timeline.getMeasurements()
    const shifts = timeline.getRecentShifts(99999)

    const avgHr = measurements.reduce((s, m) => s + m.hr, 0) / measurements.length
    const avgRmssd = measurements.reduce((s, m) => s + m.rmssd, 0) / measurements.length
    const avgConf = measurements.reduce((s, m) => s + m.confidence, 0) / measurements.length

    const stateCounts: Record<string, number> = {}
    for (const m of measurements) {
      stateCounts[m.autonomicState] = (stateCounts[m.autonomicState] || 0) + 1
    }
    const dominantState = Object.entries(stateCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'transitioning'

    const rawDumps = engineRef.current?.getSignalDumps() ?? []
    const signalDumps = rawDumps.slice(-10).map(d => ({
      ...d,
      rBuffer: d.rBuffer.slice(-150),
      gBuffer: d.gBuffer.slice(-150),
      bBuffer: d.bBuffer.slice(-150),
    }))

    const data: HrvSessionData = {
      id: sessionId,
      startedAt: startTimeRef.current,
      endedAt: Date.now(),
      calibrationBaseline: timeline.baselineRmssd || 0,
      measurements,
      shifts,
      signalDumps,
      summary: {
        dominantState: dominantState as HrvSessionData['summary']['dominantState'],
        averageHr: Math.round(avgHr),
        averageRmssd: Math.round(avgRmssd * 10) / 10,
        shiftCount: shifts.length,
        avgConfidence: Math.round(avgConf * 100) / 100,
      },
    }

    await db.hrvSessions.add(data)
  }, [sessionIdRef])

  const start = useCallback(async () => {
    const engine = new HrvEngine()
    engineRef.current = engine
    timelineRef.current = new HrvTimeline()
    startTimeRef.current = Date.now()

    engine.onMeasurement((m) => {
      timelineRef.current.addMeasurement(m)
      setLatestMeasurement(m)
      setMeasurementCount(c => c + 1)
    })

    engine.onCalibrationComplete((baseline) => {
      timelineRef.current.setBaseline(baseline)
      setCalibrating(false)
    })

    engine.onError((err) => {
      if (err.type === 'camera_lost') setError('Camera disconnected')
      else if (err.type === 'worker_error') console.warn('HRV worker error:', err.message)
    })

    try {
      await engine.start()
      setEnabled(true)
      setError(null)
      flushIntervalRef.current = setInterval(() => { flushData().catch(console.error) }, 10_000)
      trackEvent('hrv_enabled', { session_id: sessionIdRef.current ?? '' })
    } catch (err) {
      const hrvErr = err as HrvError
      setError(hrvErr.type === 'camera_denied' ? 'Camera access denied' : 'Camera not available')
      engineRef.current = null
    }
  }, [flushData, sessionIdRef])

  const stop = useCallback(() => {
    engineRef.current?.stop()
    engineRef.current = null
    setEnabled(false)
    setLatestMeasurement(null)
    setMeasurementCount(0)
    setCalibrating(true)
    setError(null)
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current)
      flushIntervalRef.current = null
    }
  }, [])

  const toggle = useCallback(async () => {
    if (getGlobalConfig()?.features?.webcamHrv !== true) return
    if (enabled) { stop(); return }
    const consent = await db.consent.get('camera-hrv')
    if (!consent) { setShowConsent(true); return }
    await start()
  }, [enabled, start, stop])

  const stopAndFlush = useCallback(async () => {
    if (engineRef.current) {
      await flushData()
      stop()
    }
  }, [flushData, stop])

  const addConversationEvent = useCallback((type: string, messageIndex: number) => {
    timelineRef.current.addConversationEvent(type, messageIndex)
  }, [])

  const buildPromptContext = useCallback(() => {
    return timelineRef.current.buildPromptContext()
  }, [])

  const markResponseStarted = useCallback(() => {
    responseStartedRef.current = true
  }, [])

  const hasResponseStarted = useCallback(() => {
    const v = responseStartedRef.current
    responseStartedRef.current = false
    return v
  }, [])

  return {
    enabled,
    latestMeasurement,
    measurementCount,
    calibrating,
    error,
    showConsent,
    setShowConsent,
    toggle,
    start,
    stop,
    stopAndFlush,
    addConversationEvent,
    buildPromptContext,
    markResponseStarted,
    hasResponseStarted,
  }
}
```

- [ ] **Step 3: Refactor SessionView to use both hooks**

Replace the inline typewriter state (lines 66-89) with `useTypewriter()`.
Replace the HRV state (lines 54-63, 419-541) with `useHrvSession()`.
This should remove ~200 lines from SessionView.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/hooks/useTypewriter.ts src/hooks/useHrvSession.ts src/components/Session/SessionView.tsx
git commit -m "refactor: extract typewriter and HRV hooks from SessionView"
```

---

### Task 8: Unify WeatherEngine instances (Item #9)

**Files:**
- Create: `src/store/weatherStore.ts`
- Modify: `src/App.tsx` — remove weatherEngineRef
- Modify: `src/components/Session/SessionView.tsx` — remove weatherEngineRef

- [ ] **Step 1: Create a singleton weather store**

```typescript
import { WeatherEngine } from '../engine/weatherEngine'

const engine = new WeatherEngine()

export function getWeatherEngine(): WeatherEngine {
  return engine
}
```

- [ ] **Step 2: Replace both refs with the shared instance**

In `App.tsx`, replace `weatherEngineRef.current` with `getWeatherEngine()`.
In `SessionView.tsx`, replace `weatherEngineRef.current` with `getWeatherEngine()`.
Remove `WeatherEngine` imports and `useRef(new WeatherEngine())` from both files.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/store/weatherStore.ts src/App.tsx src/components/Session/SessionView.tsx
git commit -m "refactor: unify WeatherEngine into singleton store"
```

---

### Task 9: Extract Markdown export from db.ts (Item #13)

**Files:**
- Create: `src/store/dataExport.ts`
- Modify: `src/store/db.ts` — remove export functions and partPrompts import

- [ ] **Step 1: Move `buildMarkdownExport` and `exportAllData` to new file**

Move everything from the export section (~lines 225-445) of `db.ts` to `src/store/dataExport.ts`. Update imports to reference `db` from `./db`. Remove the `SEEDED_PARTS` import from `db.ts:19` (it's only needed by the export logic).

- [ ] **Step 2: Update callers**

Search for `exportAllData` imports — update to import from `../store/dataExport`.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/store/dataExport.ts src/store/db.ts src/components/Sidebar/SettingsPanel.tsx
git commit -m "refactor: extract Markdown export from db.ts to dataExport.ts"
```

---

## Phase C: App.tsx Decomposition & Performance

### Task 10: Lazy-load engines and rare components (Item #5)

**Files:**
- Modify: `src/App.tsx` — change static imports to lazy/dynamic
- Modify: `vite.config.ts` — add manual chunk for engines

- [ ] **Step 1: Lazy-load rare components**

Change these imports from static to lazy:

```typescript
const Onboarding = lazyWithRetry(() => import('./components/Onboarding'))
const EntryChoice = lazyWithRetry(() => import('./components/EntryChoice'))
const CrisisResources = lazyWithRetry(() => import('./components/CrisisResources'))
const SessionClosing = lazyWithRetry(() => import('./components/SessionClosing'))
```

Remove the static imports for these four components. Wrap usages in `<Suspense>` where not already wrapped.

- [ ] **Step 2: Dynamic-import engines that are lazily used**

`ReflectionEngine`, `RitualEngine` are used on entry switch (not initial render). Change to dynamic imports:

```typescript
// Remove static imports:
// import { ReflectionEngine } from './engine/reflectionEngine'
// import { RitualEngine } from './engine/ritualEngine'

// Lazy-load in the refs:
const reflectionEngineRef = useRef<{ generateReflection: (...args: unknown[]) => Promise<unknown> } | null>(null)

// In triggerReflection:
if (!reflectionEngineRef.current) {
  const { ReflectionEngine } = await import('./engine/reflectionEngine')
  reflectionEngineRef.current = new ReflectionEngine()
}
```

Same pattern for RitualEngine.

- [ ] **Step 3: Remove `chatCompletion` and `languageDirective` from App.tsx imports**

These are only used in `handleSessionClose`. Dynamic-import them there:

```typescript
const handleSessionClose = useCallback(async () => {
  setClosingLoading(true)
  setClosingPhrase(null)
  // ... save entry ...

  const [{ chatCompletion }, { languageDirective }] = await Promise.all([
    import('./ai/openrouter'),
    import('./ai/partPrompts'),
  ])
  // ... rest of closing logic
}, [activeEntryId, tr])
```

- [ ] **Step 4: Add engine chunk to vite config**

In `vite.config.ts`, add to `manualChunks`:

```typescript
manualChunks(id) {
  if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor'
  if (id.includes('@sentry')) return 'sentry'
  if (id.includes('src/engine/')) return 'engines'
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm run build && npx tsc --noEmit && npm run test -- --run`

```bash
git add src/App.tsx vite.config.ts
git commit -m "perf: lazy-load engines and rare components, split engine chunk"
```

---

### Task 11: Throttle LivingEditor streaming re-renders (Item #4)

**Files:**
- Modify: `src/components/Editor/LivingEditor.tsx:490-506`

- [ ] **Step 1: Throttle `onThoughtToken` with rAF batching**

Replace the per-token `setThoughts` call with a ref-buffered approach:

```typescript
// Add ref near other refs:
const pendingThoughtUpdateRef = useRef<number | null>(null)

// In onThoughtToken:
onThoughtToken: (token) => {
  const current = currentThoughtRef.current
  if (!current) return
  const wasEmpty = current.content.length === 0
  current.content += token

  if (wasEmpty) {
    const snapshot = { ...current, content: current.content }
    setThoughts((prev) => [...prev, snapshot])
  } else {
    // Batch updates at rAF cadence instead of per-token
    if (!pendingThoughtUpdateRef.current) {
      pendingThoughtUpdateRef.current = requestAnimationFrame(() => {
        pendingThoughtUpdateRef.current = null
        const id = current.id
        const content = current.content
        setThoughts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, content } : t)),
        )
      })
    }
  }
},
```

Add cleanup in the component's existing cleanup effect:
```typescript
if (pendingThoughtUpdateRef.current) cancelAnimationFrame(pendingThoughtUpdateRef.current)
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/components/Editor/LivingEditor.tsx
git commit -m "perf: throttle thought token updates to rAF cadence"
```

---

### Task 12: Fix breathing rAF loop (Item #12)

**Files:**
- Modify: `src/components/Editor/LivingEditor.tsx:330-348`

- [ ] **Step 1: Cache DOM element in ref and stop loop when idle**

```typescript
const breathElRef = useRef<HTMLElement | null>(null)

useEffect(() => {
  breathElRef.current = document.querySelector('.typing-breath') as HTMLElement
}, [])

useEffect(() => {
  let active = true
  const updateBreath = () => {
    if (!active) return
    typingEnergyRef.current *= 0.97
    if (typingEnergyRef.current < 0.01) {
      typingEnergyRef.current = 0
      // Stop loop when energy is zero — restart on next keystroke
      breathRafRef.current = 0
      return
    }

    const energy = typingEnergyRef.current
    const el = breathElRef.current
    if (el) {
      el.style.transform = `scale(${1 + energy * 0.06})`
      el.style.opacity = String(0.15 + energy * 0.6)
    }

    breathRafRef.current = requestAnimationFrame(updateBreath)
  }

  breathRafRef.current = requestAnimationFrame(updateBreath)
  return () => {
    active = false
    if (breathRafRef.current) cancelAnimationFrame(breathRafRef.current)
  }
}, [])
```

In the keystroke handler, restart the loop when energy increases:
```typescript
typingEnergyRef.current = Math.min(typingEnergyRef.current + 0.15, 1)
if (!breathRafRef.current) {
  // Restart the rAF loop
  const updateBreath = () => { /* same as above */ }
  breathRafRef.current = requestAnimationFrame(updateBreath)
}
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/components/Editor/LivingEditor.tsx
git commit -m "perf: stop breathing rAF loop when idle, cache DOM element"
```

---

### Task 13: Fix routing side effects during render (Item #14)

**Files:**
- Modify: `src/App.tsx:458-477`

- [ ] **Step 1: Move `replaceState` calls into a `useEffect`**

Replace the inline redirects at lines 458-466 with a useEffect:

```typescript
// Replace the inline admin guard and 404 redirect with:
useEffect(() => {
  if (routePath.startsWith('/admin') && !ADMIN_EMAILS.includes(user?.email || '')) {
    window.history.replaceState(null, '', '/')
    setRoutePath('/')
  } else if (routePath !== '/' && routePath !== '/new' && !routePath.startsWith('/admin') && !routePath.startsWith('/session')) {
    window.history.replaceState(null, '', '/')
    setRoutePath('/')
  }
}, [routePath, user?.email])
```

Adjust the admin route rendering to check the condition without the side effect:

```typescript
const isAdminRoute = routePath.startsWith('/admin') && ADMIN_EMAILS.includes(user?.email || '')
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/App.tsx
git commit -m "fix: move routing side effects from render to useEffect"
```

---

### Task 14: Fix fossil setTimeout leak (Item #15)

**Files:**
- Modify: `src/App.tsx:317`

- [ ] **Step 1: Track the timeout in a ref and clean up**

Add a ref:
```typescript
const fossilTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

At line 317, replace:
```typescript
setTimeout(() => setFossilThought(null), 30000)
```
With:
```typescript
if (fossilTimerRef.current) clearTimeout(fossilTimerRef.current)
fossilTimerRef.current = setTimeout(() => setFossilThought(null), 30000)
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/App.tsx
git commit -m "fix: track fossil timeout in ref to prevent leak on unmount"
```

---

### Task 15: Fix globalConfig onSnapshot across logout (Item #11)

**Files:**
- Modify: `src/store/globalConfig.ts`

- [ ] **Step 1: Add a `teardownGlobalConfig` function**

```typescript
export function teardownGlobalConfig(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  cache = null
  hasNewVersion = false
  initialBuildVersion = null
  notify()
}
```

- [ ] **Step 2: Call `teardownGlobalConfig` on logout**

In `src/App.tsx`, in the auth state change handler or wherever logout is detected, call `teardownGlobalConfig()`. Search for existing logout handling (likely in `useAuth` or `App.tsx`'s `!user` path).

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/store/globalConfig.ts src/App.tsx
git commit -m "fix: tear down globalConfig onSnapshot listener on logout"
```

---

### Task 16: Remove console.logs from HRV code (Item #16)

**Files:**
- Modify: `src/engine/hrvEngine.ts`
- Modify: `src/engine/hrvSignalWorker.ts`

- [ ] **Step 1: Remove or guard console.log calls**

Remove all `console.log` calls from both files. Keep `console.warn` and `console.error` for actual error conditions. The worker log that fires every 300 frames (~5s) at line 685 should be removed entirely.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/engine/hrvEngine.ts src/engine/hrvSignalWorker.ts
git commit -m "chore: remove debug console.logs from HRV engine and worker"
```

---

## Phase D: Testing

### Task 17: Add tests for critical untested paths (Item #6)

**Files:**
- Create: `src/ai/openrouter.test.ts`
- Create: `src/store/db.test.ts`
- Expand: `src/components/Session/SessionView.test.ts`

- [ ] **Step 1: Test `chatCompletion` response parsing**

Create `src/ai/openrouter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock firebase auth
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: { getIdToken: () => Promise.resolve('mock-token') } }),
}))

describe('chatCompletion', () => {
  beforeEach(() => {
    vi.resetModules()
    mockFetch.mockReset()
  })

  it('returns content from valid response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Hello world' } }],
      }),
    })

    const { chatCompletion } = await import('./openrouter')
    const result = await chatCompletion([{ role: 'user', content: 'test' }])
    expect(result).toBe('Hello world')
  })

  it('throws on empty choices array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ choices: [] }),
    })

    const { chatCompletion } = await import('./openrouter')
    await expect(chatCompletion([{ role: 'user', content: 'test' }]))
      .rejects.toThrow('Empty response')
  })

  it('throws on missing message content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: {} }],
      }),
    })

    const { chatCompletion } = await import('./openrouter')
    await expect(chatCompletion([{ role: 'user', content: 'test' }]))
      .rejects.toThrow('Empty response')
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    })

    const { chatCompletion } = await import('./openrouter')
    await expect(chatCompletion([{ role: 'user', content: 'test' }]))
      .rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npm run test -- --run src/ai/openrouter.test.ts`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/ai/openrouter.test.ts
git commit -m "test: add chatCompletion response parsing tests"
```

---

### Task 18: App.tsx decomposition — extract session closing flow (Item #1 partial)

This addresses the most self-contained piece of the App.tsx god component. Full decomposition is a larger effort but this extracts the most problematic business logic.

**Files:**
- Create: `src/engine/closingEngine.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Extract the closing logic**

Create `src/engine/closingEngine.ts`:

```typescript
import { languageDirective } from '../ai/partPrompts'

export async function generateClosingPhrase(text: string, language: string): Promise<string> {
  const { chatCompletion } = await import('../ai/openrouter')
  const snippet = text.slice(-600) || 'The writer opened a blank page today.'

  return chatCompletion([
    {
      role: 'system',
      content: `You are The Weaver — a warm, pattern-seeing inner voice. The writer is finishing their session. Offer one brief, warm closing thought (1-2 sentences). Be soothing and loving. Reference something specific from what they wrote — a thread, an image, a feeling. Don't summarize. Don't give advice. Just leave them with something gentle to carry. Speak directly to them. No quotes around your words.${languageDirective()}`,
    },
    { role: 'user', content: snippet },
  ], 15000, 80)
}
```

- [ ] **Step 2: Simplify `handleSessionClose` in App.tsx**

```typescript
import { generateClosingPhrase } from './engine/closingEngine'

const handleSessionClose = useCallback(async () => {
  setClosingLoading(true)
  setClosingPhrase(null)

  if (activeEntryId && latestContentRef.current.html) {
    await db.entries.update(activeEntryId, {
      content: latestContentRef.current.html,
      plainText: latestContentRef.current.text,
      updatedAt: Date.now(),
    })
  }

  const text = latestContentRef.current.text.trim()
  trackEvent('session_close', { word_count: text ? text.split(/\s+/).filter(Boolean).length : 0 })

  try {
    const phrase = await generateClosingPhrase(text, '')
    setClosingPhrase(phrase.trim())
  } catch {
    setClosingPhrase(tr['session.fallback'])
  }
}, [activeEntryId, tr])
```

Remove the static `chatCompletion` and `languageDirective` imports from App.tsx (they're now dynamically imported inside `closingEngine.ts`).

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm run test -- --run`

```bash
git add src/engine/closingEngine.ts src/App.tsx
git commit -m "refactor: extract session closing logic from App.tsx to closingEngine"
```

---

## Summary

| Task | Item(s) | Phase | Estimated Complexity |
|------|---------|-------|---------------------|
| 1. Type Firestore boundary | #2 | A | High — touches ~15 files |
| 2. Extract grounding state | #8 | A | Low |
| 3. Public PartOrchestrator accessor | #10 | A | Low |
| 4. Fix openrouter unsafe access | #17 | A | Low |
| 5. Remove localStorage from orchestrator | #18 | A | Low |
| 6. Extract autocorrect hook | #3 | B | Medium |
| 7. Extract HRV + typewriter hooks | #7 | B | High |
| 8. Unify WeatherEngine | #9 | B | Low |
| 9. Extract Markdown export | #13 | B | Low |
| 10. Lazy-load engines + components | #5 | C | Medium |
| 11. Throttle streaming re-renders | #4 | C | Low |
| 12. Fix breathing rAF loop | #12 | C | Low |
| 13. Fix routing side effects | #14 | C | Low |
| 14. Fix fossil setTimeout | #15 | C | Low |
| 15. Fix globalConfig logout | #11 | C | Low |
| 16. Remove HRV console.logs | #16 | C | Low |
| 17. Add openrouter tests | #6 | D | Medium |
| 18. Extract closing engine | #1 | C | Low |
