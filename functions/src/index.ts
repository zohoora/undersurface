import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

initializeApp()

const openRouterKey = defineSecret('OPENROUTER_API_KEY')
const ADMIN_EMAILS = ['zohoora@gmail.com']

export const chat = onRequest(
  {
    secrets: [openRouterKey],
    cors: true,
    memory: '256MiB',
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

    try {
      await getAuth().verifyIdToken(authHeader.split('Bearer ')[1])
    } catch {
      res.status(401).json({ error: 'Invalid auth token' })
      return
    }

    const { messages, model, max_tokens, temperature, stream } = req.body

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
          model: model || 'google/gemini-3-flash-preview',
          messages,
          max_tokens: max_tokens || 150,
          temperature: temperature ?? 0.9,
          stream: !!stream,
        }),
      },
    )

    if (!openRouterResponse.ok) {
      const errorBody = await openRouterResponse.text().catch(() => '')
      res.status(openRouterResponse.status).json({
        error: `OpenRouter error: ${openRouterResponse.status}`,
        details: errorBody,
      })
      return
    }

    if (stream && openRouterResponse.body) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('X-Accel-Buffering', 'no')

      const reader = openRouterResponse.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
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
    if (ADMIN_EMAILS.includes(decoded.email || '')) return decoded.email!
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

async function handleGetOverview() {
  const listResult = await getAuth().listUsers()
  const users = listResult.users

  let totalEntries = 0
  let totalThoughts = 0
  let totalInteractions = 0
  const recentActivity: Array<{
    uid: string
    displayName: string
    entryId: string
    preview: string
    updatedAt: number
  }> = []

  for (const user of users) {
    const [entryCount, thoughtCount, interactionCount] = await Promise.all([
      getCollectionCount(user.uid, 'entries'),
      getCollectionCount(user.uid, 'thoughts'),
      getCollectionCount(user.uid, 'interactions'),
    ])
    totalEntries += entryCount
    totalThoughts += thoughtCount
    totalInteractions += interactionCount

    // Get recent entries for activity feed
    const recentEntries = await getFirestore()
      .collection('users').doc(user.uid).collection('entries')
      .orderBy('updatedAt', 'desc')
      .limit(3)
      .get()

    for (const doc of recentEntries.docs) {
      const data = doc.data()
      recentActivity.push({
        uid: user.uid,
        displayName: user.displayName || user.email || 'Unknown',
        entryId: data.id || doc.id,
        preview: (data.plainText || '').slice(0, 100),
        updatedAt: data.updatedAt || 0,
      })
    }
  }

  recentActivity.sort((a, b) => b.updatedAt - a.updatedAt)

  return {
    userCount: users.length,
    totalEntries,
    totalThoughts,
    totalInteractions,
    recentActivity: recentActivity.slice(0, 10),
  }
}

async function handleGetUserList() {
  const listResult = await getAuth().listUsers()
  const users = []

  for (const user of listResult.users) {
    const [entryCount, thoughtCount, interactionCount] = await Promise.all([
      getCollectionCount(user.uid, 'entries'),
      getCollectionCount(user.uid, 'thoughts'),
      getCollectionCount(user.uid, 'interactions'),
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
      totalWords,
      lastActive,
    })
  }

  return { users }
}

async function handleGetUserDetail(uid: string) {
  // Get user info from Auth
  const userRecord = await getAuth().getUser(uid)

  const [entries, parts, thoughts, interactions, memories, entrySummaries, userProfileDocs] =
    await Promise.all([
      getCollectionDocs(uid, 'entries'),
      getCollectionDocs(uid, 'parts'),
      getCollectionDocs(uid, 'thoughts'),
      getCollectionDocs(uid, 'interactions'),
      getCollectionDocs(uid, 'memories'),
      getCollectionDocs(uid, 'entrySummaries'),
      getCollectionDocs(uid, 'userProfile'),
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
      totalWords,
      lastActive,
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
  }
}

async function handleGetConfig() {
  const docRef = getFirestore().collection('appConfig').doc('global')
  const snap = await docRef.get()
  return { config: snap.exists ? snap.data() : null }
}

async function handleUpdateConfig(
  partial: Record<string, unknown>,
  adminEmail: string,
) {
  const docRef = getFirestore().collection('appConfig').doc('global')
  const merged = {
    ...partial,
    updatedAt: Date.now(),
    updatedBy: adminEmail,
  }
  await docRef.set(merged, { merge: true })
  const updated = await docRef.get()
  return { config: updated.data() }
}

async function handleGenerateInsights(apiKey: string) {
  // Collect summaries and profiles across all users
  const listResult = await getAuth().listUsers()
  const allSummaries: string[] = []
  const allProfiles: string[] = []

  for (const user of listResult.users) {
    const name = user.displayName || user.email || 'Unknown'

    const summaries = await getCollectionDocs(user.uid, 'entrySummaries')
    for (const s of summaries) {
      const themes = (s.themes as string[])?.join(', ') || ''
      const arc = (s.emotionalArc as string) || ''
      allSummaries.push(`[${name}] Themes: ${themes}. Arc: ${arc}`)
    }

    const profiles = await getCollectionDocs(user.uid, 'userProfile')
    if (profiles.length > 0) {
      const p = profiles[0]
      allProfiles.push(
        `[${name}] Landscape: ${p.innerLandscape || 'none'}. ` +
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

export const adminApi = onRequest(
  {
    secrets: [openRouterKey],
    cors: true,
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
        case 'generateInsights':
          res.json(await handleGenerateInsights(openRouterKey.value()))
          return
        default:
          res.status(400).json({ error: `Unknown action: ${action}` })
      }
    } catch (error) {
      console.error('Admin API error:', error)
      res.status(500).json({
        error: 'Internal error',
        details: error instanceof Error ? error.message : String(error),
      })
    }
  },
)
