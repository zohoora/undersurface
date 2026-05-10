import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE = readFileSync(
  resolve(__dirname, 'SessionJournalSurface.tsx'),
  'utf8',
)

describe('SessionJournalSurface', () => {
  describe('parts toggle gate', () => {
    it('effective enable AND-chains all three guards in correct order', () => {
      // Order matters less than presence here, but the failure modes are:
      //   - Forgetting partsEnabled → toggle becomes a placebo (always on)
      //   - Forgetting !isGrounding → parts speak during distress (the
      //     load-bearing override mirroring Real Talk's grounding rule)
      //   - Forgetting global partsEnabled → admin-disabled flag is bypassed
      expect(SOURCE).toContain('partsEnabled &&')
      expect(SOURCE).toContain('!isGrounding')
      expect(SOURCE).toContain("globalConfig?.features?.partsEnabled !== false")
    })

    it('effective enable is the value passed to useJournalParts', () => {
      // Catches a refactor regression where someone wires `partsEnabled` raw
      // into the hook and skips the grounding/global guard.
      const hookCallIdx = SOURCE.indexOf('useJournalParts({')
      expect(hookCallIdx).toBeGreaterThan(-1)
      const hookCallEnd = SOURCE.indexOf('})', hookCallIdx)
      expect(hookCallEnd).toBeGreaterThan(hookCallIdx)
      const hookCallBlock = SOURCE.slice(hookCallIdx, hookCallEnd)
      expect(hookCallBlock).toContain('enabled: effectivelyEnabled')
    })

    it('useGroundingMode is subscribed (reactive distress signal)', () => {
      // The grounding override only works if the surface re-renders when
      // grounding flips. useGroundingMode is the reactive subscription
      // (vs imperative isGroundingActive() which doesn't trigger re-render).
      expect(SOURCE).toContain('useGroundingMode()')
    })
  })

  describe('editor handlers', () => {
    it('keydown calls recordKeystroke directly (stable identity, no ref-bridge)', () => {
      // recordKeystroke is useCallback([]) inside useJournalParts — stable
      // for the component's life — so capturing it in TipTap's once-built
      // closure is safe without a useRef bridge.
      expect(SOURCE).toContain('recordKeystroke(event.key, text, pos)')
    })

    it('onUpdate calls updateText directly', () => {
      expect(SOURCE).toContain('updateText(text, editor.state.selection.from)')
    })

    it('keydown calls fadeVisibleThoughts (narrow API from the hook, no setThoughts leak)', () => {
      // The hook exposes fadeVisibleThoughts so the consumer doesn't need
      // raw setThoughts — keeps the ActiveThought shape encapsulated.
      expect(SOURCE).toContain('fadeVisibleThoughts()')
    })
  })

  describe('UI layering', () => {
    it('renders thought bubbles in a positioned wrapper', () => {
      expect(SOURCE).toContain('PartThoughtBubble')
    })

    it('renders ThinkingSpace overlay when chat.activeInteraction is non-null', () => {
      expect(SOURCE).toContain('chat.activeInteraction && (')
      expect(SOURCE).toContain('ThinkingSpace')
    })

    it('renders PauseRipple component for pause-feedback affordance', () => {
      expect(SOURCE).toContain('<PauseRipple ripples={ripples} />')
    })

    it('keeps the original journal placeholder + presence affordance', () => {
      // Regression: the toggle shouldn't strip the atmospheric "therapist is
      // listening" presence dot or the placeholder copy.
      expect(SOURCE).toContain('session.journal.presence')
      expect(SOURCE).toContain('session.journal.placeholder')
    })
  })

  describe('cursor ripple uses shared helper', () => {
    it('triggerRippleAtCursor is wired with the session-journal-surface selector', () => {
      // The math (coordsAtPos → container offset) lives in
      // Atmosphere/usePauseRipple to stay in sync with standalone Journal.
      expect(SOURCE).toContain('triggerRippleAtCursor(editor')
      expect(SOURCE).toContain("'.session-journal-surface'")
    })
  })
})
