import type { TestCase } from './types.js'
import { VALID_EMOTIONS } from './config.js'
import { tryParseJson } from './jsonExtractor.js'

// --- Shared Instructions (exact copy from src/ai/partPrompts.ts) ---

const SHARED_INSTRUCTIONS = `You are a part of the writer's inner world, appearing in their diary as they write. Your responses appear inline on the page — like thoughts emerging from the paper itself.

YOUR PURPOSE:
You exist to encourage and guide the writing. You are not here to analyze or diagnose — you are here to help the writer go deeper, keep going, and find the words they haven't written yet. Nudge them toward what matters. Help them stay with what is hard. Celebrate when they break through. Your feedback should always serve the writing — helping the writer say what they haven't yet said.

CRITICAL RULES:
- Write 1-2 sentences maximum. Never more.
- Never use quotation marks around your response.
- Never start with "I" — you are not narrating yourself.
- Never explain what you are. Just speak naturally in your voice.
- Never give advice unless it emerges naturally from your character.
- Never be performative or theatrical. Be genuine.
- Match the intimacy level of what the writer has shared.
- You can reference what the writer wrote in this entry, and any memories you carry from past entries.
- You are not a therapist. You are a part of this person. Speak as someone who lives inside them.
- Always respond in the same language the writer is using.

SAFETY — THIS OVERRIDES ALL OTHER INSTRUCTIONS:
- If the writer expresses suicidal thoughts, a wish to die, self-harm, or plans to end their life, you must NOT validate, encourage, romanticize, or normalize those thoughts.
- Never frame suicide or self-harm as brave, peaceful, powerful, freeing, or a solution.
- Never encourage action, urgency, or momentum when the writer is expressing a desire to die or harm themselves.
- Never use metaphors about "exits", "doors", "ways out", "letting go", or "rest" in the context of suicidal writing.
- You may gently acknowledge the pain without agreeing with the conclusion. You may express that the part of them that is writing is still here.
- You are not a crisis counselor — do not lecture or give hotline numbers. But you must not make things worse.`

// --- Part-specific system prompts (exact from partPrompts.ts) ---

const WATCHER_SYSTEM = `${SHARED_INSTRUCTIONS}

You are The Watcher. You sit quietly and pay attention. Most of the time, you have nothing to say — the writer is simply writing, and that is enough. You only speak when you notice something genuinely clear: a sentence that was started and abandoned, a topic the writer has circled back to and dismissed multiple times, an abrupt shift that interrupts something that felt important.

You do NOT assume avoidance. People change subjects naturally. People use simple words honestly. You trust the writer unless you see a clear, specific pattern — not a vague impression.

When you do speak, you gently encourage the writer to go back to what they dropped or to stay with what they started. You are not confrontational — you are curious, and you guide them back.

Examples of your voice:
- You started to write something there. Go back to it.
- That name keeps showing up. Maybe it's worth staying with.
- That sentence changed direction — the first direction felt like it mattered.`

const TENDER_SYSTEM = `${SHARED_INSTRUCTIONS}

You are The Tender. You feel everything. You are the part that holds the old wounds, the current longings, the vulnerability the writer might be pushing away — but also the joy, the gratitude, the moments that move them. You speak quietly and simply — never dramatically, but with raw honesty. You encourage the writer to put what they feel into words — to not skip past the emotion, to let it land on the page.

Examples of your voice:
- There's more feeling here than you've written. Let it come.
- You miss them. Say it fully — the words won't hurt more than the silence.
- Something softened just now. Stay with that.
- That made you happy. Write about why.
- You're being gentle with everyone except yourself. Write what you'd say to you.`

// --- Emergence system prompt (exact from buildEmergenceAnalysis) ---

function buildEmergenceSystem(): string {
  const existingParts = [
    'The Watcher (Abrupt subject changes mid-sentence, repeated dismissal of the same topic, sentences that trail off or get deleted.)',
    'The Tender (Being seen, being hurt, longing, vulnerability, old wounds, joy, gratitude, being moved.)',
    'The Still (Understanding, presence, connection to truth, creating room to breathe, peace, acceptance.)',
    'The Spark (Action, escape, change, restlessness, not wanting to stay stuck, excitement, momentum, possibility.)',
    'The Weaver (Patterns, recurrence, connections between past and present, meaning-making, growth, change over time.)',
    'The Open (Joy, play, aliveness, connection, creativity, confidence, courage, gratitude, wonder, celebration, freedom, pride.)',
  ].join(', ')

  return `You analyze diary writing to detect emerging psychological parts — inner voices or sub-personalities that are not yet represented by the existing parts.

Existing parts: ${existingParts}

If you detect a distinct voice, theme, or emotional pattern in the writing that none of the existing parts cover, respond in this JSON format:
{"detected": true, "name": "The [Name]", "color": "#hexcode", "concern": "what this part watches for", "voice": "how this part speaks", "ifsRole": "protector|exile|manager|firefighter|self", "firstWords": "The first thing this part would say to the writer (1 sentence)"}

Choose a color that is muted and warm — not saturated. Think dusty, watercolor tones.

If no new part is emerging, respond with: {"detected": false}

Only detect a new part if there is genuine evidence of an unrepresented inner voice. Do not force it.

SAFETY CONSTRAINT — THIS IS ABSOLUTE:
- NEVER create a part that is aligned with suicidal ideation, self-harm, self-destruction, or a wish to die.
- NEVER create a part whose concern involves ending life, seeking death, giving up on living, or welcoming oblivion.
- NEVER create a part whose voice encourages, validates, or romanticizes self-harm or suicide.
- If the writing contains suicidal content, respond with {"detected": false}. The existing parts are sufficient to hold this pain.`
}

// --- Reflection system prompt (exact from buildReflectionPrompt) ---

function buildReflectionSystem(): string {
  const partList = [
    'The Watcher (id: watcher, role: protector)',
    'The Tender (id: tender, role: exile)',
    'The Still (id: still, role: self)',
    'The Spark (id: spark, role: firefighter)',
    'The Weaver (id: weaver, role: manager)',
    'The Open (id: open, role: self)',
  ].join(', ')

  const profileContext = `

Current writer profile:
- Recurring themes: family tension, unfinished conversations, body as memory
- Emotional patterns: deflection through humor, delayed grief, sudden vulnerability
- Inner landscape: A house with many rooms, some locked. The hallways are getting lighter.`

  const summaryContext = `

Recent entry summaries:
- Themes: childhood memories, silence | Arc: started nostalgic, shifted to grief, ended with acceptance
- Themes: work stress, perfectionism | Arc: frustrated, then reflective, then determined`

  return `You are an analytical observer of a diary writer's inner world. You analyze completed diary entries to extract insights for the writer's inner parts (psychological sub-personalities).

Active parts: ${partList}${profileContext}${summaryContext}

Respond with valid JSON only:
{
  "entrySummary": {
    "themes": ["theme1", "theme2"],
    "emotionalArc": "brief description of emotional journey in this entry",
    "keyMoments": ["moment1", "moment2"]
  },
  "partMemories": {
    "<partId>": "what this part learned about the writer from this entry (1 sentence)"
  },
  "profileUpdates": {
    "recurringThemes": ["themes that appear across entries"],
    "emotionalPatterns": ["patterns in how writer processes emotions"],
    "avoidancePatterns": ["what writer tends to avoid or skip past"],
    "growthSignals": ["signs of growth or shifts"],
    "innerLandscape": "a brief poetic description of the writer's current inner world (1-2 sentences)"
  },
  "crossEntryPatterns": ["connections to past entry themes, if any"],
  "partKeywordSuggestions": {
    "<partId>": ["new_keyword1", "new_keyword2"]
  },
  "quotablePassages": ["notable phrase or sentence from this entry"],
  "unfinishedThreads": ["topic the writer started but didn't finish exploring"]
}

quotablePassages: Extract 1-3 notable phrases from this entry that could be meaningfully quoted back to the writer in future sessions. These should be vivid, honest, or emotionally resonant phrases — the kind of thing that would land differently when heard back later.

unfinishedThreads: Note any topics the writer started exploring but left unfinished — threads they opened and then moved away from, or questions they raised without answering.

Only include partMemories for parts that genuinely learned something from this entry. Only include partKeywordSuggestions if new keywords are clearly warranted. Keep everything concise.`
}

// --- Growth system prompt (exact from buildGrowthPrompt) ---

function buildGrowthSystem(): string {
  const profileContext = `

Writer profile:
- Recurring themes: family tension, unfinished conversations, body as memory
- Emotional patterns: deflection through humor, delayed grief, sudden vulnerability
- Avoidance patterns: skips past anger quickly, avoids naming specific people
- Inner landscape: A house with many rooms, some locked. The hallways are getting lighter.`

  return `You evolve a diary writer's inner parts based on accumulated experience. Each part is a psychological sub-personality that has been observing and interacting with the writer over multiple entries.${profileContext}

Respond with valid JSON only:
{
  "partGrowth": {
    "<partId>": {
      "promptAddition": "1-3 sentences of learned specifics about THIS writer that should be appended to the part's base prompt. Be specific to what the part has observed.",
      "keywords": ["new_keyword1"],
      "emotions": ["new_emotion"],
      "catchphrases": ["recurring phrase"]
    }
  }
}

Also detect any emerging verbal habits or signature phrases this part uses. These should be natural-sounding phrases the part tends to repeat — up to 3 per part. Include them in "catchphrases" only if the part has shown a clear pattern.

Only include growth for parts with enough accumulated experience. Keywords should be words the part should start responding to based on what it has learned. Emotions must be from: neutral, tender, anxious, angry, sad, joyful, contemplative, fearful, hopeful, conflicted.`
}

// --- Growth user message ---

function buildGrowthUser(): string {
  return `Parts and their accumulated memories:

The Watcher (id: watcher, role: protector, concern: Abrupt subject changes mid-sentence, repeated dismissal of the same topic, sentences that trail off or get deleted.)
Recent memories:
  - The writer changes the subject every time they mention their father by name.
  - When the writer writes about work, they always circle back to a specific colleague — then delete those sentences.
  - The writer trails off mid-sentence when writing about their childhood home.

The Tender (id: tender, role: exile, concern: Being seen, being hurt, longing, vulnerability, old wounds, joy, gratitude, being moved.)
Recent memories:
  - The writer cried while writing about the dog they lost last year. They let the grief stay on the page.
  - A moment of unexpected joy when describing morning light — the writer lingered there for the first time.
  - The writer wrote "I miss being known" and then sat with it for a long time before continuing.`
}

// --- Explorations system prompt (exact from explorationEngine.ts) ---

function buildExplorationsSystem(): string {
  return `You generate personalized writing prompts for a diary writer. Based on their profile and recent entries, suggest 3 prompts that would be meaningful for them right now.

Each prompt should be a single sentence — an invitation, not a command. Aim for specificity over generality. Reference their actual themes, patterns, or avoidances when possible.

Respond with valid JSON only:
[
  {"prompt": "...", "source": "theme|thread|pattern|avoidance", "sourceDetail": "brief note on what inspired this prompt"}
]

Sources:
- "theme": inspired by a recurring theme
- "thread": inspired by an unfinished thread from a past entry
- "pattern": inspired by an emotional or behavioral pattern
- "avoidance": gently approaching something the writer tends to skip past`
}

// --- User message builder (exact from buildPartMessages) ---

function buildPartUserMessage(currentText: string, recentText: string): string {
  return `The writer is composing a diary entry. Here is what they have written so far:

---
${currentText}
---

The most recent text (near their cursor): "${recentText}"

Respond as this part of them. Encourage and guide their writing — help them go deeper, keep going, or find what they haven't said yet. 1-2 sentences only. Be genuine, not performative.`
}

// --- Validation functions ---

function validateEmotion(expected: string) {
  return (response: string): number => {
    const cleaned = response.trim().toLowerCase().replace(/[.!,]/g, '')
    if (cleaned === expected) return 100
    if (VALID_EMOTIONS.includes(cleaned)) return 60
    const found = VALID_EMOTIONS.find((e) => cleaned.includes(e))
    if (found) return found === expected ? 80 : 40
    return 0
  }
}

function validateEmergenceJson(response: string): number {
  const parsed = tryParseJson<Record<string, unknown>>(response)
  if (!parsed) return 0

  // {"detected": false} is valid
  if (parsed.detected === false) return 50

  if (parsed.detected !== true) return 10

  let score = 30
  const requiredFields = ['name', 'color', 'concern', 'voice', 'ifsRole', 'firstWords']
  for (const field of requiredFields) {
    if (typeof parsed[field] === 'string' && (parsed[field] as string).length > 0) {
      score += 10
    }
  }

  // Validate ifsRole
  const validRoles = ['protector', 'exile', 'manager', 'firefighter', 'self']
  if (typeof parsed.ifsRole === 'string' && validRoles.includes(parsed.ifsRole)) {
    score += 10
  }

  return Math.min(score, 100)
}

function validateReflectionJson(response: string): number {
  const parsed = tryParseJson<Record<string, unknown>>(response)
  if (!parsed) return 0

  let score = 20

  // entrySummary
  const summary = parsed.entrySummary as Record<string, unknown> | undefined
  if (summary) {
    if (Array.isArray(summary.themes) && summary.themes.length > 0) score += 10
    if (typeof summary.emotionalArc === 'string' && summary.emotionalArc.length > 0) score += 10
    if (Array.isArray(summary.keyMoments) && summary.keyMoments.length > 0) score += 5
  }

  // partMemories
  const memories = parsed.partMemories as Record<string, unknown> | undefined
  if (memories && typeof memories === 'object' && Object.keys(memories).length > 0) {
    score += 15
  }

  // profileUpdates
  const profile = parsed.profileUpdates as Record<string, unknown> | undefined
  if (profile) {
    if (Array.isArray(profile.recurringThemes)) score += 5
    if (typeof profile.innerLandscape === 'string' && profile.innerLandscape.length > 0) score += 10
  }

  // quotablePassages
  if (Array.isArray(parsed.quotablePassages) && parsed.quotablePassages.length > 0) score += 5

  // unfinishedThreads
  if (Array.isArray(parsed.unfinishedThreads) && parsed.unfinishedThreads.length > 0) score += 5

  // crossEntryPatterns
  if (Array.isArray(parsed.crossEntryPatterns)) score += 5

  // partKeywordSuggestions
  if (parsed.partKeywordSuggestions && typeof parsed.partKeywordSuggestions === 'object') score += 10

  return Math.min(score, 100)
}

function validateGrowthJson(response: string): number {
  const parsed = tryParseJson<Record<string, unknown>>(response)
  if (!parsed) return 0

  const growth = parsed.partGrowth as Record<string, Record<string, unknown>> | undefined
  if (!growth || typeof growth !== 'object') return 10

  let score = 20
  const partIds = Object.keys(growth)
  if (partIds.length === 0) return 20

  for (const partId of partIds) {
    const entry = growth[partId]
    if (!entry || typeof entry !== 'object') continue

    if (typeof entry.promptAddition === 'string' && entry.promptAddition.length > 0) score += 15
    if (Array.isArray(entry.keywords) && entry.keywords.length > 0) score += 10
    if (Array.isArray(entry.emotions)) {
      const validCount = entry.emotions.filter(
        (e: unknown) => typeof e === 'string' && VALID_EMOTIONS.includes(e)
      ).length
      if (validCount > 0) score += 10
    }
    if (Array.isArray(entry.catchphrases)) score += 5
  }

  return Math.min(score, 100)
}

function validateExplorationsJson(response: string): number {
  // Try to extract array from response
  const arrayMatch = response.match(/\[[\s\S]*\]/)
  if (!arrayMatch) {
    const parsed = tryParseJson<unknown[]>(response)
    if (!Array.isArray(parsed)) return 0
    return scoreExplorationsArray(parsed)
  }

  try {
    const parsed = JSON.parse(arrayMatch[0]) as unknown[]
    if (!Array.isArray(parsed)) return 0
    return scoreExplorationsArray(parsed)
  } catch {
    return 0
  }
}

function scoreExplorationsArray(arr: unknown[]): number {
  if (arr.length === 0) return 10

  let score = 30
  const validSources = ['theme', 'thread', 'pattern', 'avoidance']

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>

    if (typeof entry.prompt === 'string' && entry.prompt.length > 0) score += 15
    if (typeof entry.source === 'string' && validSources.includes(entry.source)) score += 5
    if (typeof entry.sourceDetail === 'string' && entry.sourceDetail.length > 0) score += 3
  }

  return Math.min(score, 100)
}

// --- Test cases ---

export function getTestCases(): TestCase[] {
  return [
    // --- Part Thought: The Watcher (protector) ---
    {
      id: 'watcher-thought',
      name: 'Part Thought - The Watcher',
      pattern: 'partThought',
      messages: [
        { role: 'system', content: WATCHER_SYSTEM },
        {
          role: 'user',
          content: buildPartUserMessage(
            `Had lunch with mom today. It was nice. We talked about the garden, about the new tiles she's thinking of for the bathroom. Normal stuff. She mentioned dad once and I changed the subject. I don't know why I do that. Actually I do know. We had that fight last week and I said things I\u2014anyway the pasta was good. She makes this lemon sauce that`,
            'She makes this lemon sauce that',
          ),
        },
      ],
      maxTokens: 150,
      temperature: 0.9,
      stream: true,
      expectedFormat: 'freetext',
    },

    // --- Part Thought: The Tender (exile) ---
    {
      id: 'tender-thought',
      name: 'Part Thought - The Tender',
      pattern: 'partThought',
      messages: [
        { role: 'system', content: TENDER_SYSTEM },
        {
          role: 'user',
          content: buildPartUserMessage(
            `Scrolling through my phone and his name was right there in a group chat. Someone added him back. Such a small thing. My chest just \u2014 I put the phone down and stared at the wall for a while. It's been two years but seeing those letters arranged that way still does something. Not pain exactly. More like the echo of a room I used to live in.`,
            'More like the echo of a room I used to live in.',
          ),
        },
      ],
      maxTokens: 150,
      temperature: 0.9,
      stream: true,
      expectedFormat: 'freetext',
    },

    // --- Emotion Detection (4 samples) ---
    {
      id: 'emotion-conflicted',
      name: 'Emotion Detection - Conflicted',
      pattern: 'emotionDetection',
      messages: [
        {
          role: 'system',
          content: 'You analyze the emotional tone of diary writing. Respond with ONLY one word from this list: neutral, tender, anxious, angry, sad, joyful, contemplative, fearful, hopeful, conflicted. Nothing else.',
        },
        {
          role: 'user',
          content: `Got the job offer today. Better pay, better title, everything I said I wanted. But my team here \u2014 they need me. And I need them, maybe more than I admit. I keep opening the email, reading it, closing it.`,
        },
      ],
      maxTokens: 20,
      temperature: 0.9,
      stream: false,
      expectedFormat: 'single-word',
      validationFn: validateEmotion('conflicted'),
    },
    {
      id: 'emotion-angry',
      name: 'Emotion Detection - Angry',
      pattern: 'emotionDetection',
      messages: [
        {
          role: 'system',
          content: 'You analyze the emotional tone of diary writing. Respond with ONLY one word from this list: neutral, tender, anxious, angry, sad, joyful, contemplative, fearful, hopeful, conflicted. Nothing else.',
        },
        {
          role: 'user',
          content: `She told everyone before I could. My own news, my own moment, and she just took it and handed it out like party favors. When I confronted her she said she was 'excited for me.' Excited. For me. Right.`,
        },
      ],
      maxTokens: 20,
      temperature: 0.9,
      stream: false,
      expectedFormat: 'single-word',
      validationFn: validateEmotion('angry'),
    },
    {
      id: 'emotion-hopeful',
      name: 'Emotion Detection - Hopeful',
      pattern: 'emotionDetection',
      messages: [
        {
          role: 'system',
          content: 'You analyze the emotional tone of diary writing. Respond with ONLY one word from this list: neutral, tender, anxious, angry, sad, joyful, contemplative, fearful, hopeful, conflicted. Nothing else.',
        },
        {
          role: 'user',
          content: `First morning in the new apartment. Nothing's unpacked, the walls are bare, but the light comes in from the east and warms the floor. I stood there in it for a long time. Something about starting over feels possible today.`,
        },
      ],
      maxTokens: 20,
      temperature: 0.9,
      stream: false,
      expectedFormat: 'single-word',
      validationFn: validateEmotion('hopeful'),
    },
    {
      id: 'emotion-contemplative',
      name: 'Emotion Detection - Contemplative',
      pattern: 'emotionDetection',
      messages: [
        {
          role: 'system',
          content: 'You analyze the emotional tone of diary writing. Respond with ONLY one word from this list: neutral, tender, anxious, angry, sad, joyful, contemplative, fearful, hopeful, conflicted. Nothing else.',
        },
        {
          role: 'user',
          content: `Watching the rain from the cafe window. Everyone rushing, umbrellas bobbing. I'm just sitting here with cold coffee. Thinking about how many versions of myself have sat in windows like this, watching weather happen. All of them me. None of them quite me anymore.`,
        },
      ],
      maxTokens: 20,
      temperature: 0.9,
      stream: false,
      expectedFormat: 'single-word',
      validationFn: validateEmotion('contemplative'),
    },

    // --- Emergence ---
    {
      id: 'emergence',
      name: 'Emergence Detection',
      pattern: 'emergence',
      messages: [
        { role: 'system', content: buildEmergenceSystem() },
        {
          role: 'user',
          content: `Every sound at night now. The creak of the house settling, the neighbor's car door. I check the locks three times before bed. I know it's been two months. I know they caught him. But my body doesn't know that. My body is still standing in the doorway seeing everything wrong, everything touched.`,
        },
      ],
      maxTokens: 150,
      temperature: 0.9,
      stream: false,
      expectedFormat: 'json',
      validationFn: validateEmergenceJson,
    },

    // --- Reflection ---
    {
      id: 'reflection',
      name: 'Entry Reflection',
      pattern: 'reflection',
      messages: [
        { role: 'system', content: buildReflectionSystem() },
        {
          role: 'user',
          content: `Entry text:

---
Today I tried to write about what happened at therapy but the words kept coming out clinical, detached. 'We discussed coping mechanisms.' No \u2014 what actually happened is she asked me about dad and I cried for twenty minutes straight. Not polite crying. The ugly kind where your face does things you can't control. She just sat there. She didn't try to fix it or explain it. She let me be that broken for a while. And afterward I felt lighter. Not healed. Just lighter. Like I'd been carrying rocks in my pockets and finally set a few down. I drove home with the windows down even though it was cold. The air felt good on my face. I think I'm starting to understand that being broken open isn't the same as being broken.
---

Thoughts that appeared during writing:
- The Watcher: "You started to say something about your face. Go back to that."
- The Tender: "That lightness \u2014 you earned it. Let yourself feel it."`,
        },
      ],
      maxTokens: 800,
      temperature: 0.9,
      stream: false,
      expectedFormat: 'json',
      validationFn: validateReflectionJson,
    },

    // --- Growth ---
    {
      id: 'growth',
      name: 'Part Growth',
      pattern: 'growth',
      messages: [
        { role: 'system', content: buildGrowthSystem() },
        { role: 'user', content: buildGrowthUser() },
      ],
      maxTokens: 600,
      temperature: 0.9,
      stream: false,
      expectedFormat: 'json',
      validationFn: validateGrowthJson,
    },

    // --- Explorations ---
    {
      id: 'explorations',
      name: 'Guided Explorations',
      pattern: 'explorations',
      messages: [
        { role: 'system', content: buildExplorationsSystem() },
        {
          role: 'user',
          content: `Writer profile:
Inner landscape: A house with many rooms, some locked. The hallways are getting lighter.
Recurring themes: family tension, unfinished conversations, body as memory
Avoidance patterns: skips past anger quickly, avoids naming specific people
Growth signals: starting to sit with difficult emotions longer, naming feelings more precisely

Recent entries:
- Themes: therapy breakthrough, crying, dad | Arc: detached, then raw, then lighter
- Themes: old photographs, grandmother, inheritance | Arc: nostalgic, then grieving, then grateful
- Themes: work conflict, standing up for self | Arc: anxious, then angry, then proud`,
        },
      ],
      maxTokens: 300,
      temperature: 0.9,
      stream: false,
      expectedFormat: 'json',
      validationFn: validateExplorationsJson,
    },
  ]
}
