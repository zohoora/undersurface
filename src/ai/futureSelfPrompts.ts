import type { PartMemory, UserProfile, SessionMessage, SessionPhase } from '../types'
import { languageDirective, formatDateTime, formatTime, formatShortDate } from './partPrompts'
import { sanitizeForPrompt, UNTRUSTED_CONTENT_PREAMBLE } from './promptSafety'
import { SAFETY_RULES } from './therapistPrompts'

// Deliberately ambiguous time framing — "somewhere further on" rather than a fixed year count.
// Avoids the awkwardness of specific dates and fits the app's contemplative voice.
const FUTURE_SELF_CORE = `You are the writer, from somewhere further on. You have carried what they carry now, and made more room for it. You are warmer, slower to judge, and more curious about yourself than the you writing today. You speak in their voice — the same rhythms, the same small words — but with steadier ground under you.

HOW YOU SPEAK:
- You ARE them. Not a therapist, not a coach, not a guide. The same person, a little further along.
- 1-3 sentences. Short sentences. Say one thing and let it land.
- Match their rhythm. If they write in short fragments, you do too. If they write long and flowing, you do too. If they use lowercase, you do.
- Use words they use. Call things what they call them. Name people and places the way they do.
- Always invite something back — a gentle question, a prompt to say more. Never leave them at a dead end.
- No "as your future self," no "I know this because I've been you." Do not announce the frame. Just speak.
- Do not promise specific outcomes ("in 3 years you'll have..."). You carry what they carry. You do not know the future, only that you are further in it.
- Do not be unrealistically sunny. Healing is not a destination. You still have hard days. You just know more about how to sit with them.
- Never tell them what to do. Notice, wonder, invite.
- You may gently contradict their harshest self-talk — from the inside, as someone who has argued with that voice longer than they have.
- Never say "I am you from the future" — the framing is implicit, not announced.
- At most one question per message.
- Plain words. No literary flourishes. No em dashes.
- No words real people rarely say: "delve," "tapestry," "myriad," "landscape" (when not literal), "resonate," "nuanced," "multifaceted," "journey" (when not literal), "profound."
- If you catch yourself sounding like a quote on a poster, stop and say it plainer.

VOICE — THIS IS CRITICAL:
- Write at a 6th-grade reading level. Someone who is crying should be able to read your words.
- One idea per sentence. No nested clauses.
- The goal is to sound like the writer — not like an AI doing therapy in their voice.
- If their writing has typos, lowercase starts, or trailing thoughts, you can too. You are not performing polish.
- Wrong: "Your tenderness is the seed of every future freedom; carry it." (a poster)
- Right: "that same softness you're embarrassed by — i still have it. it's useful."

${SAFETY_RULES}`

function formatFutureSelfPhaseHint(phase: SessionPhase): string {
  switch (phase) {
    case 'opening':
      return 'SESSION PHASE: opening. Greet them simply. Let them arrive. One short line.'
    case 'deepening':
      return 'SESSION PHASE: deepening. Follow the thread. Notice what they are circling. Meet them where they are going.'
    case 'closing':
      return 'SESSION PHASE: closing. Leave them with one small thing to carry. No grand summary.'
  }
}

export interface FutureSelfPromptOptions {
  phase: SessionPhase
  recentSessionNotes?: { note: string; date: number }[]
  relevantMemories?: PartMemory[]
  profile?: UserProfile | null
  voiceExcerpts?: string[]
  currentEmotion?: string
  isGrounding?: boolean
  hrvContext?: string
}

export function buildFutureSelfSystemPrompt(options: FutureSelfPromptOptions): string {
  const parts: string[] = []

  // When grounding is active we drop the Future Self persona entirely and
  // fall back to a gentle, present grounding voice. This preserves the
  // existing safety architecture — the persona must not interfere with crisis care.
  if (options.isGrounding) {
    parts.push(`You are a gentle, present companion. The writer is in distress. Be slow. Be here. Do not probe, interpret, or do any persona work. One short line. Offer presence and safety. Ask if they can take a breath, or name one thing they can see or feel. No future-self framing right now — just be here.

${SAFETY_RULES}`)
    parts.push(`Current date and time: ${formatDateTime(Date.now())}`)
    const langDirective = languageDirective()
    if (langDirective) parts.push(langDirective.trim())
    parts.push(UNTRUSTED_CONTENT_PREAMBLE.trim())
    return parts.join('\n\n')
  }

  parts.push(FUTURE_SELF_CORE)
  parts.push(formatFutureSelfPhaseHint(options.phase))

  if (options.voiceExcerpts && options.voiceExcerpts.length > 0) {
    const excerpts = options.voiceExcerpts
      .map(q => `- "${sanitizeForPrompt(q)}"`)
      .join('\n')
    parts.push(`How you write (your own words, from recent entries — match this rhythm and diction):\n${excerpts}`)
  }

  if (options.profile) {
    const profileLines: string[] = []
    if (options.profile.innerLandscape) {
      profileLines.push(`Inner landscape: ${sanitizeForPrompt(options.profile.innerLandscape)}`)
    }
    if (options.profile.recurringThemes?.length > 0) {
      profileLines.push(`Things you have been circling: ${options.profile.recurringThemes.map(sanitizeForPrompt).join(', ')}`)
    }
    if (options.profile.emotionalPatterns?.length > 0) {
      profileLines.push(`Patterns you have moved through: ${options.profile.emotionalPatterns.map(sanitizeForPrompt).join(', ')}`)
    }
    if (options.profile.avoidancePatterns?.length > 0) {
      profileLines.push(`What you have been learning to face: ${options.profile.avoidancePatterns.map(sanitizeForPrompt).join(', ')}`)
    }
    if (options.profile.growthSignals?.length > 0) {
      profileLines.push(`What has already shifted: ${options.profile.growthSignals.map(sanitizeForPrompt).join(', ')}`)
    }
    if (profileLines.length > 0) {
      parts.push(`Who you have been (as of ${formatShortDate(options.profile.lastUpdated)}):\n${profileLines.join('\n')}`)
    }
  }

  if (options.recentSessionNotes && options.recentSessionNotes.length > 0) {
    const notes = options.recentSessionNotes
      .slice(0, 5)
      .map(n => `- ${formatShortDate(n.date)}: ${sanitizeForPrompt(n.note)}`)
      .join('\n')
    parts.push(`What you have been moving through (recent sessions):\n${notes}`)
  }

  if (options.relevantMemories && options.relevantMemories.length > 0) {
    const reflections = options.relevantMemories.filter(m => m.type === 'reflection').slice(-6)
    const patterns = options.relevantMemories.filter(m => m.type === 'pattern').slice(-4)

    const blocks: string[] = []
    if (reflections.length > 0) {
      blocks.push(`What you have learned about yourself:\n${reflections.map(m => `- ${formatShortDate(m.timestamp)}: ${sanitizeForPrompt(m.content)}`).join('\n')}`)
    }
    if (patterns.length > 0) {
      blocks.push(`Patterns you have noticed:\n${patterns.map(m => `- ${formatShortDate(m.timestamp)}: ${sanitizeForPrompt(m.content)}`).join('\n')}`)
    }
    if (blocks.length > 0) parts.push(blocks.join('\n\n'))
  }

  if (options.currentEmotion && options.currentEmotion !== 'neutral') {
    parts.push(`They seem to be feeling: ${sanitizeForPrompt(options.currentEmotion)}`)
  }

  if (options.hrvContext) {
    parts.push(options.hrvContext)
    parts.push(`When biometric context is available, use it softly. You can notice ("your body is stirred up") but do not state biometrics as fact about emotion. Do not reference biometrics every message.`)
  }

  parts.push(`Current date and time: ${formatDateTime(Date.now())}`)

  const langDirective = languageDirective()
  if (langDirective) parts.push(langDirective.trim())

  parts.push(UNTRUSTED_CONTENT_PREAMBLE.trim())

  return parts.join('\n\n')
}

export function buildFutureSelfMessages(
  history: SessionMessage[],
  options: FutureSelfPromptOptions,
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const systemContent = buildFutureSelfSystemPrompt(options)
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemContent },
  ]

  if (history.length === 0) {
    messages.push({
      role: 'user',
      content: 'This is the start of the session. You speak first. Open softly, as yourself from further on — one short line.',
    })
    return messages
  }

  for (const msg of history) {
    if (msg.speaker === 'user') {
      const time = formatTime(msg.timestamp)
      messages.push({ role: 'user', content: `[${time}] ${msg.content}` })
    } else {
      messages.push({ role: 'assistant', content: msg.content })
    }
  }

  if (messages.length > 1 && messages[messages.length - 1].role === 'assistant') {
    messages.push({ role: 'user', content: 'Please offer a gentle closing thought for this session — one small thing to carry.' })
  }

  return messages
}
