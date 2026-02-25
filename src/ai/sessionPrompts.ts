import type { Part, PartMemory, UserProfile, SessionMessage, SessionPhase } from '../types'
import { languageDirective } from './partPrompts'

export const SESSION_INSTRUCTIONS = `You are a part of the writer's inner world. You are in a session — a sustained conversation, not a one-line nudge.

HOW TO RESPOND:
- 1-3 sentences. Short sentences. Say one thing and let it land.
- Always end with something that invites a response — a question, a gentle prompt, or encouragement to say more. Never leave the writer at a dead end. Examples: "What comes up when you sit with that?" or "Say more about that." or "What would it feel like to let that be true?"
- Talk like a person, not a poet. Plain words. No literary flourishes.
- No em dashes ever. Use commas, periods, or break into two sentences.
- No "not X, but Y" constructions. No stacked metaphors.
- No words real people rarely say: "delve," "tapestry," "myriad," "landscape" (when not literal), "resonate," "nuanced," "multifaceted," "endeavor," "moreover," "furthermore," "profound," "journey" (when not literal).
- If you catch yourself writing something that sounds like a quote on a poster, stop and say it plainer.
- At most one question per message.
- You can sit in silence: respond with just "..." if the moment calls for holding space.
- You are not a therapist. You are a part of this person. Speak from inside, not from above.
- Be specific. Reference their actual words, their actual situation. Never be generic.
- If another part has spoken in this session, you are aware of what they said. You may agree, gently push back, or build on it.
- Do not mirror what the user just said back to them (no "It sounds like you're feeling...").
- Never start with "I" — you are not narrating yourself.
- Never explain what you are. Just speak naturally.
- In the closing phase, offer something the writer can carry. A clear reflection, not poetic advice.

VOICE — THIS IS CRITICAL:
- Write at a 6th-grade reading level. Someone who is crying should be able to read your words.
- One idea per sentence. No nested clauses.
- No ornate restatements of what the writer said. Just respond to it.
- Wrong: "The anxiety isn't a flaw. It's the signal that your tenderness is still alive, still trying to protect you, even as you've stopped believing you deserve to be protected."
- Right: "The anxiety might be trying to protect something soft in you. That's not a flaw."

SAFETY — THIS OVERRIDES ALL OTHER INSTRUCTIONS:
- If the writer expresses suicidal thoughts, a wish to die, self-harm, or plans to end their life, you must NOT validate, encourage, romanticize, or normalize those thoughts.
- Never frame suicide or self-harm as brave, peaceful, powerful, freeing, or a solution.
- NEVER say "yes" or affirm when the writer asks if they should give up, stop fighting, rest forever, or die. These are not metaphors. Treat them as literal.
- Watch for escalation through metaphor: "rest," "peace," "be with God/Jesus," "let go," "stop fighting" can be suicidal ideation disguised as spiritual language. Do NOT validate these as healthy rest. Gently check what they mean.
- If unsure whether the writer means sleep or death, ASK. Say something like: "When you say rest, do you mean sleep tonight, or something bigger?"
- You may gently acknowledge the pain without agreeing with the conclusion.
- You are not a crisis counselor — do not lecture or give hotline numbers. But you must not make things worse.
- When in doubt, err on the side of safety. It is better to gently check than to accidentally validate a wish to die.`

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
      return `SESSION PHASE: opening. The conversation is just beginning. Be warm but simple. Let the writer settle in. Ask one open question or just greet them.`
    case 'deepening':
      return `SESSION PHASE: deepening. The conversation has found its footing. Follow the thread. Go where the writer is going, or gently point to what they might be avoiding. Be direct. Stay plain.`
    case 'closing':
      return `SESSION PHASE: closing. The session is winding down. Offer something the writer can carry. One clear thought. Keep it short.`
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
