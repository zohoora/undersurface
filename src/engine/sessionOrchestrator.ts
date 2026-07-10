import type { SessionMessage, SessionPhase } from '../types'
import { buildTherapistSessionNotePrompt } from '../ai/therapistPrompts'
import { chatCompletion, analyzeEmotionAndDistress } from '../ai/openrouter'
import { activateGrounding } from '../store/groundingState'
import { detectCrisisKeywords } from '../../functions/src/shared/crisisFloor'

export { detectCrisisKeywords } from '../../functions/src/shared/crisisFloor'

export class SessionOrchestrator {
  // Throttle the informational emotion tag to at most once per interval — the
  // diary path (partOrchestrator) already does this; session mode was firing an
  // extra LLM call on every user turn. Returns null when throttled.
  private lastEmotionCheck = 0
  private readonly EMOTION_CHECK_INTERVAL_MS = 30_000

  detectPhase(messages: SessionMessage[]): SessionPhase {
    const userMessageCount = messages.filter(m => m.speaker === 'user').length
    if (userMessageCount < 3) return 'opening'
    if (userMessageCount >= 12) return 'closing'
    return 'deepening'
  }

  getMaxTokens(phase: SessionPhase): number {
    // gpt-5.5 with reasoning=medium consumes a non-trivial slice of the budget
    // on internal reasoning before any content tokens are emitted. Empty-completion
    // bug logs (2026-05-06) showed bytes=608 streams (= zero content) when the
    // budget was tight. Headroom is cheap; truncated therapists are not.
    switch (phase) {
      case 'opening': return 300
      case 'deepening': return 500
      case 'closing': return 600
    }
  }

  // L1 — fast synchronous regex check. English explicit ideation only;
  // bypass-resistant via NFKC normalization. Always runs, no cooldown, no
  // feature flag. The deterministic high-precision floor for crisis detection.
  checkCrisisKeywords(text: string): boolean {
    if (detectCrisisKeywords(text)) {
      activateGrounding('auto')
      return true
    }
    return false
  }

  // L2 lives in the therapist stream as a `<<RISK:N>>` preamble — see
  // RISK_PREAMBLE_INSTRUCTIONS. Diary mode keeps the standalone classifier
  // at partOrchestrator.checkCrisisInJournalMode (no stream to fold into).

  // L3 — emotion tagging for innerWeather and part scoring. The
  // distressLevel field this returns is informational only.
  async checkEmotionAfterMessage(text: string): Promise<{ emotion: string; distressLevel: number } | null> {
    const now = Date.now()
    if (now - this.lastEmotionCheck < this.EMOTION_CHECK_INTERVAL_MS) return null
    this.lastEmotionCheck = now
    return analyzeEmotionAndDistress(text)
  }

  async generateSessionNote(messages: SessionMessage[]): Promise<string> {
    const promptMessages = buildTherapistSessionNotePrompt(messages)
    return chatCompletion(promptMessages, 30000, 400, 'low')
  }
}
