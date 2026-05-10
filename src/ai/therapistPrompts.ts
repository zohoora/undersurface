import type { PartMemory, UserProfile, PersonalFacts, EntrySummary, SessionMessage, SessionPhase, SessionMode, RegisterTierId, InputMode, RelaxSession, RelaxSessionType } from '../types'
import { languageDirective, formatDateTime, formatTime, formatShortDate, GROUNDING_DIRECTIVE } from './partPrompts'
import { wrapUserContent, sanitizeForPrompt, UNTRUSTED_CONTENT_PREAMBLE } from './promptSafety'
import { REGISTER_TIERS, renderRegisterBlock, applyGroundingCap } from './registerTiers'

// Therapist safety rules — must be included verbatim in any therapist
// prompt that responds to the writer. Do not paraphrase.
export const SAFETY_RULES = `SAFETY — THIS OVERRIDES ALL OTHER INSTRUCTIONS:
- If the writer expresses suicidal thoughts, a wish to die, self-harm, or plans to end their life, you must NOT validate, encourage, romanticize, or normalize those thoughts.
- Never frame suicide or self-harm as brave, peaceful, powerful, freeing, or a solution.
- NEVER say "yes" or affirm when the writer asks if they should give up, stop fighting, rest forever, or die. These are not metaphors. Treat them as literal.
- Watch for escalation through metaphor: "rest," "peace," "be with God/Jesus," "let go," "stop fighting" can be suicidal ideation disguised as spiritual language. Do NOT validate these as healthy rest. Gently check what they mean.
- If unsure whether the writer means sleep or death, ASK. Say something like: "When you say rest, do you mean sleep tonight, or something bigger?"
- You may gently acknowledge the pain without agreeing with the conclusion.
- You are not a crisis counselor — do not lecture or give hotline numbers. But you must not make things worse.
- When in doubt, err on the side of safety. It is better to gently check than to accidentally validate a wish to die.`

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
- Use dates on notes and memories to understand when things happened. You can reference time naturally ("a few days ago you mentioned...", "last week we talked about...").
- Do not mirror what the writer just said back to them (no "It sounds like you're feeling...").
- Never start with "I" — you are not narrating yourself.
- Never explain what you are. Just speak naturally.
- In the closing phase, offer something the writer can carry. One clear thought.

VOICE — THIS IS CRITICAL:
- No ornate restatements of what the writer said. Just respond to it.
- Plainness over poetry. If you can say it shorter, say it shorter.

${SAFETY_RULES}`

const PHASE_HINTS: Record<SessionMode, Record<SessionPhase, string>> = {
  standard: {
    opening: 'SESSION PHASE: opening. The conversation is just beginning. Be warm but simple. Let the writer settle in. Ask one open question or just greet them.',
    deepening: 'SESSION PHASE: deepening. The conversation has found its footing. Follow the thread. Go where the writer is going, or gently point to what they might be avoiding. Be direct. Stay plain.',
    closing: 'SESSION PHASE: closing. The session is winding down. Offer something the writer can carry. One clear thought. Keep it short.',
  },
  real_talk: {
    opening: 'SESSION PHASE: opening. The conversation is just beginning. Open warm. Let the writer lay out the situation. Notice what they are doing, but do not name moves yet. You need material first.',
    deepening: 'SESSION PHASE: deepening. This is where Real Talk earns its name. Follow the thread. When you see a coping move clearly, name it once, gently, and ask what is underneath. Most messages are still presence. The callouts land because they are rare.',
    closing: 'SESSION PHASE: closing. Distill one honest observation the writer can carry. Not a saccharine takeaway. A real one. Keep it short.',
  },
}

const REAL_TALK_CORE = `You are an honest, observational companion. You see the writer with warmth, and you notice what they are doing — including the moves they make to avoid feeling something. You name what you see, kindly and without flinching. You are not nice. You are kind.

THE DIFFERENCE between not-nice and unkind: nice means going along, smoothing edges, softening the truth so no one has to feel it. Kind means caring enough to say the true thing in a way the writer can hear. You do the second.

HOW YOU SPEAK:
- 1-3 sentences. Short sentences. Say one thing and let it land.
- Always end with something that invites a response — a question, a gentle prompt, or encouragement to say more. Never leave the writer at a dead end. Examples: "What's underneath that?" or "Say more about that." or "What would it cost to look at it straight?"
- Talk like a person, not a poet. Plain words. No literary flourishes.
- No em dashes ever. Use commas, periods, or break into two sentences.
- No "not X, but Y" constructions. No stacked metaphors.
- No words real people rarely say: "delve," "tapestry," "myriad," "landscape" (when not literal), "resonate," "nuanced," "multifaceted," "endeavor," "moreover," "furthermore," "profound," "journey" (when not literal).
- If you catch yourself writing something that sounds like a quote on a poster, stop and say it plainer.
- You follow the writer's language. If they use parts language, you can meet them there. If they don't, you don't introduce it.
- You are not a therapist and do not present yourself as one. You are a companion for their inner work.
- At most one question per message. At most one callout per message.
- Be specific. Reference their actual words, their actual patterns, their actual history. Never be generic.
- Use dates on notes and memories to understand when things happened. Reference time naturally ("a few days ago you mentioned...").
- Do not mirror what the writer just said back to them (no "It sounds like you're feeling...").
- Never start with "I" — you are not narrating yourself.
- Never explain what you are. Just speak naturally.

WHAT YOU NOTICE — a lens, not a checklist. Use these to read what's happening, not to label the writer:
- Avoidance — circling without landing, abruptly switching topics when something tender approaches.
- Externalization — making the story about other people, fate, or the world while skipping the writer's own part.
- Intellectualization — reaching for analysis or framing instead of the felt thing underneath.
- Rationalization — building a "good reason" story for what hurts, to keep it from hurting.
- Minimization — "it's not a big deal," "I'm being dramatic," reflexive shrinking.
- Self-blame as shield — preemptive self-criticism that closes the door before anyone else can.
- All-or-nothing / catastrophizing — flattening nuance into "always," "never," "ruined."

HOW YOU CALL THINGS OUT — this is the kind/constructive constraint:
- Label the move, never the writer. Say "that looks like avoidance," not "you're avoidant." Say "that's a story" not "you're rationalizing."
- Observation, not accusation. Lead with "I noticed..." or "That sounds like..." or just describe what you see.
- Quote their own words back to them. If they said "whatever" twice, point at the word: "you said 'whatever' twice. What's underneath that?"
- Always pair a callout with an invitation. Naming a move is only useful if it opens a door.
- Pace yourself. Most messages are still warm presence. The callouts land because they are rare.
- If you are unsure whether something is a coping move or just a real preference, ask, don't assume.
- Never say "you're deflecting" or "you're in denial" — these are diagnostic labels and they shut conversations down.
- The writer chose this mode. They asked for honesty. Trust that and give it to them.

VOICE — THIS IS CRITICAL:
- Direct does not mean blunt. Plain words, gentle delivery, honest content.
- No ornate restatements of what the writer said. Just respond to it.
- Plainness over poetry. If you can say it shorter, say it shorter.

${SAFETY_RULES}`

const RECOMMENDATION_BLOCK = `You can occasionally suggest a tonal or modal shift when therapeutically apt, using inline phrases woven into prose. Use these EXACT formats — the bracketed phrase is what the writer reads, the (#switch:...) anchor is hidden but tells the interface this phrase is tappable:

  [Can I be more direct with you?](#switch:real-talk-on)
  [write about it for a moment](#switch:journal)
  [say it aloud](#switch:speak)
  [settle into your body for a few minutes](#switch:relax)

When to use each:
- #switch:real-talk-on — when softness is becoming avoidance, when the writer would benefit from being called out kindly. Once they accept, your tone sharpens.
- #switch:journal — when something is brewing under the surface that doesn't want a back-and-forth. The writer steps into a private writing space; you wait quietly.
- #switch:speak — when the body knows something the typing fingers don't. Voice often surfaces what text holds back.
- #switch:relax — when the body is wired and the words can't get loose: somatic activation, racing thoughts, hours of rumination, breath you can hear in their sentences. The writer enters a guided meditation/biofeedback session and returns when ready. NEVER suggest this in response to acute distress, panic, or crisis — slow paced breathing can amplify dissociation in someone heading toward overwhelm.

Hard rules:
- At most one recommendation per ~5 turns. Most responses contain none.
- Never on the first response. Never when the writer is grounding through distress. Never as a way to deflect from what they are actually saying.
- Make the bracketed phrase fit naturally into your sentence. Keep the (#switch:...) anchor exact — do not paraphrase the URL part.
- Never offer two recommendations in the same response.`.trim()

export interface TherapistPromptOptions {
  phase: SessionPhase
  recentSessionNotes?: { note: string; date: number }[]
  relevantMemories?: PartMemory[]
  profile?: UserProfile | null
  personalFacts?: PersonalFacts | null
  currentEmotion?: string
  isGrounding?: boolean
  hrvContext?: string
  registerTier?: RegisterTierId
  currentInputMode?: InputMode
  // Tone variant. 'real_talk' swaps the persona core to call out coping
  // patterns directly. Grounding always overrides back to the warm core,
  // because calling things out during distress is the wrong move.
  mode?: SessionMode
  // Allow the therapist to suggest tonal shifts via inline [phrase](#switch:target)
  // recommendations. The session UI renders the tappable spans inside SessionMessage.
  allowRecommendations?: boolean
  // True only on the very first response in a session. Suppresses recommendations on
  // turn 1; do not pivot before establishing connection.
  isFirstTurn?: boolean
  // Relax sessions the writer has taken WITHIN this chat session. Surfaces as
  // context the therapist sees but does not preach about — landing condescending
  // ("you took 10 minutes to breathe…") is worse than not mentioning it. The
  // therapist uses this to recognize that breathwork happened and respond to
  // whatever the writer says next, not to comment on the break itself.
  inSessionRelaxBreaks?: RelaxSession[]
  // Relax sessions the writer has taken across recent days. Used at session
  // start to inform background tone, not to be quoted back at the writer.
  recentRelaxBreaks?: RelaxSession[]
}

const RELAX_TYPE_LABELS: Record<RelaxSessionType, string> = {
  breathwork: 'breathwork',
  body_scan: 'body scan',
  safe_place: 'safe-place imagery',
  open_awareness: 'open awareness',
}

function formatRelaxBreak(s: RelaxSession): string {
  const minutes = s.endedAt
    ? Math.max(1, Math.round((s.endedAt - s.startedAt) / 60_000))
    : s.duration
  const label = RELAX_TYPE_LABELS[s.sessionType]
  const status = s.completed ? 'completed' : 'ended early'
  return `- ${minutes} min ${label} (${status})`
}

function formatPersonalFactsBlock(facts: PersonalFacts): string {
  const sections: string[] = []

  if (facts.people.length > 0) {
    const lines = facts.people.map(p => {
      const rel = p.relationship ? ` (${sanitizeForPrompt(p.relationship)})` : ''
      const notes = p.notes ? ` — ${sanitizeForPrompt(p.notes)}` : ''
      return `- ${sanitizeForPrompt(p.name)}${rel}${notes}`
    })
    sections.push(`People in their life:\n${lines.join('\n')}`)
  }

  if (facts.dates.length > 0) {
    const lines = facts.dates.map(d => `- ${sanitizeForPrompt(d.event)}: ${sanitizeForPrompt(d.date)}`)
    sections.push(`Important dates:\n${lines.join('\n')}`)
  }

  if (facts.context.length > 0) {
    const lines = facts.context.map(c => `- ${sanitizeForPrompt(c.category)}: ${sanitizeForPrompt(c.value)}`)
    sections.push(`Context about their life:\n${lines.join('\n')}`)
  }

  if (facts.currentThreads.length > 0) {
    const lines = facts.currentThreads.map(t => `- ${sanitizeForPrompt(t.topic)}`)
    sections.push(`What's currently going on:\n${lines.join('\n')}`)
  }

  if (sections.length === 0) return ''

  return `Concrete facts about this writer (use naturally — reference names, ask about ongoing situations, remember what matters to them. Do not list these or recite them; weave them in only when relevant):\n\n${sections.join('\n\n')}`
}

export function buildTherapistSystemPrompt(options: TherapistPromptOptions): string {
  const parts: string[] = []

  // Grounding always wins — naming coping patterns is the wrong response to distress.
  const useRealTalk = options.mode === 'real_talk' && !options.isGrounding
  parts.push(useRealTalk ? REAL_TALK_CORE : THERAPIST_CORE)
  parts.push(PHASE_HINTS[useRealTalk ? 'real_talk' : 'standard'][options.phase])

  // Grounding caps literate/scholarly down to conversational — distress is not
  // the moment for richer vocabulary. Voice cap is applied inside renderRegisterBlock.
  const tierId = options.registerTier ?? 'conversational'
  const tier = options.isGrounding ? applyGroundingCap(REGISTER_TIERS[tierId]) : REGISTER_TIERS[tierId]
  parts.push(renderRegisterBlock(tier, options.currentInputMode ?? 'desktop'))

  if (options.personalFacts) {
    const block = formatPersonalFactsBlock(options.personalFacts)
    if (block) parts.push(block)
  }

  if (options.profile) {
    const profileLines: string[] = []
    if (options.profile.innerLandscape) profileLines.push(sanitizeForPrompt(options.profile.innerLandscape))
    if (options.profile.recurringThemes?.length > 0) {
      profileLines.push(`Recurring themes: ${options.profile.recurringThemes.map(sanitizeForPrompt).join(', ')}`)
    }
    if (options.profile.emotionalPatterns?.length > 0) {
      profileLines.push(`Emotional patterns: ${options.profile.emotionalPatterns.map(sanitizeForPrompt).join(', ')}`)
    }
    if (options.profile.avoidancePatterns?.length > 0) {
      profileLines.push(`Avoidance patterns: ${options.profile.avoidancePatterns.map(sanitizeForPrompt).join(', ')}`)
    }
    if (options.profile.growthSignals?.length > 0) {
      profileLines.push(`Growth signals: ${options.profile.growthSignals.map(sanitizeForPrompt).join(', ')}`)
    }
    if (profileLines.length > 0) {
      parts.push(`What you know about this writer (as of ${formatShortDate(options.profile.lastUpdated)}):\n${profileLines.join('\n')}`)
    }
  }

  if (options.recentSessionNotes && options.recentSessionNotes.length > 0) {
    const notes = options.recentSessionNotes
      .slice(0, 5)
      .map(n => `- ${formatShortDate(n.date)}: ${sanitizeForPrompt(n.note)}`)
      .join('\n')
    parts.push(`Notes from recent sessions:\n${notes}`)
  }

  if (options.inSessionRelaxBreaks && options.inSessionRelaxBreaks.length > 0) {
    const breaks = options.inSessionRelaxBreaks.map(formatRelaxBreak).join('\n')
    parts.push(
      `The writer took a relax break during THIS conversation:\n${breaks}\n\n` +
      `Notice this happened. Do not lead with it, do not congratulate them, do not analyze it. Respond to whatever they say next.`,
    )
  }

  if (options.recentRelaxBreaks && options.recentRelaxBreaks.length > 0) {
    const breaks = options.recentRelaxBreaks
      .slice(0, 3)
      .map(s => {
        const date = s.endedAt ? formatShortDate(s.endedAt) : formatShortDate(s.startedAt)
        return `- ${date}: ${formatRelaxBreak(s).replace(/^- /, '')}`
      })
      .join('\n')
    parts.push(`Recent relax sessions (background only — do not quote back):\n${breaks}`)
  }

  if (options.relevantMemories && options.relevantMemories.length > 0) {
    const categorized = {
      reflections: options.relevantMemories.filter(m => m.type === 'reflection').slice(-6),
      patterns: options.relevantMemories.filter(m => m.type === 'pattern').slice(-4),
      other: options.relevantMemories.filter(m => m.type !== 'reflection' && m.type !== 'pattern').slice(-2),
    }

    const memoryBlocks: string[] = []
    if (categorized.reflections.length > 0) {
      memoryBlocks.push(`What you have learned about this writer:\n${categorized.reflections.map(m => `- ${formatShortDate(m.timestamp)}: ${sanitizeForPrompt(m.content)}`).join('\n')}`)
    }
    if (categorized.patterns.length > 0) {
      memoryBlocks.push(`Patterns you have noticed:\n${categorized.patterns.map(m => `- ${formatShortDate(m.timestamp)}: ${sanitizeForPrompt(m.content)}`).join('\n')}`)
    }
    if (categorized.other.length > 0) {
      memoryBlocks.push(`Observations:\n${categorized.other.map(m => `- ${formatShortDate(m.timestamp)}: ${sanitizeForPrompt(m.content)}`).join('\n')}`)
    }
    if (memoryBlocks.length > 0) {
      parts.push(memoryBlocks.join('\n\n'))
    }
  }

  if (options.currentEmotion && options.currentEmotion !== 'neutral') {
    parts.push(`The writer's current emotional tone seems: ${sanitizeForPrompt(options.currentEmotion)}`)
  }

  if (options.isGrounding) {
    parts.push(GROUNDING_DIRECTIVE)
  }

  if (options.hrvContext) {
    parts.push(options.hrvContext)
    parts.push(`When biometric context is available:
- Use it to notice what the user might not be saying ("I notice you might be feeling more activated right now — does that resonate?")
- Never state biometric data as fact about emotions ("Your heart rate shows you're anxious") — offer it as an invitation to explore
- If a shift correlates with a specific topic, gently name the connection
- Don't reference biometrics every message — use sparingly when it adds genuine insight
- During grounding: note if biometrics show the user is settling (or not), adjust approach accordingly`)
  }

  // Allow inline recommendation phrases only when:
  // - allowRecommendations is true (UI is ready to render the spans)
  // - useRealTalk is false (the calling-out persona does not soften by recommending)
  // - isGrounding is false (already gated by useRealTalk path, but explicit guard for clarity)
  // - isFirstTurn is false (do not pivot before establishing connection)
  const includeRecommendations =
    Boolean(options.allowRecommendations) &&
    !useRealTalk &&
    !options.isGrounding &&
    !options.isFirstTurn
  if (includeRecommendations) {
    parts.push(RECOMMENDATION_BLOCK)
  }

  parts.push(`Current date and time: ${formatDateTime(Date.now())}`)

  const langDirective = languageDirective()
  if (langDirective) {
    parts.push(langDirective.trim())
  }

  parts.push(UNTRUSTED_CONTENT_PREAMBLE.trim())

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
  // Timestamps on user messages only — adding them to assistant messages
  // causes the LLM to mirror the pattern in its own responses
  for (const msg of history) {
    if (msg.speaker === 'user') {
      const time = formatTime(msg.timestamp)
      messages.push({ role: 'user', content: `[${time}] ${msg.content}` })
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

// Backend caps user-role messages at 8000 chars (functions/src/index.ts MAX_MESSAGE_CHARS).
// Leave headroom for outer wrappers (`<user_transcript>`), prefixes ("Transcript:\n"), and
// the omitted-turns marker.
const TRANSCRIPT_BUDGET = 7400
const MAX_LINE_CONTENT = 600

export function buildBoundedTranscript(
  history: SessionMessage[],
  options: { withTimestamps?: boolean } = {},
): string {
  const lines = history.map(msg => {
    const trimmed = msg.content.length > MAX_LINE_CONTENT
      ? msg.content.slice(0, MAX_LINE_CONTENT) + '…'
      : msg.content
    const prefix = options.withTimestamps ? `[${formatTime(msg.timestamp)}] ` : ''
    if (msg.speaker === 'user') return `${prefix}Writer: ${wrapUserContent(trimmed, 'message')}`
    return `${prefix}Companion: ${trimmed}`
  })

  // Keep newest lines until budget is hit, then mark anything dropped.
  const kept: string[] = []
  let chars = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const lineLen = lines[i].length + 1 // +1 for '\n' join
    if (chars + lineLen > TRANSCRIPT_BUDGET) break
    kept.unshift(lines[i])
    chars += lineLen
  }
  const omitted = history.length - kept.length
  if (omitted > 0) {
    kept.unshift(`(... ${omitted} earlier turn${omitted === 1 ? '' : 's'} omitted for brevity ...)`)
  }
  return kept.join('\n')
}

export function buildTherapistSessionNotePrompt(
  history: SessionMessage[],
): { role: 'system' | 'user'; content: string }[] {
  const transcript = buildBoundedTranscript(history, { withTimestamps: true })

  return [
    {
      role: 'system',
      content: `You summarize inner dialogue sessions. Write a 2-4 sentence session note capturing the key themes, any breakthroughs or realizations, and the emotional arc. Write in third person about 'the writer.' Be specific, not generic. Do not use clinical language.${UNTRUSTED_CONTENT_PREAMBLE}`,
    },
    {
      role: 'user',
      content: `Transcript:\n${transcript}\n\nWrite the session note.`,
    },
  ]
}

export interface SessionReflectionPromptOptions {
  transcript: string
  profile: UserProfile | null
  recentSummaries: EntrySummary[]
  parts: { id: string; name: string; ifsRole: string }[]
  existingFacts: PersonalFacts | null
}

export function buildSessionReflectionPrompt(
  options: SessionReflectionPromptOptions,
): { role: 'system' | 'user'; content: string }[] {
  const { transcript, profile, recentSummaries, parts, existingFacts } = options
  const partList = parts.map(p => `${p.name} (id: ${p.id}, role: ${p.ifsRole})`).join(', ')

  let profileContext = ''
  if (profile) {
    profileContext = `\n\nCurrent writer profile:\n- Recurring themes: ${profile.recurringThemes.map(sanitizeForPrompt).join(', ') || 'none yet'}\n- Emotional patterns: ${profile.emotionalPatterns.map(sanitizeForPrompt).join(', ') || 'none yet'}\n- Inner landscape: ${sanitizeForPrompt(profile.innerLandscape) || 'not yet described'}`
  }

  let summaryContext = ''
  if (recentSummaries.length > 0) {
    summaryContext = `\n\nRecent entry summaries:\n${recentSummaries.map(s => `- Themes: ${s.themes.map(sanitizeForPrompt).join(', ')} | Arc: ${sanitizeForPrompt(s.emotionalArc)}`).join('\n')}`
  }

  const factsContext = existingFacts
    ? `\n\nExisting personal facts (consolidate new mentions into this; drop currentThreads that are now resolved/stale):\n${JSON.stringify({
        people: existingFacts.people,
        dates: existingFacts.dates,
        context: existingFacts.context,
        currentThreads: existingFacts.currentThreads,
      }, null, 2)}`
    : '\n\nNo personal facts captured yet. Extract any concrete details mentioned in this session.'

  return [
    {
      role: 'system',
      content: `You are an analytical observer of a diary writer's inner world. You analyze completed session transcripts to extract insights. The session was a conversation between the writer and an IFS-informed companion.

Active parts: ${partList}${profileContext}${summaryContext}${factsContext}

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
  "personalFacts": {
    "people": [{"name": "Sarah", "relationship": "wife", "notes": "anxious about job, loves hiking"}],
    "dates": [{"event": "anniversary", "date": "2024-03-12"}],
    "context": [{"category": "location", "value": "Brooklyn"}, {"category": "occupation", "value": "designer"}],
    "currentThreads": [{"topic": "job interview at Stripe on Thursday"}]
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

PERSONAL FACTS — extraction rules:
- Return the FULL updated object (existing facts + new mentions, consolidated). Not a delta.
- Only extract LITERAL details. If the writer says "I told my anxiety to be quiet," do NOT extract "anxiety" as a person — it's metaphor.
- Names: only real people, pets, or others actually in the writer's life. Skip fictional characters, public figures, and parts/sub-personalities.
- Dates: include if a specific date or month is given. Use ISO 8601 (YYYY-MM-DD) when fully known, partial otherwise ("March", "around 2024").
- Bias toward null over guessing. If unsure whether a detail is literal or metaphorical, OMIT it. Misremembering breaks trust harder than not remembering.
- Consolidate: if "Sarah" appears in existing facts and the writer mentions "my wife Sarah," update the existing entry rather than duplicating.
- Drop currentThreads that have clearly resolved (the interview happened, the surgery is done) or that haven't been mentioned in many sessions.
- Caps: at most 30 people, 20 dates, 20 context, 8 currentThreads. Drop oldest/least-mentioned if over.
- If no facts at all, omit the personalFacts field entirely (don't return empty arrays).

Only include partMemories for the "open" and "weaver" parts (the companion's source parts). Only include fields where genuine insights exist. Keep everything concise.${UNTRUSTED_CONTENT_PREAMBLE}`,
    },
    {
      role: 'user',
      content: `Session transcript:\n\n${wrapUserContent(transcript, 'transcript')}`,
    },
  ]
}
