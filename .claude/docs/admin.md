# Admin Dashboard

At `/admin` for admin users only (currently `zohoora@gmail.com`). Two-layer access control:

1. **Frontend** — `App.tsx` checks `isAdmin()` (`src/admin/isAdmin.ts`) before rendering `AdminDashboard`; non-admins are redirected to `/`
2. **Backend** — `adminApi` verifies the Firebase ID token with `verifyAdmin` (`functions/src/shared/auth.ts`: allowlisted AND `email_verified`); returns 403 for non-admins

The admin route is checked before DB initialization, so the admin page doesn't load the session shell or editor. `AdminDashboard` is lazy-loaded and, since 2026-10-14, left out of the PWA precache (runtime-cached on first use).

6 tabs: **Overview**, **Users**, **Analytics**, **Messages**, **Insights**, **Settings**.

## Admin API actions

Handler map in `functions/src/admin/index.ts`, handlers in `admin/handlers.ts`, analytics in `admin/analytics.ts`.

| Action | Input | Returns |
|--------|-------|---------|
| `getOverview` | — | userCount (live from Auth), totals, recentActivity[], writingHabits, emotionalLandscape, featureAdoption |
| `getUserList` | — | users[] with counts, words, lastActive, partCount, sessionCount, createdAt |
| `getUserDetail` | `{ uid }` | Full user data for the 11 detail tabs |
| `getConfig` | — | Current GlobalConfig from `appConfig/global` |
| `updateConfig` | `{ config }` | Validated (`configSchema.ts`) + merged config (sets updatedAt + updatedBy) |
| `getAnalytics` | — | Cached analytics: active users, signups, part usage, engagement, rich metrics |
| `refreshAnalytics` | — | Force-recompute cached analytics (iterates all users — slow at scale) |
| `generateInsights` | — | LLM narrative + highlights from summaries and profiles (10–30s) |
| `getSessionMessages` | `{ uid, sessionId }` | One session's transcript |
| `getContactMessages` | — | Up to 100 most recent contact messages, newest first |
| `getDiagnostics` | `{ uid, limit? }` | That user's `diagnostics` events, newest first (default 100, max 500) |

`updateConfig` rejects unknown top-level keys and unknown `features` keys (`FEATURE_KEYS`); retired keys (`customSoundscapesEnabled`) are dropped instead of rejected. A newer admin bundle that saves a key the deployed functions don't know fails until functions are deployed.

## Account API actions (`accountApi`, `functions/src/account.ts`)

| Action | Input | Returns |
|--------|-------|---------|
| `deleteAccount` | — | Tombstone → revoke refresh tokens → Twilio message/media deletion (best effort) → `recursiveDelete` of `users/{uid}` subcollections → Storage `field-moments/{uid}/`, contact messages, quota doc, top-level SMS/dispatch docs → Auth user → final `recursiveDelete(users/{uid})` |
| `submitContact` | `{ message }` | Writes to top-level `contactMessages` (validated, max 5000 chars) |
| `getSmsStatus` | — | Linked state (last four only) |
| `createSmsLinkCode` | — | 10-minute link code |
| `unlinkSms` | — | Unlinks the phone and revokes field-window consent (same as texting STOP) |

## Settings tab

Sections: Defaults (response speed), Core Feature Flags, Visual Effects, Atmosphere Features, Part Intelligence Features, Engagement Features, Safety & Wellbeing (grounding tuning + companion flags), Biometric, **Room** (one toggle writing `features.roomEnabled`; while it is unset the toggle reflects the legacy `relaxEnabled`/`driftEnabled` derivation and says so), **SMS Field Channel** (`features.smsEnabled`, on unless false), Voice Mode (`voiceEnabled` + default voice), Announcement, version signal, Reset Defaults (`src/admin/adminDefaults.ts`; writes `roomEnabled: false` explicitly).

## Adding a new admin user

Update `ADMIN_EMAILS` in two places, then deploy both frontend and functions:
1. `src/admin/isAdmin.ts` — frontend routing gate (UX only)
2. `functions/src/shared/auth.ts` — backend check (the real boundary)

## Admin components

Admin components use inline styles with a warm muted palette (Inter font, #FAF8F5 bg, #A09A94 subtle, #2D2B29 text). Admin stays light-only (no dark mode).

| File | Purpose |
|------|---------|
| `src/admin/adminTypes.ts` | TypeScript types for admin API + `GlobalConfig` |
| `src/admin/adminDefaults.ts` | `ADMIN_CONFIG_DEFAULTS` |
| `src/admin/featureFlags.ts` | `effectiveRoomEnabled`, `effectiveSmsEnabled`, retired-key stripping |
| `src/admin/adminApi.ts` | Client-side admin API caller (`adminFetch(action, params)`) |
| `src/admin/useAdminQuery.ts` / `useAdminUser.ts` / `useAdminConfig.ts` / `useAdminMutation.ts` | Data-loading hooks (see CLAUDE.md) |
| `src/admin/AdminDashboard.tsx` | Admin shell with tab navigation. Lazy-loaded — default export |
| `src/admin/AdminOverview.tsx` | Metric cards + writing habits, emotional landscape, feature adoption + recent activity feed |
| `src/admin/AdminUsers.tsx` | Sortable user table with drill-down |
| `src/admin/AdminUserDetail.tsx` | 11 tabs: entries, parts, conversations, thoughts, memories, profile, sessions, weather, letters, fossils, diagnostics |
| `src/admin/ConversationsTab.tsx` / `DiagnosticsTab.tsx` | User-detail session transcripts / diagnostics |
| `src/admin/AdminAnalytics.tsx` | Active users, engagement metrics, charts |
| `src/admin/AdminMessages.tsx` | Contact message inbox |
| `src/admin/AdminInsights.tsx` | LLM-generated narrative analysis |
| `src/admin/AdminSettings.tsx` | GlobalConfig editor (sections above) |
