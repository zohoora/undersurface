// Parses the closing-offer marker the therapist prompt teaches:
//   [<intention phrase, the writer's words>](#offer-intention)
// The phrase renders as normal text; the IntentionCard beneath the message
// carries consent (Keep creates the doc; skip is remembered per-tab). Only the
// FIRST marker counts; extras are stripped to their phrases.
// Spec: docs/superpowers/specs/2026-07-04-intentions-and-stance-design.md

const PATTERN = /\[([^\]]+)\]\(#offer-intention\)/g

export interface IntentionOfferExtraction {
  cleanText: string
  offer: { phrase: string } | null
}

export function extractIntentionOffer(text: string): IntentionOfferExtraction {
  let offer: IntentionOfferExtraction['offer'] = null
  const cleanText = text.replace(PATTERN, (_full, phrase: string) => {
    if (!offer) offer = { phrase }
    return phrase
  })
  return { cleanText, offer }
}
