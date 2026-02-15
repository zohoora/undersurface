# Admin Dashboard

At `/admin` for admin users only (currently `zohoora@gmail.com`). Two-layer access control:

1. **Frontend** — `App.tsx` checks `ADMIN_EMAILS` before rendering `AdminDashboard`; non-admins redirected to `/`
2. **Backend** — `adminApi` Cloud Function verifies email from Firebase ID token; returns 403 for non-admins

Admin route is checked before DB initialization — admin page doesn't load TipTap, spell engine, or diary components. `AdminDashboard` is lazy-loaded via `React.lazy()` + `Suspense`.

6 tabs: **Overview**, **Users**, **Analytics**, **Messages**, **Insights**, **Settings**.

## Admin API actions

| Action | Input | Returns |
|--------|-------|---------|
| `getOverview` | — | userCount, totalEntries, totalThoughts, totalInteractions, recentActivity[] |
| `getUserList` | — | users[] with counts, words, lastActive |
| `getUserDetail` | `{ uid }` | Full user data: entries, parts, thoughts, interactions, memories, profile, summaries |
| `getConfig` | — | Current GlobalConfig from `appConfig/global` |
| `updateConfig` | `{ config }` | Merged config (sets updatedAt + updatedBy) |
| `getAnalytics` | — | activeUsers (daily/weekly/monthly), signupsByWeek, entriesByDay, partUsage, engagement metrics |
| `refreshAnalytics` | — | Force-refresh cached analytics data |
| `generateInsights` | — | LLM narrative + highlights from entry summaries and user profiles (can take 10-30s) |
| `getContactMessages` | — | Up to 100 most recent contact messages, ordered by createdAt desc |

## Account API actions

| Action | Input | Returns |
|--------|-------|---------|
| `deleteAccount` | — | Deletes all 12 user subcollections + user doc + Firebase Auth user |
| `submitContact` | `{ message }` | Writes to top-level `contactMessages` collection (validated, max 5000 chars) |

## Adding a new admin user

Update `ADMIN_EMAILS` in two places:
1. `src/App.tsx` — frontend routing gate
2. `functions/src/index.ts` — backend auth check

Then build and deploy both frontend and function.

## Admin components

Admin components use inline styles with warm muted palette (Inter font, #FAF8F5 bg, #A09A94 subtle, #2D2B29 text). Admin stays light-only (no dark mode).

| File | Purpose |
|------|---------|
| `src/admin/adminTypes.ts` | TypeScript types for admin API + `GlobalConfig` |
| `src/admin/adminApi.ts` | Client-side admin API caller (`adminFetch(action, params)`) |
| `src/admin/AdminDashboard.tsx` | Admin shell with tab navigation. Lazy-loaded — default export |
| `src/admin/AdminOverview.tsx` | Metric cards + recent activity feed |
| `src/admin/AdminUsers.tsx` | User table with drill-down |
| `src/admin/AdminUserDetail.tsx` | Full user data view (entries, parts, thoughts, profile) |
| `src/admin/AdminAnalytics.tsx` | Active users, engagement metrics, charts |
| `src/admin/AdminMessages.tsx` | Contact message inbox |
| `src/admin/AdminInsights.tsx` | LLM-generated narrative analysis |
| `src/admin/AdminSettings.tsx` | Form for GlobalConfig (model, speed, feature flags, announcements, version signal) |
