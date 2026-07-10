# SMS Field Bridge

**Date:** 2026-07-09  
**Status:** Implemented; production configuration and live SMS verification pending

## Goal

Extend UnderSurface into ordinary daily life without turning SMS into a full replacement for a reflective session. SMS is a bounded field channel: capture a moment, receive one useful response, request more room explicitly, or hand off into the app.

## Interaction grammar

- Normal text → one bounded field response (1-3 sentences, ≤480 characters)
- `SAVE: <text>` → persist a field note and acknowledge without starting a conversation
- `DEEP: <text>` → allow a longer response (2-6 sentences, ≤1,200 characters)
- `OPEN` → return the `/session/new` handoff link
- `HELP` → describe the grammar
- `UNLINK` → disconnect the phone
- `LINK <code>` → complete account linking with a 10-minute code generated in Settings
- Carrier-standard opt-out words → unlink locally and defer the standardized response to Twilio

## Architecture

1. `smsApi` validates the Twilio webhook signature and message envelope.
2. Deterministic commands/linking respond synchronously with TwiML.
3. Conversational messages are stored under `users/{uid}/smsMessages` and queued in `smsInbound/{MessageSid}`.
4. `smsInboundProcessor` claims the queue item, applies the shared L1 hard floor and calibrated L2 classifier, generates a bounded reply, and sends through Twilio.
5. Recent inbound fragments are loaded by `sessionContextLoader` as weak, user-authored context for later Talk and Speak sessions.
6. SMS messages participate in export and account deletion. Link codes, phone mappings, and processing queues are server-owned top-level collections.

## Research constraints

- SMS fragments are observations, not identity evidence.
- The companion never announces a longitudinal pattern from SMS fragments alone.
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
- Live link, normal response, `SAVE:`, `DEEP:`, `OPEN`, `UNLINK`, and crisis-floor test
- Account deletion zero-residue test
