import { getFirestore } from 'firebase-admin/firestore'
import { countWords, getAllUsers, getCollectionCount } from './helpers.js'

// Full analytics computation — expensive, writes result to appConfig/analytics
export async function computeAndCacheAnalytics() {
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
  let usersWithSessions = 0
  let usersWithIntentions = 0
  let totalParts = 0
  let totalConversations = 0
  const conversationBuckets: Record<string, number> = {}

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
    let hasIntention = false
    for (const doc of entriesSnap.docs) {
      const data = doc.data()
      totalEntries++
      totalWords += countWords((data.plainText as string) || '')
      const updatedAt = (data.updatedAt as number) || 0
      if (updatedAt > userLastActive) userLastActive = updatedAt
      if (data.intention) hasIntention = true

      // Track entries by day (last 14 days)
      const entryCreated = (data.createdAt as number) || 0
      if (now - entryCreated < 14 * oneDay) {
        const dayKey = new Date(entryCreated).toISOString().split('T')[0]
        entryBuckets[dayKey] = (entryBuckets[dayKey] || 0) + 1
      }
    }
    if (hasIntention) usersWithIntentions++

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

    // Feature adoption checks (sessions query runs in parallel to avoid N+1)
    const [profileCount, letterCount, fossilCount, conversationCount, convRecentSnap] = await Promise.all([
      getCollectionCount(user.uid, 'userProfile'),
      getCollectionCount(user.uid, 'letters'),
      getCollectionCount(user.uid, 'fossils'),
      getCollectionCount(user.uid, 'sessions'),
      getFirestore()
        .collection('users').doc(user.uid).collection('sessions')
        .where('startedAt', '>', now - 14 * oneDay)
        .get(),
    ])
    if (profileCount > 0) usersWithProfile++
    if (letterCount > 0) usersWithLetters++
    if (fossilCount > 0) usersWithFossils++
    if (conversationCount > 0) usersWithSessions++
    totalConversations += conversationCount

    // Track conversations by day (last 14 days) — reuse already-fetched snapshot
    for (const doc of convRecentSnap.docs) {
      const startedAt = doc.data().startedAt as number
      if (startedAt) {
        const dayKey = new Date(startedAt).toISOString().split('T')[0]
        conversationBuckets[dayKey] = (conversationBuckets[dayKey] || 0) + 1
      }
    }
  }

  // Build sorted arrays
  const signupsByWeek = Object.entries(signupBuckets)
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week))

  const entriesByDay = Object.entries(entryBuckets)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const conversationsByDay = Object.entries(conversationBuckets)
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

  // Cache to Firestore
  await getFirestore().collection('appConfig').doc('analytics').set(result)

  return result
}

export async function handleGetAnalytics() {
  // Read cached analytics (1 read)
  const snap = await getFirestore().collection('appConfig').doc('analytics').get()
  if (snap.exists) {
    return snap.data()
  }
  // Bootstrap: no cache yet, compute and write it
  return await computeAndCacheAnalytics()
}
