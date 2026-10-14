# Analytics, Tracking & Monitoring

## Firebase Analytics events

| Event | File | Trigger | Params |
|-------|------|---------|--------|
| `app_launch` | App.tsx | After ready | — |
| `sign_in` | AuthContext.tsx | Successful auth (incl. redirect result) | `method: 'google'\|'email'` |
| `sign_up` | AuthContext.tsx | New email account created | `method: 'email'` |
| `auth_error` | useLoginFlow.ts | Auth failure | `method`, `mode` |
| `auth_form_submitted` | useLoginFlow.ts | Form submission | `mode` |
| `onboarding_complete` | App.tsx | Consent accepted | — |
| `onboarding_step_viewed` | Onboarding.tsx | Step displayed | `step` |
| `onboarding_step_completed` | Onboarding.tsx | Step completed | `step` |
| `session_started` | SessionView.tsx | New session created | `opening_method`, `host_part`, `mode` |
| `session_closed` | SessionView.tsx | End session | `session_id`, `message_count`, `duration_ms` |
| `session_note_generated` / `session_note_failed` | SessionView.tsx | Session note at close | `session_id` |
| `voice_session_started` / `voice_session_ended` | useSessionVoice.ts | Speak start/stop | `session_id` |
| `hrv_enabled` | useHrvSession.ts, usePolarH10Session.ts | Biometric source enabled | `session_id` (+ `source: 'polarH10'` for H10) |
| `part_thought` | partOrchestrator.ts | Journal part thought generated | `part_name`, `pause_type` |
| `thinking_out_loud` | useChatResponse.ts | TOL response | `part_name`, `status` |
| `export_data` | SettingsPanel.tsx | Export clicked | — |

Analytics service (`src/services/analytics.ts`) lazy-initializes on first `trackEvent()`, guards SSR and missing config, and sets the GA user id on sign-in.

**Sensitive data never goes to GA.** GA is keyed to the user id and shares a property with Ads conversions, so crisis/grounding state and detected emotions are not tracked there: grounding activations go to first-party diagnostics only (`src/store/groundingState.ts` → `engineLog`), and `part_thought` deliberately omits the emotion. Keep it that way for any new event.

## Google Ads conversion tracking

Conversion ID: `AW-17954082823`.

- `index.html` loads `gtag.js` for all users (required for `gclid` attribution)
- Conversions fire on email sign-up (always) and Google sign-in (new users only — `creationTime === lastSignInTime` check) in `AuthContext.tsx`
- Conversion event: `gtag('event', 'conversion', { send_to: 'AW-17954082823/TuxaCPeu0vgbEIeglvFC' })`
- CSP: the single web policy is the `firebase.json` header; it allows the Ads/GA4 hosts per Google's tag-platform CSP guide (incl. `ad.doubleclick.net`, `pagead2.googlesyndication.com`, `*.google-analytics.com`, and the regional `www.google.<tld>` list). `index.html` must not carry its own meta CSP — the intersection of two policies silently broke conversion tracking until 2026-10-14

### Logo assets (public/)

Left out of the PWA precache (`vite.config.ts` `globIgnores`).

| File | Size | Use |
|------|------|-----|
| `logo-square-1200.png` | 1200x1200, transparent | Google Ads square logo |
| `logo-square-1200-opaque.png` | 1200x1200, cream bg | Google Ads (requires opaque) |
| `logo-landscape-1200x300.png` | 1200x300, transparent | Google Ads landscape logo |
| `logo-landscape-1200x300-opaque.png` | 1200x300, cream bg | Google Ads (requires opaque) |
| `logo-icon-512.png` | 512x512, transparent | App stores / large icon |
| `logo-icon-192.png` | 192x192, transparent | PWA / smaller contexts |

## Sentry (frontend error monitoring)

Production-only (`enabled: import.meta.env.PROD`). Init in `main.tsx` before React render.

- Traces 10%, error replays 10%, session replay 0%
- Source maps uploaded via `@sentry/vite-plugin` only on `npm run build:release` (needs `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`)
- User context set in `AuthContext.tsx` via `Sentry.setUser()`
- `ErrorBoundary.tsx` and `SurfaceErrorBoundary.tsx` call `Sentry.captureException()` in `componentDidCatch`
- `beforeSend` in `main.tsx` drops extension DOM errors (`removeChild`/`insertBefore`) and the known WebKit IndexedDB errors (those show the connection banner instead)

## Environment variables

`.env.local` (git-ignored):
```
VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / STORAGE_BUCKET / MESSAGING_SENDER_ID / APP_ID
VITE_SENTRY_DSN
```

Build-time only (not bundled):
```
SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT
CAPACITOR_BUILD=1   # set by npm run build:native; injects the native meta CSP
```

All `VITE_FIREBASE_*` and `VITE_SENTRY_DSN` are safe to expose — security is via Firestore rules + auth.
