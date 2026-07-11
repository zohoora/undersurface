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
    // gpt-5.5 budgets hidden reasoning, the ambient assessment preamble, and
    // visible prose against the same max_completion_tokens value. The old
    // 300–600 range could end halfway through the hidden preamble, especially
    // on a research-assigned turn. These are ceilings, not length targets;
    // prompt instructions still keep the visible reply appropriately concise.
    switch (phase) {
      case 'opening': return 1600
      case 'deepening': return 2000
      case 'closing': return 2400
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
