import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useJournalParts } from './useJournalParts'

const SOURCE = readFileSync(
  resolve(__dirname, 'useJournalParts.ts'),
  'utf8',
)

describe('useJournalParts', () => {
  it('exports a hook function', () => {
    expect(typeof useJournalParts).toBe('function')
    expect(useJournalParts.name).toBe('useJournalParts')
  })

  describe('engine lifecycle', () => {
    it('source: bails out of init when enabled is false (no engines created)', () => {
      // The early-return guard is what makes the disabled path zero-cost —
      // PauseDetector / PartOrchestrator / EmergenceEngine are never new'd.
      expect(SOURCE).toContain('if (!enabled || !scopeId) return')
    })

    it('source: bails out of init when scopeId is empty (parent not ready)', () => {
      // Empty scopeId protects against a race where SessionView mounts the
      // surface before the session doc has been created/loaded.
      expect(SOURCE).toContain('if (!enabled || !scopeId) return')
    })

    it('source: passes scopeId to orchestrator.setEntryId — orchestrator is scope-agnostic', () => {
      // setEntryId stores any opaque string; passing the session id tags
      // session-mode part interactions distinctly from real-entry interactions.
      expect(SOURCE).toContain('orchestrator.setEntryId(scopeId)')
    })

    it('source: teardown is invoked only via the cleanup closure, never directly in effect body', () => {
      // The init-effect body must not call teardown() — that triggers
      // cascading-render lint errors and risks double-cleanup. The cleanup
      // closure (return () => teardown()) is the single exit path.
      const initEffectStart = SOURCE.indexOf('// Initialize / re-initialize engines')
      expect(initEffectStart).toBeGreaterThan(-1)
      const initEffectEnd = SOURCE.indexOf('}, [enabled, scopeId, teardown])', initEffectStart)
      expect(initEffectEnd).toBeGreaterThan(initEffectStart)
      const effectBlock = SOURCE.slice(initEffectStart, initEffectEnd)
      const teardownCalls = effectBlock.match(/teardown\(\)/g) ?? []
      // Exactly one call inside the effect block — the one inside the cleanup
      // closure: `return () => { teardown() }`.
      expect(teardownCalls).toHaveLength(1)
    })

    it('source: teardown clears thoughts state and nulls active part color', () => {
      // Live-toggle false transition must wipe stale bubbles AND reset the
      // parent-tracked active color, otherwise the editor stays tinted with
      // a part color forever.
      expect(SOURCE).toContain('setThoughts([])')
      expect(SOURCE).toContain('onActivePartColorChangeRef.current?.(null)')
    })

    it('source: teardown destroys the pause detector', () => {
      // PauseDetector schedules timers internally; not destroying leaks them
      // and can fire orchestrator callbacks against the prior (torn-down)
      // closure.
      expect(SOURCE).toContain('pauseDetectorRef.current?.destroy()')
    })

    it('source: teardown cancels any pending RAF for batched thought updates', () => {
      // Without this, a half-streamed thought can land in setThoughts after
      // the engines are gone, undoing the clear.
      expect(SOURCE).toContain('cancelAnimationFrame(pendingThoughtUpdateRef.current)')
    })
  })

  describe('chat integration', () => {
    it('source: composes useChatResponse with the same orchestrator and pauseDetector refs', () => {
      // The chat hook needs to suppress the pause detector during a click-back
      // interaction — it can only do that if it gets the LIVE refs from this
      // hook, not stale or undefined ones.
      expect(SOURCE).toContain('useChatResponse({')
      expect(SOURCE).toContain('orchestratorRef')
      expect(SOURCE).toContain('pauseDetectorRef')
    })

    it('source: handleThoughtClick hides the thought when the chat panel opens', () => {
      // When the user clicks a bubble to talk back, the bubble shouldn't
      // remain on the page — it should hide, leaving only the ThinkingSpace.
      expect(SOURCE).toContain('isVisible: false')
    })
  })

  describe('editor handler shape', () => {
    it('source: recordKeystroke and updateText are useCallback-wrapped (stable identity)', () => {
      // TipTap's editorProps closures capture once; the consumer's editor
      // handlers reference these via refs. Stable identity here avoids
      // bridging-ref churn on every parent re-render.
      const recordIdx = SOURCE.indexOf('const recordKeystroke = useCallback')
      const updateIdx = SOURCE.indexOf('const updateText = useCallback')
      expect(recordIdx).toBeGreaterThan(-1)
      expect(updateIdx).toBeGreaterThan(-1)
    })

    it('source: recordKeystroke and updateText defer to current pauseDetectorRef (no-op when null)', () => {
      // Optional-chain on .current means: if engines aren't running (toggle
      // off), the editor's handlers silently no-op — no exceptions, no
      // missed-method crashes.
      expect(SOURCE).toContain('pauseDetectorRef.current?.recordKeystroke')
      expect(SOURCE).toContain('pauseDetectorRef.current?.updateText')
    })
  })
})
