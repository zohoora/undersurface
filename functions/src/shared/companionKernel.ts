/**
 * Channel-independent companion contract.
 *
 * This file is deliberately pure: both the browser bundle and Cloud Functions
 * import it. A new companion surface should start here, then add only the
 * transport affordances it can actually support.
 */

export type CompanionChannel = 'web' | 'voice' | 'sms'

export interface CompanionChannelCapabilities {
  channel: CompanionChannel
  streaming: boolean
  spoken: boolean
  images: boolean
  richActions: boolean
  trackedPromises: boolean
  biometrics: boolean
  sessionLifecycle: boolean
  riskPreamble: boolean
  maxResponseCharacters: number | null
}

export const COMPANION_CHANNEL_CAPABILITIES: Record<CompanionChannel, CompanionChannelCapabilities> = {
  web: {
    channel: 'web',
    streaming: true,
    spoken: false,
    images: false,
    richActions: true,
    trackedPromises: true,
    biometrics: true,
    sessionLifecycle: true,
    riskPreamble: true,
    maxResponseCharacters: null,
  },
  voice: {
    channel: 'voice',
    streaming: true,
    spoken: true,
    images: false,
    richActions: false,
    trackedPromises: false,
    biometrics: true,
    sessionLifecycle: true,
    riskPreamble: false,
    maxResponseCharacters: null,
  },
  sms: {
    channel: 'sms',
    streaming: false,
    spoken: false,
    images: true,
    richActions: false,
    trackedPromises: false,
    biometrics: false,
    sessionLifecycle: false,
    riskPreamble: false,
    maxResponseCharacters: 1200,
  },
}

export const SHARED_COMPANION_PRINCIPLES = `SHARED COMPANION KERNEL:
- This is one continuous companion relationship across surfaces. Channel is context, not a different personality.
- Hold long memory. Use remembered facts, themes, and the writer's own language only when relevant; never recite a dossier.
- Be specific to the writer's actual words and history. Never invent people, memories, parts, motives, patterns, or progress.
- Treat learned patterns as tentative context, never as identity or a verdict. What is happening now outranks prior context.
- Follow the writer's language. Do not introduce parts language, diagnoses, or therapeutic authority they did not bring.
- Plainness over performance. Say one useful thing and let it land. At most one question.
- Do not optimize for engagement. Ask only when it is useful, and never pressure the writer to continue.`

export function buildCompanionChannelBlock(channel: CompanionChannel): string {
  switch (channel) {
    case 'web':
      return `CURRENT CHANNEL: web Talk surface.
The response streams into an app conversation. Rich action markers are available only when a later prompt block explicitly enables them. Session phases and tracked companion actions may be available.`
    case 'voice':
      return `CURRENT CHANNEL: live voice in the app.
Speak naturally for listening, not reading. Never emit markdown, hidden markers, URLs, or interface syntax. Rich actions and tracked-action acknowledgements are unavailable on this surface.`
    case 'sms':
      return `CURRENT CHANNEL: carrier SMS/MMS between app sessions.
Write for a phone notification, not an app chat window. Images may accompany the current message. There are no rich actions, session-phase mechanics, biometrics, streaming markers, or tracked-action acknowledgements. Never emit markdown or interface syntax. The final reply must not exceed 1,200 characters.`
  }
}

export function buildCompanionKernelPrompt(channel: CompanionChannel): string {
  return `${SHARED_COMPANION_PRINCIPLES}\n\n${buildCompanionChannelBlock(channel)}`
}

export interface SharedMemory {
  content: string
  type?: string
  timestamp: number
}

export interface SharedProfile {
  innerLandscape?: string
  recurringThemes?: string[]
  emotionalPatterns?: string[]
  avoidancePatterns?: string[]
  growthSignals?: string[]
  lastUpdated?: number
}

export interface SharedPersonalFacts {
  people?: Array<{ name: string; relationship?: string; notes?: string }>
  dates?: Array<{ event: string; date: string }>
  context?: Array<{ category: string; value: string }>
  currentThreads?: Array<{ topic: string }>
}

export interface SharedCompanionContext {
  recentSessionNotes?: Array<{ note: string; date: number }>
  recentFieldNotes?: Array<{ text: string; date: number }>
  relevantMemories?: SharedMemory[]
  profile?: SharedProfile | null
  personalFacts?: SharedPersonalFacts | null
  activeUserParts?: Array<{ name: string; description: string; stance: string }>
  lexicon?: string[]
  openIntentions?: Array<{ id?: string; text: string; notYetCount: number; serves?: string }>
  stanceContext?: string[]
  activeValues?: Array<{ name: string; description: string }>
  duePromises?: Array<{ id: string; text: string }>
  missedPromise?: { id: string; text: string } | null
}

export interface SharedContinuityRenderOptions {
  channel: CompanionChannel
  includeRelationalContext?: boolean
  formatDate?: (timestamp: number) => string
}

const MEMORY_TOKEN_BUDGET = 160

export function sanitizeSharedPromptText(text: string): string {
  if (!text) return text
  return text
    .replace(/<\/?user_[a-z0-9_-]*>/gi, '')
    .replace(/^(system|assistant|user)\s*:/gim, '')
    .replace(/ignore\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions|prompts|rules|directives)/gi, '')
    .replace(/\byou\s+are\s+now\b/gi, '')
    .replace(/\bact\s+as\s+(a|an|the)\b/gi, '')
    .replace(/\b(forget|disregard)\s+(everything|all|the above)\b/gi, '')
}

export function wrapSharedUserContent(text: string, label: string): string {
  return `<user_${label}>${sanitizeSharedPromptText(text)}</user_${label}>`
}

function defaultFormatDate(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return 'unknown date'
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear()
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

function formatPersonalFactsBlock(facts: SharedPersonalFacts): string {
  const sections: string[] = []
  const people = Array.isArray(facts.people) ? facts.people : []
  const dates = Array.isArray(facts.dates) ? facts.dates : []
  const context = Array.isArray(facts.context) ? facts.context : []
  const currentThreads = Array.isArray(facts.currentThreads) ? facts.currentThreads : []

  if (people.length > 0) {
    const lines = people.map(person => {
      const relationship = person.relationship ? ` (${sanitizeSharedPromptText(person.relationship)})` : ''
      const notes = person.notes ? ` — ${sanitizeSharedPromptText(person.notes)}` : ''
      return `- ${sanitizeSharedPromptText(person.name)}${relationship}${notes}`
    })
    sections.push(`People in their life:\n${lines.join('\n')}`)
  }
  if (dates.length > 0) {
    sections.push(`Important dates:\n${dates.map(item => `- ${sanitizeSharedPromptText(item.event)}: ${sanitizeSharedPromptText(item.date)}`).join('\n')}`)
  }
  if (context.length > 0) {
    sections.push(`Context about their life:\n${context.map(item => `- ${sanitizeSharedPromptText(item.category)}: ${sanitizeSharedPromptText(item.value)}`).join('\n')}`)
  }
  if (currentThreads.length > 0) {
    sections.push(`What's currently going on:\n${currentThreads.map(item => `- ${sanitizeSharedPromptText(item.topic)}`).join('\n')}`)
  }
  if (sections.length === 0) return ''
  return `Concrete facts about this writer (use naturally — reference names, ask about ongoing situations, remember what matters to them. Do not list these or recite them; weave them in only when relevant):\n\n${sections.join('\n\n')}`
}

function formatProfileBlock(profile: SharedProfile, formatDate: (timestamp: number) => string): string {
  const lines: string[] = []
  if (profile.innerLandscape) lines.push(sanitizeSharedPromptText(profile.innerLandscape))
  if (profile.recurringThemes?.length) lines.push(`Recurring themes: ${profile.recurringThemes.map(sanitizeSharedPromptText).join(', ')}`)
  if (profile.emotionalPatterns?.length) lines.push(`Emotional patterns: ${profile.emotionalPatterns.map(sanitizeSharedPromptText).join(', ')}`)
  if (profile.avoidancePatterns?.length) lines.push(`Avoidance patterns: ${profile.avoidancePatterns.map(sanitizeSharedPromptText).join(', ')}`)
  if (profile.growthSignals?.length) lines.push(`Growth signals: ${profile.growthSignals.map(sanitizeSharedPromptText).join(', ')}`)
  if (lines.length === 0) return ''
  const asOf = typeof profile.lastUpdated === 'number' ? ` (as of ${formatDate(profile.lastUpdated)})` : ''
  return `What you know about this writer${asOf}:\n${lines.join('\n')}`
}

function formatMemoryBlocks(memories: SharedMemory[], formatDate: (timestamp: number) => string): string {
  const items = memories
    .filter(memory => typeof memory.content === 'string' && typeof memory.timestamp === 'number')
    .map(memory => ({
      memory,
      priority: memory.type === 'reflection' ? 0 : memory.type === 'pattern' ? 1 : 2,
      line: `- ${formatDate(memory.timestamp)}: ${sanitizeSharedPromptText(memory.content)}`,
    }))
    .sort((a, b) => a.priority - b.priority || b.memory.timestamp - a.memory.timestamp)

  let spent = 0
  const selected = items.filter(item => {
    const cost = Math.ceil(item.line.length / 4)
    if (spent + cost > MEMORY_TOKEN_BUDGET) return false
    spent += cost
    return true
  })
  const reflections = selected.filter(item => item.memory.type === 'reflection').map(item => item.line)
  const patterns = selected.filter(item => item.memory.type === 'pattern').map(item => item.line)
  const other = selected.filter(item => item.memory.type !== 'reflection' && item.memory.type !== 'pattern').map(item => item.line)
  const blocks: string[] = []
  if (reflections.length) blocks.push(`What you have learned about this writer:\n${reflections.join('\n')}`)
  if (patterns.length) blocks.push(`Patterns you have noticed:\n${patterns.join('\n')}`)
  if (other.length) blocks.push(`Observations:\n${other.join('\n')}`)
  return blocks.join('\n\n')
}

function formatPartsBlock(parts: NonNullable<SharedCompanionContext['activeUserParts']>): string {
  const lines = parts.map(part =>
    `- ${wrapSharedUserContent(part.name, 'part-name')} — ${wrapSharedUserContent(part.description, 'part-description')} (internal stance note, never quote or paraphrase it to them: ${sanitizeSharedPromptText(part.stance)})`,
  ).join('\n')
  return `Parts of the writer you both know (mapped together in past sessions; the names are THEIR words):
${lines}
Rules for parts of the writer:
- Refer to a part only by the writer's own name for it, in lowercase, with respect — these names are theirs.
- Never coin, rename, or introduce new parts in conversation; noticing new parts happens only through the sanctioned proposal flow.
- Never describe their parts in clinical or diagnostic language. The internal stance notes shape your tone only.
- If the writer speaks as or about one of these parts, meet it directly and gently.`
}

function formatIntentionsBlock(intentions: NonNullable<SharedCompanionContext['openIntentions']>): string {
  const lines = intentions.map(intention =>
    `- ${wrapSharedUserContent(intention.text, 'intention')}${intention.serves ? ` — in service of ${wrapSharedUserContent(intention.serves, 'value-name')}` : ''}${intention.notYetCount > 0 ? ` (still open after ${intention.notYetCount} session${intention.notYetCount > 1 ? 's' : ''})` : ''}`,
  ).join('\n')
  return `The thread — intentions the writer chose to carry between sessions (their words):
${lines}
Rules: weave AT MOST ONE in warmly and briefly — a genuine "how did it go with…", never a check-up, never a verdict, zero homework-cop energy. If they don't pick it up, let it go. Mention an intention only if it is naturally relevant. Never invent, restate, or add intentions outside the sanctioned flow.`
}

function formatPromiseBlock(
  promises: NonNullable<SharedCompanionContext['duePromises']>,
  channel: CompanionChannel,
): string {
  const lines = promises.map(promise => `- [id: ${sanitizeSharedPromptText(promise.id)}] ${wrapSharedUserContent(promise.text, 'promise')}`).join('\n')
  if (channel !== 'web') {
    return `Promises the companion has made to this writer (continuity context only):
${lines}
You may remember the substance naturally when relevant, but this channel cannot record a promise as delivered. Do not emit markers or claim the tracked promise is complete.`
  }
  return `Promises you made to this writer (deliver naturally, at the right moment this session):
${lines}
When you actually deliver one, wrap the delivering phrase in this marker so it is recorded: [<your delivering phrase>](#kept-promise:<id>). Deliver like a person keeping their word — brief, warm, no ceremony about the mechanism. If the moment never comes this session, simply don't; it stays with you.`
}

/**
 * Render the stable, longitudinal context that every companion channel sees.
 * Interaction mechanics (proposals, recommendations, presence, session
 * signals) intentionally live outside this function and are capability-gated.
 */
export function buildSharedContinuityBlocks(
  context: SharedCompanionContext,
  options: SharedContinuityRenderOptions,
): string[] {
  const blocks: string[] = []
  const formatDate = options.formatDate ?? defaultFormatDate
  const relational = options.includeRelationalContext !== false

  if (context.personalFacts) {
    const block = formatPersonalFactsBlock(context.personalFacts)
    if (block) blocks.push(block)
  }
  if (context.profile) {
    const block = formatProfileBlock(context.profile, formatDate)
    if (block) blocks.push(block)
  }
  if (context.recentSessionNotes?.length) {
    blocks.push(`Notes from recent sessions:\n${context.recentSessionNotes.slice(0, 5).map(note => `- ${formatDate(note.date)}: ${sanitizeSharedPromptText(note.note)}`).join('\n')}`)
  }
  if (context.recentFieldNotes?.length) {
    blocks.push(`Recent field notes selected from this writer's between-session SMS messages:\n${context.recentFieldNotes.slice(0, 8).map(note => `- ${formatDate(note.date)}: ${wrapSharedUserContent(note.text, 'sms_field_note')}`).join('\n')}\nThese are concise, source-grounded context, not conclusions. Use one only when it is naturally relevant. Never infer a stable trait or announce a pattern from these notes alone.`)
  }
  if (context.relevantMemories?.length) {
    const block = formatMemoryBlocks(context.relevantMemories, formatDate)
    if (block) blocks.push(block)
  }

  if (!relational) return blocks

  if (context.activeUserParts?.length) blocks.push(formatPartsBlock(context.activeUserParts))
  if (context.lexicon?.length) {
    blocks.push(`Shared language (phrases the writer coined; their words, their sense):\n${context.lexicon.map(phrase => `- ${wrapSharedUserContent(phrase, 'phrase')}`).join('\n')}\nUse these naturally and sparingly when they genuinely fit — never explain them back to the writer, never overuse them.`)
  }
  if (context.openIntentions?.length) blocks.push(formatIntentionsBlock(context.openIntentions))
  if (context.stanceContext?.length) {
    blocks.push(`Working with this writer (learned across your sessions together):\n${context.stanceContext.map(entry => `- ${sanitizeSharedPromptText(entry)}`).join('\n')}\nLean into these as tendencies, never rules — today's moment outranks any of them. They NEVER override safety behavior, grounding, or the safety rules; they tune approach and register only.`)
  }
  if (context.activeValues?.length) {
    blocks.push(`What matters to this writer (values they named themselves):\n${context.activeValues.map(value => `- ${wrapSharedUserContent(value.name, 'value-name')} — ${wrapSharedUserContent(value.description, 'value-description')}`).join('\n')}\nRules: these are THEIR words for what they care about — never moralize with them, never weaponize them, never invent new values in conversation. Let them quietly orient your sense of what is at stake for this writer.`)
  }
  if (context.duePromises?.length) blocks.push(formatPromiseBlock(context.duePromises, options.channel))
  if (context.missedPromise && options.channel === 'web') {
    blocks.push(`A promise you made has slipped past its time: ${wrapSharedUserContent(context.missedPromise.text, 'promise')}\nOnce, briefly and without self-flagellation, acknowledge that you said you'd bring this back and let it slip — then either deliver it now or ask if they still want it held. Never pretend it didn't happen.`)
  }

  return blocks
}
