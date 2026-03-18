# Webcam HRV Biofeedback for Session Mode

**Date:** 2026-03-17
**Status:** Approved design

## Overview

Add webcam-based heart rate variability (HRV) monitoring to session/companion mode. The camera captures subtle skin color fluctuations caused by blood flow (remote photoplethysmography / rPPG) to derive autonomic nervous system state. This data is provided to the therapist AI as rich context — including correlations between HRV shifts and specific conversation moments — enabling more physiologically attuned responses.

**Scope:** Session mode only. Not diary/editor mode.

### Out of Scope (v1)

- Consent revocation UI (add in settings later)
- Mobile-specific optimizations (desktop-first for this iteration)
- Resuming HRV data when returning to an existing session (always fresh start)
- `beforeunload` persistence (accept potential data loss on abrupt close, consistent with existing session behavior)

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/engine/hrvEngine.ts` | Signal processing: webcam → HRV measurements |
| `src/engine/hrvTimeline.ts` | Timeline tracking, shift detection, message correlation, prompt context builder |
| `src/components/Session/HrvConsentDialog.tsx` | One-time informed consent modal |
| `src/components/Session/HrvAmbientBar.tsx` | Live HRV trace bar + camera thumbnail |
| `src/types/hrv.ts` | HRV type definitions |

### Modified Files

| File | Change |
|------|--------|
| `src/components/Session/SessionView.tsx` | Add HRV toggle, mount ambient bar, wire engine to message lifecycle |
| `src/ai/therapistPrompts.ts` | Inject HRV context into therapist system prompt |
| `src/store/db.ts` | Add `hrvSessions` collection proxy |
| `src/types/index.ts` | Export HRV types |
| `src/admin/adminTypes.ts` | Add `webcamHrv` feature flag |
| `firebase.json` | Update `Permissions-Policy` to `camera=(self)`, update CSP if needed |
| `functions/src/index.ts` | Add `hrvSessions` to `deleteAccount` cleanup |

## Section 1: HRV Engine

`src/engine/hrvEngine.ts` — Standalone engine, no React dependencies.

### Signal Extraction Pipeline

1. `getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } })` — low-res suffices for rPPG
2. **Web Worker** processes frames to avoid blocking the main thread:
   - Main thread: captures frames at ~30fps via `requestAnimationFrame`, draws to offscreen canvas, posts `ImageData` to worker
   - Worker: performs all signal processing (steps 3-6 below), posts back `HrvMeasurement` every ~5 seconds
3. Extract average green channel intensity from a fixed center-of-frame ROI (user centers face via thumbnail preview; no face detection dependency in v1)
4. Bandpass filter (0.7–4 Hz, i.e., 42–240 BPM range) — custom IIR Butterworth implementation (lightweight, no external DSP library)
5. Peak detection → inter-beat intervals (IBIs)
6. From IBIs, compute:
   - **HR** — beats per minute
   - **RMSSD** — root mean square of successive IBI differences (primary HRV metric, reflects parasympathetic activity)
   - **Autonomic state** — derived from RMSSD relative to user's baseline: `calm` (high RMSSD), `activated` (low RMSSD), `transitioning`
   - **Trend** — `rising`, `falling`, `steady` over a sliding window

### Output

Emits `HrvMeasurement` every ~5 seconds:

```typescript
interface HrvMeasurement {
  timestamp: number
  hr: number
  rmssd: number
  autonomicState: 'calm' | 'activated' | 'transitioning'
  trend: 'rising' | 'falling' | 'steady'
  confidence: number  // 0-1, signal quality indicator
}
```

### Calibration

First 60 seconds after activation is a calibration window — establishes the user's baseline RMSSD. State thresholds are relative to their baseline, not absolute values (HRV varies significantly between individuals). Calibration extends automatically if confidence remains below threshold, up to 120 seconds max.

### Signal Quality & Confidence

- Measurements with confidence < 0.3 are excluded from prompt context
- If confidence stays below 0.3 for > 60 seconds after calibration, the ambient bar shows "Weak signal — try adjusting lighting or position"
- Prompt context includes `Signal confidence: low/medium/high` so the AI can weight its interpretation accordingly

### API Surface

```typescript
class HrvEngine {
  start(): Promise<void>          // request camera, begin processing
  stop(): void                    // release camera, stop processing
  getLatest(): HrvMeasurement | null
  getStream(): MediaStream | null // for camera thumbnail
  onMeasurement(cb: (m: HrvMeasurement) => void): void
  onCalibrationComplete(cb: (baseline: number) => void): void
  onError(cb: (error: HrvError) => void): void
  isCalibrating(): boolean
}
```

### Error Handling

```typescript
type HrvError =
  | { type: 'camera_denied' }        // user denied permission
  | { type: 'camera_unavailable' }   // no camera found
  | { type: 'camera_lost' }          // stream interrupted mid-session
  | { type: 'worker_error'; message: string }
```

- **Camera denied / unavailable:** `start()` rejects, toggle resets to off, toast message shown
- **Camera lost mid-session:** Engine emits `camera_lost` error, ambient bar shows "Camera disconnected", measurements stop, prompt context notes "biometric data unavailable since [time]". Toggle stays on so user can click to retry.
- **Worker crash:** Fallback to main-thread processing (degraded performance warning in console)

## Section 2: Session Timeline & Message Correlation

`src/engine/hrvTimeline.ts` — Tracks measurements alongside conversation events.

### Timeline Model

```typescript
interface HrvTimeline {
  events: HrvTimelineEvent[]
  shifts: HrvShift[]
  baselineRmssd: number | null
  addMeasurement(m: HrvMeasurement): void
  addConversationEvent(type: HrvConversationEventType, messageIndex: number): void
  getRecentShifts(windowSeconds?: number): HrvShift[]
  buildPromptContext(): string
}

type HrvConversationEventType = 'user_message' | 'ai_response_start' | 'ai_response_complete'

interface HrvTimelineEvent {
  timestamp: number
  type: 'measurement' | HrvConversationEventType
  measurement?: HrvMeasurement
  messageIndex?: number
}
```

**SessionView integration points:**
- `user_message`: recorded when user sends a message (submit handler)
- `ai_response_start`: recorded when first streaming token arrives (`onToken` callback, guarded to fire once)
- `ai_response_complete`: recorded when streaming finishes (`onComplete` callback)

### Shift Detection

- Compares current RMSSD against a rolling average (last 60 seconds)
- If deviation exceeds threshold → flag as a "notable shift"
- Looks backward to find the most recent conversation event before the shift

```typescript
interface HrvShift {
  timestamp: number
  fromState: 'calm' | 'activated' | 'transitioning'
  toState: 'calm' | 'activated' | 'transitioning'
  trigger: 'user_message' | 'ai_response' | 'unknown'
  triggerMessageIndex: number | null
  magnitude: number
}
```

### Prompt Context Builder

`HrvTimeline.buildPromptContext()` produces a text block injected into the therapist system prompt:

```
[Biometric context]
Current autonomic state: activated (trend: rising, 90s)
Heart rate: 82 bpm
Session baseline: calm
Notable shifts:
- Shifted from calm → activated after your message about work (message #4, ~45s ago)
- Brief activation during therapist response #3, settled within 20s
Signal confidence: high
```

### Continuous Tracking

HRV runs continuously throughout the session — during user typing AND while reading AI responses. The user's physiological reaction to the therapist's words is captured alongside their state while composing messages.

## Section 3: UI Components

### HrvConsentDialog.tsx

Modal shown on first HRV activation per user:
- Explains: camera captures video locally, no video is stored or transmitted, only derived HRV metrics are persisted
- Two checkboxes: camera usage consent + biometric data collection consent
- Stores `consent/camera-hrv` in Firestore with version and timestamp
- Only shown once (consent checked on mount)

### HrvAmbientBar.tsx

Thin horizontal bar at the top of the session view (below header):
- Rolling HRV trace: last ~60 seconds of RMSSD values as a simple line graph
- Background color: calm blue-green ↔ activated warm amber, smooth CSS transitions
- Left: text label showing current state ("calm", "activated", "calibrating...")
- Right: 48px circular camera thumbnail showing user's face for framing
- Low confidence: subtle "weak signal" indicator

### HRV Toggle

Toggle button in session header area:
- Off by default each session
- Click → check consent doc → if missing show consent dialog → if present start engine
- Camera icon with on/off state
- Ambient bar appears/hides with toggle

### Layout

```
┌─────────────────────────────────────┐
│ [Session Header]        [HRV Toggle]│
├─────────────────────────────────────┤
│ [HRV Ambient Bar ~~~~~~~~~ ◉ cam ] │  ← only when active
├─────────────────────────────────────┤
│                                     │
│         Chat messages               │
│                                     │
├─────────────────────────────────────┤
│ [Message input]                     │
└─────────────────────────────────────┘
```

Styling follows existing SessionView patterns: inline styles, warm muted palette. Ambient bar uses CSS variables for dark mode compatibility.

## Section 4: Data Persistence

### Firestore: `users/{uid}/hrvSessions/{sessionId}`

```typescript
interface HrvSessionData {
  id: string                      // matches session ID
  startedAt: number
  endedAt: number
  calibrationBaseline: number     // baseline RMSSD from calibration window
  measurements: HrvMeasurement[]  // full timeline, ~12/min
  shifts: HrvShift[]              // notable state changes with correlations
  summary: {
    dominantState: 'calm' | 'activated' | 'transitioning'
    averageHr: number
    averageRmssd: number
    shiftCount: number
    avgConfidence: number
  }
}
```

### Write Strategy

- Measurements accumulate in memory during the session
- Safety flush to Firestore every 5 minutes (guards against browser close)
- Full write + summary on session end
- ~720 measurements for a 60-min session ≈ ~72KB (well within Firestore 1MB doc limit)

### Consent: `users/{uid}/consent/camera-hrv`

Follows existing `ConsentRecord` shape:

```typescript
interface CameraHrvConsent {
  id: 'camera-hrv'
  acceptedAt: number
  acceptedVersion: string  // '1.0'
  cameraAccepted: boolean
  biometricDataAccepted: boolean
}
```

### Integration with existing data patterns

- Add `hrvSessions` proxy to `db.ts` (add to the `db` object literal)
- Add `'hrvSessions'` to the `collectionNames` array in `exportAllData()`
- Add types to `src/types/index.ts`
- Add to `deleteAccount` in `functions/src/index.ts`
- Add Firestore security rules for `users/{uid}/hrvSessions/{docId}` (owner-only read/write)
- Add Firestore security rules for `users/{uid}/consent/camera-hrv` (owner-only read/write — may already be covered by existing consent rules)

## Section 5: Therapist Prompt Integration & Safety

### Prompt Injection

HRV context injected into the therapist system prompt in `therapistPrompts.ts`, alongside existing session context (phase, emotion, grounding state).

The `HrvTimeline.buildPromptContext()` method produces the context string. `therapistPrompts.ts` receives it via a new optional field on `TherapistPromptOptions`:

```typescript
interface TherapistPromptOptions {
  // ... existing fields
  hrvContext?: string  // pre-built text from HrvTimeline.buildPromptContext()
}
```

When present, appended to the system prompt after existing session context.

### AI Behavior Guidance

Added to therapist prompt instructions:

```
When biometric context is available:
- Use it to notice what the user might not be saying ("I notice you might be
  feeling more activated right now — does that resonate?")
- Never state biometric data as fact about emotions ("Your heart rate shows
  you're anxious") — offer it as an invitation to explore
- If a shift correlates with a specific topic, gently name the connection
- Don't reference biometrics every message — use sparingly when it adds genuine insight
- During grounding: note if biometrics show the user is settling (or not),
  adjust approach accordingly
```

### Safety

- HRV does NOT trigger grounding independently — crisis keywords and emotion checks remain the safety layer
- If grounding is already active, HRV context is still provided so the therapist can see whether the user is physiologically settling
- No crisis detection from HRV alone (elevated heart rate ≠ crisis)

### Feature Flag

`features.webcamHrv` — experimental (default disabled, `=== true` check)

### Infrastructure Changes

- `firebase.json` Permissions-Policy: `camera=()` → `camera=(self)` (note: this enables camera permission prompts site-wide, but only session mode will request access behind the feature flag + consent gate)
- CSP: no changes needed (camera is a browser permission, not a network resource)

### Session End Integration

When `handleEndSession` is called in SessionView:
1. Build final HRV prompt context (so the closing therapist message has HRV awareness)
2. Generate closing message with HRV context included
3. Stop HRV engine (`hrvEngine.stop()`)
4. Compute summary and write `HrvSessionData` to Firestore
5. If engine is still in calibration at session end, skip persistence (insufficient data)
