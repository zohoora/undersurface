# SMS Field Bridge

**Date:** 2026-07-09  
**Status:** Implemented, deployed, and verified on a live handset; natural-interaction revision completed 2026-07-09

## Goal

Extend UnderSurface into ordinary daily life without turning SMS into a full replacement for a reflective session. SMS is a natural field channel: the writer simply texts, while GPT-5.5 decides how much the moment needs and whether any explicit detail deserves continuity into a later session.

## Interaction grammar

- Ordinary text → GPT-5.5 chooses a concise SMS-appropriate response length; most replies are 1-3 sentences, with room to expand to 6 when complexity warrants it and a 1,200-character hard backstop
- The same structured model turn returns whether to carry forward a concise, source-grounded field note; casual or transient messages remain transcript-only
- `HELP` → explain the natural SMS behavior
- `UNLINK` → disconnect the phone
- `LINK <code>` → complete account linking with a 10-minute code generated in Settings
- Carrier-standard opt-out words → unlink locally and defer the standardized response to Twilio

## Architecture

1. `smsApi` validates the Twilio webhook signature and message envelope.
2. Deterministic account controls and linking respond synchronously with TwiML.
3. Conversational messages are stored under `users/{uid}/smsMessages` and queued in `smsInbound/{MessageSid}`.
4. `smsInboundProcessor` claims the queue item, applies the shared L1 hard floor and calibrated L2 classifier, then asks GPT-5.5 for a structured adaptive-length reply plus an optional field note before sending through Twilio.
5. `sessionContextLoader` loads only selected field notes as weak, source-grounded context for later Talk and Speak sessions. Full SMS messages remain available for short-term SMS continuity and export.
6. SMS messages participate in export and account deletion. Link codes, phone mappings, and processing queues are server-owned top-level collections.

## Research constraints

- Selected SMS field notes are observations, not identity evidence.
- The companion never announces a longitudinal pattern from SMS notes alone.
- The selection prompt rejects inferred motives, diagnoses, stable traits, and the companion's own advice; notes must stay grounded in explicit writer content.
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
- Live link, natural adaptive response, structured save/no-save decisions, `UNLINK`, and crisis-floor test
- Account deletion zero-residue test
