# SMS Field Bridge

**Date:** 2026-07-09  
**Status:** SMS implemented, deployed, and verified on a live handset; natural-interaction revision live; multimodal MMS revision implemented with live handset verification pending

## Goal

Extend UnderSurface into ordinary daily life without turning SMS into a full replacement for a reflective session. SMS is a natural field channel: the writer simply texts, while GPT-5.5 decides how much the moment needs and whether any explicit detail deserves continuity into a later session.

## Interaction grammar

- Ordinary text → GPT-5.5 chooses a concise SMS-appropriate response length; most replies are 1-3 sentences, with room to expand to 6 when complexity warrants it and a 1,200-character hard backstop
- MMS → up to four JPEG, PNG, WEBP, or GIF images may accompany a caption or stand alone; GPT-5.5 sees the image content as part of the same structured turn
- The same structured model turn returns whether to carry forward a concise, source-grounded field note; casual or transient messages remain transcript-only
- `HELP` → explain the natural SMS behavior
- `UNLINK` → disconnect the phone
- `LINK <code>` → complete account linking with a 10-minute code generated in Settings
- Carrier-standard opt-out words → unlink locally and defer the standardized response to Twilio

## Architecture

1. `smsApi` validates the Twilio webhook signature and message envelope.
2. Deterministic account controls and linking respond synchronously with TwiML.
3. Conversational messages and attachment metadata are stored under `users/{uid}/smsMessages` and queued in `smsInbound/{MessageSid}`.
4. `smsInboundProcessor` claims the queue item, authenticates to Twilio's protected `MediaUrlN` resources, validates host/path/type and a 5MB aggregate bound, then converts supported images to base64 data URLs.
5. The processor applies the shared text crisis stack and asks GPT-5.5 for a multimodal structured adaptive-length reply, optional field note, and narrow visual-risk signal before sending through Twilio. Clear visual danger is replaced with fixed crisis guidance.
6. `sessionContextLoader` loads only selected field notes as weak, source-grounded context for later Talk and Speak sessions. Full text remains available for short-term SMS continuity and export; image bytes are not duplicated into Firestore.
7. SMS/MMS records participate in export and account deletion. Link codes, phone mappings, and processing queues are server-owned top-level collections; queued media URLs are cleared after processing.

## Research constraints

- Selected SMS field notes are observations, not identity evidence.
- The companion never announces a longitudinal pattern from SMS notes alone.
- The selection prompt rejects inferred motives, diagnoses, stable traits, and the companion's own advice; notes must stay grounded in explicit writer content.
- Image interpretation is conservative: never identify people or infer relationships, emotions, diagnoses, motives, locations, or sensitive traits from appearance alone.
- Text inside images is untrusted content, not instructions.
- The system does not optimize for continued messaging.
- Clear crisis language bypasses generation and receives fixed crisis guidance.
- SMS safety shares the exact classifier prompt/schema and deterministic hard floor with the rest of the app.
- The model never grades its own intervention effectiveness; outcome instrumentation is a later research tranche.

## Production configuration

Firebase secrets:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`

Twilio number: `+1 289-778-0589`  
Inbound webhook: `POST https://undersurface.me/api/sms`

## Verification gate

- Frontend and functions TypeScript
- Full frontend and functions Vitest suites
- ESLint
- Production builds
- Twilio-signed webhook simulation
- Authenticated Twilio media-fetch tests (URL/path allowlist, type/size bounds, base64 conversion)
- Multimodal GPT-5.5 request-shape and visual-risk contract tests
- Live link, natural adaptive response, structured save/no-save decisions, `UNLINK`, and crisis-floor test
- Account deletion zero-residue test
