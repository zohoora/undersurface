# Admin Panel Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the user count bug, add sortable columns to the Users table, surface rich metrics from all 12 Firestore subcollections, and expand UserDetail with session/weather/letter/fossil data.

**Architecture:** Extend the existing cache-first pattern. `handleGetOverview()` gets a live Auth count; `computeAndCacheAnalytics()` aggregates new metrics into the same `appConfig/analytics` doc; frontend reads from cache. Sorting is client-side via `useMemo`. Admin components use inline styles with the warm muted palette (light-only).

**Tech Stack:** TypeScript strict mode, React functional components, Firebase Admin SDK (functions), Firestore, inline styles (admin convention), no semicolons, single quotes.

---

### Task 1: Fix user count bug + extend types for new data

**Files:**
- Modify: `functions/src/index.ts:187-208` (handleGetOverview)
- Modify: `src/admin/adminTypes.ts`

**Step 1: Fix handleGetOverview to always fetch live user count**

In `functions/src/index.ts`, replace the `handleGetOverview` function (lines 187-255). The key change: always call `getAllUsers()` for the user count, read the rest from cache.

```typescript
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
```

**Step 2: Extend AdminUser type with new fields**

In `src/admin/adminTypes.ts`, add to the `AdminUser` interface:

```typescript
export interface AdminUser {
  uid: string
  email: string
  displayName: string
  photoURL: string | null
  entryCount: number
  thoughtCount: number
  interactionCount: number
  totalWords: number
  lastActive: number | null
  partCount: number
  sessionCount: number
  createdAt: number | null
}
```

**Step 3: Extend AdminOverviewResponse with rich metrics**

In `src/admin/adminTypes.ts`, update the response type:

```typescript
export interface WritingHabits {
  totalSessions: number
  avgSessionDuration: number
  avgSessionsPerUser: number
  peakWritingHour: number | null
}

export interface EmotionalLandscape {
  topEmotions: Array<{ emotion: string; count: number }>
  weatherAdoptionPercent: number
  avgIntensity: number
}

export interface FeatureAdoption {
  profileAdoptionPercent: number
  letterAdoptionPercent: number
  fossilAdoptionPercent: number
  avgPartsPerUser: number
}

export interface AdminOverviewResponse {
  userCount: number
  totalEntries: number
  totalThoughts: number
  totalInteractions: number
  recentActivity: RecentActivity[]
  refreshedAt?: number
  writingHabits: WritingHabits | null
  emotionalLandscape: EmotionalLandscape | null
  featureAdoption: FeatureAdoption | null
}
```

**Step 4: Add UserDetail types for new subcollections**

In `src/admin/adminTypes.ts`, add:

```typescript
export interface AdminSession {
  id: string
  startedAt: number
  endedAt?: number
  duration?: number
  wordCount: number
  timeOfDay: string
  dayOfWeek: number
}

export interface AdminWeather {
  id: string
  dominantEmotion: string
  secondaryEmotion?: string
  intensity: number
  trend: 'rising' | 'falling' | 'steady'
  updatedAt: number
}

export interface AdminLetter {
  id: string
  partIds: string[]
  content: string
  triggerType: 'milestone' | 'pattern' | 'growth'
  createdAt: number
  isRead: boolean
}

export interface AdminFossil {
  id: string
  entryId: string
  partId: string
  commentary: string
  createdAt: number
}
```

Update `AdminUserDetailResponse`:

```typescript
export interface AdminUserDetailResponse {
  user: AdminUser
  entries: AdminEntry[]
  parts: AdminPart[]
  thoughts: AdminThought[]
  interactions: AdminInteraction[]
  memories: AdminMemory[]
  userProfile: AdminUserProfile | null
  entrySummaries: AdminEntrySummary[]
  sessions: AdminSession[]
  weather: AdminWeather[]
  letters: AdminLetter[]
  fossils: AdminFossil[]
}
```

**Step 5: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: No errors (may show warnings from other files — that's OK)

**Step 6: Commit**

```bash
git add src/admin/adminTypes.ts functions/src/index.ts
git commit -m "fix: live user count in admin overview, extend types for rich metrics"
```

---

### Task 2: Extend backend — getUserList with new columns + getUserDetail with new subcollections

**Files:**
- Modify: `functions/src/index.ts:257-390` (handleGetUserList + handleGetUserDetail)

**Step 1: Extend handleGetUserList with partCount, sessionCount, createdAt**

In `functions/src/index.ts`, replace `handleGetUserList` (lines 257-297):

```typescript
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
      totalWords,
      lastActive,
      partCount,
      sessionCount,
      createdAt: new Date(user.metadata.creationTime).getTime(),
    })
  }

  return { users }
}
```

**Step 2: Extend handleGetUserDetail with sessions, weather, letters, fossils**

In `functions/src/index.ts`, replace `handleGetUserDetail` (lines 299-390):

```typescript
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
      totalWords,
      lastActive,
      partCount: parts.length,
      sessionCount: sessionLog.length,
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
```

**Step 3: Verify functions compile**

Run: `cd functions && npx tsc --noEmit && cd ..`
Expected: No errors

**Step 4: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat: extend getUserList with parts/sessions/signup, getUserDetail with all subcollections"
```

---

### Task 3: Extend computeAndCacheAnalytics with rich metrics

**Files:**
- Modify: `functions/src/index.ts:392-514` (computeAndCacheAnalytics)

**Step 1: Extend the analytics computation**

In `functions/src/index.ts`, replace `computeAndCacheAnalytics` (lines 392-514). Add session, weather, and feature adoption aggregation inside the per-user loop:

```typescript
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
    refreshedAt: Date.now(),
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
  }

  // Cache to Firestore
  await getFirestore().collection('appConfig').doc('analytics').set(result)

  return result
}
```

**Step 2: Verify functions compile**

Run: `cd functions && npx tsc --noEmit && cd ..`
Expected: No errors

**Step 3: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat: extend analytics cache with writing habits, emotional landscape, feature adoption"
```

---

### Task 4: Sortable Users table frontend

**Files:**
- Modify: `src/admin/AdminUsers.tsx`

**Step 1: Rewrite AdminUsers with sorting + new columns**

Replace the entire file:

```tsx
import { useState, useEffect, useMemo } from 'react'
import { adminFetch } from './adminApi'
import type { AdminUser } from './adminTypes'
import { AdminUserDetail } from './AdminUserDetail'

type SortKey = 'displayName' | 'entryCount' | 'thoughtCount' | 'interactionCount' | 'totalWords' | 'partCount' | 'sessionCount' | 'createdAt' | 'lastActive'

const columns: { key: SortKey; label: string }[] = [
  { key: 'displayName', label: 'User' },
  { key: 'entryCount', label: 'Entries' },
  { key: 'thoughtCount', label: 'Thoughts' },
  { key: 'interactionCount', label: 'Interactions' },
  { key: 'totalWords', label: 'Words' },
  { key: 'partCount', label: 'Parts' },
  { key: 'sessionCount', label: 'Sessions' },
  { key: 'createdAt', label: 'Signup' },
  { key: 'lastActive', label: 'Last Active' },
]

export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('lastActive')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    adminFetch<{ users: AdminUser[] }>('getUserList')
      .then((res) => setUsers(res.users))
      .catch((e) => setError(e.message))
  }, [])

  const sortedUsers = useMemo(() => {
    if (!users) return null
    return [...users].sort((a, b) => {
      const aVal = a[sortBy]
      const bVal = b[sortBy]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      let cmp: number
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        cmp = aVal.localeCompare(bVal)
      } else {
        cmp = (aVal as number) < (bVal as number) ? -1 : (aVal as number) > (bVal as number) ? 1 : 0
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [users, sortBy, sortDir])

  function handleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      setSortDir(key === 'displayName' ? 'asc' : 'desc')
    }
  }

  if (selectedUid) {
    return <AdminUserDetail uid={selectedUid} onBack={() => setSelectedUid(null)} />
  }

  if (error) return <div style={{ color: '#B91C1C', fontSize: 13, padding: 20 }}>Error: {error}</div>
  if (!sortedUsers) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>Loading...</div>

  return (
    <div>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
        background: '#FFFFFF',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid #E8E4DF',
      }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #E8E4DF' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  fontWeight: 500,
                  fontSize: 12,
                  color: sortBy === col.key ? '#2D2B29' : '#A09A94',
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {col.label}{' '}
                {sortBy === col.key ? (sortDir === 'asc' ? '\u2191' : '\u2193') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedUsers.map((u) => (
            <tr
              key={u.uid}
              onClick={() => setSelectedUid(u.uid)}
              style={{
                borderBottom: '1px solid #F0EDE9',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#FAF8F5' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
            >
              <td style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {u.photoURL && (
                    <img
                      src={u.photoURL}
                      alt=""
                      style={{ width: 28, height: 28, borderRadius: '50%' }}
                    />
                  )}
                  <div>
                    <div style={{ fontWeight: 500 }}>{u.displayName || 'Unknown'}</div>
                    <div style={{ fontSize: 11, color: '#A09A94' }}>{u.email}</div>
                  </div>
                </div>
              </td>
              <td style={{ padding: '12px 16px' }}>{u.entryCount}</td>
              <td style={{ padding: '12px 16px' }}>{u.thoughtCount}</td>
              <td style={{ padding: '12px 16px' }}>{u.interactionCount}</td>
              <td style={{ padding: '12px 16px' }}>{u.totalWords.toLocaleString()}</td>
              <td style={{ padding: '12px 16px' }}>{u.partCount}</td>
              <td style={{ padding: '12px 16px' }}>{u.sessionCount}</td>
              <td style={{ padding: '12px 16px', color: '#A09A94' }}>
                {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
              </td>
              <td style={{ padding: '12px 16px', color: '#A09A94' }}>
                {u.lastActive ? new Date(u.lastActive).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

**Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: No errors

**Step 3: Commit**

```bash
git add src/admin/AdminUsers.tsx
git commit -m "feat: add sortable columns to admin users table with parts, sessions, signup date"
```

---

### Task 5: Rich metrics on Overview tab

**Files:**
- Modify: `src/admin/AdminOverview.tsx`

**Step 1: Rewrite AdminOverview with rich metric sections**

Replace the entire file:

```tsx
import { useState, useEffect } from 'react'
import { adminFetch } from './adminApi'
import type { AdminOverviewResponse } from './adminTypes'

export function AdminOverview() {
  const [data, setData] = useState<AdminOverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminFetch<AdminOverviewResponse>('getOverview')
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  if (error) return <div style={{ color: '#B91C1C', fontSize: 13, padding: 20 }}>Error: {error}</div>
  if (!data) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>Loading...</div>

  const metrics = [
    { label: 'Users', value: data.userCount },
    { label: 'Entries', value: data.totalEntries },
    { label: 'Thoughts', value: data.totalThoughts },
    { label: 'Interactions', value: data.totalInteractions },
  ]

  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16,
        marginBottom: 16,
      }}>
        {metrics.map((m) => (
          <div key={m.label} style={{
            background: '#FFFFFF',
            borderRadius: 8,
            padding: '20px 24px',
            border: '1px solid #E8E4DF',
          }}>
            <div style={{ fontSize: 12, color: '#A09A94', marginBottom: 8 }}>{m.label}</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{m.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {data.refreshedAt && (
        <div style={{ fontSize: 11, color: '#C4BEB8', marginBottom: 24 }}>
          Totals (except users) last refreshed: {new Date(data.refreshedAt).toLocaleString()}
        </div>
      )}

      {data.writingHabits && (
        <MetricSection title="Writing Habits">
          <MetricGrid items={[
            { label: 'Total Sessions', value: data.writingHabits.totalSessions.toLocaleString() },
            { label: 'Avg Duration', value: data.writingHabits.avgSessionDuration > 0 ? formatDuration(data.writingHabits.avgSessionDuration) : '—' },
            { label: 'Avg Sessions / User', value: String(data.writingHabits.avgSessionsPerUser) },
            { label: 'Peak Hour', value: data.writingHabits.peakWritingHour != null ? formatHour(data.writingHabits.peakWritingHour) : '—' },
          ]} />
        </MetricSection>
      )}

      {data.emotionalLandscape && (
        <MetricSection title="Emotional Landscape">
          <MetricGrid items={[
            { label: 'Weather Adoption', value: `${data.emotionalLandscape.weatherAdoptionPercent}%` },
            { label: 'Avg Intensity', value: String(data.emotionalLandscape.avgIntensity) },
          ]} />
          {data.emotionalLandscape.topEmotions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: '#A09A94', marginBottom: 8 }}>Top Emotions</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {data.emotionalLandscape.topEmotions.map((e) => (
                  <span key={e.emotion} style={{
                    fontSize: 12,
                    background: '#F5F3F0',
                    padding: '4px 10px',
                    borderRadius: 12,
                    color: '#6B6560',
                  }}>
                    {e.emotion} ({e.count})
                  </span>
                ))}
              </div>
            </div>
          )}
        </MetricSection>
      )}

      {data.featureAdoption && (
        <MetricSection title="Feature Adoption">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AdoptionBar label="User Profiles" percent={data.featureAdoption.profileAdoptionPercent} />
            <AdoptionBar label="Part Letters" percent={data.featureAdoption.letterAdoptionPercent} />
            <AdoptionBar label="Entry Fossils" percent={data.featureAdoption.fossilAdoptionPercent} />
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: '#6B6560' }}>
            Avg parts per user: <strong>{data.featureAdoption.avgPartsPerUser}</strong>
          </div>
        </MetricSection>
      )}

      <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Recent Activity</h3>
      {data.recentActivity.length === 0 ? (
        <div style={{ fontSize: 13, color: '#A09A94' }}>No recent activity</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.recentActivity.map((item) => (
            <div key={item.entryId} style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '14px 20px',
              border: '1px solid #E8E4DF',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{item.displayName}</span>
                <span style={{ fontSize: 12, color: '#A09A94', marginLeft: 12 }}>
                  {item.preview.slice(0, 80)}{item.preview.length > 80 ? '...' : ''}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#C4BEB8', whiteSpace: 'nowrap' }}>
                {new Date(item.updatedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MetricSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>{title}</h3>
      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: 20,
        border: '1px solid #E8E4DF',
      }}>
        {children}
      </div>
    </div>
  )
}

function MetricGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, 1fr)`, gap: 16 }}>
      {items.map((item) => (
        <div key={item.label}>
          <div style={{ fontSize: 11, color: '#A09A94', marginBottom: 4 }}>{item.label}</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{item.value}</div>
        </div>
      ))}
    </div>
  )
}

function AdoptionBar({ label, percent }: { label: string; percent: number }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: '#6B6560' }}>{label}</span>
        <span style={{ color: '#A09A94' }}>{percent}%</span>
      </div>
      <div style={{ background: '#F0EDE9', borderRadius: 4, height: 6, overflow: 'hidden' }}>
        <div style={{ background: '#8B8580', borderRadius: 4, height: '100%', width: `${percent}%`, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

function formatHour(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
}
```

**Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: No errors

**Step 3: Commit**

```bash
git add src/admin/AdminOverview.tsx
git commit -m "feat: add writing habits, emotional landscape, feature adoption to admin overview"
```

---

### Task 6: Expanded UserDetail with sessions, weather, letters, fossils

**Files:**
- Modify: `src/admin/AdminUserDetail.tsx`

**Step 1: Add new tabs and sections to AdminUserDetail**

Replace the entire file. Key changes: add 4 new tabs (`sessions`, `weather`, `letters`, `fossils`) to the `DetailTab` union and render new sections for each:

```tsx
import { useState, useEffect } from 'react'
import { adminFetch } from './adminApi'
import type { AdminUserDetailResponse } from './adminTypes'

type DetailTab = 'entries' | 'parts' | 'thoughts' | 'profile' | 'sessions' | 'weather' | 'letters' | 'fossils'

interface Props {
  uid: string
  onBack: () => void
}

export function AdminUserDetail({ uid, onBack }: Props) {
  const [data, setData] = useState<AdminUserDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>('entries')

  useEffect(() => {
    adminFetch<AdminUserDetailResponse>('getUserDetail', { uid })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [uid])

  if (error) return <div style={{ color: '#B91C1C', fontSize: 13, padding: 20 }}>Error: {error}</div>
  if (!data) return <div style={{ fontSize: 13, color: '#A09A94', padding: 20 }}>Loading...</div>

  const detailTabs: { id: DetailTab; label: string }[] = [
    { id: 'entries', label: `Entries (${data.entries.length})` },
    { id: 'parts', label: `Parts (${data.parts.length})` },
    { id: 'thoughts', label: `Thoughts (${data.thoughts.length})` },
    { id: 'profile', label: 'Profile' },
    { id: 'sessions', label: `Sessions (${data.sessions.length})` },
    { id: 'weather', label: `Weather (${data.weather.length})` },
    { id: 'letters', label: `Letters (${data.letters.length})` },
    { id: 'fossils', label: `Fossils (${data.fossils.length})` },
  ]

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 13,
          color: '#A09A94',
          padding: '0 0 16px',
          fontFamily: 'inherit',
        }}
      >
        &larr; Back to users
      </button>

      <div style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: 20,
        border: '1px solid #E8E4DF',
        marginBottom: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        {data.user.photoURL && (
          <img src={data.user.photoURL} alt="" style={{ width: 48, height: 48, borderRadius: '50%' }} />
        )}
        <div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>{data.user.displayName || 'Unknown'}</div>
          <div style={{ fontSize: 13, color: '#A09A94' }}>{data.user.email}</div>
          {data.user.createdAt && (
            <div style={{ fontSize: 11, color: '#C4BEB8', marginTop: 2 }}>
              Joined {new Date(data.user.createdAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E8E4DF', marginBottom: 20, flexWrap: 'wrap' }}>
        {detailTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px',
              fontSize: 12,
              background: 'none',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid #2D2B29' : '2px solid transparent',
              color: tab === t.id ? '#2D2B29' : '#A09A94',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: tab === t.id ? 500 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'entries' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))}
          {data.entries.length === 0 && <div style={{ fontSize: 13, color: '#A09A94' }}>No entries</div>}
        </div>
      )}

      {tab === 'parts' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {data.parts.map((part) => (
            <div key={part.id} style={{
              background: '#FFFFFF',
              borderRadius: 8,
              padding: '16px 20px',
              border: '1px solid #E8E4DF',
              borderLeft: `3px solid ${part.color}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{part.name}</div>
              <div style={{ fontSize: 12, color: '#A09A94', marginBottom: 8 }}>{part.ifsRole}</div>
              <div style={{ fontSize: 12, color: '#6B6560' }}>{part.concern}</div>
              {part.learnedKeywords && part.learnedKeywords.length > 0 && (
                <div style={{ fontSize: 11, color: '#C4BEB8', marginTop: 8 }}>
                  Keywords: {part.learnedKeywords.join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'thoughts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.thoughts.slice(0, 50).map((t) => (
            <div key={t.id} style={{
              background: '#FFFFFF',
              borderRadius: 6,
              padding: '10px 16px',
              border: '1px solid #E8E4DF',
              fontSize: 13,
            }}>
              <span style={{ color: '#A09A94', fontSize: 11, marginRight: 8 }}>
                {new Date(t.timestamp).toLocaleDateString()}
              </span>
              {t.content}
            </div>
          ))}
          {data.thoughts.length === 0 && <div style={{ fontSize: 13, color: '#A09A94' }}>No thoughts</div>}
          {data.thoughts.length > 50 && (
            <div style={{ fontSize: 12, color: '#A09A94' }}>Showing first 50 of {data.thoughts.length}</div>
          )}
        </div>
      )}

      {tab === 'profile' && data.userProfile && (
        <div style={{
          background: '#FFFFFF',
          borderRadius: 8,
          padding: 20,
          border: '1px solid #E8E4DF',
          fontSize: 13,
        }}>
          <ProfileSection label="Inner Landscape" value={data.userProfile.innerLandscape} />
          <ProfileSection label="Recurring Themes" items={data.userProfile.recurringThemes} />
          <ProfileSection label="Emotional Patterns" items={data.userProfile.emotionalPatterns} />
          <ProfileSection label="Avoidance Patterns" items={data.userProfile.avoidancePatterns} />
          <ProfileSection label="Growth Signals" items={data.userProfile.growthSignals} />
        </div>
      )}
      {tab === 'profile' && !data.userProfile && (
        <div style={{ fontSize: 13, color: '#A09A94' }}>No profile data yet</div>
      )}

      {tab === 'sessions' && (
        <div>
          {data.sessions.length === 0 ? (
            <div style={{ fontSize: 13, color: '#A09A94' }}>No sessions recorded</div>
          ) : (
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              background: '#FFFFFF',
              borderRadius: 8,
              overflow: 'hidden',
              border: '1px solid #E8E4DF',
            }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E8E4DF' }}>
                  {['Date', 'Time of Day', 'Duration', 'Words'].map((h) => (
                    <th key={h} style={{
                      padding: '10px 16px',
                      textAlign: 'left',
                      fontWeight: 500,
                      fontSize: 12,
                      color: '#A09A94',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.sessions
                  .sort((a, b) => b.startedAt - a.startedAt)
                  .slice(0, 50)
                  .map((s) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #F0EDE9' }}>
                      <td style={{ padding: '10px 16px' }}>{new Date(s.startedAt).toLocaleDateString()}</td>
                      <td style={{ padding: '10px 16px', color: '#A09A94' }}>{s.timeOfDay}</td>
                      <td style={{ padding: '10px 16px' }}>
                        {s.duration ? `${Math.round(s.duration / 60000)}m` : '—'}
                      </td>
                      <td style={{ padding: '10px 16px' }}>{s.wordCount}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {data.sessions.length > 50 && (
            <div style={{ fontSize: 12, color: '#A09A94', marginTop: 8 }}>Showing first 50 of {data.sessions.length}</div>
          )}
        </div>
      )}

      {tab === 'weather' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.weather.length === 0 ? (
            <div style={{ fontSize: 13, color: '#A09A94' }}>No weather data</div>
          ) : (
            data.weather
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 30)
              .map((w) => (
                <div key={w.id} style={{
                  background: '#FFFFFF',
                  borderRadius: 8,
                  padding: '12px 20px',
                  border: '1px solid #E8E4DF',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{w.dominantEmotion}</span>
                    {w.secondaryEmotion && (
                      <span style={{ fontSize: 12, color: '#A09A94', marginLeft: 8 }}>+ {w.secondaryEmotion}</span>
                    )}
                    <span style={{ fontSize: 11, color: '#C4BEB8', marginLeft: 12 }}>
                      intensity {w.intensity} &middot; {w.trend}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#C4BEB8' }}>
                    {new Date(w.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {tab === 'letters' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.letters.length === 0 ? (
            <div style={{ fontSize: 13, color: '#A09A94' }}>No letters</div>
          ) : (
            data.letters
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((l) => (
                <div key={l.id} style={{
                  background: '#FFFFFF',
                  borderRadius: 8,
                  padding: '14px 20px',
                  border: '1px solid #E8E4DF',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{
                      fontSize: 11,
                      background: l.isRead ? '#E8F5E9' : '#FFF3E0',
                      color: l.isRead ? '#2E7D32' : '#E65100',
                      padding: '2px 8px',
                      borderRadius: 8,
                    }}>
                      {l.isRead ? 'Read' : 'Unread'}
                    </span>
                    <span style={{ fontSize: 11, color: '#C4BEB8' }}>
                      {l.triggerType} &middot; {new Date(l.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#6B6560', lineHeight: 1.6 }}>
                    {l.content.slice(0, 300)}{l.content.length > 300 ? '...' : ''}
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {tab === 'fossils' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.fossils.length === 0 ? (
            <div style={{ fontSize: 13, color: '#A09A94' }}>No fossils</div>
          ) : (
            data.fossils
              .sort((a, b) => b.createdAt - a.createdAt)
              .map((f) => (
                <div key={f.id} style={{
                  background: '#FFFFFF',
                  borderRadius: 8,
                  padding: '14px 20px',
                  border: '1px solid #E8E4DF',
                }}>
                  <div style={{ fontSize: 11, color: '#C4BEB8', marginBottom: 6 }}>
                    {new Date(f.createdAt).toLocaleDateString()}
                  </div>
                  <div style={{ fontSize: 13, color: '#6B6560', lineHeight: 1.6 }}>
                    {f.commentary}
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  )
}

function EntryCard({ entry }: { entry: { id: string; plainText: string; createdAt: number; updatedAt: number } }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = entry.plainText.length > 300

  return (
    <div
      onClick={truncated ? () => setExpanded((e) => !e) : undefined}
      style={{
        background: '#FFFFFF',
        borderRadius: 8,
        padding: '14px 20px',
        border: '1px solid #E8E4DF',
        cursor: truncated ? 'pointer' : 'default',
      }}
    >
      <div style={{ fontSize: 11, color: '#C4BEB8', marginBottom: 6 }}>
        {new Date(entry.createdAt).toLocaleDateString()} &middot; {new Date(entry.updatedAt).toLocaleTimeString()}
      </div>
      <div style={{ fontSize: 13, color: '#6B6560', lineHeight: 1.6, whiteSpace: expanded ? 'pre-wrap' : undefined }}>
        {expanded ? entry.plainText : entry.plainText.slice(0, 300)}{!expanded && truncated ? '...' : ''}
      </div>
      {truncated && (
        <div style={{ fontSize: 11, color: '#A09A94', marginTop: 6 }}>
          {expanded ? 'Click to collapse' : 'Click to expand'}
        </div>
      )}
    </div>
  )
}

function ProfileSection({ label, value, items }: { label: string; value?: string; items?: string[] }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#A09A94', marginBottom: 6 }}>{label}</div>
      {value && <div style={{ color: '#6B6560', lineHeight: 1.6 }}>{value}</div>}
      {items && items.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 20, color: '#6B6560', lineHeight: 1.8 }}>
          {items.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )}
      {items && items.length === 0 && <div style={{ color: '#C4BEB8' }}>None yet</div>}
    </div>
  )
}
```

**Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: No errors

**Step 3: Run existing tests to check nothing broke**

Run: `npm run test`
Expected: All tests pass (admin has no tests but engine tests should still pass)

**Step 4: Commit**

```bash
git add src/admin/AdminUserDetail.tsx
git commit -m "feat: add sessions, weather, letters, fossils tabs to admin user detail"
```

---

### Task 7: Build and verify

**Step 1: Full type-check**

Run: `npx tsc --noEmit -p tsconfig.json && cd functions && npx tsc --noEmit && cd ..`
Expected: No errors

**Step 2: Lint**

Run: `npm run lint`
Expected: No errors (fix any if found)

**Step 3: Run tests**

Run: `npm run test`
Expected: All tests pass

**Step 4: Build**

Run: `npm run build`
Expected: Build succeeds, no errors

**Step 5: Build functions**

Run: `cd functions && npx tsc && cd ..`
Expected: Build succeeds

**Step 6: Commit any fixes, then final commit if needed**

If any fixes were needed during verification, commit them.
