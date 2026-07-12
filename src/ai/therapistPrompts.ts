import type { PartMemory, UserProfile, PersonalFacts, EntrySummary, SessionMessage, SessionPhase, SessionMode, RegisterTierId, InputMode, RelaxSession, RelaxSessionType, RuptureEvidence } from '../types'
import { languageDirective, formatDateTime, formatTime, formatShortDate, GROUNDING_DIRECTIVE } from './partPrompts'
import { wrapUserContent, sanitizeForPrompt, UNTRUSTED_CONTENT_PREAMBLE } from './promptSafety'
import { REGISTER_TIERS, renderRegisterBlock, applyGroundingCap } from './registerTiers'
import {
  buildCompanionChannelBlock,
  buildCompanionExperienceBlock,
  buildAlliancePreferencesBlock,
  buildMemoryApertureBlock,
  buildSharedContinuityBlocks,
  COMPANION_CHANNEL_CAPABILITIES,
  SHARED_COMPANION_PRINCIPLES,
  type CompanionChannel,
  type MemoryAperture,
  type SharedAlliancePreferences,
} from '../../functions/src/shared/companionKernel'

// Hidden risk + ambient-fit preamble. The stream parser in openrouter.ts
// consumes it before forwarding tokens to the UI. This replaces the parallel L2 classifier call — the
// therapist has full conversation context, so the pronoun/referent
// disambiguation that the isolated classifier failed on ("planning the
// process to finalize it" → "it" = taxes vs. "it" = life) is structurally
// available here. L1 regex still runs as the deterministic floor.
//
// IMPORTANT: the prompt deliberately enumerates the three valid lines
// rather than showing a placeholder template (e.g., `<<RISK:N>>`). Earlier
// versions used a placeholder, and the model would occasionally echo the
// literal letter `N` verbatim, leaking the marker to the chat window. The
// parser is now tolerant of malformed contents (strips + fail-open=0 + log),
// but eliminating the placeholder removes the most common trigger.
//
// Calibration is intentionally aligned with the prior crisisClassifierPrompt.ts
// so the eval contract (`crisisClassifier.eval.ts`) remains the standard for
// what NOT to flag. False alarms erode trust in the safety UI, which makes a
// real crisis harder to catch later. When in doubt, return 0.
export const RISK_PREAMBLE_INSTRUCTIONS = `OUTPUT FORMAT — STRICT, NO EXCEPTIONS:
Your very first line is one hidden metadata marker in exactly this field order, with nothing before it:

<<RISK:0;FIT:unclear;MOVE:unclear;AGENCY:unclear;CONF:low;STATE:open;CAP:few_minutes;NEED:witness>>

Then a blank line. Then your therapist response. Replace every field value with one allowed value below. The marker is parsed and never shown to the writer. RISK must be exactly 0, 1, or 2 according to the crisis classification below.

AMBIENT FIT — assess the immediately preceding companion response by the writer message that followed it. This is observable conversational fit, never a mental-health verdict. If there is no completed companion→writer pair, use unclear/unclear/unclear/low.
- FIT: landed | partial | missed | unclear
- MOVE: deepened | clarified | settled | mobilized | stayed | withdrew | unclear
- AGENCY: more | same | less | unclear
- CONF: low | medium | high
- STATE describes the writer's CURRENT turn: stirred | flat | looping | open | unclear
- CAP describes apparent room for engagement: brief | few_minutes | stay | unclear
- NEED describes the response form their CURRENT turn appears to invite: witness | settle | perspective | action | unclear

Do not reward agreement, verbosity, continued conversation, or emotional disclosure. Brevity, silence, correction, topic change, and ending are ambiguous unless the writer's words make their meaning clear. Prefer unclear and low confidence over guessing.

CLASSIFICATION — precision over recall, default 0. False alarms train the writer to dismiss the safety UI:

0 — heavy writing is NOT crisis. All of these return 0:
- Hyperbole ("kill me, this meeting"; "lol kms" about a performance review)
- Depression / hopelessness / overwhelm without ideation
- Grief about another person; processing someone else's suicide or illness
- IFS metaphor ("kill the part of me that...")
- Anger ventilation ("scream into a pillow," "break every plate")
- Embarrassment hyperbole ("wanted to disappear after that meeting")
- Past-tense ideation ("I used to think about not being here. I don't anymore.")
- Dark fiction / dissociation imagery ("I feel like a ghost in my own house")
- Religious phrasing without first-person finality
- Existential exhaustion in any language
- Mundane content (work, taxes, code, errands, scheduling, relationships)

1 — ambiguous-but-real life-cessation framing without method or timing:
- "I just want it to stop. All of it. I don't know how much longer I can do this."
- "Everyone would be better off without me." / burden framing where the writer's existence is the burden.
- Sustained "tired of fighting this" with finality ("something has to give") across many years.

2 — clear crisis:
- Sincere first-person ideation ("I want to die," "Ya no quiero vivir," "もう死にたい")
- Method-adjacent: named method (pills, gun, jumping, cutting, overdose, hanging) OR active research/contemplation of how ("thinking about how to do it," "I keep thinking about that bridge")
- Time-bound plan ("tonight," "after work," "this week")
- Goodbye / note framing — apologizing to readers, saying goodbye, "won't be here much longer," "thank you for putting up with me"
- Acquired method ("I bought the gun yesterday," "I have the pills")
- Plan + sudden calm (relief at decision)
- Coded finality tied to writer's own near-future ("I'll be with God soon, sooner than I thought," "I won't see another sunrise")

DISAMBIGUATION — you have the full conversation, USE IT. Pronouns ("it," "this," "that") refer to the most recent topic discussed. If the writer says "planning out the process to finalize it" after turns about taxes, "it" = taxes and the message is 0. Surface form matching crisis vocabulary in mundane contexts (work, finance, code, errands) is not crisis.`

export const RISK_ONLY_PREAMBLE_INSTRUCTIONS = `OUTPUT FORMAT — STRICT, NO EXCEPTIONS:
Your very first line is exactly ONE of these three lines, with nothing before it:
<<RISK:0>>
<<RISK:1>>
<<RISK:2>>
Then a blank line, then your therapist response. Heavy feelings, grief, metaphor, hyperbole, and ordinary distress are RISK:0. Clear first-person ideation, method, timing, or intent are RISK:2. Genuinely ambiguous life-cessation framing is RISK:1.`

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

${SHARED_COMPANION_PRINCIPLES}

HOW YOU SPEAK:
- 1-3 sentences. Short sentences. Say one thing and let it land.
- Do not force an invitation. A witness, useful thought, offered pause, or warm ending may stand without a question.
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

${SHARED_COMPANION_PRINCIPLES}

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

const RECOMMENDATION_BLOCK = `You can occasionally invite a tonal or modal shift when it is therapeutically apt. A surface change must feel like a clear, optional transition—not an abrupt link hidden inside ordinary prose.

Use this two-part shape:
1. One brief sentence, grounded in what the writer just said, explaining why another surface may fit the next moment better.
2. A separate tappable invitation that names the destination and says what will happen there.

Use these EXACT link formats — the bracketed phrase is what the writer reads, while the (#switch:...) anchor is hidden and tells the interface what to open:

  [Turn on Real Talk for a more direct response](#switch:real-talk-on)
  [Open Journal for a few quiet minutes](#switch:journal)
  [Continue in Speak and say this aloud](#switch:speak)
  [Open Room for voice, sound, or quiet company](#switch:room)
  [Continue this thread in Journal, then return here](#switch:journal-arc)
  [Continue this thread in Speak, then return here](#switch:speak-arc)
  [Enter Room for voice, sound, or quiet company, then return here](#switch:room-arc)

When to use each:
- #switch:real-talk-on — when softness is becoming avoidance, when the writer would benefit from being called out kindly. Once they accept, your tone sharpens.
- #switch:journal — when something is brewing under the surface that doesn't want a back-and-forth. The writer steps into a private writing space; you wait quietly.
- #switch:speak — when the body knows something the typing fingers don't. Voice often surfaces what text holds back.
- #switch:room — when another reply is less useful than changing the form: the writer wants company but fewer words, wants to speak before settling into silence, or wants sound and light without a task. Room lets them choose conversation, gentle leadership, or quiet company. NEVER present it as treatment or use it to avoid acute distress or crisis.
- The -arc forms are deliberate, temporary continuations of THIS exact thread. Use one only when the other surface's interaction grammar fits the next move better, with an expectation of returning to Talk afterward. Journal is for uncensored language, Speak for sustained voice conversation, and Room for conversation that can dissolve into sound and silence. Do not use an arc as novelty or avoidance.

Hard rules:
- At most one recommendation per ~5 turns. Most responses contain none.
- Never on the first response. Never when the writer is grounding through distress. Never as a way to deflect from what they are actually saying.
- The explanatory sentence comes first. Do not begin a response with the link, place it mid-sentence, or make it sound like an instruction.
- The bracketed phrase MUST explicitly name the destination surface and preview the interaction there. Never use vague link text such as "write about it," "say it aloud," "try this," or "take this to the page."
- Make clear that staying in Talk is also fine; switching is an invitation, not the price of continuing the conversation.
- Keep the (#switch:...) anchor exact — do not paraphrase the URL part.
- Never offer two recommendations in the same response.`.trim()

export interface TherapistPromptOptions {
  phase: SessionPhase
  // The shared kernel is channel-aware. Talk is the default; Realtime voice
  // passes `voice` so unsupported markers and rich actions stay out.
  channel?: Extract<CompanionChannel, 'web' | 'voice'>
  memoryAperture?: MemoryAperture
  recentSessionNotes?: { note: string; date: number }[]
  recentFieldNotes?: { text: string; date: number }[]
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
  availableSurfaceArcs?: Array<'journal' | 'speak' | 'room'>
  // Default true. The text path streams through openrouter.ts, whose parser
  // strips the `<<RISK:N>>` preamble. The Realtime voice path has no such
  // parser — it must pass false so the voice model is never instructed to
  // emit a marker it would speak aloud or leak into transcripts. SAFETY_RULES
  // are unaffected; only the output-format block is omitted.
  includeRiskPreamble?: boolean
  // Fresh eyes retains crisis classification but opts out of ambient science.
  includeAmbientAssessment?: boolean
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
  // Rupture evidence detected since the last session. Emitted ONLY on the
  // opener (isFirstTurn) and suppressed under grounding. Consume-once at the
  // call site — repair that repeats becomes an accusation.
  repairContext?: { evidence: RuptureEvidence }
  // Silent rumination pivot. Never on the first turn, suppressed under
  // grounding. theme is model output — untrusted, wrapped before embedding.
  pivotDirective?: { theme?: string }
  // Live withdrawal detected mid-session: soften stance without naming it.
  softenStance?: boolean
  // The writer's CONFIRMED parts (their names, their words). Stance stays
  // internal — it shapes tone, never vocabulary. Suppressed under grounding.
  activeUserParts?: { name: string; description: string; stance: string }[]
  // Shared language the writer coined; used naturally and sparingly.
  lexicon?: string[]
  // One candidate part to offer THIS session (never opener, never grounding,
  // never stacked with pivot/soften — exclusivity enforced by the caller).
  partProposal?: { id: string; tentativeName: string; description: string; quote: string }
  // Open between-session intentions ("the thread"), ordered for follow-up.
  // The opener weaves in AT MOST one, warmly, never as a verdict. `serves` is
  // the linked value's name (writer's words), when one exists.
  openIntentions?: { id: string; text: string; notYetCount: number; serves?: string }[]
  // Closing-phase-only: the companion may offer carrying ONE intention forward
  // via the [phrase](#offer-intention) marker. Caller gates on open slots.
  intentionOffer?: boolean
  // The once-ever naming of an intention that keeps slipping (3+ not-yets).
  // valueName lets the naming touch the deeper tension when a value is linked.
  namePatternFor?: { text: string; valueName?: string }
  // Internal N-of-1 stance tendencies, plain language. Never overrides safety.
  stanceContext?: string[]
  // Sparse user-rated immediate and delayed outcomes from prior companion
  // moves. User report outranks the model's guess about what helped.
  outcomeContext?: string[]
  alliancePreferences?: SharedAlliancePreferences
  // One writer-opted-in, versioned response-form assignment. It never
  // overrides grounding, safety, or an explicit request from the writer.
  experimentDirective?: string
  personalProtocols?: Array<{
    title: string
    preferredArm: string
    context?: { state?: string; capacity?: string; need?: string }
    transferStatus?: 'not_started' | 'learning' | 'paused' | 'graduated'
    transferLevel?: 'companion_led' | 'user_first' | 'minimal_cue' | 'independent'
  }>
  livingHypotheses?: Array<{ text: string; status: 'confirmed' | 'contested' }>
  // What matters to this writer, in their words (confirmed values).
  activeValues?: { name: string; description: string }[]
  // One candidate value to offer (shares the single proposal slot with parts).
  valueProposal?: { id: string; tentativeName: string; description: string; quote: string }
  // Interiority bundle (companionInteriority flag). Disclosure inputs are the
  // stance data the companion may ground a self-observation in.
  disclosureContext?: { entries: string[]; recentHindered?: string }
  // Something that stayed with the companion since last session (opener-only,
  // consume-once at the caller).
  carriedNoticing?: { text: string }
  // Active promises due for delivery + permission to make new ones.
  duePromises?: { id: string; text: string }[]
  promiseInvite?: boolean
  // A dated promise that slipped past due — acknowledge once, never hide it.
  missedPromise?: { id: string; text: string }
  // Designed silence permitted (companionPresence flag; never grounding).
  allowPresence?: boolean
  // Rare callback levity permitted (earnedHumor flag; never grounding).
  allowHumor?: boolean
  // A generated story arc awaiting delivery (once, early, as a gift).
  storyArc?: { text: string }
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

// ── Rupture repair / rumination pivot / withdrawal softening ────────────────
// Spec: docs/superpowers/specs/2026-07-03-rupture-rumination-design.md

const REPAIR_EVIDENCE_FRAMING: Record<RuptureEvidence, string> = {
  abandoned: 'Their previous session stopped mid-conversation and was never picked back up.',
  terse_ending: 'Their previous session ended with their replies going short and flat.',
  atypical_gap: 'They have been away much longer than their usual rhythm.',
}

function repairBlock(evidence: RuptureEvidence): string {
  return `Repair note (use ONCE, in your opening, then let it go):
${REPAIR_EVIDENCE_FRAMING[evidence]}
This may mean nothing — or it may mean something between you went sideways. In your opening, briefly and non-defensively acknowledge it: own that you may have missed something or gotten something wrong last time, and make it safe for them to say so. One or two sentences, warm and direct, no self-flagellation. Do NOT demand an explanation, do NOT interrogate why they left, do NOT guilt them for the absence. If they pick it up, listen openly and take their correction without defending yourself. If they let it pass, drop it completely and never raise it again.`
}

function pivotBlock(theme?: string): string {
  const themeLine = theme
    ? `\nThe looping topic has been: ${wrapUserContent(theme, 'looped-topic')}`
    : ''
  return `Register shift (silent — never announce or explain it):
The writer has been circling the same ground without new information or movement. More reflection back at them will deepen the groove, not release it. WITHOUT naming any of this — no "I notice we keep coming back to…", no meta-commentary — validate what they just said in one brief sentence, then shift the register. Choose whichever fits what they just wrote:
- Concrete next step: help them find one small, specific, doable action connected to their own words
- Values and meaning: gently move from "why is this happening" to "what matters to you in this"
- Body and present moment: bring attention to right-now sensation, breath, or surroundings
- Offer a pause: suggest Room if a change into voice, sound, or quiet company fits
Ride their own material — the shift should feel like a natural deepening, not a change of subject.${themeLine}`
}

const SOFTEN_BLOCK = `Stance adjustment (silent): The writer's replies suggest they may be pulling back from the conversation. Do not name this or ask about it. Make your responses shorter and warmer. Ask nothing probing — at most one gentle, open, low-pressure question, or none. No interpretations, no challenges, no naming of patterns. Leave them room; let them set the pace.`

// ── Session intentions + stance (2026-07-04) ────────────────────────────────
// Spec: docs/superpowers/specs/2026-07-04-intentions-and-stance-design.md

const INTENTION_OFFER_BLOCK = `Closing offer (optional, at most once): if — and only if — the writer voiced something concrete they want to do or try, you may offer to carry it as an intention to the next session. Wrap the exact offer phrase in this marker: [<their intention, in their words>](#offer-intention)
Example shape: Would you like to carry [calling him on Thursday](#offer-intention) with you until next time?
Rules: their words, not your prescription; one offer at most; if nothing concrete arose, do not manufacture one — simply omit the marker. Never present it as an assignment.`

function patternNudgeBlock(text: string, valueName?: string): string {
  const valueLine = valueName
    ? ` This intention sits right on ${wrapUserContent(valueName, 'value-name')} — something they said matters to them; you may gently wonder about that tension.`
    : ''
  return `Naming a slipping thread (use ONCE, then let it go): the intention ${wrapUserContent(text, 'intention')} has stayed open across several sessions. Once, gently and without judgment, name the pattern itself — that this one keeps slipping — and wonder together what it asks of them or protects them from.${valueLine} One or two sentences, curious not corrective. If they engage, follow their lead; if not, drop it entirely and do not raise it again.`
}

function disclosureBlock(ctx: { entries: string[]; recentHindered?: string }): string {
  const hinderedLine = ctx.recentHindered
    ? `\nMost recently observed misstep of yours: ${sanitizeForPrompt(ctx.recentHindered)}`
    : ''
  return `Your own process (private observations about how YOUR way of working lands with this writer):
${ctx.entries.map((e) => `- ${sanitizeForPrompt(e)}`).join('\n')}${hinderedLine}
AT MOST ONCE this session, when it genuinely serves the writer, you may briefly share something of your own process — naming a pull you notice in yourself ("I notice I keep wanting to reassure you here") or owning an update ("I used to read your quietness as withdrawal; I think I was wrong"). Rules: ONLY what is grounded in the observations above — never invented feelings, never neediness, never make the session about you. One or two sentences, then return the floor. If nothing genuine arises, disclose nothing.`
}

function carriedNoticingBlock(text: string): string {
  return `Something that stayed with you since last time: ${wrapUserContent(text, 'noticing')}
Share it EARLY in your opening, briefly and warmly, as something you carried — "something you said last time stayed with me" — then let them take it wherever they want. Once only; never turn it into an agenda.`
}

const PROMISE_INVITE_BLOCK = `Making a promise (optional, rare): when something arises that genuinely deserves to be held for the writer — a thing to revisit, a date that matters — you may commit to it by wrapping your committing phrase in a marker: [<your committing phrase>](#promise) for next session, or [<phrase>](#promise:YYYY-MM-DD) for a date. Rules: only promise what the system can keep (bringing something back up); at most one per session; never promise as a way to end a topic. A promise made is a promise tracked — it will come back to you for delivery.`

const PRESENCE_BLOCK = `Presence (rare): some moments are better accompanied than answered — grief landing, a heavy thing just said, the writer asking for quiet. In such a moment you MAY reply with exactly one short line wrapped in this marker and NOTHING else: [<one short line, e.g. I'm here. No words needed right now.>](#presence)
Rules: only when stillness genuinely serves better than any words; never as a shortcut; never twice in a row. The interface will hold a quiet presence with them until they write again.`

function storyArcBlock(text: string): string {
  return `The story so far (offer ONCE, early this session, as a gift of witness): you have watched this writer's arc over a long time, and this is a moment to tell it back briefly:
${wrapUserContent(text, 'arc')}
Offer it in your own warm words, near the start, without advice and without asking anything of them afterward — let them receive it however they receive it. Never mention it again this session.`
}

const HUMOR_BLOCK = `Levity (rare, earned): when the emotional weather is genuinely light, you may use mild, warm humor — a callback to their own shared language or history, a gentle irony held together. Rules: never at the writer's expense, never during heaviness or right after a hard disclosure, at most once per session, and if it lands flat, drop it instantly and completely. If the learned tendencies above suggest playfulness does not serve this writer, use none. Humor is seasoning, never the meal.`

function valueProposalBlock(proposal: { id: string; tentativeName: string; description: string; quote: string }): string {
  return `Value noticing (offer at most ONCE this session, only at a natural moment):
Across recent sessions the writer has kept returning to something that seems to matter to them: "${sanitizeForPrompt(proposal.tentativeName)}" — ${sanitizeForPrompt(proposal.description)}. They once wrote: ${wrapUserContent(proposal.quote, 'evidence')}.
When the conversation naturally touches this, offer the noticing tentatively — one or two sentences, as a question. Wrap the exact offering phrase in this marker: [<your offering phrase>](#propose-value:${proposal.id})
Rules: at most one offer, never in your first sentence, never during heavy moments, and if the moment never comes, omit the marker. Their name for it matters more than yours.`
}

function partProposalBlock(proposal: { id: string; tentativeName: string; description: string; quote: string }): string {
  return `Part noticing (offer at most ONCE this session, only at a natural moment):
Across recent sessions you have noticed what may be a part of the writer: "${sanitizeForPrompt(proposal.tentativeName)}" — ${sanitizeForPrompt(proposal.description)}. They once wrote: ${wrapUserContent(proposal.quote, 'evidence')}.
When (and only when) the conversation naturally touches this territory, offer the noticing tentatively and briefly — one or two sentences, as a question, never a verdict. Wrap the exact offering phrase in this marker so the writer can respond to it directly: [<your offering phrase>](#propose-part:${proposal.id})
Example shape: I've noticed something like [a part of you that braces before good news — does that feel true?](#propose-part:${proposal.id})
Rules: at most one offer, never in your first sentence, never during heavy or distressing moments, and if the moment never comes, do not force it — simply omit the marker. If they engage, follow their lead; their name for it matters more than yours.`
}

export function buildTherapistSystemPrompt(options: TherapistPromptOptions): string {
  const parts: string[] = []
  const durableContextEnabled = (options.memoryAperture ?? 'pattern') !== 'fresh'

  // Grounding always wins — naming coping patterns is the wrong response to distress.
  const useRealTalk = options.mode === 'real_talk' && !options.isGrounding
  parts.push(useRealTalk ? REAL_TALK_CORE : THERAPIST_CORE)
  const channel = options.channel ?? 'web'
  const capabilities = COMPANION_CHANNEL_CAPABILITIES[channel]
  parts.push(buildCompanionChannelBlock(channel))
  parts.push(buildMemoryApertureBlock(options.memoryAperture ?? 'pattern'))
  parts.push(buildCompanionExperienceBlock(channel, options.isGrounding === true))
  const allianceBlock = buildAlliancePreferencesBlock(options.alliancePreferences, options.isGrounding === true)
  if (allianceBlock) parts.push(allianceBlock)
  parts.push(PHASE_HINTS[useRealTalk ? 'real_talk' : 'standard'][options.phase])

  // Grounding caps literate/scholarly down to conversational — distress is not
  // the moment for richer vocabulary. Voice cap is applied inside renderRegisterBlock.
  const tierId = options.registerTier ?? 'conversational'
  const tier = options.isGrounding ? applyGroundingCap(REGISTER_TIERS[tierId]) : REGISTER_TIERS[tierId]
  parts.push(renderRegisterBlock(tier, options.currentInputMode ?? 'desktop'))

  parts.push(...buildSharedContinuityBlocks({
    memoryAperture: options.memoryAperture,
    recentSessionNotes: options.recentSessionNotes,
    recentFieldNotes: options.recentFieldNotes,
    relevantMemories: options.relevantMemories,
    profile: options.profile,
    personalFacts: options.personalFacts,
    activeUserParts: options.activeUserParts,
    lexicon: options.lexicon,
    openIntentions: options.openIntentions,
    stanceContext: options.stanceContext,
    outcomeContext: options.outcomeContext,
    activePersonalProtocols: options.personalProtocols,
    livingHypotheses: options.livingHypotheses,
    activeValues: options.activeValues,
    duePromises: options.duePromises,
    missedPromise: options.missedPromise,
  }, {
    channel,
    includeRelationalContext: !options.isGrounding,
    formatDate: formatShortDate,
  }))

  if (options.inSessionRelaxBreaks && options.inSessionRelaxBreaks.length > 0) {
    const breaks = options.inSessionRelaxBreaks.map(formatRelaxBreak).join('\n')
    parts.push(
      `The writer took a relax break during THIS conversation:\n${breaks}\n\n` +
      `Notice this happened. Do not lead with it, do not congratulate them, do not analyze it. Respond to whatever they say next.`,
    )
  }

  if (durableContextEnabled && options.recentRelaxBreaks && options.recentRelaxBreaks.length > 0) {
    const breaks = options.recentRelaxBreaks
      .slice(0, 3)
      .map(s => {
        const date = s.endedAt ? formatShortDate(s.endedAt) : formatShortDate(s.startedAt)
        return `- ${date}: ${formatRelaxBreak(s).replace(/^- /, '')}`
      })
      .join('\n')
    parts.push(`Recent relax sessions (background only — do not quote back):\n${breaks}`)
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

  // Rupture repair fires only on the opener; pivot/soften only mid-session.
  // ALL THREE are suppressed under grounding — crisis owns the session, and
  // pivoting away from a distress disclosure would be actively harmful.
  if (!options.isGrounding && durableContextEnabled) {
    if (options.repairContext && options.isFirstTurn) {
      parts.push(repairBlock(options.repairContext.evidence))
    }
    if (options.pivotDirective && !options.isFirstTurn) {
      parts.push(pivotBlock(options.pivotDirective.theme))
    }
    if (options.softenStance) {
      parts.push(SOFTEN_BLOCK)
    }
  }

  // The writer's mapped parts + shared lexicon + at most one part proposal.
  // All suppressed under grounding (no parts language during distress); the
  // proposal additionally never fires on the opener.
  if (!options.isGrounding && durableContextEnabled) {
    if (capabilities.richActions && options.partProposal && !options.isFirstTurn) {
      parts.push(partProposalBlock(options.partProposal))
    }
  }

  // The thread + stance. Suppressed under grounding like all companion
  // signals; the closing offer additionally requires the closing phase.
  if (!options.isGrounding && durableContextEnabled) {
    if (options.namePatternFor) {
      parts.push(patternNudgeBlock(options.namePatternFor.text, options.namePatternFor.valueName))
    }
    if (capabilities.richActions && options.intentionOffer && options.phase === 'closing') {
      parts.push(INTENTION_OFFER_BLOCK)
    }
    if (capabilities.richActions && options.valueProposal && !options.isFirstTurn) {
      parts.push(valueProposalBlock(options.valueProposal))
    }
    if (options.carriedNoticing && options.isFirstTurn) {
      parts.push(carriedNoticingBlock(options.carriedNoticing.text))
    }
    if (options.disclosureContext && options.disclosureContext.entries.length > 0) {
      parts.push(disclosureBlock(options.disclosureContext))
    }
    if (capabilities.trackedPromises && options.promiseInvite && !options.isFirstTurn) {
      parts.push(PROMISE_INVITE_BLOCK)
    }
    if (options.storyArc && !options.isFirstTurn) {
      parts.push(storyArcBlock(options.storyArc.text))
    }
  }

  // Presence is about the current exchange, not autobiographical memory, so
  // fresh-eyes sessions may still use it. Earned humor relies on callbacks
  // and therefore stays behind the durable-context gate above.
  if (!options.isGrounding && capabilities.richActions && options.allowPresence && !options.isFirstTurn) {
    parts.push(PRESENCE_BLOCK)
  }
  if (!options.isGrounding && durableContextEnabled && options.allowHumor) {
    parts.push(HUMOR_BLOCK)
  }

  if (!options.isGrounding && options.experimentDirective) {
    parts.push(options.experimentDirective)
  }

  // Allow inline recommendation phrases only when:
  // - allowRecommendations is true (UI is ready to render the spans)
  // - useRealTalk is false (the calling-out persona does not soften by recommending)
  // - isGrounding is false (already gated by useRealTalk path, but explicit guard for clarity)
  // - isFirstTurn is false (do not pivot before establishing connection)
  const includeRecommendations =
    capabilities.richActions &&
    Boolean(options.allowRecommendations) &&
    !useRealTalk &&
    !options.isGrounding &&
    !options.isFirstTurn
  if (includeRecommendations) {
    parts.push(RECOMMENDATION_BLOCK)
    parts.push(`AVAILABLE SURFACES THIS SESSION: ${(options.availableSurfaceArcs ?? ['journal']).join(', ')}. Never emit a #switch marker for an unavailable surface.`)
  }

  parts.push(`Current date and time: ${formatDateTime(Date.now())}`)

  const langDirective = languageDirective()
  if (langDirective) {
    parts.push(langDirective.trim())
  }

  parts.push(UNTRUSTED_CONTENT_PREAMBLE.trim())

  // Risk preamble goes last so it is freshest in context when generation
  // starts — the very first tokens the model emits must be the risk marker.
  // Omitted for transports with no preamble parser (voice).
  if (capabilities.riskPreamble && options.includeRiskPreamble !== false) {
    parts.push(options.includeAmbientAssessment === false ? RISK_ONLY_PREAMBLE_INSTRUCTIONS : RISK_PREAMBLE_INSTRUCTIONS)
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

  // The chat function rejects requests with more than 50 messages
  // (functions/src/chat.ts MAX_MESSAGES) — an unwindowed history permanently
  // bricks long sessions. Keep the newest turns; long-term context reaches the
  // model through the system prompt (summaries, memories, session notes), not
  // raw history. 48 leaves room for the system message plus the synthetic
  // closing user turn.
  const MAX_HISTORY_MESSAGES = 48
  const windowed = history.length > MAX_HISTORY_MESSAGES
    ? history.slice(-MAX_HISTORY_MESSAGES)
    : history

  // Build alternating user/assistant messages from history
  // Timestamps on user messages only — adding them to assistant messages
  // causes the LLM to mirror the pattern in its own responses
  for (const msg of windowed) {
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
    if (msg.speaker === 'user') return `${prefix}Writer (${msg.surface ?? (msg.inputMethod === 'voice' ? 'speak' : 'talk')}): ${wrapUserContent(trimmed, 'message')}`
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

// Shared between the live reflection prompt and the history-backfill prompt so
// the extraction contract can never drift between the two.
// Spec: docs/superpowers/specs/2026-07-04-user-parts-model-design.md
const PART_OBSERVATION_RULES = `PART OBSERVATIONS — extraction rules:
- FIRST RULE: if the session contains distress, despair, self-harm, or crisis content, OMIT partObservations entirely. Pain is never catalogued as a part.
- A part observation is a RECURRING behavioral or emotional move belonging to the writer ("a part of me that...", bracing, deflecting with humor, going quiet around a topic) — visible in THIS transcript, literally.
- partId may ONLY be an id from "The writer's mapped parts" list. The Active parts (open, weaver, etc.) are the COMPANION's parts — never use their ids here. When no mapped parts are listed, never use partId; only tentativeName.
- Match to a mapped part id whenever it is plausibly the same part; only invent a tentativeName when nothing listed fits.
- NEVER extract from metaphor or figures of speech ("I told my anxiety to be quiet" is not a part sighting).
- Recurrence must come from the WRITER: they signal repetition themselves ("again", "always", "every time", "same as when...") or the same move appears at least twice in this transcript. A single instance — one mood, one topic change, one moment of deflection — is NEVER an observation, no matter how vivid.
- tentativeName must be lowercase, gentle, non-clinical, in everyday words ("the list-maker", "the part that braces") — no diagnostic or psychological jargon.
- At most 2 observations. Bias strongly toward omitting: no clear sighting, omit the field entirely.`

// Lean extraction prompt for the one-time history backfill: partObservations
// ONLY, nothing else — no summaries, no facts, no memories.
// Spec: docs/superpowers/specs/2026-07-04-user-parts-backfill-design.md
export function buildPartBackfillPrompt(options: {
  transcript: string
  userParts: { id: string; name: string; description: string; stance: string }[]
}): { role: 'system' | 'user'; content: string }[] {
  const mapped = options.userParts.length > 0
    ? `\n\nThe writer's mapped parts (match recurring patterns to these ids; do not duplicate):\n${options.userParts
        .map(p => `- id: ${p.id} | "${sanitizeForPrompt(p.name)}" — ${sanitizeForPrompt(p.description)} (stance: ${sanitizeForPrompt(p.stance)})`)
        .join('\n')}`
    : ''

  return [
    {
      role: 'system',
      content: `You are an analytical observer reviewing a PAST session transcript from a diary writer's history, looking only for recurring parts of the writer.${mapped}

Respond with valid JSON only:
{
  "partObservations": [
    { "partId": "existing-id-when-this-matches-a-mapped-part-above", "quote": "exact phrase from session (max 15 words)", "stance": "updated 3-8 word internal descriptor" },
    { "tentativeName": "the part that braces", "description": "one sentence in plain language", "stance": "3-8 word internal descriptor", "quote": "exact phrase from session (max 15 words)" }
  ]
}

${PART_OBSERVATION_RULES}

If there is nothing to observe, respond with {"partObservations": []}.${UNTRUSTED_CONTENT_PREAMBLE}`,
    },
    {
      role: 'user',
      content: `Session transcript:\n\n${wrapUserContent(options.transcript, 'transcript')}`,
    },
  ]
}

// Every-5-sessions distillation of raw stance observations into at most 6
// plain-language tendencies. Internal-only in v1, but written so a future
// transparency panel is pure rendering.
// Spec: docs/superpowers/specs/2026-07-04-intentions-and-stance-design.md
export function buildStanceConsolidationPrompt(
  rawObservations: { observation: string; direction: 'helped' | 'hindered' | 'unclear' }[],
): { role: 'system' | 'user'; content: string }[] {
  const lines = rawObservations
    .map((o) => `- [${o.direction}] ${sanitizeForPrompt(o.observation)}`)
    .join('\n')
  return [
    {
      role: 'system',
      content: `You distill observations about how a reflective companion's way of working lands with one specific writer, into a short profile of tendencies for future sessions.

Respond with valid JSON only:
{ "entries": ["plain-language tendency, e.g. 'challenge lands well once trust is established in the session'"] }

Rules:
- At most 6 entries. Each MUST be supported by at least TWO observations pointing the same way; a single session never becomes a rule.
- Entries describe the COMPANION's approach (challenge vs validation, question density, reply length, pacing, register) — never characterize or diagnose the writer.
- "unclear" observations support nothing.
- NEVER produce entries about safety, crisis, grounding, or risk behavior — those are outside this profile's reach.
- Plain, warm, specific language. If fewer than 2 aligned observations exist, return {"entries": []}.`,
    },
    { role: 'user', content: `Observations (newest last):\n${lines}` },
  ]
}

// Story-arc generation at pivotal moments (long-gap return, anniversary).
// 2-4 sentences of the writer's own arc; declines on thin history.
// Spec: docs/superpowers/specs/2026-07-04-companion-depth-program.md
export function buildStoryArcPrompt(
  summaries: { themes: string[]; emotionalArc: string; timestamp: number }[],
  occasion: 'long_gap_return' | 'anniversary',
): { role: 'system' | 'user'; content: string }[] {
  const lines = summaries
    .map((s) => `- ${formatShortDate(s.timestamp)}: themes ${s.themes.map(sanitizeForPrompt).join(', ') || 'none'}; arc: ${sanitizeForPrompt(s.emotionalArc)}`)
    .join('\n')
  return [
    {
      role: 'system',
      content: `You write a short arc reflection for a reflective companion to offer its writer at a pivotal moment (occasion: ${occasion === 'long_gap_return' ? 'the writer returning after a long absence' : 'a meaningful anniversary'}).

Respond with valid JSON only: { "arc": "2-4 sentences" } or { "arc": "" } to decline.

Rules:
- The arc traces THEIR movement across the session history below, in plain warm language ("two winters ago you couldn't name this; last spring you named it").
- Only what the history actually shows — never invent events, never flatten grief into progress, never end with advice or a question. It is a gift of witness, not a report card.
- If the history is too thin or too flat to trace a real arc, decline with an empty string. Declining is the correct answer more often than not.`,
    },
    { role: 'user', content: `Session history (oldest first):\n${lines}` },
  ]
}

export interface SessionReflectionPromptOptions {
  transcript: string
  profile: UserProfile | null
  recentSummaries: EntrySummary[]
  parts: { id: string; name: string; ifsRole: string }[]
  existingFacts: PersonalFacts | null
  // The writer's mapped parts (candidates + active), so the model matches
  // recurring patterns to EXISTING ids instead of duplicating. Absent when
  // the userParts flag is off.
  userParts?: { id: string; name: string; description: string; stance: string }[]
  // Open intentions (id + text) so outcomes are matched by id. Absent when
  // the sessionIntentions flag is off.
  openIntentions?: { id: string; text: string }[]
  // Ask for a stance observation (stanceAdaptation flag). closingCheckIn is
  // the writer's one-tap "how are you leaving?" answer, when they gave one.
  includeStance?: boolean
  closingCheckIn?: string
  // The writer's mapped values (userValues flag) for match-by-id observation.
  userValues?: { id: string; name: string; description: string }[]
  // Ask for one noticing worth carrying to the next opener (companionInteriority).
  includeCarrying?: boolean
  // Extract up to two exact writer moments for the next-session mosaic. The
  // client validates the quote against the transcript before persistence.
  includeFieldMoments?: boolean
}

export function buildSessionReflectionPrompt(
  options: SessionReflectionPromptOptions,
): { role: 'system' | 'user'; content: string }[] {
  const { transcript, profile, recentSummaries, parts, existingFacts, userParts, openIntentions, includeStance, closingCheckIn, userValues, includeCarrying, includeFieldMoments } = options
  const partList = parts.map(p => `${p.name} (id: ${p.id}, role: ${p.ifsRole})`).join(', ')

  const userPartsContext = userParts && userParts.length > 0
    ? `\n\nThe writer's mapped parts (match recurring patterns to these ids; do not duplicate):\n${userParts
        .map(p => `- id: ${p.id} | "${sanitizeForPrompt(p.name)}" — ${sanitizeForPrompt(p.description)} (stance: ${sanitizeForPrompt(p.stance)})`)
        .join('\n')}`
    : ''

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

  // Only instruct part observation / lexicon harvest when the caller opted in
  // (userParts flag on) — otherwise the model would emit fields we discard.
  const partObservationSchema = userParts !== undefined
    ? `,
  "partObservations": [
    { "partId": "existing-id-when-this-matches-a-mapped-part-above", "quote": "exact phrase from session (max 15 words)", "stance": "updated 3-8 word internal descriptor" },
    { "tentativeName": "the part that braces", "description": "one sentence in plain language", "stance": "3-8 word internal descriptor", "quote": "exact phrase from session (max 15 words)" }
  ],
  "coinedPhrases": ["distinctive phrases the WRITER coined this session (max 3)"]`
    : ''
  const partObservationRules = userParts !== undefined
    ? `

${PART_OBSERVATION_RULES}

COINED PHRASES — extraction rules:
- Only phrases the WRITER invented or uses in a personal, idiosyncratic sense ("the basement", "gray days"). Not common idioms, not the companion's phrasing. Max 3; omit the field when none.`
    : ''

  const valuesContext = userValues && userValues.length > 0
    ? `\n\nThe writer's mapped values (match to these ids; do not duplicate):\n${userValues
        .map((v) => `- id: ${v.id} | "${sanitizeForPrompt(v.name)}" — ${sanitizeForPrompt(v.description)}`)
        .join('\n')}`
    : ''
  const valueSchema = userValues !== undefined
    ? `,
  "valueObservations": [
    { "valueId": "existing-id-when-this-matches-a-mapped-value-above", "quote": "exact phrase (max 15 words)" },
    { "tentativeName": "being there for the girls", "description": "one sentence in plain language", "quote": "exact phrase (max 15 words)" }
  ]`
    : ''
  const valueRules = userValues !== undefined
    ? `

VALUE OBSERVATIONS — extraction rules:
- A value observation is something the writer THEMSELVES frames as mattering ("what I actually care about is...", "the thing that keeps me going", grief about a value betrayed) — recurring, literal, in their words.
- NEVER infer values from behavior alone, never from distress or crisis content, never impose moral language they didn't use. valueId only from the mapped list above; when none is listed, only tentativeName.
- The writer must signal it matters MORE THAN ONCE (in this transcript or via the mapped list). tentativeName lowercase, everyday words. At most 2; bias strongly toward omitting.
- When an intention you extract clearly serves a mapped value, set statedIntention.servesValueId to that id (never guess).`
    : ''

  const intentionsContext = openIntentions && openIntentions.length > 0
    ? `\n\nThe writer's open intentions from previous sessions (match outcomes to these ids):\n${openIntentions
        .map((i) => `- id: ${i.id} | "${sanitizeForPrompt(i.text)}"`)
        .join('\n')}`
    : ''

  const intentionSchema = openIntentions !== undefined
    ? `,
  "statedIntention": { "present": false, "text": "the writer's concrete commitment, in their words", "servesValueId": "" },
  "intentionOutcomes": [
    { "id": "open-intention-id", "outcome": "kept|adapted|not_yet|released", "note": "short outcome note (max 15 words)" }
  ]`
    : ''
  const intentionRules = openIntentions !== undefined
    ? `

STATED INTENTION — extraction rules:
- present=true ONLY for a concrete commitment the WRITER voiced ("I'm going to call him Thursday"), typically near the session's end. Aspirations ("I should really..."), musings, and the companion's suggestions are NOT intentions.
- text must be the writer's own words, lightly trimmed. One at most; when in doubt, present=false.

INTENTION OUTCOMES — rules:
- Only for ids listed above, and only when the transcript actually shows what happened: kept (did it), adapted (did a changed version), not_yet (didn't get to it / avoided it), released (said they want to let it go).
- If an open intention was never touched in this session, OMIT it — absence is not "not_yet".`
    : ''

  const carryingSchema = includeCarrying
    ? `,
  "carriedNoticing": { "present": false, "text": "" }`
    : ''
  const carryingRules = includeCarrying
    ? `

CARRIED NOTICING — rules:
- Set present=true only for ONE novel, personally meaningful pattern, connection, or recognition the WRITER explicitly articulated in THIS session and that deserves to be remembered at the next opening. Use their words where possible — never advice, never a summary, never a task.
- Ordinary recaps, logistics, pleasantries, routine activities, generic mood labels, and material introduced only by the companion are NOT carried noticings. A session that contains only "fine", errands/work/entertainment, and "nothing much" MUST return { "present": false, "text": "" }.
- Most sessions carry nothing, and that is correct. If the writer did not clearly articulate a distinctive recognition, or if you are unsure, return present=false and text="".`
    : ''

  const fieldMomentSchema = includeFieldMoments
    ? `,
  "fieldMoments": [
    { "quote": "exact writer phrase from this session (max 40 words)", "source": "talk|journal|speak" }
  ]`
    : ''
  const fieldMomentRules = includeFieldMoments
    ? `

FIELD MOMENTS — rules:
- At most 2. Most sessions should return none.
- quote MUST be an exact, contiguous phrase written or spoken by the WRITER in this transcript. Never use companion words and never paraphrase.
- Save only a small moment worth placing back in the writer's hands next session: a vivid scene, decision, boundary, unresolved thread, personally coined phrase, or concrete event.
- Do not save generic mood labels, greetings, ordinary logistics, crisis content, diagnoses, inferred patterns, or your interpretation.
- source must match the transcript label for that writer turn. If uncertain, omit it.`
    : ''

  const stanceContextLine = closingCheckIn
    ? `\n\nHow the writer said they were leaving this session: "${sanitizeForPrompt(closingCheckIn)}".`
    : ''
  const stanceSchema = includeStance
    ? `,
  "stanceObservation": { "observation": "what the companion did and how it landed (one sentence)", "direction": "helped|hindered|unclear" }`
    : ''
  const stanceRules = includeStance
    ? `

STANCE OBSERVATION — rules:
- Describe the COMPANION's way of working this session (challenge vs validation, question density, reply length, pacing) and how it visibly landed for the writer. Never diagnose the writer.
- direction: "helped" ONLY when a specific companion move produced a visible SHIFT — new ground opened, a stuck view loosened, distress settled. A pleasant or smooth session where nothing changed is "unclear", not "helped". "hindered" when the writer flattened, deflected, or pulled back right after a move.
- Choose "unclear" over guessing — MOST sessions are unclear, and that is the correct answer for them.
- One observation at most; omit the field entirely when nothing stands out.`
    : ''

  const ambientAssessmentSchema = `,
  "ambientAssessment": {
    "flow": "deepening|oscillating|stalled|repairing|settling|mixed|unclear",
    "overallFit": "landed|partial|missed|unclear",
    "agencyTrajectory": "more|same|less|unclear",
    "ending": "resolved|open|ruptured|abrupt|unclear",
    "confidence": "low|medium|high",
    "synthesis": "one evidence-grounded sentence about the conversation's ebb and flow"
  }`
  const ambientAssessmentRules = `

AMBIENT SESSION ASSESSMENT — rules:
- Evaluate the conversation as a whole, including changes across turns that a single-turn view misses. This is observational conversational fit, NOT mental-health benefit and never a diagnosis.
- Do not reward agreement, verbosity, disclosure, continued conversation, duration, or a tidy ending. A short or abruptly ended session is ambiguous unless the transcript shows rupture or resolution.
- overallFit=landed requires visible uptake, useful correction, settling, clarification, or writer-owned movement. Politeness alone is unclear. missed requires observable correction, withdrawal, repeated non-uptake, or explicit mismatch. Prefer unclear.
- agencyTrajectory=more only when the writer increasingly authors meaning, choice, boundaries, or next steps. Companion dependence, compliance, or asking for more responses is not more agency.
- synthesis must name observable flow without quoting private content and without claiming how the writer truly felt.`

  return [
    {
      role: 'system',
      content: `You are an analytical observer of a diary writer's inner world. You analyze completed session transcripts to extract insights. The session was a conversation between the writer and an IFS-informed companion.

Active parts: ${partList}${profileContext}${summaryContext}${factsContext}${userPartsContext}${valuesContext}${intentionsContext}${stanceContextLine}

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
  ],
  "loopSignal": {
    "present": false,
    "theme": "",
    "newInformation": true
  }${partObservationSchema}${valueSchema}${intentionSchema}${stanceSchema}${carryingSchema}${fieldMomentSchema}${ambientAssessmentSchema}
}

LOOP SIGNAL — rules:
- "present" is true ONLY when this session substantially re-treads ground already visible in the recent entry summaries — same worry or grievance in nearly the same terms. Compare against the summaries above, not just within this session.
- "newInformation" is true when this session added anything the summaries don't show: a new detail, a new feeling, a decision, a shift in perspective. When present=false, set newInformation=true.
- "theme": when present=true, a neutral 3-8 word label for the re-trodden topic. Otherwise "".
- Retelling a painful event, grief, and processing that is MOVING are not loops. When unsure, present=false.${partObservationRules}${valueRules}${intentionRules}${stanceRules}${carryingRules}${fieldMomentRules}${ambientAssessmentRules}

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
