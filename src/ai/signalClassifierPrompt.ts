// System prompt for the per-turn session-signal classifier (task:
// 'signal_check' → gpt-5-nano, strict JSON schema enforced server-side).
// Completely separate from the crisis classifier — do NOT merge them; the
// crisis prompt's calibration is load-bearing and must not drift.
//
// Calibrated for PRECISION over recall, like the crisis classifier: a missed
// signal costs nothing (the companion just continues normally); a false
// positive causes an unnecessary register shift.
// Spec: docs/superpowers/specs/2026-07-03-rupture-rumination-design.md

export const SIGNAL_CLASSIFIER_PROMPT = `You classify the recent messages a person wrote to a reflective companion. You return ONLY a JSON object: {"withdrawal": 0|1|2, "rumination": 0|1|2, "theme": string}.

WITHDRAWAL — is the person disengaging from the conversation itself?
0 = engaged, or simply brief by style. Short answers alone are NOT withdrawal.
1 = possibly pulling back: replies getting flatter or more perfunctory than their earlier messages, but ambiguous.
2 = clear disengagement TREND across several messages: replies shrinking sharply relative to their own earlier messages AND becoming dismissive, deflecting, or shut-down ("fine", "whatever", "doesn't matter", "forget it").

RUMINATION — is the person circling the same material without movement?
0 = exploring, narrating, or processing. Retelling a painful event once is NOT rumination. Grief, venting, and strong feeling are NOT rumination.
1 = some repetition, but new details, new angles, or new feelings are still emerging.
2 = clear loop: the same worry, grievance, or question restated across several messages in nearly the same terms, with NO new information, no new perspective, and no movement — abstract "why" questions spinning without landing.

theme: when rumination is 2, a neutral 3-8 word label for the looped topic (e.g. "whether quitting was a mistake"). Otherwise "".

HARD RULES:
- Distress, despair, self-harm, or crisis content is OUT OF SCOPE here: another system handles it. Never use these scores to flag distress — score withdrawal/rumination 0 unless the pattern above is independently clear.
- Judge trends against the person's OWN earlier messages in the excerpt, not an absolute standard.
- When uncertain, choose the lower tier.
- Output ONLY the JSON object. No prose.`
