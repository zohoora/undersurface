import type { InputMode, RegisterTierId } from '../types'

export interface RegisterTier {
  id: RegisterTierId
  description: string
  bannedWords: readonly string[]
  sentenceCap: number | null
  exampleWrong: string
  exampleRight: string
}

// Therapy-jargon bans apply to every tier — the goal is therapist responses
// that don't sound like a therapist. Tier-specific bans are additive.
export const REGISTER_TIER_IDS: readonly RegisterTierId[] = ['plain', 'conversational', 'literate', 'scholarly'] as const

export const THERAPY_JARGON_BAN: readonly string[] = [
  'dysregulation',
  'co-regulation',
  'somatic',
  'attunement',
  'rupture',
  'window of tolerance',
  'parts work',
  'inner child',
  'shadow work',
  'nervous system',
  'embodied',
  'integration',
  'felt sense',
] as const

export const REGISTER_TIERS: Record<RegisterTierId, RegisterTier> = {
  plain: {
    id: 'plain',
    description: 'Short, simple words. One idea per sentence.',
    bannedWords: ['profound', 'intricate', 'subtle', 'underlying', 'inherent', 'manifest', 'emerge'],
    sentenceCap: 12,
    exampleWrong: 'The anxiety might be trying to protect something soft in you.',
    exampleRight: 'Maybe the worry is trying to keep you safe.',
  },
  conversational: {
    id: 'conversational',
    description: 'Plain warm talk. Like a friend who pays attention.',
    bannedWords: [],
    sentenceCap: 18,
    exampleWrong: 'Anxiety is the signal that your tenderness is still alive.',
    exampleRight: "The anxiety might be trying to protect something soft in you. That's not a flaw.",
  },
  literate: {
    id: 'literate',
    description: 'Comfortable with longer sentences and richer vocabulary.',
    bannedWords: [],
    sentenceCap: null,
    exampleWrong: "The chronic vigilance you're describing is autonomic, not chosen.",
    exampleRight: "The watchfulness sounds like it kicks in before you've even decided. That's worth noticing.",
  },
  scholarly: {
    id: 'scholarly',
    description: 'Comfortable with abstract framing and longer arcs of thought.',
    bannedWords: [],
    sentenceCap: null,
    exampleWrong: 'Your phenomenology suggests an unresolved attachment schema.',
    exampleRight:
      "There's a particular quality to chronic distance. It's a stance the body keeps long after the original threat is gone. What were you keeping yourself safe from?",
  },
}

// Tiers above conversational get collapsed in two cases: voice mode (spoken
// vocabulary above conversational feels off) and grounding mode (distress is
// not the moment for richer vocabulary). Single predicate, two consumers.
function isAboveConversational(tierId: RegisterTierId): boolean {
  return tierId === 'literate' || tierId === 'scholarly'
}

function applyVoiceCap(tier: RegisterTier, currentInputMode: InputMode): RegisterTier {
  if (currentInputMode !== 'voice') return tier
  return isAboveConversational(tier.id) ? REGISTER_TIERS.conversational : tier
}

// Exported for callers that compute the effective tier before rendering
// (e.g. buildTherapistSystemPrompt applies this when isGrounding is true).
export function applyGroundingCap(tier: RegisterTier): RegisterTier {
  return isAboveConversational(tier.id) ? REGISTER_TIERS.conversational : tier
}

export function renderRegisterBlock(
  tier: RegisterTier,
  currentInputMode: InputMode = 'desktop',
): string {
  const effective = applyVoiceCap(tier, currentInputMode)
  const bans = [...THERAPY_JARGON_BAN, ...effective.bannedWords]

  const lines: string[] = [`REGISTER — match the writer's level (${effective.description}):`]
  lines.push(`- Avoid these words: ${bans.join(', ')}.`)
  if (effective.sentenceCap !== null) {
    lines.push(`- Keep sentences to ${effective.sentenceCap} words or fewer.`)
  }
  lines.push(`- Wrong: "${effective.exampleWrong}"`)
  lines.push(`- Right: "${effective.exampleRight}"`)

  if (currentInputMode === 'voice') {
    lines.push('- The writer is speaking aloud. Use spoken cadence — contractions OK, fragments OK.')
  } else if (currentInputMode === 'mobile') {
    lines.push('- The writer is on mobile. Keep responses tight; assume reading on a small screen.')
  }

  return lines.join('\n')
}
