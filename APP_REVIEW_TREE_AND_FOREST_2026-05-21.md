# UnderSurface App Review: Tree And Forest Analysis

Date: 2026-05-21  
Scope: repository review, local verification, codebase architecture, privacy/safety/data lifecycle, product strategy, market position, and online research.  
Constraint honored: no source code changes were made. This Markdown report is the only intended modification.

## Executive Summary

UnderSurface is not just a diary app. The current product has become a multi-surface reflective system: text conversation, private journaling inside a session, voice, relax/breathwork, inner voices/parts, memory, HRV/biofeedback, admin analytics, MCP export access, and multilingual support. The technical ambition is high and there is real craft in the prompt system, tests, safety flow, and emotional UX.

The core strategic problem is that the app is currently carrying three product theses at once:

1. A diary where inner voices respond as you write.
2. An AI therapist-like companion for sessions.
3. A somatic wellness and biofeedback tool.

Those can eventually reinforce each other, but right now they create positioning, safety, compliance, cost, and implementation risk. The strongest wedge is still the original one: a private reflective writing instrument where different inner perspectives help the writer notice patterns. That is more differentiated than competing head-on as an "AI therapist" or generic wellness chatbot.

The biggest near-term risks are not test failures. The local verification pass is strong. The bigger risks are trust and operational correctness: user-facing policy still says OpenRouter while the code uses OpenAI; export and deletion do not cover all sensitive user data; admin can view highly sensitive content; app copy says "therapist" in places despite disclaimers; rate limits are per-instance only; and admin settings appear to silently drop several fields on save.

My recommendation: before pushing growth, do a trust hardening sprint. Align policy/docs with the actual providers, fix export/delete parity, add real quota enforcement, add admin auditability, remove ambiguous "therapist" product language, and simplify the user-facing thesis. After that, choose one growth wedge and price it around AI cost realities.

## Methods

I reviewed:

- Source tree, package scripts, Firebase rules, Cloud Functions, admin tools, session architecture, AI prompts, safety code, data export/delete code, settings/config, tests, and build output.
- Public competitor and category context for AI journaling, digital mental health, and companion chatbots.
- Current official OpenAI model pages because the repo uses OpenAI API model IDs.

Local commands run:

- `npm run lint`: passed.
- `npx tsc -b --noEmit`: passed.
- `npm test`: passed, 58 test files passed, 1 skipped; 1084 tests passed, 2 skipped.
- `cd functions && npm test`: passed, 5 test files, 64 tests.
- `npm run build`: passed with bundle warnings and a Sentry source-map upload warning caused by restricted network/DNS.
- `cd functions && npm run build`: passed.

I did not run emulator-backed integration tests such as `npm run test:indexes`; the normal unit suites did run.

## Codebase Structure Map

The app is a Vite/React/TypeScript frontend with Firebase Auth, Firestore, Hosting, Cloud Functions, PWA support, and Capacitor native shells.

High-level structure:

```text
.
|-- src/
|   |-- admin/                 Admin dashboard, analytics, settings, user detail views
|   |-- ai/                    Prompt builders, OpenAI proxy client, safety wrappers, parsers
|   |-- api/                   Client API wrappers for account/soundscape/authed fetch
|   |-- auth/                  Auth context and social sign-in
|   |-- components/
|   |   |-- Atmosphere/         Ambient visual effects
|   |   |-- BodyMap/            Body map UI
|   |   |-- Editor/             Journal/editor-related pieces
|   |   |-- Session/            Talk/Journal/Speak/Relax session surfaces
|   |   |-- Sidebar/            Settings and session list
|   |   `-- ThinkingOutLoud/    Older/adjacent inner dialogue surface
|   |-- engine/                 Domain engines: parts, sessions, HRV, relax, weather, rituals
|   |-- hooks/                  React hooks for streaming, voice, HRV, theme, autocorrect
|   |-- i18n/                   17 translation files and key parity tests
|   |-- native/                 Capacitor native integrations
|   |-- services/               Analytics and diagnostics
|   |-- store/                  Firestore abstraction, settings, export, config, weather
|   |-- styles/                 CSS for atmosphere and voice
|   |-- types/                  Shared frontend types
|   `-- utils/
|-- functions/src/
|   |-- admin/                  Admin API, analytics, handlers
|   |-- shared/                 Auth, CORS, model IDs, rate limit, secrets
|   |-- soundscape/             ElevenLabs soundscape provider/normalization
|   |-- account.ts              Account deletion/contact API
|   |-- chat.ts                 OpenAI chat proxy and crisis task routing
|   |-- mcp.ts                  MCP HTTP endpoint backed by user API keys
|   |-- realtime.ts             OpenAI Realtime client-secret endpoint
|   `-- soundscapeApi.ts
|-- tests/                      Firestore rules/index tests
|-- android/, ios/              Capacitor native projects
|-- public/                     App icons and manifest assets
|-- docs/, scripts/, benchmarks/
|-- firestore.rules
|-- storage.rules
|-- vite.config.ts
|-- firebase.json
`-- package.json
```

Size signals:

- `src` TypeScript/TSX/CSS: 44,095 lines.
- `functions/src` TypeScript: 3,040 lines.
- Frontend TypeScript/TSX files: 220.
- Cloud Function TypeScript files: 25.
- Test files in `src`, `functions/src`, and `tests`: 66.

Largest files:

- `src/engine/hrvSignalWorker.ts`: 1,347 lines.
- `src/engine/polarH10Engine.ts`: 964 lines.
- `src/admin/AdminSettings.tsx`: 875 lines.
- `src/components/Session/SessionView.tsx`: 805 lines.
- `src/ai/partPrompts.ts`: 586 lines.
- `src/engine/partOrchestrator.ts`: 576 lines.
- `src/ai/therapistPrompts.ts`: 570 lines.
- `src/engine/hrvEngine.ts`: 500 lines.

## What Is Strong

### The core interaction is differentiated

The original product idea, "a diary where inner voices respond as you write," is meaningfully different from most AI journals. Rosebud and Mindsera both offer AI reflection, patterns, prompts, and companion-like feedback. UnderSurface's strongest distinction is the felt presence of multiple inner perspectives that appear in and around the writing flow.

That is a real product angle. It is not merely "ChatGPT for journaling."

### The safety work is better than the average prototype

There is thoughtful crisis handling:

- Synchronous keyword detection runs before AI response generation in `src/hooks/useSessionStream.ts:304`.
- Crisis keywords include normalization against zero-width and fullwidth evasion in `src/engine/sessionOrchestrator.ts:48`.
- The therapist prompt includes explicit safety override rules in `src/ai/therapistPrompts.ts:55`.
- Real Talk is disabled during grounding by prompt-builder design, and this is covered by tests.
- The UI includes 988, Crisis Text Line, and findahelpline.com in `src/components/CrisisResources.tsx:69`.

This is not sufficient for a clinical product, but it is materially better than having only a prompt disclaimer.

### Prompt-injection handling exists and is tested

`src/ai/promptSafety.ts` wraps user-authored content in explicit tags and strips role-change/instruction patterns from metadata fields. The key design choice is correct: diary content is preserved but labeled as untrusted, while metadata strings can be sanitized.

This matters because the app feeds long-term memories, profile facts, prior sessions, and user text back into prompts. Without a prompt safety layer, a malicious or accidental journal entry could poison future AI behavior.

### Test coverage is broad

The tests cover engines, prompts, parsers, HRV math, session streaming, i18n parity, admin hooks, settings, safety, and functions. That is a meaningful moat for a solo/small-team app with this much behavioral complexity.

The strongest test areas are:

- Crisis keyword behavior and Real Talk grounding override.
- Prompt construction and parser behavior.
- HRV signal processing and Polar H10 parsing.
- Admin config hook behavior.
- i18n key parity across translations.

### Firebase backend boundaries are simple

All model calls are proxied through Cloud Functions. Secrets are server-side. Client-supplied model selection is ignored. Firestore rules isolate `users/{uid}` data to the signed-in owner. This is a good baseline architecture for a consumer app.

## Material Findings

### P0: Account deletion misses sensitive nested data and API keys

In `functions/src/account.ts:30`, deletion loops over top-level user subcollections including `sessions`. Then, only after deleting the session documents, it tries to enumerate `users/{uid}/sessions` and delete each `messages` subcollection at `functions/src/account.ts:39`.

Firestore subcollections are not automatically deleted when parent documents are deleted. Because the parent session documents are deleted first, the later query over `sessions` can return no documents, leaving orphaned `sessions/{id}/messages` data behind.

Also, the local data model exposes `apiKeys` at `src/store/db.ts:150`, and `functions/src/mcp.ts:17` authenticates MCP requests by querying all users' `apiKeys` subcollections. But `apiKeys` is not included in the account deletion collection list in `functions/src/account.ts:30`.

Impact:

- "Delete account and all data" may not actually delete all conversations.
- MCP API key hashes can persist after deletion.
- This is a serious trust and privacy issue in a mental-health-adjacent product.

Recommendation:

- Delete session message subcollections before deleting session docs, or use a recursive delete mechanism.
- Include `apiKeys` and any newer collections in the deletion plan.
- Add a test that creates a session with nested messages and an API key, calls deletion, and verifies no user-owned documents or subcollection documents remain.
- Maintain a single canonical user-owned collection registry used by export, deletion, admin, and rules tests.

### P0: Export is not a full data export

`src/store/dataExport.ts:234` exports a fixed list of collections. It includes `sessions`, `hrvSessions`, and `relaxSessions`, but `buildMarkdownExport` mainly renders diary entries, parts, memories, thoughts, interactions, summaries, fossils, letters, and `sessionLog`. It does not render nested `sessions/{id}/messages` at all.

It also does not appear to include every user-owned collection exposed in `src/store/db.ts`, including `apiKeys` and `diagnostics`. Some of those should not expose secrets, but the export behavior needs an intentional policy rather than accidental omission.

Impact:

- Settings says "Export all data" in `src/i18n/translations/en.ts:59`.
- Policy says users can export all data in `src/i18n/translations/en.ts:232`.
- Actual export is partial, especially for session conversations.

Recommendation:

- Decide whether export is "human-readable journal export" or "complete data export." The UI and policy currently imply complete.
- Offer two files: `journal.md` for readable export and `data.json` for full portability.
- Include nested session messages, session metadata, HRV/relax summaries, consent records, personal facts, inner weather, and diagnostics metadata where appropriate.
- For API keys, export key names/created/last-used/revoked status, never raw key material.

### P0: Privacy/policy text says OpenRouter, code uses OpenAI

The English policy says text is sent to OpenRouter in `src/i18n/translations/en.ts:226`, and the same OpenRouter claim appears across translations. `README.md` also describes OpenRouter and Gemini 3 Flash.

The actual function code uses OpenAI:

- `functions/src/shared/models.ts:4`: `OPENAI_CHAT_MODEL = 'gpt-5.5'`.
- `functions/src/chat.ts:178`: calls `https://api.openai.com/v1/chat/completions`.
- `functions/src/realtime.ts:75`: calls `https://api.openai.com/v1/realtime/client_secrets`.
- `functions/src/shared/secrets.ts`: `OPENAI_API_KEY`.

Impact:

- The privacy policy is materially inaccurate.
- Users are making consent decisions based on the wrong AI provider.
- This increases regulatory and reputational risk.

Recommendation:

- Update policy in every locale before broader release.
- Name the actual subprocessors and categories: OpenAI for chat/realtime, ElevenLabs for custom soundscapes if enabled, Firebase/Google for auth/storage/functions/hosting, Sentry for diagnostics if enabled, Google Analytics/Ads if enabled.
- State plainly that journal/session content may be sent to AI providers for processing. Removing name/email does not make raw diary text anonymous.
- Link to provider data policies. OpenAI states API data is not used for training by default, but abuse-monitoring retention may still apply depending on account controls.

Relevant source: OpenAI platform data controls state that API data is not used to train by default and describes abuse monitoring logs: https://platform.openai.com/docs/guides/your-data

### P0: Admin settings UI silently drops many editable fields

`src/admin/AdminSettings.tsx` exposes a large editable `GlobalConfig`: `defaultResponseSpeed`, `features`, `atmosphere`, `partIntelligence`, `engagement`, `grounding`, `voice`, announcement, and update signaling.

But the backend only allows these top-level config keys:

```ts
const ALLOWED_CONFIG_KEYS = new Set([
  'features', 'tuning', 'grounding', 'announcement',
])
```

See `functions/src/admin/handlers.ts:316`.

This means fields such as `defaultResponseSpeed`, `buildVersion`, `atmosphere`, `partIntelligence`, `engagement`, and `voice` are stripped during save. `useAdminConfig.signalUpdate()` sets `buildVersion` at `src/admin/useAdminConfig.ts:54`, and `useNewVersionAvailable()` depends on `buildVersion` in `src/store/globalConfig.ts:25`, so the "Signal Update" feature likely does not work against the real backend.

Impact:

- Admin UI can show success while not persisting the settings the admin changed.
- Refresh/update signaling can be broken.
- Tests around `useAdminConfig` mock the backend and therefore do not catch the server allowlist mismatch.

Recommendation:

- Update the backend allowlist to match `GlobalConfig`, or move the UI to a single `tuning` object if that is the intended contract.
- Add a function-level test for `handleUpdateConfig` that submits the exact frontend default config and asserts the returned config retains all intended keys.
- Surface backend-stripped keys as validation errors rather than silent success.

### P0: Rate limits are per-instance memory only

`functions/src/shared/rateLimit.ts:1` explicitly notes the limiter is "best-effort per-instance." It stores counters in a local `Map`.

This applies to:

- Chat: `functions/src/chat.ts:55`, 30/min per UID per function instance.
- Realtime token creation: `functions/src/realtime.ts:32`, 10/min per UID per function instance.
- MCP: `functions/src/mcp.ts:6`, 60/min per API key hash per function instance.

Impact:

- Limits reset on cold start.
- Limits multiply with function scaling.
- They do not protect budget reliably.
- Voice/realtime and GPT-5.5 can be expensive enough that this matters before public growth.

Recommendation:

- Add durable per-user usage accounting in Firestore, Redis/Memorystore, or another central quota mechanism.
- Enforce daily/monthly AI budgets by feature and plan.
- Put expensive features behind entitlement checks before generating OpenAI or ElevenLabs requests.
- Add alerting for abnormal spend and per-user abuse.

### P1: Firestore rules are owner-isolated but schema-free

`firestore.rules:4` allows any authenticated user to read and write anything under their own `users/{uid}/{document=**}` path.

That is good for user isolation but weak for production:

- No schema validation.
- No document size limits.
- No protection for function-owned collections such as computed memories, diagnostics, consent, HRV summaries, or API keys.
- A malicious user can write arbitrary self-data that admin analytics later reads.

Recommendation:

- Keep the simple owner rule for low-risk personal documents.
- Add stricter match blocks for sensitive collections: consent, apiKeys, diagnostics, summaries, memories, hrvSessions, relaxSessions.
- Consider moving API key minting to a server function so keys can have quotas, scopes, and revocation semantics.
- Add rules tests for denied writes to function-owned or shape-sensitive paths.

### P1: Admin access is broad for a privacy-sensitive category

Admin access is gated by one hardcoded email in `functions/src/shared/auth.ts:3`, mirrored client-side in `src/admin/isAdmin.ts:4`.

The admin API can retrieve raw entries, thoughts, interactions, memories, user profiles, conversations, nested session messages, diagnostics, and contact messages. See `functions/src/admin/handlers.ts:141` and `functions/src/admin/index.ts:59`.

Impact:

- The policy discloses that administrators can view data, but this is still a major trust issue for journal/mental-health content.
- A compromised admin account exposes highly sensitive user data.
- No audit trail is visible in the reviewed code.

Recommendation:

- Move admin authorization to Firebase custom claims or a dedicated role collection, not hardcoded email lists.
- Require MFA on admin accounts.
- Add immutable admin audit logs for every user-detail, session-message, diagnostics, export, or support access.
- Separate aggregate analytics from raw-content support tools.
- Consider a "support access grant" flow where users temporarily approve admin access.

### P1: Crisis handling is thoughtful but not clinical-grade

The safety flow is good for a wellness prototype, but it should not be marketed as clinical safety.

Specific risks:

- L1 regex is mostly English and explicit ideation oriented.
- L2 session risk classification is folded into the model response preamble. `src/ai/openrouter.ts:22` calls this out as fail-open when the preamble is missing, and `src/ai/openrouter.ts:174` fires `risk=0` after 80 chars without a preamble.
- The therapist prompt says skipping the preamble breaks safety, but it is still asking the same model that is producing supportive text to self-label risk.
- Crisis resources are US-first in English and rely on findahelpline.com for non-English/international users.

Recommendation:

- Keep L1 deterministic checks, but add a standalone server-side classifier for session mode too, at least for high-risk messages, rather than relying only on the response preamble.
- Treat preamble absence as a diagnostic event and fallback to the standalone classifier.
- Localize and region-resolve crisis resources.
- Add crisis evals for every supported language, or avoid implying multilingual crisis safety coverage.
- Keep disclaimers prominent and avoid "therapist" UI language.

### P1: Product language conflicts with disclaimers

The app correctly says it is not therapy in onboarding and policy:

- `src/i18n/translations/en.ts:28`
- `src/i18n/translations/en.ts:237`

But the session UI also says:

- `src/i18n/translations/en.ts:98`: "Therapist is listening"
- `src/i18n/translations/en.ts:99`: "The therapist is here..."
- `src/i18n/translations/en.ts:100`: "The therapist couldn't be reached."

And many internal concepts are named therapist/session/grounding/Real Talk/hypnotherapy. Internal names are less important, but user-facing copy matters.

Impact:

- Users may treat the product as therapy despite the disclaimer.
- Regulators and platforms may evaluate the product by the stronger claim.
- It blurs the product's best differentiation: reflective writing, not therapy replacement.

Recommendation:

- Replace user-facing "therapist" with "companion," "guide," "listener," or a branded name.
- Keep "session" if it is important, but avoid "therapeutic" claims unless pursuing clinical validation.
- Avoid "hypnotherapy" in user-facing settings unless reviewed legally and clinically.
- Make the disclaimer visible near voice/Real Talk/Relax, not only onboarding.

### P1: Bundle splitting is fighting itself

The production build passes, but Vite warns about large chunks. The largest emitted chunks were:

- `engines-*.js`: about 625 kB minified, 199 kB gzip.
- `editor-*.js`: about 376 kB minified, 120 kB gzip.
- `index-*.js`: about 246 kB minified, 76 kB gzip.
- `SessionView-*.js`: about 102 kB minified, 32 kB gzip.

`vite.config.ts:17` groups all `src/engine` modules into a manual `engines` chunk. That pulls together many features with very different usage profiles. Build warnings also note dynamic imports cannot split modules that are statically imported elsewhere. For example, `src/engine/polarH10Engine.ts:2` statically imports `hrvSignalWorker`, while `src/engine/hrvEngine.ts:185` dynamically imports it.

Impact:

- First-load cost is higher than needed.
- Users who never enable HRV/Polar/Relax can still pay for heavy engine code.
- Mobile performance and conversion can suffer.

Recommendation:

- Replace broad `src/engine` manual chunking with feature-level dynamic imports.
- Split HRV webcam, Polar H10, Relax, admin, editor, and Sentry paths separately.
- Avoid static imports of worker-heavy code in modules used by the default session path.
- Run bundle analyzer after changes.

### P1: Documentation is stale enough to slow down engineering

`README.md` still describes OpenRouter, Gemini 3 Flash, old function structure, and older product surfaces. `CLAUDE.md` is closer but still references files and flows that no longer exist, such as `LivingEditor`, `EntryChoice`, and the older `/new` choice behavior.

Impact:

- New contributors will implement against the wrong architecture.
- Operational docs can lead to setting the wrong secret.
- Product narrative in docs does not match the app users now see.

Recommendation:

- Rewrite README around the current architecture: unified SessionView, OpenAI, Realtime, soundscape API, MCP, Firebase collections, and admin.
- Add a concise architecture diagram and data lifecycle table.
- Keep a migration/change log when major concepts are removed or renamed.

### P2: SessionView is carrying too much responsibility

`src/components/Session/SessionView.tsx` is 805 lines and owns session creation/loading, messages, streaming, editor, voice, HRV, Polar H10, surface switching, relax, typewriter behavior, consent dialogs, persistence, and layout.

The file is still understandable, but it is now a coordination hub for many high-risk features.

Recommendation:

- Split into a `SessionShell` plus surface controllers: Talk, Journal, Speak, Relax.
- Move persistence/session lifecycle into a hook.
- Keep HRV/Polar orchestration behind a single biometrics adapter hook.
- Keep surface rendering dumb where possible.

## Product And Strategy Analysis

### The market is real but crowded

The mental health apps market is large and growing. Grand View Research estimates the global mental health apps market at USD 7.48B in 2024 and projected USD 17.52B by 2030, with a 14.6% CAGR from 2025 to 2030. It estimates the U.S. market at USD 2.42B in 2024 and USD 5.11B by 2030.

Sources:

- Global market: https://www.grandviewresearch.com/industry-analysis/mental-health-apps-market-report
- U.S. market: https://www.grandviewresearch.com/horizon/outlook/mental-health-apps-market/united-states

But this is not an empty market. UnderSurface sits between several categories:

| Category | Examples | What they own | UnderSurface implication |
|---|---|---|---|
| Private journaling | Apple Journal, Day One | Trust, capture, memories, media, encryption | Competing on plain journaling is hard unless privacy becomes a moat. |
| AI journaling/personal growth | Rosebud, Mindsera | Prompts, reflection, summaries, patterns, memory, voice | This is the closest competitive set. UnderSurface needs sharper differentiation. |
| Clinical/digital therapeutics | Wysa, regulated mental health tools | Evidence, care pathways, provider relationships | Avoid this category unless willing to invest in validation and compliance. |
| AI companions | Replika, Character-style bots, general LLM voice | Relationship, presence, engagement | High engagement, high scrutiny, youth/dependency risks. |
| Somatic/biofeedback wellness | Breathwork, HRV, meditation apps | Body-state feedback and guided regulation | UnderSurface has credible technical hooks, but needs careful claims. |

### Competitor notes

Apple Journal and Day One set the privacy bar.

- Apple Journal emphasizes on-device suggestions, user control over shared suggestions, passcode/Face ID lock, and end-to-end encrypted iCloud entries.
- Day One emphasizes end-to-end encryption by default and says AI features require opt-in; AI only processes selected content and does not access the journal if users do not use AI.

Sources:

- Apple Journal launch/privacy: https://www.apple.com/ne/newsroom/2023/12/apple-launches-journal-app-a-new-app-for-reflecting-on-everyday-moments/
- Apple Journaling Suggestions privacy: https://www.apple.com/legal/privacy/data/en/journaling-suggestions/
- Day One encryption: https://dayoneapp.com/features/end-to-end-encryption/
- Day One AI features/privacy: https://dayoneapp.com/guides/labs/ai-features/

Rosebud is the closest "AI reflective companion" competitor.

- Rosebud describes itself as a therapist-backed interactive journal and says it had 500M words journaled, 30M mindful minutes, and 7,500+ paying customers as of its June 2025 funding announcement.
- It positions as a therapy/coaching companion, emphasizes HIPAA-aligned practices, encrypted data, no sale of data, no training on entries, and export/delete.
- Its therapy/coaching page shows pricing around USD 12.99/mo monthly and discounted annual/practitioner-referral pricing.

Sources:

- Rosebud funding/posture: https://www.rosebud.app/blog/rosebud-raises-6m-to-expand-the-worlds-leading-ai-journal
- Rosebud therapy/coaching page: https://www.rosebud.app/therapy-and-coaching
- Rosebud Google Play listing: https://play.google.com/store/apps/details?hl=en-US&id=co.justimagine.rosebud
- Rosebud privacy policy: https://help.rosebud.app/about-us/privacy-policy

Mindsera owns the "mental fitness / thinking copilot" lane.

- Mindsera positions around AI analysis, emotions, patterns, mental models, voice journaling, smart highlights, personality assessment, weekly reviews, and privacy.
- Its public pricing shows free and paid tiers around USD 14.99/month or USD 149/year.

Source: https://mindsera.com/

Wysa shows what clinical seriousness looks like.

- Wysa has an evidence page claiming clinical trials, service evaluations, real-world studies, and 36+ peer-reviewed publications.
- It also references FDA Breakthrough Device Designation for an AI-led mental health conversational agent.

Source: https://www.wysa.com/clinical-evidence

Woebot is a cautionary example.

- Woebot's FAQ says the app was retired June 30, 2025, with new accounts unavailable and previous accounts inaccessible.

Source: https://woebothealth.com/faq/

### Regulatory and trust context is tightening

AI companion and wellness apps are under scrutiny.

- The FTC launched an inquiry into AI chatbots acting as companions, focusing on safety testing, monetization of engagement, data handling, youth impacts, and risk disclosures.
- The APA's 2025 advisory warns that general-purpose chatbots and wellness apps are being used for mental health purposes despite not being designed to treat disorders, and recommends clear disclaimers, expert involvement, safeguards, research, and human-professional boundaries.
- The FTC Health Breach Notification Rule applies to many health apps not covered by HIPAA and can require notification for breaches of identifying health information.
- Mozilla's mental health app privacy research found many popular mental health and prayer apps failed privacy/security expectations.
- FDA general wellness guidance supports low-risk wellness claims, but warns that medical or clinical-context claims can move products outside the low-risk wellness lane.

Sources:

- FTC AI companion inquiry: https://www.ftc.gov/news-events/news/press-releases/2025/09/ftc-launches-inquiry-ai-chatbots-acting-companions
- APA advisory PDF: https://www.infocop.es/wp-content/uploads/2025/11/health-advisory-ai-chatbots-wellness-apps-mental-health.pdf
- FTC Health Breach Notification Rule basics: https://www.ftc.gov/business-guidance/resources/health-breach-notification-rule-basics-business
- FTC Mobile Health Apps tool: https://www.ftc.gov/business-guidance/resources/mobile-health-apps-interactive-tool
- Mozilla privacy report: https://www.mozillafoundation.org/en/privacynotincluded/articles/top-mental-health-and-prayer-apps-fail-spectacularly-at-privacy-security/
- FDA general wellness guidance: https://www.fda.gov/media/90652/download?attachment=

### Positioning recommendation

UnderSurface should not position as "AI therapy." It should position as:

> A private reflective writing space where different inner perspectives help you notice patterns, stay with hard material, and carry insights forward.

Why this is stronger:

- It owns the app's unique mechanic.
- It reduces clinical claim exposure.
- It avoids direct comparison with Wysa-style evidence-backed tools.
- It competes with Rosebud/Mindsera while sounding less generic.
- It keeps voice/relax/HRV as supporting features rather than the brand promise.

Avoid:

- "Therapist in your pocket."
- "Therapy replacement."
- "Clinical grounding."
- "Treat anxiety/depression/PTSD."
- "Hypnotherapy" unless professionally reviewed.

Use:

- "Reflective writing."
- "Inner perspectives."
- "Pattern noticing."
- "Private journaling companion."
- "Wellness support."
- "Not medical care."

### Strategic choices

I see three plausible paths:

#### Path A: Privacy-first dialogic journal

This is the recommended near-term path.

Wedge:

- Inner voices as the differentiated interaction.
- Long memory, pattern noticing, letters, reflections.
- Strong export/delete/privacy controls.
- Optional AI with explicit consent.

Pros:

- Distinct.
- Lower clinical burden.
- Monetizable by consumers.
- Can grow into mobile.

Cons:

- Requires stronger trust posture to beat Apple/Day One expectations.
- Needs crisp onboarding so "parts" does not feel confusing.

#### Path B: Between-session therapy/coaching companion

This is possible but requires more investment.

Wedge:

- Companion for people already in therapy/coaching.
- Shareable summaries.
- Practitioner referral.
- Evidence-informed but not a provider.

Pros:

- Rosebud has validated some demand.
- Higher willingness to pay.
- Clear distribution via practitioners.

Cons:

- Requires privacy/security maturity, legal review, possibly HIPAA-aligned operations, audit logs, and therapist-facing workflows.
- Current admin access/export/delete gaps are blockers.

#### Path C: Somatic/HRV reflective wellness

This is technically interesting but should not be the first wedge.

Wedge:

- Journal plus body-state feedback.
- HRV-informed reflection and relax practices.

Pros:

- Differentiated and defensible if validated.
- Aligns with existing engine work.

Cons:

- Harder user education.
- More device/browser compatibility complexity.
- Higher claim and validation burden.
- Can distract from the core writing habit.

## Business Model And Cost Notes

The current code pins `gpt-5.5` for chat and `gpt-realtime-2` for realtime. These are valid current OpenAI model IDs per official docs, but they are premium models:

- GPT-5.5: USD 5.00 per 1M input tokens and USD 30.00 per 1M output tokens, with a 1,050,000 token context window.
- gpt-realtime-2: USD 4.00 per 1M text input tokens, USD 24.00 per 1M text output tokens, USD 32.00 per 1M audio input tokens, and USD 64.00 per 1M audio output tokens.

Sources:

- GPT-5.5 model page: https://developers.openai.com/api/docs/models/gpt-5.5
- gpt-realtime-2 model page: https://developers.openai.com/api/docs/models/gpt-realtime-2

Implications:

- Free unlimited use is not viable.
- Voice should be premium, metered, or capped.
- Long-memory prompts need budget discipline.
- Background analysis should use cheaper models where quality permits.
- Per-instance rate limits are not enough for spend control.

Suggested pricing shape:

- Free: limited sessions/reflections, no voice or low voice minutes, basic export.
- Paid consumer: USD 8-15/month, enough AI quota for daily journaling, limited voice minutes.
- Premium: more voice, HRV/Relax, advanced memory/reporting, full export/import, maybe BYOK.
- Practitioner plan later: client summaries and referral discounts only after trust hardening.

## Prioritized Recommendations

### P0: Before public growth

1. Fix account deletion and export parity.
2. Update privacy policy and translations to name actual providers and data flows.
3. Fix admin config backend allowlist or shrink frontend settings to the real contract.
4. Replace per-instance-only rate limits with durable quotas.
5. Add admin audit logs and move admin auth out of hardcoded email lists.
6. Remove user-facing "therapist" wording or get legal/clinical review for the claim.
7. Add a provider/model startup check or deploy-time smoke test so invalid model IDs and provider failures are caught early.
8. Decide whether the app is 13+, 16+, or 18+ and design youth safety accordingly.

### P1: Next engineering/product cycle

1. Rewrite README and contributor docs around the current architecture.
2. Split SessionView into surface-specific modules and session lifecycle hooks.
3. Improve bundle splitting, especially HRV/Polar/Relax/admin code paths.
4. Add full data lifecycle tests covering every user-owned collection.
5. Add standalone L2 crisis classification fallback for session mode when risk preamble is absent.
6. Build monetization and entitlement checks before expensive AI calls.
7. Add user-visible AI controls: disable AI, disable memory, delete memory, export memory, provider disclosure.
8. Add localized crisis resources for all supported locales.

### P2: Strategic moat

1. Explore client-side encryption or local-first storage for diary content.
2. Explore on-device/local models for lower-risk suggestions or summarization.
3. Build a practitioner-safe summary export only after privacy hardening.
4. Validate HRV/Relax claims with expert review and user studies.
5. Build retention loops around the core writing habit rather than feature breadth.

## Suggested Product Narrative

Short version:

> UnderSurface is a private journal that listens for the different parts of you. As you write, gentle inner perspectives help you notice patterns, stay with what is hard, and return to what matters.

Longer version:

> UnderSurface is a reflective writing companion. It is not therapy and does not diagnose or treat mental health conditions. It helps you write, notice emotional patterns, and hear from different inner perspectives that can make self-reflection easier to stay with.

This narrative supports the current code better than "AI therapist." It also gives the app room to include voice, relax, and HRV as optional modes without making them the compliance center of gravity.

## Final Assessment

UnderSurface has the raw ingredients of a compelling product: a distinctive interaction model, thoughtful prompts, strong test coverage, and a surprisingly broad technical base. The app's ceiling is not limited by code quality right now. It is limited by trust coherence and strategic focus.

The next stage should not be "add more features." It should be:

1. Make the data promises true.
2. Make the provider/policy story accurate.
3. Make the product language safer and clearer.
4. Make cost controls real.
5. Focus the market wedge.

If those are handled, the app can credibly compete in AI journaling. If not, the current breadth will magnify the risk: more surfaces, more sensitive data, more user trust required, and more places where promises can drift from behavior.
