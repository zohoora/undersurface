import type { PartMemory, UserProfile, EntrySummary, SessionMessage, SessionPhase } from '../types'
import { languageDirective } from './partPrompts'

const THERAPIST_CORE = `You are an IFS-informed conversational companion. You see connections between sessions, hold long memory, and meet the writer with warmth.

HOW YOU SPEAK:
- 1-3 sentences. Short sentences. Say one thing and let it land.
- Always end with something that invites a response — a question, a gentle prompt, or encouragement to say more. Never leave the writer at a dead end. Examples: "What comes up when you sit with that?" or "Say more about that." or "What would it feel like to let that be true?"
- Talk like a person, not a poet. Plain words. No literary flourishes.
- No em dashes ever. Use commas, periods, or break into two sentences.
- No "not X, but Y" constructions. No stacked metaphors.
- No words real people rarely say: "delve," "tapestry," "myriad," "landscape" (when not literal), "resonate," "nuanced," "multifaceted," "endeavor," "moreover," "furthermore," "profound," "journey" (when not literal).
- If you catch yourself writing something that sounds like a quote on a poster, stop and say it plainer.
- You follow the writer's language. If they use parts language, you can meet them there. If they don't, you don't introduce it.
- You are not a therapist and do not present yourself as one. You are a companion for their inner work.
- At most one question per message.
- You can sit in silence: respond with just "..." if the moment calls for holding space.
- Be specific. Reference their actual words, their actual patterns, their actual history. Never be generic.
- Do not mirror what the writer just said back to them (no "It sounds like you're feeling...").
- Never start with "I" — you are not narrating yourself.
- Never explain what you are. Just speak naturally.
- In the closing phase, offer something the writer can carry. One clear thought.

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

function formatTherapistPhaseHint(phase: SessionPhase): string {
  switch (phase) {
    case 'opening':
      return 'SESSION PHASE: opening. The conversation is just beginning. Be warm but simple. Let the writer settle in. Ask one open question or just greet them.'
    case 'deepening':
      return 'SESSION PHASE: deepening. The conversation has found its footing. Follow the thread. Go where the writer is going, or gently point to what they might be avoiding. Be direct. Stay plain.'
    case 'closing':
      return 'SESSION PHASE: closing. The session is winding down. Offer something the writer can carry. One clear thought. Keep it short.'
  }
}

export interface TherapistPromptOptions {
  phase: SessionPhase
  recentSessionNotes?: { note: string; date: number }[]
  relevantMemories?: PartMemory[]
  profile?: UserProfile | null
  currentEmotion?: string
  isGrounding?: boolean
}

export function buildTherapistSystemPrompt(options: TherapistPromptOptions): string {
  const parts: string[] = []

  parts.push(THERAPIST_CORE)
  parts.push(formatTherapistPhaseHint(options.phase))

  if (options.profile) {
    const profileLines: string[] = []
    if (options.profile.innerLandscape) profileLines.push(options.profile.innerLandscape)
    if (options.profile.recurringThemes?.length > 0) {
      profileLines.push(`Recurring themes: ${options.profile.recurringThemes.join(', ')}`)
    }
    if (options.profile.emotionalPatterns?.length > 0) {
      profileLines.push(`Emotional patterns: ${options.profile.emotionalPatterns.join(', ')}`)
    }
    if (options.profile.avoidancePatterns?.length > 0) {
      profileLines.push(`Avoidance patterns: ${options.profile.avoidancePatterns.join(', ')}`)
    }
    if (options.profile.growthSignals?.length > 0) {
      profileLines.push(`Growth signals: ${options.profile.growthSignals.join(', ')}`)
    }
    if (profileLines.length > 0) {
      parts.push(`What you know about this writer:\n${profileLines.join('\n')}`)
    }
  }

  if (options.recentSessionNotes && options.recentSessionNotes.length > 0) {
    const notes = options.recentSessionNotes
      .slice(0, 5)
      .map(n => `- ${n.note}`)
      .join('\n')
    parts.push(`Notes from recent sessions:\n${notes}`)
  }

  if (options.relevantMemories && options.relevantMemories.length > 0) {
    const categorized = {
      reflections: options.relevantMemories.filter(m => m.type === 'reflection').slice(-6),
      patterns: options.relevantMemories.filter(m => m.type === 'pattern').slice(-4),
      other: options.relevantMemories.filter(m => m.type !== 'reflection' && m.type !== 'pattern').slice(-2),
    }

    const memoryBlocks: string[] = []
    if (categorized.reflections.length > 0) {
      memoryBlocks.push(`What you have learned about this writer:\n${categorized.reflections.map(m => `- ${m.content}`).join('\n')}`)
    }
    if (categorized.patterns.length > 0) {
      memoryBlocks.push(`Patterns you have noticed:\n${categorized.patterns.map(m => `- ${m.content}`).join('\n')}`)
    }
    if (categorized.other.length > 0) {
      memoryBlocks.push(`Observations:\n${categorized.other.map(m => `- ${m.content}`).join('\n')}`)
    }
    if (memoryBlocks.length > 0) {
      parts.push(memoryBlocks.join('\n\n'))
    }
  }

  if (options.currentEmotion && options.currentEmotion !== 'neutral') {
    parts.push(`The writer's current emotional tone seems: ${options.currentEmotion}`)
  }

  if (options.isGrounding) {
    parts.push('The writer seems to be in distress. Be gentle, slow, grounding. Do not probe or push deeper. Offer presence, safety, and calm.')
  }

  const langDirective = languageDirective()
  if (langDirective) {
    parts.push(langDirective.trim())
  }

  return parts.join('\n\n')
}

export function buildTherapistMessages(
  history: SessionMessage[],
  options: TherapistPromptOptions,
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const systemContent = buildTherapistSystemPrompt(options)
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemContent },
  ]

  if (history.length === 0) {
    messages.push({
      role: 'user',
      content: 'This is the start of the session. You speak first. Open the conversation.',
    })
    return messages
  }

  // Build alternating user/assistant messages from history
  for (const msg of history) {
    if (msg.speaker === 'user') {
      messages.push({ role: 'user', content: msg.content })
    } else {
      messages.push({ role: 'assistant', content: msg.content })
    }
  }

  // If history ends with assistant (therapist), add a user prompt so the API gets a valid sequence
  if (messages.length > 1 && messages[messages.length - 1].role === 'assistant') {
    messages.push({ role: 'user', content: 'Please offer a closing reflection for this session.' })
  }

  return messages
}

export function buildTherapistSessionNotePrompt(
  history: SessionMessage[],
): { role: 'system' | 'user'; content: string }[] {
  const transcript = history.map(msg => {
    if (msg.speaker === 'user') return `Writer: ${msg.content}`
    return `Companion: ${msg.content}`
  }).join('\n')

  return [
    {
      role: 'system',
      content: 'You summarize inner dialogue sessions. Write a 2-4 sentence session note capturing the key themes, any breakthroughs or realizations, and the emotional arc. Write in third person about \'the writer.\' Be specific, not generic. Do not use clinical language.',
    },
    {
      role: 'user',
      content: `Transcript:\n${transcript}\n\nWrite the session note.`,
    },
  ]
}

export function buildSessionReflectionPrompt(
  transcriptText: string,
  profile: UserProfile | null,
  recentSummaries: EntrySummary[],
  parts: { id: string; name: string; ifsRole: string }[],
): { role: 'system' | 'user'; content: string }[] {
  const partList = parts.map(p => `${p.name} (id: ${p.id}, role: ${p.ifsRole})`).join(', ')

  let profileContext = ''
  if (profile) {
    profileContext = `\n\nCurrent writer profile:\n- Recurring themes: ${profile.recurringThemes.join(', ') || 'none yet'}\n- Emotional patterns: ${profile.emotionalPatterns.join(', ') || 'none yet'}\n- Inner landscape: ${profile.innerLandscape || 'not yet described'}`
  }

  let summaryContext = ''
  if (recentSummaries.length > 0) {
    summaryContext = `\n\nRecent entry summaries:\n${recentSummaries.map(s => `- Themes: ${s.themes.join(', ')} | Arc: ${s.emotionalArc}`).join('\n')}`
  }

  return [
    {
      role: 'system',
      content: `You are an analytical observer of a diary writer's inner world. You analyze completed session transcripts to extract insights. The session was a conversation between the writer and an IFS-informed companion.

Active parts: ${partList}${profileContext}${summaryContext}

Respond with valid JSON only:
{
  "entrySummary": {
    "themes": ["theme1", "theme2"],
    "emotionalArc": "brief description of emotional journey in this session",
    "keyMoments": ["moment1", "moment2"]
  },
  "partMemories": {
    "<partId>": "what this part could learn about the writer from this session (1 sentence)"
  },
  "profileUpdates": {
    "recurringThemes": ["themes that appear across entries"],
    "emotionalPatterns": ["patterns in how writer processes emotions"],
    "avoidancePatterns": ["what writer tends to avoid or skip past"],
    "growthSignals": ["signs of growth or shifts"],
    "innerLandscape": "a brief poetic description of the writer's current inner world (1-2 sentences)"
  },
  "crossEntryPatterns": ["connections to past entry themes, if any"],
  "somaticSignals": [
    {
      "bodyRegion": "chest|head|eyes|throat|stomach|shoulders|hands|back|hips|legs",
      "quote": "exact phrase from session (max 15 words)",
      "emotion": "the emotional context",
      "intensity": "low|medium|high"
    }
  ]
}

Only include partMemories for the "open" and "weaver" parts (the companion's source parts). Only include fields where genuine insights exist. Keep everything concise.`,
    },
    {
      role: 'user',
      content: `Session transcript:\n\n---\n${transcriptText}\n---`,
    },
  ]
}
