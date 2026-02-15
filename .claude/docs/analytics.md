# Analytics, Tracking & Monitoring

## Firebase Analytics events

| Event | File | Trigger | Params |
|-------|------|---------|--------|
| `app_launch` | App.tsx | After ready | — |
| `sign_in` | AuthContext.tsx | Successful auth | `method: 'google'\|'email'` |
| `sign_up` | AuthContext.tsx | New account created | `method: 'email'` |
| `auth_error` | LoginScreen.tsx | Auth failure | `method`, `mode` |
| `auth_form_submitted` | LoginScreen.tsx | Form submission | `mode` |
| `onboarding_complete` | App.tsx | Consent accepted | — |
| `onboarding_step_viewed` | Onboarding.tsx | Step displayed | `step` |
| `onboarding_step_completed` | Onboarding.tsx | Step completed | `step` |
| `first_keystroke` | App.tsx | First key in session | — |
| `new_entry` | App.tsx | New entry created | — |
| `entry_switch` | App.tsx | Entry selected | `entry_age_days` |
| `session_close` | App.tsx | Session closed | `word_count` |
| `export_data` | SettingsPanel.tsx | Export clicked | — |
| `part_thought` | partOrchestrator.ts | Thought generated | `part_name`, `emotion`, `pause_type` |
| `thinking_out_loud` | LivingEditor.tsx | TOL response | `part_name`, `status` |
| `grounding_activated` | useGroundingMode.ts | Grounding on | `trigger: 'auto'\|'manual'` |
| `exploration_shown` | App.tsx | Explorations generated | `count` |
| `exploration_selected` | App.tsx | Prompt selected | `source` |
| `intention_set` | App.tsx | Intention written | — |
| `emotion_shift` | App.tsx | Emotion changed | `from`, `to` |
| `fossil_shown` | App.tsx | Fossil rendered | `part_name` |

Analytics service (`src/services/analytics.ts`) lazy-initializes on first `trackEvent()`. Guards SSR and missing config. Uses `getApp()` from `firebase/app`.

## Google Ads conversion tracking

Conversion ID: `AW-17954082823`.

- `index.html` loads `gtag.js` for all users (required for `gclid` attribution)
- Conversions fire on email sign-up (always) and Google sign-in (new users only — `creationTime === lastSignInTime` check)
- Conversion event: `gtag('event', 'conversion', { send_to: 'AW-17954082823/TuxaCPeu0vgbEIeglvFC' })`

### Logo assets (public/)

| File | Size | Use |
|------|------|-----|
| `logo-square-1200.png` | 1200x1200, transparent | Google Ads square logo |
| `logo-square-1200-opaque.png` | 1200x1200, cream bg | Google Ads (requires opaque) |
| `logo-landscape-1200x300.png` | 1200x300, transparent | Google Ads landscape logo |
| `logo-landscape-1200x300-opaque.png` | 1200x300, cream bg | Google Ads (requires opaque) |
| `logo-icon-512.png` | 512x512, transparent | App stores / large icon |
| `logo-icon-192.png` | 192x192, transparent | PWA / smaller contexts |

## Sentry (frontend error monitoring)

Production-only (`import.meta.env.PROD`). Init in `main.tsx` before React render.

- Traces 10%, error replays 10%, session replay 0%
- Source maps uploaded via `@sentry/vite-plugin` (needs `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`)
- User context set in `AuthContext.tsx` via `Sentry.setUser()`
- `ErrorBoundary.tsx` calls `Sentry.captureException()` in `componentDidCatch`
- Service worker registration errors filtered in `main.tsx` `beforeSend`

## Environment variables

`.env.local` (git-ignored):
```
VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / STORAGE_BUCKET / MESSAGING_SENDER_ID / APP_ID
VITE_SENTRY_DSN
```

Build-time only (not bundled):
```
SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT
```

All `VITE_FIREBASE_*` and `VITE_SENTRY_DSN` are safe to expose — security is via Firestore rules + auth.
