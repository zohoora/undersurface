# Admin Panel Improvements — Design

## Problem

1. **Overview tab user count is wrong** — reads from a stale cache that only refreshes on manual admin action
2. **Users table has no column sorting** — headers are static strings, no interactivity
3. **Rich Firestore data is untapped** — 12 subcollections per user, admin only surfaces ~7

## Approach: Cache-First Expansion

Extend the existing `computeAndCacheAnalytics()` + cache-read pattern. Fix user count with a live Auth call. Add sorting client-side.

## Section 1 — Fix User Count

**File:** `functions/src/index.ts` (`handleGetOverview`)

Replace cached `userCount` with a live `getAllUsers().length` call. Keep other totals (entries, thoughts, interactions) cached. The function already has `getAllUsers()` for the bootstrap path — just use it unconditionally.

## Section 2 — Sortable Users Table

### Backend (`functions/src/index.ts` → `handleGetUserList`)

Add to per-user data:
- `partCount` — `getCollectionCount(uid, 'parts')`
- `sessionCount` — `getCollectionCount(uid, 'sessionLog')`
- `createdAt` — `user.metadata.creationTime`

### Frontend (`src/admin/AdminUsers.tsx`)

- State: `sortBy` (column key), `sortDir` ('asc' | 'desc')
- `useMemo` to sort `users` array by active column
- Clickable `<th>` headers with directional arrow indicators
- New columns: Parts, Sessions, Signup

### Types (`src/admin/adminTypes.ts`)

Add to `AdminUser`: `partCount`, `sessionCount`, `createdAt`

## Section 3 — Rich Overview Metrics

### Backend (`functions/src/index.ts` → `computeAndCacheAnalytics`)

Extend the per-user loop to collect:

**Writing Habits** (from `sessionLog`):
- `totalSessions`, `avgSessionDuration`, `avgSessionsPerUser`, `peakWritingHour`

**Emotional Landscape** (from `innerWeather`):
- `dominantEmotionCounts` (top emotions), `weatherAdoptionPercent`, `avgIntensity`

**Feature Adoption** (from collection counts):
- `profileAdoptionPercent`, `letterAdoptionPercent`, `fossilAdoptionPercent`, `avgPartsPerUser`

All stored in the same `appConfig/analytics` cache doc.

### Frontend (`src/admin/AdminOverview.tsx`)

Three new sections below existing metric cards:
- **Writing Habits** — session stats in a card grid
- **Emotional Landscape** — emotion breakdown + intensity
- **Feature Adoption** — percentage bars for each feature

### Types (`src/admin/adminTypes.ts`)

Extend `AdminOverviewResponse` with new metric fields. Extend `AdminAnalyticsResponse` with the cached fields.

## Section 4 — Expanded UserDetail

### Backend (`functions/src/index.ts` → `handleGetUserDetail`)

Add parallel fetches for: `sessionLog`, `innerWeather`, `letters`, `fossils`

### Frontend (`src/admin/AdminUserDetail.tsx`)

New collapsible sections:
- **Sessions** — table of writing sessions (time, duration, words)
- **Weather** — inner weather snapshots
- **Letters** — part letters with read status
- **Fossils** — resurfaced entry commentary

### Types (`src/admin/adminTypes.ts`)

Add interfaces: `AdminSession`, `AdminWeather`, `AdminLetter`, `AdminFossil`
Extend `AdminUserDetailResponse` with the 4 new arrays.

## Files Changed

| File | Changes |
|------|---------|
| `functions/src/index.ts` | Fix user count, add user list fields, extend analytics cache, extend user detail |
| `src/admin/AdminOverview.tsx` | New metric sections for writing habits, emotions, adoption |
| `src/admin/AdminUsers.tsx` | Sorting state + logic, new columns |
| `src/admin/AdminUserDetail.tsx` | New collapsible sections for sessions, weather, letters, fossils |
| `src/admin/adminTypes.ts` | New interfaces + extended response types |
