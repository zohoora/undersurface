# Experience Intelligence Program

**Date:** 2026-07-10
**Status:** Implemented and verified locally

## Goal

Turn UnderSurface's surfaces and channels into one longitudinal experience that gathers fragments without rushing to explain them, learns which interaction grammar helps in which context, and ends or hands off cleanly when more conversation would add little.

This program implements eight connected ideas:

1. Field Mosaic
2. Shared response grammar
3. Concrete Episode switch
4. User-first generativity
5. Memory Aperture and memory ledger
6. Immediate and delayed outcomes
7. Optimal Ending
8. Seamless surface arcs

## Load-bearing principles

- These are shared companion capabilities, not SMS-only features.
- Stable intelligence belongs in the shared companion kernel; channel adapters expose only supported mechanics.
- Crisis and grounding are never experimental conditions. Grounding suppresses memory-derived relational programs, response experiments, outcomes, and surface arcs.
- The model may propose; the writer controls memory, interpretation, movement between surfaces, and whether to answer research prompts.
- Personalization learns context-conditioned intervention response, never a fixed personality verdict.
- Brief interactions are allowed to remain brief. SMS is a field channel, not a compressed session.
- The model does not grade its own intervention. User-reported immediate and delayed outcomes are the primary signal.

## Shared response grammar

The companion chooses one internal response mode per turn:

```text
witness | reflect | clarify | make_concrete | user_first |
offer_action | offer_quiet | handoff | close_warmly
```

The grammar changes structure, not persona. `make_concrete` asks for one bounded scene instead of debating an abstract conclusion. `user_first` invites the writer to generate language for another person or part before the companion adds language. `close_warmly` explicitly permits a good-enough ending without another question.

SMS records the mode through its existing structured response. Talk uses visible rich-action markers only for mechanics that need UI (`#switch:*`, `#end:session`); ordinary witness/reflect/concrete/user-first moves remain natural prose. Voice receives the same grammar without markers. Journal/Relax/Drift remain distinct practices but can be entered through reversible arcs.

## Memory Aperture

`MemoryAperture` has four modes:

- `fresh` — no autobiographical continuity
- `light` — confirmed facts, current threads, and recent source-grounded notes
- `pattern` — full enabled longitudinal context (current behavior)
- `counterstory` — full context plus an explicit search for exceptions and limiting cases

The per-user default lives in `companionPreferences/current`; each session snapshots an override. SMS reads the same preference. The shared kernel filters context, so new channels cannot bypass the aperture accidentally.

## Durable data

Only three new user subcollections are introduced:

### `fieldMoments`

Source-grounded fragments selected from SMS/MMS and completed-session reflection. Fields include source channel/surface, source id, exact or concise text, optional authenticated Storage paths, timestamp, review state, user meaning, and optional connections to other moments.

### `companionPreferences`

Singleton `current`: default memory aperture, Field Mosaic enablement, and outcome-sampling level.

### `interventionOutcomes`

Sparse records for actually delivered/sampled companion moves and surface arcs, with immediate (`helped`, `nothing`, `worse`, `not_wanted`) and delayed (`stayed`, `used`, `nothing`, `regret`, `changed_mind`) user reports. No record is inferred from silence.

All three join the client proxy, export, account-deletion registry, and tests. Field-moment Storage objects live below `field-moments/{uid}/` and are deleted with the account.

## Field Mosaic

Recent unreviewed moments appear as a small, quiet mosaic at the beginning of an eligible session. A tile may contain text, an authenticated image, source, and time. The writer can:

- open one moment into Talk;
- keep or dismiss it;
- connect two moments;
- add or correct its meaning;
- say that no moment matters now.

The model does not synthesize a pattern merely because several tiles coexist. Connections are user-authored or explicitly confirmed.

## Outcome sampling

Sampling is sparse and deterministic enough to test. It never appears during grounding, on the first turn, twice in a row, or after every response. Eligible in-app companion messages may show one compact “What did that do?” pulse. SMS moments can receive the same pulse when reviewed in the app. A pending delayed pulse may appear at the next session opening.

ClosingCheckIn remains the low-burden session-level signal and also writes an outcome record.

## Optimal endings and surface arcs

Web rich actions add:

- `#end:session` — a warm companion-proposed ending rendered as an explicit user-controlled button
- `#switch:journal-arc`
- `#switch:speak-arc`
- `#switch:relax-arc`
- `#switch:drift-arc`

An arc remembers that Talk proposed the move, enters the surface, and returns to Talk with a small non-interpretive re-entry card. Journal arcs use a short timer; voice/Relax/Drift return when their own surface closes. The user can always leave early.

## Initial experiments

1. Chronological SMS history versus Field Mosaic on next app open.
2. Witness versus one-question versus quiet close on eligible low-risk turns.
3. Companion-generated reflection versus user-first generativity.
4. Pattern aperture versus counterstory aperture.

Primary outcomes: clarity, agency, activation direction, delayed residue, real-world use, unwantedness, and regret. Message count and time in app are not primary outcomes.

## Implementation map

- Shared policy and aperture enforcement: `functions/src/shared/companionKernel.ts`
- Talk/Speak prompt integration: `src/ai/therapistPrompts.ts`, `src/hooks/useSessionStream.ts`, `src/hooks/useSessionVoice.ts`
- SMS structured response mode + Field Mosaic persistence: `functions/src/sms/{openai,prompts,context,index,moments}.ts`
- Field Mosaic and private image reads: `src/components/Session/FieldMosaic.tsx`
- Immediate/delayed learning loop: `src/components/Session/OutcomePulse.tsx`, `src/store/interventionOutcomes.ts`
- Optimal endings and reversible surface arcs: `src/ai/therapistRecommendationParser.ts`, `src/components/Session/{SurfaceArc,SessionView}.tsx`
- Memory controls and correctable ledger: `src/components/Sidebar/CompanionPreferencesSection.tsx`
- Reflection-selected exact-quote moments: `src/engine/sessionReflectionEngine.ts`
- Data lifecycle: `src/types/index.ts`, `src/store/{db,dataExport}.ts`, `functions/src/{account,shared/collections}.ts`, `storage.rules`

## Verification record

- Frontend production build and function TypeScript build
- ESLint clean
- Client unit/integration suite, including new Mosaic/outcome/arc/reflection/aperture coverage
- Cloud Functions suite, including structured SMS response mode and media persistence
- Firestore index/rules and Storage rules emulator suites under Java 21
- Mobile-width rendered smoke pass and browser console check

Authenticated browser coverage now includes a fully automated disposable-account journey through account creation, the two remaining onboarding acknowledgements, live companion responses, persisted preferences, the personal-science handshake, closing outcomes, account deletion, and rejection of the deleted credentials. The former age attestation was removed by product direction.
