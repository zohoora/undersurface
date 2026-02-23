import type { Part, PartMemory, UserProfile, SessionMessage, SessionPhase } from '../types'
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

export interface SessionPromptOptions {
  phase: SessionPhase
  memories: PartMemory[]
  profile?: UserProfile | null
  recentEntryContext?: string
  otherParts?: string[]
  emergenceContext?: string
  isClosing?: boolean
}

function formatPhaseHint(phase: SessionPhase): string {
  switch (phase) {
    case 'opening':
      return `SESSION PHASE: opening. The conversation is just beginning. Be warm but not effusive. Let the writer settle in. Ask one gentle, open question — or simply greet them in your voice.`
    case 'deepening':
      return `SESSION PHASE: deepening. The conversation has found its footing. Follow the thread. Go where the writer is going — or gently point to where they might be avoiding. You can be more direct now.`
    case 'closing':
      return `SESSION PHASE: closing. The session is winding down. Offer a distillation — something the writer can carry with them. A mirror, not advice. Keep it brief and resonant.`
  }
}

function formatTranscript(history: SessionMessage[]): string {
  return history.map(msg => {
    if (msg.speaker === 'user') {
      return `Writer: ${msg.content}`
    }
    return `${msg.partName}: ${msg.content}`
  }).join('\n')
}

export function buildSessionMessages(
  part: Part,
  history: SessionMessage[],
  options: SessionPromptOptions,
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  // Build system prompt from scratch — do NOT use part.systemPrompt
  // (it contains journal-mode SHARED_INSTRUCTIONS baked in)
  const systemParts: string[] = []

  // 1. Session instructions
  systemParts.push(SESSION_INSTRUCTIONS)

  // 2. Part voice and concern
  systemParts.push(`You are ${part.name}. ${part.voiceDescription}\nYour concern: ${part.concern}`)

  // 3. Part's systemPromptAddition (learned specifics)
  if (part.systemPromptAddition) {
    systemParts.push(part.systemPromptAddition)
  }

  // 4. Phase hint
  systemParts.push(formatPhaseHint(options.phase))

  // 5. User profile
  if (options.profile) {
    const profileLines: string[] = []
    if (options.profile.innerLandscape) profileLines.push(options.profile.innerLandscape)
    if (options.profile.recurringThemes?.length > 0) {
      profileLines.push(`Recurring themes: ${options.profile.recurringThemes.join(', ')}`)
    }
    if (options.profile.avoidancePatterns?.length > 0) {
      profileLines.push(`Avoidance patterns: ${options.profile.avoidancePatterns.join(', ')}`)
    }
    if (profileLines.length > 0) {
      systemParts.push(`What you know about this writer:\n${profileLines.join('\n')}`)
    }
  }

  // 6. Memories (up to 8)
  const relevantMemories = options.memories.slice(-8)
  if (relevantMemories.length > 0) {
    systemParts.push(`Your memories of this writer:\n${relevantMemories.map(m => `- ${m.content}`).join('\n')}`)
  }

  // 7. Other parts present
  if (options.otherParts && options.otherParts.length > 0) {
    systemParts.push(`Other parts present in this session: ${options.otherParts.join(', ')}. You are aware of what they have said. You may build on it, gently disagree, or take the conversation in a different direction.`)
  }

  // 8. Emergence context
  if (options.emergenceContext) {
    systemParts.push(`You are entering this conversation mid-session because: ${options.emergenceContext}`)
  }

  // 9. Language directive
  const langDirective = languageDirective()
  if (langDirective) {
    systemParts.push(langDirective.trim())
  }

  const systemContent = systemParts.join('\n\n')

  // Build user message
  const userParts: string[] = []

  // Recent entry context
  if (options.recentEntryContext) {
    userParts.push(`Recent journal context: ${options.recentEntryContext}`)
  }

  // Conversation history
  if (history.length > 0) {
    userParts.push(`Conversation so far:\n${formatTranscript(history)}`)
  }

  // Closing instruction
  if (history.length === 0) {
    userParts.push(`This is the start of the session. You speak first. Open the conversation.`)
  } else {
    userParts.push(`Respond as ${part.name}.`)
  }

  const userContent = userParts.join('\n\n')

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ]
}

export function buildSessionNotePrompt(
  history: SessionMessage[],
  partNames: string[],
): { role: 'system' | 'user'; content: string }[] {
  return [
    {
      role: 'system',
      content: 'You summarize inner dialogue sessions. Write a 2-4 sentence session note capturing the key themes, any breakthroughs or realizations, and the emotional arc. Write in third person about \'the writer.\' Be specific, not generic. Do not use clinical language.',
    },
    {
      role: 'user',
      content: `Parts present: ${partNames.join(', ')}\n\nTranscript:\n${formatTranscript(history)}\n\nWrite the session note.`,
    },
  ]
}
