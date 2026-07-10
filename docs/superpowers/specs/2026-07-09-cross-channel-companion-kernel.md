# Cross-Channel Companion Kernel

**Date:** 2026-07-09
**Status:** Implemented for Talk, Speak, and SMS/MMS

## Decision

UnderSurface has one longitudinal companion, not a separate SMS bot, voice bot, and web bot. A channel describes the transport and available interaction mechanics. It does not define a separate personality or memory island.

The pure shared module is `functions/src/shared/companionKernel.ts`. It is imported by both the browser and Cloud Functions, so there is no generated copy to drift.

## Shared by default

All three companion channels receive the same stable continuity categories when the corresponding feature is enabled:

- recent closed-session notes
- selected SMS field notes
- reflection, pattern, and observation memories
- profile themes, emotional patterns, avoidance patterns, growth signals, and inner landscape
- concrete personal facts and current threads
- collaboratively confirmed user parts and shared lexicon
- open session intentions and their linked values
- learned stance tendencies
- confirmed values
- companion promises as supported by the surface

The shared renderer preserves the existing memory token budget and prompt-injection scrubbing. Grounding keeps foundational facts and memories available but suppresses relational companion programs such as parts, intentions, stance, values, and promises.

## Explicit channel capabilities

| Capability | Talk | Speak | SMS/MMS |
|---|---:|---:|---:|
| Longitudinal context | Yes | Yes | Yes |
| Streaming | Yes | Yes | No |
| Images in current turn | No | No | Yes |
| Session phases | Yes | Yes | No |
| Physiological context | Yes | Yes | No |
| Rich action markers/cards | Yes | No | No |
| Tracked promise delivery | Yes | Read-only | Read-only |
| In-band risk preamble | Yes | No | No |
| Hard response-character cap | No | No | 1,200 |

Capability checks are enforced inside the prompt builder, not left solely to callers. Voice cannot accidentally receive recommendation, proposal, promise, presence, or risk-preamble markers even if a future caller requests them.

## SMS server context

`functions/src/sms/context.ts` is the server-side counterpart to the browser's `sessionContextLoader`. It performs bounded Firestore reads, applies the same feature flags, deduplicates memories, filters selected field notes, and derives the shared structural context before the GPT-5.5 SMS turn.

Context loading degrades to an empty context without making SMS unavailable. The current SMS/MMS and recent SMS exchange remain separate untrusted turn input; longitudinal context is supplied through the shared system-prompt renderer.

## Feature-extension rule

When a new companion intelligence feature is added:

1. Put stable cross-channel context in `SharedCompanionContext` and render it in `buildSharedContinuityBlocks`.
2. Populate that context in both `sessionContextLoader` and `sms/context`.
3. Add a capability only if the feature requires a surface affordance.
4. Keep UI markers, consent cards, streaming protocols, or sensor inputs in thin channel adapters.
5. Add a parity test proving stable context reaches every supported channel and a negative test proving unsupported mechanics cannot leak.

This makes shared behavior the default. A feature must explicitly justify being surface-specific.

## Verification

- `src/ai/companionKernelFlow.test.ts` verifies Talk/Voice continuity and capability enforcement.
- `functions/src/shared/companionKernel.test.ts` verifies cross-channel rendering, grounding behavior, promise capability handling, and injection scrubbing.
- `functions/src/sms/context.test.ts` verifies Firestore-document derivation and feature gates.
- `functions/src/sms/openai.test.ts` verifies shared continuity reaches the real GPT-5.5 SMS request shape.
