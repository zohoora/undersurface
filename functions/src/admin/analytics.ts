import { getFirestore } from 'firebase-admin/firestore'
import type { UserRecord } from 'firebase-admin/auth'
import { countWords, getAllUsers, getCollectionCount } from './helpers.js'

const ONE_DAY = 24 * 60 * 60 * 1000
const ONE_WEEK = 7 * ONE_DAY
const ONE_MONTH = 30 * ONE_DAY

// Cap concurrent per-user fan-outs. 10 × 11 reads = 110 concurrent Firestore
// ops at peak — well under per-project quota for the user counts this app
// sees, but bounded enough to avoid spikes that throttle other paths.
const USER_CONCURRENCY = 10

interface UserStats {
  isDailyActive: boolean
  isWeeklyActive: boolean
  isMonthlyActive: boolean
  entries: number
  words: number
  thoughts: number
  interactions: number
  parts: number
  sessions: number
  sessionDuration: number
  sessionsWithDuration: number
  weatherEntries: number
  intensitySum: number
  hasWeather: boolean
  hasProfile: boolean
  hasLetters: boolean
  hasFossils: boolean
  hasSessions: boolean
  hasIntentions: boolean
  conversations: number
  signupWeekKey: string | null
  entryDays: Record<string, number>
  partThoughts: Record<string, { name: string; color: string; count: number }>
  hours: Record<number, number>
  emotions: Record<string, number>
  conversationDays: Record<string, number>
}

async function processUser(user: UserRecord, now: number): Promise<UserStats> {
  const userRef = getFirestore().collection('users').doc(user.uid)
  const fortnightAgo = now - 14 * ONE_DAY

  // One round trip with 11 parallel reads. The previous loop body did six
  // sequential round trips per user; collapsing them here drops wall-time
  // per user to ~1 RT regardless of how many independent collections we read.
  const [
    entriesSnap,
    interactionCount,
    partsSnap,
    thoughtsSnap,
    sessionsSnap,
    weatherSnap,
    profileCount,
    letterCount,
    fossilCount,
    conversationCount,
    convRecentSnap,
  ] = await Promise.all([
    userRef.collection('entries').get(),
    getCollectionCount(user.uid, 'interactions'),
    userRef.collection('parts').get(),
    userRef.collection('thoughts').get(),
    userRef.collection('sessionLog').get(),
    userRef.collection('innerWeather').get(),
    getCollectionCount(user.uid, 'userProfile'),
    getCollectionCount(user.uid, 'letters'),
    getCollectionCount(user.uid, 'fossils'),
    getCollectionCount(user.uid, 'sessions'),
    userRef.collection('sessions').where('startedAt', '>', fortnightAgo).get(),
  ])

  const createdAt = new Date(user.metadata.creationTime).getTime()
  let signupWeekKey: string | null = null
  if (now - createdAt < 12 * ONE_WEEK) {
    const weekStart = new Date(createdAt)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    signupWeekKey = weekStart.toISOString().split('T')[0]
  }

  let words = 0
  let userLastActive = 0
  let hasIntentions = false
  const entryDays: Record<string, number> = {}
  for (const doc of entriesSnap.docs) {
    const data = doc.data()
    words += countWords((data.plainText as string) || '')
    const updatedAt = (data.updatedAt as number) || 0
    if (updatedAt > userLastActive) userLastActive = updatedAt
    if (data.intention) hasIntentions = true

    const entryCreated = (data.createdAt as number) || 0
    if (now - entryCreated < 14 * ONE_DAY) {
      const dayKey = new Date(entryCreated).toISOString().split('T')[0]
      entryDays[dayKey] = (entryDays[dayKey] || 0) + 1
    }
  }

  const partMap: Record<string, { name: string; color: string }> = {}
  for (const doc of partsSnap.docs) {
    const data = doc.data()
    partMap[data.id as string] = { name: data.name as string, color: data.color as string }
  }

  const partThoughts: Record<string, { name: string; color: string; count: number }> = {}
  for (const doc of thoughtsSnap.docs) {
    const partId = doc.data().partId as string
    const part = partMap[partId]
    if (!part) continue
    if (!partThoughts[part.name]) {
      partThoughts[part.name] = { name: part.name, color: part.color, count: 0 }
    }
    partThoughts[part.name].count++
  }

  let sessionDuration = 0
  let sessionsWithDuration = 0
  const hours: Record<number, number> = {}
  for (const doc of sessionsSnap.docs) {
    const data = doc.data()
    if (data.duration && typeof data.duration === 'number') {
      sessionDuration += data.duration
      sessionsWithDuration++
    }
    const startedAt = data.startedAt as number
    if (startedAt) {
      const hour = new Date(startedAt).getHours()
      hours[hour] = (hours[hour] || 0) + 1
    }
  }

  const emotions: Record<string, number> = {}
  let intensitySum = 0
  let weatherEntries = 0
  for (const doc of weatherSnap.docs) {
    const data = doc.data()
    const emotion = data.dominantEmotion as string
    if (emotion) emotions[emotion] = (emotions[emotion] || 0) + 1
    if (typeof data.intensity === 'number') {
      intensitySum += data.intensity
      weatherEntries++
    }
  }

  const conversationDays: Record<string, number> = {}
  for (const doc of convRecentSnap.docs) {
    const startedAt = doc.data().startedAt as number
    if (startedAt) {
      const dayKey = new Date(startedAt).toISOString().split('T')[0]
      conversationDays[dayKey] = (conversationDays[dayKey] || 0) + 1
    }
  }

  return {
    isDailyActive: now - userLastActive < ONE_DAY,
    isWeeklyActive: now - userLastActive < ONE_WEEK,
    isMonthlyActive: now - userLastActive < ONE_MONTH,
    entries: entriesSnap.size,
    words,
    thoughts: thoughtsSnap.size,
    interactions: interactionCount,
    parts: partsSnap.size,
    sessions: sessionsSnap.size,
    sessionDuration,
    sessionsWithDuration,
    weatherEntries,
    intensitySum,
    hasWeather: weatherSnap.size > 0,
    hasProfile: profileCount > 0,
    hasLetters: letterCount > 0,
    hasFossils: fossilCount > 0,
    hasSessions: conversationCount > 0,
    hasIntentions,
    conversations: conversationCount,
    signupWeekKey,
    entryDays,
    partThoughts,
    hours,
    emotions,
    conversationDays,
  }
}

async function fanOutUsers(users: UserRecord[], now: number): Promise<UserStats[]> {
  const out: UserStats[] = []
  for (let i = 0; i < users.length; i += USER_CONCURRENCY) {
    const batch = users.slice(i, i + USER_CONCURRENCY)
    const stats = await Promise.all(batch.map(u => processUser(u, now)))
    out.push(...stats)
  }
  return out
}

function mergeMap<V>(into: Record<string, V>, from: Record<string, V>, merge: (a: V, b: V) => V): void {
  for (const [k, v] of Object.entries(from)) {
    into[k] = k in into ? merge(into[k], v) : v
  }
}

// Full analytics computation — writes to appConfig/analytics. Per-user reads
// fan out in parallel within a bounded concurrency window; the aggregation
// is a single sync pass once all stats are collected.
export async function computeAndCacheAnalytics() {
  const users = await getAllUsers()
  const now = Date.now()
  const userCount = users.length

  const allStats = await fanOutUsers(users, now)

  let dailyActive = 0, weeklyActive = 0, monthlyActive = 0
  let totalEntries = 0, totalWords = 0, totalThoughts = 0, totalInteractions = 0
  let totalSessions = 0, totalSessionDuration = 0, sessionsWithDuration = 0
  let totalIntensity = 0, weatherEntries = 0
  let usersWithWeather = 0, usersWithProfile = 0, usersWithLetters = 0
  let usersWithFossils = 0, usersWithSessions = 0, usersWithIntentions = 0
  let totalParts = 0, totalConversations = 0

  const signupBuckets: Record<string, number> = {}
  const entryBuckets: Record<string, number> = {}
  const partThoughtCounts: Record<string, { name: string; color: string; count: number }> = {}
  const hourBuckets: Record<number, number> = {}
  const emotionCounts: Record<string, number> = {}
  const conversationBuckets: Record<string, number> = {}

  for (const s of allStats) {
    if (s.isDailyActive) dailyActive++
    if (s.isWeeklyActive) weeklyActive++
    if (s.isMonthlyActive) monthlyActive++
    totalEntries += s.entries
    totalWords += s.words
    totalThoughts += s.thoughts
    totalInteractions += s.interactions
    totalParts += s.parts
    totalSessions += s.sessions
    totalSessionDuration += s.sessionDuration
    sessionsWithDuration += s.sessionsWithDuration
    totalIntensity += s.intensitySum
    weatherEntries += s.weatherEntries
    if (s.hasWeather) usersWithWeather++
    if (s.hasProfile) usersWithProfile++
    if (s.hasLetters) usersWithLetters++
    if (s.hasFossils) usersWithFossils++
    if (s.hasSessions) usersWithSessions++
    if (s.hasIntentions) usersWithIntentions++
    totalConversations += s.conversations

    if (s.signupWeekKey) {
      signupBuckets[s.signupWeekKey] = (signupBuckets[s.signupWeekKey] || 0) + 1
    }
    mergeMap(entryBuckets, s.entryDays, (a, b) => a + b)
    mergeMap(partThoughtCounts, s.partThoughts, (a, b) => ({ ...a, count: a.count + b.count }))
    mergeMap(hourBuckets as Record<string, number>, s.hours as Record<string, number>, (a, b) => a + b)
    mergeMap(emotionCounts, s.emotions, (a, b) => a + b)
    mergeMap(conversationBuckets, s.conversationDays, (a, b) => a + b)
  }

  const signupsByWeek = Object.entries(signupBuckets)
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week))

  const entriesByDay = Object.entries(entryBuckets)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const conversationsByDay = Object.entries(conversationBuckets)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const partUsage = Object.values(partThoughtCounts).sort((a, b) => b.count - a.count)

  let peakWritingHour: number | null = null
  let peakHourCount = 0
  for (const [hour, count] of Object.entries(hourBuckets)) {
    if (count > peakHourCount) {
      peakHourCount = count
      peakWritingHour = parseInt(hour)
    }
  }

  const topEmotions = Object.entries(emotionCounts)
    .map(([emotion, count]) => ({ emotion, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const result = {
    userCount,
    totalEntries,
    totalThoughts,
    totalInteractions,
    activeUsers: { daily: dailyActive, weekly: weeklyActive, monthly: monthlyActive },
    signupsByWeek,
    entriesByDay,
    conversationsByDay,
    partUsage,
    averageWordsPerEntry: totalEntries > 0 ? Math.round(totalWords / totalEntries) : 0,
    averageEntriesPerUser: userCount > 0 ? Math.round((totalEntries / userCount) * 10) / 10 : 0,
    averageConversationsPerUser: userCount > 0 ? Math.round((totalConversations / userCount) * 10) / 10 : 0,
    totalWords,
    totalConversations,
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
      sessionAdoptionPercent: userCount > 0 ? Math.round((usersWithSessions / userCount) * 100) : 0,
      intentionUsagePercent: userCount > 0 ? Math.round((usersWithIntentions / userCount) * 100) : 0,
    },
    refreshedAt: Date.now(),
  }

  await getFirestore().collection('appConfig').doc('analytics').set(result)

  return result
}

export async function handleGetAnalytics() {
  const snap = await getFirestore().collection('appConfig').doc('analytics').get()
  if (snap.exists) {
    return snap.data()
  }
  return await computeAndCacheAnalytics()
}
