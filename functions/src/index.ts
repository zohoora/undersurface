import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

initializeApp()

const openRouterKey = defineSecret('OPENROUTER_API_KEY')
const ADMIN_EMAILS = ['zohoora@gmail.com']

const ALLOWED_ORIGINS = [
  'https://undersurface.me',
  'https://undersurfaceme.web.app',
  'https://undersurfaceme.firebaseapp.com',
]

// ─── Chat API guardrails ──────────────────────────────────

const ALLOWED_MODEL_PREFIXES = [
  'google/gemini',
  'anthropic/claude',
  'meta-llama/',
  'mistralai/',
  'openai/gpt',
  'qwen/',
  'deepseek/',
]

const MAX_TOKENS_CAP = 500
const MAX_MESSAGE_CHARS = 8000 // per-message content length cap
const MAX_MESSAGES = 50 // max messages per request

// Best-effort per-instance rate limiter (not shared across Cloud Function instances)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30 // requests per minute per uid

function checkRateLimit(uid: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(uid)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(uid, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= RATE_LIMIT_MAX
}

function isModelAllowed(model: string): boolean {
  return ALLOWED_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix))
}

export const chat = onRequest(
  {
    secrets: [openRouterKey],
    cors: ALLOWED_ORIGINS,
    memory: '512MiB',
    minInstances: 1,
    region: 'us-central1',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    // Verify Firebase auth token
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing auth token' })
      return
    }

    let uid: string
    try {
      const decoded = await getAuth().verifyIdToken(authHeader.split('Bearer ')[1])
      uid = decoded.uid
    } catch {
      res.status(401).json({ error: 'Invalid auth token' })
      return
    }

    // Rate limit
    if (!checkRateLimit(uid)) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment.' })
      return
    }

    // Validate request body
    const { messages, model, max_tokens, temperature, stream, frequency_penalty } = req.body || {}
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Invalid messages' })
      return
    }

    if (messages.length > MAX_MESSAGES) {
      res.status(400).json({ error: `Too many messages (max ${MAX_MESSAGES})` })
      return
    }

    for (const msg of messages) {
      if (typeof msg.role !== 'string' || typeof msg.content !== 'string') {
        res.status(400).json({ error: 'Invalid message format' })
        return
      }
      // Only enforce length limit on user-authored messages — system/assistant
      // prompts are built by the app and legitimately exceed 8k chars
      if (msg.role === 'user' && msg.content.length > MAX_MESSAGE_CHARS) {
        res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_CHARS} chars)` })
        return
      }
    }

    const resolvedModel = model || 'google/gemini-3-flash-preview'
    if (!isModelAllowed(resolvedModel)) {
      res.status(400).json({ error: `Model not allowed: ${resolvedModel}` })
      return
    }

    const resolvedMaxTokens = Math.min(
      typeof max_tokens === 'number' && max_tokens > 0 ? max_tokens : 150,
      MAX_TOKENS_CAP,
    )
    console.log(`uid=${uid.slice(0, 8)} model=${resolvedModel} stream=${!!stream} max_tokens=${resolvedMaxTokens}`)

    const openRouterResponse = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey.value()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://undersurface.me',
          'X-Title': 'UnderSurface',
        },
        body: JSON.stringify({
          model: resolvedModel,
          messages,
          max_tokens: resolvedMaxTokens,
          temperature: typeof temperature === 'number' ? Math.min(temperature, 2) : 0.9,
          frequency_penalty: typeof frequency_penalty === 'number' ? Math.min(Math.max(frequency_penalty, 0), 2) : undefined,
          stream: !!stream,
        }),
      },
    )

    if (!openRouterResponse.ok) {
      const errorBody = await openRouterResponse.text().catch(() => '')
      console.error(`OpenRouter error: ${openRouterResponse.status}`, errorBody)
      res.status(openRouterResponse.status).json({
        error: 'AI service temporarily unavailable',
      })
      return
    }

    if (stream && openRouterResponse.body) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('X-Accel-Buffering', 'no')

      const MAX_STREAM_BYTES = 1_048_576 // 1 MiB safety cap
      let totalBytes = 0
      const reader = openRouterResponse.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          totalBytes += value.byteLength
          if (totalBytes > MAX_STREAM_BYTES) {
            console.warn(`Stream exceeded ${MAX_STREAM_BYTES} bytes for uid=${uid.slice(0, 8)}, aborting`)
            break
          }
          res.write(value)
        }
      } finally {
        res.end()
      }
    } else {
      const data = await openRouterResponse.json()
      res.json(data)
    }
  },
)

// ─── Admin API ────────────────────────────────────────────────

async function verifyAdmin(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  try {
    const decoded = await getAuth().verifyIdToken(authHeader.split('Bearer ')[1])
    if (decoded.email && ADMIN_EMAILS.includes(decoded.email)) return decoded.email
    return null
  } catch {
    return null
  }
}

async function getCollectionDocs(uid: string, name: string) {
  const snap = await getFirestore().collection('users').doc(uid).collection(name).get()
  return snap.docs.map((d) => d.data())
}

async function getCollectionCount(uid: string, name: string): Promise<number> {
  const snap = await getFirestore().collection('users').doc(uid).collection(name).count().get()
  return snap.data().count
}

// Paginate through all Firebase Auth users (listUsers returns max 1000 per call)
async function getAllUsers() {
  const allUsers: import('firebase-admin/auth').UserRecord[] = []
  let pageToken: string | undefined
  do {
    const result = await getAuth().listUsers(1000, pageToken)
    allUsers.push(...result.users)
    pageToken = result.pageToken
  } while (pageToken)
  return allUsers
}

async function handleGetOverview() {
  // Always get live user count from Firebase Auth
  const allAuthUsers = await getAllUsers()
  const userCount = allAuthUsers.length

  // Read cached totals from appConfig/analytics (1 read instead of N user scans)
  const analyticsSnap = await getFirestore().collection('appConfig').doc('analytics').get()
  const cached = analyticsSnap.exists ? analyticsSnap.data() : null

  const totalEntries = (cached?.totalEntries as number) || 0
  const totalThoughts = (cached?.totalThoughts as number) || 0
  const totalInteractions = (cached?.totalInteractions as number) || 0
  const refreshedAt = cached?.refreshedAt as number | undefined

  // Rich metrics from cache (populated by computeAndCacheAnalytics)
  const writingHabits = cached?.writingHabits || null
  const emotionalLandscape = cached?.emotionalLandscape || null
  const featureAdoption = cached?.featureAdoption || null

  // Recent activity via collection group query (bounded, fast)
  const recentSnap = await getFirestore()
    .collectionGroup('entries')
    .orderBy('updatedAt', 'desc')
    .limit(10)
    .get()

  // Collect unique user IDs from doc paths
  const userIds = new Set<string>()
  const rawActivity: Array<{ uid: string; entryId: string; preview: string; updatedAt: number }> = []
  for (const doc of recentSnap.docs) {
    const uid = doc.ref.parent.parent!.id
    userIds.add(uid)
    const data = doc.data()
    rawActivity.push({
      uid,
      entryId: (data.id as string) || doc.id,
      preview: ((data.plainText as string) || '').slice(0, 100),
      updatedAt: (data.updatedAt as number) || 0,
    })
  }

  // Batch-fetch display names from Auth
  const displayNames: Record<string, string> = {}
  const uidList = [...userIds]
  if (uidList.length > 0) {
    const userRecords = await getAuth().getUsers(uidList.map((uid) => ({ uid })))
    for (const user of userRecords.users) {
      displayNames[user.uid] = user.displayName || user.email || 'Unknown'
    }
  }

  const recentActivity = rawActivity.map((item) => ({
    ...item,
    displayName: displayNames[item.uid] || 'Unknown',
  }))

  return {
    userCount,
    totalEntries,
    totalThoughts,
    totalInteractions,
    recentActivity,
    refreshedAt,
    writingHabits,
    emotionalLandscape,
    featureAdoption,
  }
}

async function handleGetUserList() {
  const allAuthUsers = await getAllUsers()
  const users = []

  for (const user of allAuthUsers) {
    const [entryCount, thoughtCount, interactionCount, partCount, sessionCount] = await Promise.all([
      getCollectionCount(user.uid, 'entries'),
      getCollectionCount(user.uid, 'thoughts'),
      getCollectionCount(user.uid, 'interactions'),
      getCollectionCount(user.uid, 'parts'),
      getCollectionCount(user.uid, 'sessionLog'),
    ])

    // Get total words and last active from entries
    const entries = await getFirestore()
      .collection('users').doc(user.uid).collection('entries')
      .get()

    let totalWords = 0
    let lastActive: number | null = null
    for (const doc of entries.docs) {
      const data = doc.data()
      const text = data.plainText || ''
      totalWords += text.split(/\s+/).filter((w: string) => w.length > 0).length
      const updated = data.updatedAt || 0
      if (!lastActive || updated > lastActive) lastActive = updated
    }

    users.push({
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || null,
      entryCount,
      thoughtCount,
      interactionCount,
      partCount,
      sessionCount,
      totalWords,
      lastActive,
      createdAt: new Date(user.metadata.creationTime).getTime(),
    })
  }

  return { users }
}

async function handleGetUserDetail(uid: string) {
  // Get user info from Auth
  const userRecord = await getAuth().getUser(uid)

  const [entries, parts, thoughts, interactions, memories, entrySummaries, userProfileDocs, sessionLog, innerWeather, letters, fossils] =
    await Promise.all([
      getCollectionDocs(uid, 'entries'),
      getCollectionDocs(uid, 'parts'),
      getCollectionDocs(uid, 'thoughts'),
      getCollectionDocs(uid, 'interactions'),
      getCollectionDocs(uid, 'memories'),
      getCollectionDocs(uid, 'entrySummaries'),
      getCollectionDocs(uid, 'userProfile'),
      getCollectionDocs(uid, 'sessionLog'),
      getCollectionDocs(uid, 'innerWeather'),
      getCollectionDocs(uid, 'letters'),
      getCollectionDocs(uid, 'fossils'),
    ])

  // Compute counts and words from raw entries
  let totalWords = 0
  let lastActive: number | null = null
  for (const entry of entries) {
    const text = (entry.plainText as string) || ''
    totalWords += text.split(/\s+/).filter((w: string) => w.length > 0).length
    const updated = (entry.updatedAt as number) || 0
    if (!lastActive || updated > lastActive) lastActive = updated
  }

  return {
    user: {
      uid: userRecord.uid,
      email: userRecord.email || '',
      displayName: userRecord.displayName || '',
      photoURL: userRecord.photoURL || null,
      entryCount: entries.length,
      thoughtCount: thoughts.length,
      interactionCount: interactions.length,
      partCount: parts.length,
      sessionCount: sessionLog.length,
      totalWords,
      lastActive,
      createdAt: new Date(userRecord.metadata.creationTime).getTime(),
    },
    entries: entries.map((e) => ({
      id: e.id,
      plainText: e.plainText || '',
      createdAt: e.createdAt || 0,
      updatedAt: e.updatedAt || 0,
    })),
    parts: parts.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      colorLight: p.colorLight,
      ifsRole: p.ifsRole,
      concern: p.concern,
      isSeeded: p.isSeeded,
      learnedKeywords: p.learnedKeywords,
      learnedEmotions: p.learnedEmotions,
      systemPromptAddition: p.systemPromptAddition,
      growthVersion: p.growthVersion,
    })),
    thoughts: thoughts.map((t) => ({
      id: t.id,
      partId: t.partId,
      entryId: t.entryId,
      content: t.content,
      timestamp: t.timestamp || 0,
    })),
    interactions: interactions.map((i) => ({
      id: i.id,
      partId: i.partId,
      entryId: i.entryId,
      partOpening: i.partOpening,
      userResponse: i.userResponse,
      partReply: i.partReply,
      status: i.status,
      timestamp: i.timestamp || 0,
    })),
    memories: memories.map((m) => ({
      id: m.id,
      partId: m.partId,
      entryId: m.entryId,
      content: m.content,
      type: m.type,
      timestamp: m.timestamp || 0,
    })),
    userProfile: userProfileDocs.length > 0 ? userProfileDocs[0] : null,
    entrySummaries: entrySummaries.map((s) => ({
      id: s.id,
      entryId: s.entryId,
      themes: s.themes,
      emotionalArc: s.emotionalArc,
      keyMoments: s.keyMoments,
      timestamp: s.timestamp || 0,
    })),
    sessions: sessionLog.map((s) => ({
      id: s.id,
      startedAt: s.startedAt || 0,
      endedAt: s.endedAt,
      duration: s.duration,
      wordCount: s.wordCount || 0,
      timeOfDay: s.timeOfDay || '',
      dayOfWeek: s.dayOfWeek ?? 0,
    })),
    weather: innerWeather.map((w) => ({
      id: w.id,
      dominantEmotion: w.dominantEmotion || '',
      secondaryEmotion: w.secondaryEmotion,
      intensity: w.intensity ?? 0,
      trend: w.trend || 'steady',
      updatedAt: w.updatedAt || 0,
    })),
    letters: letters.map((l) => ({
      id: l.id,
      partIds: l.partIds || [],
      content: l.content || '',
      triggerType: l.triggerType || 'milestone',
      createdAt: l.createdAt || 0,
      isRead: l.isRead ?? false,
    })),
    fossils: fossils.map((f) => ({
      id: f.id,
      entryId: f.entryId || '',
      partId: f.partId || '',
      commentary: f.commentary || '',
      createdAt: f.createdAt || 0,
    })),
  }
}

// Full analytics computation — expensive, writes result to appConfig/analytics
async function computeAndCacheAnalytics() {
  const users = await getAllUsers()

  const now = Date.now()
  const oneDay = 24 * 60 * 60 * 1000
  const oneWeek = 7 * oneDay
  const oneMonth = 30 * oneDay

  let dailyActive = 0
  let weeklyActive = 0
  let monthlyActive = 0
  let totalEntries = 0
  let totalWords = 0
  let totalThoughts = 0
  let totalInteractions = 0

  // Signup tracking by week (last 12 weeks)
  const signupBuckets: Record<string, number> = {}
  // Entry tracking by day (last 14 days)
  const entryBuckets: Record<string, number> = {}
  // Part usage tracking
  const partThoughtCounts: Record<string, { name: string; color: string; count: number }> = {}

  // Rich metrics accumulators
  let totalSessions = 0
  let totalSessionDuration = 0
  let sessionsWithDuration = 0
  const hourBuckets: Record<number, number> = {}
  const emotionCounts: Record<string, number> = {}
  let totalIntensity = 0
  let weatherEntries = 0
  let usersWithWeather = 0
  let usersWithProfile = 0
  let usersWithLetters = 0
  let usersWithFossils = 0
  let totalParts = 0

  for (const user of users) {
    // Track signups by week
    const createdAt = new Date(user.metadata.creationTime).getTime()
    if (now - createdAt < 12 * oneWeek) {
      const weekStart = new Date(createdAt)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      const weekKey = weekStart.toISOString().split('T')[0]
      signupBuckets[weekKey] = (signupBuckets[weekKey] || 0) + 1
    }

    // Get entries for activity + word count
    const [entriesSnap, thoughtCount, interactionCount] = await Promise.all([
      getFirestore().collection('users').doc(user.uid).collection('entries').get(),
      getCollectionCount(user.uid, 'thoughts'),
      getCollectionCount(user.uid, 'interactions'),
    ])

    totalThoughts += thoughtCount
    totalInteractions += interactionCount

    let userLastActive = 0
    for (const doc of entriesSnap.docs) {
      const data = doc.data()
      totalEntries++
      const text = (data.plainText as string) || ''
      totalWords += text.split(/\s+/).filter((w: string) => w.length > 0).length
      const updatedAt = (data.updatedAt as number) || 0
      if (updatedAt > userLastActive) userLastActive = updatedAt

      // Track entries by day (last 14 days)
      const entryCreated = (data.createdAt as number) || 0
      if (now - entryCreated < 14 * oneDay) {
        const dayKey = new Date(entryCreated).toISOString().split('T')[0]
        entryBuckets[dayKey] = (entryBuckets[dayKey] || 0) + 1
      }
    }

    if (now - userLastActive < oneDay) dailyActive++
    if (now - userLastActive < oneWeek) weeklyActive++
    if (now - userLastActive < oneMonth) monthlyActive++

    // Get parts for this user
    const partsSnap = await getFirestore()
      .collection('users').doc(user.uid).collection('parts')
      .get()
    totalParts += partsSnap.docs.length
    const partMap: Record<string, { name: string; color: string }> = {}
    for (const doc of partsSnap.docs) {
      const data = doc.data()
      partMap[data.id as string] = { name: data.name as string, color: data.color as string }
    }

    // Count thoughts per part
    const thoughtsSnap = await getFirestore()
      .collection('users').doc(user.uid).collection('thoughts')
      .get()
    for (const doc of thoughtsSnap.docs) {
      const partId = doc.data().partId as string
      const part = partMap[partId]
      if (part) {
        if (!partThoughtCounts[part.name]) {
          partThoughtCounts[part.name] = { name: part.name, color: part.color, count: 0 }
        }
        partThoughtCounts[part.name].count++
      }
    }

    // Session logs
    const sessionsSnap = await getFirestore()
      .collection('users').doc(user.uid).collection('sessionLog')
      .get()
    totalSessions += sessionsSnap.docs.length
    for (const doc of sessionsSnap.docs) {
      const data = doc.data()
      if (data.duration && typeof data.duration === 'number') {
        totalSessionDuration += data.duration
        sessionsWithDuration++
      }
      const startedAt = data.startedAt as number
      if (startedAt) {
        const hour = new Date(startedAt).getHours()
        hourBuckets[hour] = (hourBuckets[hour] || 0) + 1
      }
    }

    // Inner weather
    const weatherSnap = await getFirestore()
      .collection('users').doc(user.uid).collection('innerWeather')
      .get()
    if (weatherSnap.docs.length > 0) usersWithWeather++
    for (const doc of weatherSnap.docs) {
      const data = doc.data()
      const emotion = data.dominantEmotion as string
      if (emotion) {
        emotionCounts[emotion] = (emotionCounts[emotion] || 0) + 1
      }
      if (typeof data.intensity === 'number') {
        totalIntensity += data.intensity
        weatherEntries++
      }
    }

    // Feature adoption checks
    const [profileCount, letterCount, fossilCount] = await Promise.all([
      getCollectionCount(user.uid, 'userProfile'),
      getCollectionCount(user.uid, 'letters'),
      getCollectionCount(user.uid, 'fossils'),
    ])
    if (profileCount > 0) usersWithProfile++
    if (letterCount > 0) usersWithLetters++
    if (fossilCount > 0) usersWithFossils++
  }

  // Build sorted arrays
  const signupsByWeek = Object.entries(signupBuckets)
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week))

  const entriesByDay = Object.entries(entryBuckets)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const partUsage = Object.values(partThoughtCounts)
    .sort((a, b) => b.count - a.count)

  // Find peak writing hour
  let peakWritingHour: number | null = null
  let peakHourCount = 0
  for (const [hour, count] of Object.entries(hourBuckets)) {
    if (count > peakHourCount) {
      peakHourCount = count
      peakWritingHour = parseInt(hour)
    }
  }

  // Top emotions
  const topEmotions = Object.entries(emotionCounts)
    .map(([emotion, count]) => ({ emotion, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const userCount = users.length

  const result = {
    userCount,
    totalEntries,
    totalThoughts,
    totalInteractions,
    activeUsers: { daily: dailyActive, weekly: weeklyActive, monthly: monthlyActive },
    signupsByWeek,
    entriesByDay,
    partUsage,
    averageWordsPerEntry: totalEntries > 0 ? Math.round(totalWords / totalEntries) : 0,
    averageEntriesPerUser: userCount > 0 ? Math.round((totalEntries / userCount) * 10) / 10 : 0,
    totalWords,
    writingHabits: {
      totalSessions,
      avgSessionDuration: sessionsWithDuration > 0 ? Math.round(totalSessionDuration / sessionsWithDuration) : 0,
      avgSessionsPerUser: userCount > 0 ? Math.round((totalSessions / userCount) * 10) / 10 : 0,
      peakWritingHour,
    },
    emotionalLandscape: {
      topEmotions,
      weatherAdoptionPercent: userCount > 0 ? Math.round((usersWithWeather / userCount) * 100) : 0,
      avgIntensity: weatherEntries > 0 ? Math.round((totalIntensity / weatherEntries) * 10) / 10 : 0,
    },
    featureAdoption: {
      profileAdoptionPercent: userCount > 0 ? Math.round((usersWithProfile / userCount) * 100) : 0,
      letterAdoptionPercent: userCount > 0 ? Math.round((usersWithLetters / userCount) * 100) : 0,
      fossilAdoptionPercent: userCount > 0 ? Math.round((usersWithFossils / userCount) * 100) : 0,
      avgPartsPerUser: userCount > 0 ? Math.round((totalParts / userCount) * 10) / 10 : 0,
    },
    refreshedAt: Date.now(),
  }

  // Cache to Firestore
  await getFirestore().collection('appConfig').doc('analytics').set(result)

  return result
}

async function handleGetAnalytics() {
  // Read cached analytics (1 read)
  const snap = await getFirestore().collection('appConfig').doc('analytics').get()
  if (snap.exists) {
    return snap.data()
  }
  // Bootstrap: no cache yet, compute and write it
  return await computeAndCacheAnalytics()
}

async function handleGetConfig() {
  const docRef = getFirestore().collection('appConfig').doc('global')
  const snap = await docRef.get()
  return { config: snap.exists ? snap.data() : null }
}

const ALLOWED_CONFIG_KEYS = new Set([
  'features', 'tuning', 'defaultModel', 'grounding', 'announcement',
])

async function handleUpdateConfig(
  partial: Record<string, unknown>,
  adminEmail: string,
) {
  // Strip unknown keys to prevent arbitrary field injection
  const sanitized: Record<string, unknown> = {}
  for (const key of Object.keys(partial)) {
    if (ALLOWED_CONFIG_KEYS.has(key)) {
      sanitized[key] = partial[key]
    }
  }
  if (Object.keys(sanitized).length === 0) {
    return { error: 'No valid config keys provided' }
  }

  const docRef = getFirestore().collection('appConfig').doc('global')
  const merged = {
    ...sanitized,
    updatedAt: Date.now(),
    updatedBy: adminEmail,
  }
  await docRef.set(merged, { merge: true })
  const updated = await docRef.get()
  return { config: updated.data() }
}

async function handleGenerateInsights(apiKey: string) {
  // Collect summaries and profiles across all users (pseudonymous — no PII sent to AI)
  const allAuthUsers = await getAllUsers()
  const allSummaries: string[] = []
  const allProfiles: string[] = []

  for (let i = 0; i < allAuthUsers.length; i++) {
    const user = allAuthUsers[i]
    const label = `User ${i + 1}`

    const summaries = await getCollectionDocs(user.uid, 'entrySummaries')
    for (const s of summaries) {
      const themes = (s.themes as string[])?.join(', ') || ''
      const arc = (s.emotionalArc as string) || ''
      allSummaries.push(`[${label}] Themes: ${themes}. Arc: ${arc}`)
    }

    const profiles = await getCollectionDocs(user.uid, 'userProfile')
    if (profiles.length > 0) {
      const p = profiles[0]
      allProfiles.push(
        `[${label}] Landscape: ${p.innerLandscape || 'none'}. ` +
        `Themes: ${(p.recurringThemes as string[])?.join(', ') || 'none'}. ` +
        `Patterns: ${(p.emotionalPatterns as string[])?.join(', ') || 'none'}.`
      )
    }
  }

  // Read config for model preference
  const configSnap = await getFirestore().collection('appConfig').doc('global').get()
  const config = configSnap.exists ? configSnap.data() : null
  const model = (config?.defaultModel as string) || 'google/gemini-3-flash-preview'

  const systemPrompt = `You are analyzing usage data for a diary app called UnderSurface where AI "parts" (inner voices) respond to users as they write. You have entry summaries and user profiles (no raw diary text).

Provide:
1. A narrative analysis (2-3 paragraphs) of how users are engaging with the app — patterns, themes, emotional arcs, how the parts system is working.
2. A list of 3-5 concrete highlights or interesting observations.

Respond in JSON: { "narrative": "...", "highlights": ["...", "..."] }`

  const userContent = `Entry Summaries:\n${allSummaries.join('\n') || 'No summaries yet'}\n\nUser Profiles:\n${allProfiles.join('\n') || 'No profiles yet'}`

  const openRouterResponse = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://undersurface.me',
        'X-Title': 'UnderSurface Admin',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: 800,
        temperature: 0.7,
      }),
    },
  )

  if (!openRouterResponse.ok) {
    const errorBody = await openRouterResponse.text().catch(() => '')
    throw new Error(`OpenRouter error: ${openRouterResponse.status} ${errorBody}`)
  }

  const data = await openRouterResponse.json()
  const content = data.choices?.[0]?.message?.content || ''

  // Parse JSON from response (handle markdown code blocks)
  let cleaned = content.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  try {
    return JSON.parse(cleaned)
  } catch {
    return { narrative: content, highlights: [] }
  }
}

// ─── Account API (user self-service) ─────────────────────

async function deleteCollection(uid: string, collName: string) {
  const db = getFirestore()
  const collRef = db.collection('users').doc(uid).collection(collName)
  let snap = await collRef.limit(500).get()
  while (snap.docs.length > 0) {
    const batch = db.batch()
    snap.docs.forEach((d) => batch.delete(d.ref))
    await batch.commit()
    snap = await collRef.limit(500).get()
  }
}

export const accountApi = onRequest(
  {
    cors: ALLOWED_ORIGINS,
    memory: '256MiB',
    timeoutSeconds: 60,
    region: 'us-central1',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing auth token' })
      return
    }

    let uid: string
    try {
      const decoded = await getAuth().verifyIdToken(authHeader.split('Bearer ')[1])
      uid = decoded.uid
    } catch {
      res.status(401).json({ error: 'Invalid auth token' })
      return
    }

    if (!req.body || typeof req.body.action !== 'string') {
      res.status(400).json({ error: 'Missing action' })
      return
    }

    const { action, ...params } = req.body

    try {
      switch (action) {
        case 'deleteAccount': {
          const collections = [
            'entries', 'parts', 'memories', 'thoughts', 'interactions',
            'entrySummaries', 'userProfile', 'fossils', 'letters',
            'sessionLog', 'innerWeather', 'consent', 'sessions',
          ]
          for (const coll of collections) {
            await deleteCollection(uid, coll)
          }
          // Delete session message subcollections
          const sessionsSnap = await getFirestore()
            .collection('users').doc(uid).collection('sessions').get()
          for (const sessionDoc of sessionsSnap.docs) {
            const messagesSnap = await sessionDoc.ref.collection('messages').get()
            if (messagesSnap.docs.length > 0) {
              const batch = getFirestore().batch()
              messagesSnap.docs.forEach(d => batch.delete(d.ref))
              await batch.commit()
            }
          }
          // Delete top-level contactMessages by this user
          const contactSnap = await getFirestore()
            .collection('contactMessages')
            .where('uid', '==', uid)
            .get()
          if (contactSnap.docs.length > 0) {
            const batch = getFirestore().batch()
            contactSnap.docs.forEach((d) => batch.delete(d.ref))
            await batch.commit()
          }
          await getFirestore().collection('users').doc(uid).delete()
          await getAuth().deleteUser(uid)
          res.json({ success: true })
          return
        }
        case 'submitContact': {
          const message = params.message
          if (!message || typeof message !== 'string' || message.trim().length === 0) {
            res.status(400).json({ error: 'Message is required' })
            return
          }
          if (message.length > 5000) {
            res.status(400).json({ error: 'Message too long (max 5000 characters)' })
            return
          }
          const userRecord = await getAuth().getUser(uid)
          await getFirestore().collection('contactMessages').add({
            uid,
            email: userRecord.email || '',
            displayName: userRecord.displayName || '',
            message: message.trim(),
            createdAt: Date.now(),
          })
          res.json({ success: true })
          return
        }
        default:
          res.status(400).json({ error: `Unknown action: ${action}` })
      }
    } catch (error) {
      console.error('Account API error:', error)
      res.status(500).json({
        error: 'Request failed',
      })
    }
  },
)

// ─── Admin API ────────────────────────────────────────────────

export const adminApi = onRequest(
  {
    secrets: [openRouterKey],
    cors: ALLOWED_ORIGINS,
    memory: '512MiB',
    timeoutSeconds: 120,
    region: 'us-central1',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' })
      return
    }

    const adminEmail = await verifyAdmin(req.headers.authorization)
    if (!adminEmail) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    if (!req.body || typeof req.body.action !== 'string') {
      res.status(400).json({ error: 'Missing action' })
      return
    }

    const { action, ...params } = req.body

    try {
      switch (action) {
        case 'getOverview':
          res.json(await handleGetOverview())
          return
        case 'getUserList':
          res.json(await handleGetUserList())
          return
        case 'getUserDetail':
          if (!params.uid) {
            res.status(400).json({ error: 'Missing uid' })
            return
          }
          res.json(await handleGetUserDetail(params.uid))
          return
        case 'getConfig':
          res.json(await handleGetConfig())
          return
        case 'updateConfig':
          if (!params.config) {
            res.status(400).json({ error: 'Missing config' })
            return
          }
          res.json(await handleUpdateConfig(params.config, adminEmail))
          return
        case 'getAnalytics':
          res.json(await handleGetAnalytics())
          return
        case 'refreshAnalytics':
          res.json(await computeAndCacheAnalytics())
          return
        case 'generateInsights':
          res.json(await handleGenerateInsights(openRouterKey.value()))
          return
        case 'getContactMessages': {
          const snap = await getFirestore()
            .collection('contactMessages')
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get()
          const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          res.json({ messages })
          return
        }
        default:
          res.status(400).json({ error: `Unknown action: ${action}` })
      }
    } catch (error) {
      console.error('Admin API error:', error)
      res.status(500).json({
        error: 'Internal error',
      })
    }
  },
)
