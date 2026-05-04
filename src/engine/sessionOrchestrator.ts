import type { SessionMessage, SessionPhase } from '../types'
import { buildTherapistSessionNotePrompt } from '../ai/therapistPrompts'
import { chatCompletion, analyzeEmotionAndDistress, classifyCrisisRisk } from '../ai/openrouter'
import type { CrisisRiskResult } from '../ai/openrouter'
import { activateGrounding } from '../store/groundingState'

// Fast keyword-based crisis detection — no LLM, no cooldown, no feature flag.
// This is a safety net that runs synchronously before the therapist responds.
const CRISIS_PATTERNS = [
  /\bwant\s+to\s+die\b/i,
  /\bwant\s+to\s+kill\s+(myself|me)\b/i,
  /\bkill\s+myself\b/i,
  /\bend\s+(my|this)\s+life\b/i,
  /\bend\s+it\s+all\b/i,
  /\bsuicid/i,
  /\bdon'?t\s+want\s+to\s+(be\s+here|live|exist|be\s+alive)\b/i,
  /\bwish\s+I\s+(was|were)\s+dead\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\bno\s+reason\s+to\s+(live|go\s+on|keep\s+going)\b/i,
  /\bshould\s+I?\s*(just\s+)?die\b/i,
  /\bI\s+should\s+die\b/i,
  /\brest\s+forever\b/i,
  /\bwith\s+jesus\b/i,
  /\bjump\s+off\b/i,
  /\bcut\s+(myself|my\s+wrists?)\b/i,
  /\btake\s+(all\s+)?(the\s+)?pills\b/i,
  /\bswallow\s+(all\s+)?(the\s+)?pills\b/i,
  /\bhang\s+myself\b/i,
  /\bshoot\s+myself\b/i,
  // Abbreviations and slang
  /\bkms\b/i,
  /\bkys\b/i,
  /\bctb\b/i,
  // Additional patterns
  /\bslit\s+(my\s+)?wrists?\b/i,
  /\boverdose\b/i,
  /\bwanna\s+die\b/i,
  /\bready\s+to\s+die\b/i,
  /\bplanning\s+to\s+(end|kill|die)\b/i,
  /\bno\s+point\s+in\s+living\b/i,
  /\blife\s+isn'?t\s+worth\b/i,
  /\bcan'?t\s+do\s+this\s+anymore\b/i,
  /\bdon'?t\s+want\s+to\s+wake\s+up\b/i,
  /\bhurt\s+myself\b/i,
  /\bself[- ]?harm\b/i,
  /\bdrown\s+myself\b/i,
]

/**
 * Normalizes text for crisis detection: NFKC normalization to defeat
 * Unicode tricks (Cyrillic lookalikes, fullwidth chars), and strips
 * zero-width/non-breaking whitespace.
 */
function normalizeForCrisisDetection(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u00A0\u200B\u200C\u200D\uFEFF\u2060]/g, ' ')
}

export function detectCrisisKeywords(text: string): boolean {
  const normalized = normalizeForCrisisDetection(text)
  return CRISIS_PATTERNS.some(p => p.test(normalized))
}

export class SessionOrchestrator {
  detectPhase(messages: SessionMessage[]): SessionPhase {
    const userMessageCount = messages.filter(m => m.speaker === 'user').length
    if (userMessageCount < 3) return 'opening'
    if (userMessageCount >= 12) return 'closing'
    return 'deepening'
  }

  getMaxTokens(phase: SessionPhase): number {
    switch (phase) {
      case 'opening': return 150
      case 'deepening': return 250
      case 'closing': return 300
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

  // L2 — synchronous LLM crisis classifier. Multilingual + ambiguous coverage.
  // Calibrated for precision over recall via crisisClassifierPrompt.ts and
  // crisisClassifier.eval.ts. risk=2 activates full grounding immediately;
  // risk=1 is returned to the caller for soft-grounding handling but does not
  // flip global grounding state. Fail-open on classifier error (returns risk=0).
  //
  // Intended to be fired in parallel with therapist generation. Caller may
  // race the result against the in-flight stream's first token to decide
  // whether to abort and restart with a grounded prompt.
  async checkCrisisRisk(text: string, language?: string): Promise<CrisisRiskResult> {
    const result = await classifyCrisisRisk(text, language)
    if (result.risk === 2) {
      activateGrounding('auto')
    }
    return result
  }

  // L3 — emotion tagging for innerWeather and part scoring. L2 owns grounding
  // decisions; the distressLevel field this returns is informational only.
  async checkEmotionAfterMessage(text: string): Promise<{ emotion: string; distressLevel: number } | null> {
    return analyzeEmotionAndDistress(text)
  }

  async generateSessionNote(messages: SessionMessage[]): Promise<string> {
    const promptMessages = buildTherapistSessionNotePrompt(messages)
    return chatCompletion(promptMessages, 30000, 400, 'low')
  }
}
