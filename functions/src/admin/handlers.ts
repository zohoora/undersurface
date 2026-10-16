import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { validateConfigUpdate } from './configSchema.js'
import { OPENAI_CHAT_MODEL } from '../shared/models.js'
import {
  countWords,
  computeLastActive,
  getAllUsers,
  getCollectionCount,
  getCollectionDocs,
} from './helpers.js'

export async function handleGetOverview() {
  const db = getFirestore()

  // Live counts in parallel: Auth users + collectionGroup aggregations + cached rich metrics
  const [allAuthUsers, entryCountSnap, thoughtCountSnap, interactionCountSnap, conversationCountSnap, analyticsSnap, recentEntriesSnap, recentConversationsSnap, folioPagesSnap, folioTracesSnap, folioAdditionsSnap] = await Promise.all([
    getAllUsers(),
    db.collectionGroup('entries').count().get(),
    db.collectionGroup('thoughts').count().get(),
    db.collectionGroup('interactions').count().get(),
    db.collectionGroup('sessions').count().get(),
    db.collection('appConfig').doc('analytics').get(),
    db.collectionGroup('entries').orderBy('updatedAt', 'desc').limit(10).get(),
    db.collectionGroup('sessions').orderBy('startedAt', 'desc').limit(10).get(),
    // Folio: counts only, never content (build plan decision 15). Its kept
    // things' additions share the collection id 'entries' with the legacy
    // diary, so they're counted apart (author == 'writer') and subtracted.
    db.collectionGroup('folioPages').count().get(),
    db.collectionGroup('folioTraces').count().get(),
    db.collectionGroup('entries').where('author', '==', 'writer').count().get(),
  ])

  const userCount = allAuthUsers.length
  const folioAdditions = folioAdditionsSnap.data().count
  const totalEntries = entryCountSnap.data().count - folioAdditions
  const totalThoughts = thoughtCountSnap.data().count
  const totalInteractions = interactionCountSnap.data().count
  const totalConversations = conversationCountSnap.data().count

  // Rich metrics from cache (populated by computeAndCacheAnalytics)
  const cached = analyticsSnap.exists ? analyticsSnap.data() : null
  const refreshedAt = cached?.refreshedAt as number | undefined
  const writingHabits = cached?.writingHabits || null
  const emotionalLandscape = cached?.emotionalLandscape || null
  const featureAdoption = cached?.featureAdoption || null

  // Merge recent entries + conversations into one activity feed
  const userIds = new Set<string>()
  const rawActivity: Array<{ uid: string; itemId: string; preview: string; updatedAt: number; type: 'entry' | 'conversation' }> = []

  const activitySources = [
    { snap: recentEntriesSnap, previewField: 'plainText', timeField: 'updatedAt', type: 'entry' as const, fallback: '' },
    { snap: recentConversationsSnap, previewField: 'firstLine', timeField: 'startedAt', type: 'conversation' as const, fallback: 'Conversation' },
  ]
  for (const { snap, previewField, timeField, type, fallback } of activitySources) {
    for (const doc of snap.docs) {
      const uid = doc.ref.parent.parent!.id
      userIds.add(uid)
      const data = doc.data()
      rawActivity.push({
        uid,
        itemId: (type === 'entry' ? (data.id as string) : null) || doc.id,
        preview: ((data[previewField] as string) || fallback).slice(0, 100),
        updatedAt: (data[timeField] as number) || 0,
        type,
      })
    }
  }

  // Sort merged activity by time, take top 10
  rawActivity.sort((a, b) => b.updatedAt - a.updatedAt)
  const topActivity = rawActivity.slice(0, 10)

  // Batch-fetch display names from Auth
  const displayNames: Record<string, string> = {}
  const uidList = [...userIds]
  if (uidList.length > 0) {
    const userRecords = await getAuth().getUsers(uidList.map((uid) => ({ uid })))
    for (const user of userRecords.users) {
      displayNames[user.uid] = user.displayName || user.email || 'Unknown'
    }
  }

  const recentActivity = topActivity.map((item) => ({
    ...item,
    displayName: displayNames[item.uid] || 'Unknown',
  }))

  return {
    folio: { pages: folioPagesSnap.data().count, kept: folioTracesSnap.data().count, additions: folioAdditions },
    userCount,
    totalEntries,
    totalThoughts,
    totalInteractions,
    totalConversations,
    recentActivity,
    refreshedAt,
    writingHabits,
    emotionalLandscape,
    featureAdoption,
  }
}

export async function handleGetUserList() {
  const allAuthUsers = await getAllUsers()
  const db = getFirestore()
  const users = []

  for (const user of allAuthUsers) {
    const userRef = db.collection('users').doc(user.uid)

    // Sessions feed both a count and lastActive. lastActive is just a max over
    // startedAt, so we only need the single most-recent session — fetch that +
    // a count() aggregation instead of reading every session doc per user.
    // (Entries still read in full because totalWords needs each plainText.)
    const [thoughtCount, interactionCount, partCount, writingSessionCount, conversationCount, entriesSnap, recentSessionSnap] = await Promise.all([
      getCollectionCount(user.uid, 'thoughts'),
      getCollectionCount(user.uid, 'interactions'),
      getCollectionCount(user.uid, 'parts'),
      getCollectionCount(user.uid, 'sessionLog'),
      getCollectionCount(user.uid, 'sessions'),
      userRef.collection('entries').select('plainText', 'updatedAt').get(),
      userRef.collection('sessions').orderBy('startedAt', 'desc').limit(1).select('startedAt').get(),
    ])

    let totalWords = 0
    const entryData = entriesSnap.docs.map((doc) => {
      const data = doc.data()
      totalWords += countWords(data.plainText || '')
      return { updatedAt: data.updatedAt || 0 }
    })
    const sessionData = recentSessionSnap.docs.map((doc) => ({ startedAt: doc.data().startedAt || 0 }))
    const lastActive = computeLastActive(entryData, sessionData)

    users.push({
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || null,
      entryCount: entriesSnap.size,
      thoughtCount,
      interactionCount,
      partCount,
      sessionCount: conversationCount + writingSessionCount,
      totalWords,
      lastActive,
      createdAt: new Date(user.metadata.creationTime).getTime(),
    })
  }

  return { users }
}

export async function handleGetUserDetail(uid: string) {
  // Get user info from Auth
  const userRecord = await getAuth().getUser(uid)

  const [entries, parts, thoughts, interactions, memories, entrySummaries, userProfileDocs, sessionLog, sessions, innerWeather, letters, fossils] =
    await Promise.all([
      getCollectionDocs(uid, 'entries'),
      getCollectionDocs(uid, 'parts'),
      getCollectionDocs(uid, 'thoughts'),
      getCollectionDocs(uid, 'interactions'),
      getCollectionDocs(uid, 'memories'),
      getCollectionDocs(uid, 'entrySummaries'),
      getCollectionDocs(uid, 'userProfile'),
      getCollectionDocs(uid, 'sessionLog'),
      getCollectionDocs(uid, 'sessions'),
      getCollectionDocs(uid, 'innerWeather'),
      getCollectionDocs(uid, 'letters'),
      getCollectionDocs(uid, 'fossils'),
    ])
  // Folio: counts only, never content.
  const [folioPageCount, folioTraceCount] = await Promise.all([
    getCollectionCount(uid, 'folioPages'),
    getCollectionCount(uid, 'folioTraces'),
  ])

  let totalWords = 0
  for (const entry of entries) {
    totalWords += countWords((entry.plainText as string) || '')
  }
  const lastActive = computeLastActive(
    entries.map((e) => ({ updatedAt: (e.updatedAt as number) || 0 })),
    sessions.map((s) => ({ startedAt: (s.startedAt as number) || 0 })),
  )

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
      sessionCount: sessionLog.length + sessions.length,
      totalWords,
      lastActive,
      createdAt: new Date(userRecord.metadata.creationTime).getTime(),
      folioPageCount,
      folioTraceCount,
    },
    entries: entries.map((e) => ({
      id: e.id,
      plainText: e.plainText || '',
      createdAt: e.createdAt || 0,
      updatedAt: e.updatedAt || 0,
      intention: e.intention || null,
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
    conversations: sessions.map((c) => ({
      id: c.id,
      startedAt: c.startedAt || 0,
      endedAt: c.endedAt || null,
      status: c.status || 'closed',
      hostPartId: c.hostPartId || '',
      phase: c.phase || 'opening',
      sessionNote: c.sessionNote || null,
      messageCount: c.messageCount || 0,
      firstLine: c.firstLine || '',
      isTherapistSession: c.isTherapistSession ?? true,
      favorited: c.favorited ?? false,
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

export async function handleGetSessionMessages(uid: string, sessionId: string) {
  const snap = await getFirestore()
    .collection('users').doc(uid).collection('sessions').doc(sessionId).collection('messages')
    .orderBy('timestamp', 'asc')
    .get()

  const messages = snap.docs.map((d) => {
    const m = d.data()
    return {
      id: m.id || d.id,
      speaker: m.speaker || 'user',
      partId: m.partId || null,
      partName: m.partName || null,
      content: m.content || '',
      timestamp: m.timestamp || 0,
      phase: m.phase || 'opening',
      isEmergence: m.isEmergence ?? false,
    }
  })

  return { messages }
}

export async function handleGetConfig() {
  const docRef = getFirestore().collection('appConfig').doc('global')
  const snap = await docRef.get()
  return { config: snap.exists ? snap.data() : null }
}

export async function handleUpdateConfig(
  partial: Record<string, unknown>,
  adminEmail: string,
) {
  const sanitized = validateConfigUpdate(partial)

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

export async function handleGenerateInsights(apiKey: string) {
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

  const systemPrompt = `You are analyzing usage data for a diary app called UnderSurface where AI "parts" (inner voices) respond to users as they write. You have entry summaries and user profiles (no raw diary text).

Provide:
1. A narrative analysis (2-3 paragraphs) of how users are engaging with the app — patterns, themes, emotional arcs, how the parts system is working.
2. A list of 3-5 concrete highlights or interesting observations.

Respond in JSON: { "narrative": "...", "highlights": ["...", "..."] }`

  const userContent = `Entry Summaries:\n${allSummaries.join('\n') || 'No summaries yet'}\n\nUser Profiles:\n${allProfiles.join('\n') || 'No profiles yet'}`

  const openAiResponse = await fetch(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_CHAT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_completion_tokens: 800,
        reasoning_effort: 'none', // structured JSON output
      }),
    },
  )

  if (!openAiResponse.ok) {
    const errorBody = await openAiResponse.text().catch(() => '')
    throw new Error(`OpenAI error: ${openAiResponse.status} ${errorBody}`)
  }

  const data = await openAiResponse.json()
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
