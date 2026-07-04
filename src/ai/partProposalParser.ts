// Parses the part-proposal marker the therapist prompt teaches:
//   [<offering phrase>](#propose-part:<userPartId>)
// The phrase renders as normal text; the id drives the confirm card rendered
// beneath the message. Only the FIRST marker counts (the prompt contract is
// one offer per session); any extras are stripped to their phrases.
// Spec: docs/superpowers/specs/2026-07-04-user-parts-model-design.md

const PATTERN = /\[([^\]]+)\]\(#propose-part:([\w-]+)\)/g

export interface PartProposalExtraction {
  cleanText: string
  proposal: { partId: string; phrase: string } | null
}

export function extractPartProposal(text: string): PartProposalExtraction {
  let proposal: PartProposalExtraction['proposal'] = null
  const cleanText = text.replace(PATTERN, (_full, phrase: string, partId: string) => {
    if (!proposal) proposal = { partId, phrase }
    return phrase
  })
  return { cleanText, proposal }
}

// Cheap pre-check used by the stream wiring to decide whether a finalized
// message actually contained an offer (stamps proposedAt only then).
export function containsPartProposal(text: string): boolean {
  return /\]\(#propose-part:[\w-]+\)/.test(text)
}

// Same mechanics for value proposals: [phrase](#propose-value:<userValueId>).
const VALUE_PATTERN = /\[([^\]]+)\]\(#propose-value:([\w-]+)\)/g

export function extractValueProposal(text: string): { cleanText: string; proposal: { valueId: string; phrase: string } | null } {
  let proposal: { valueId: string; phrase: string } | null = null
  const cleanText = text.replace(VALUE_PATTERN, (_full, phrase: string, valueId: string) => {
    if (!proposal) proposal = { valueId, phrase }
    return phrase
  })
  return { cleanText, proposal }
}

export function containsValueProposal(text: string): boolean {
  return /\]\(#propose-value:[\w-]+\)/.test(text)
}
