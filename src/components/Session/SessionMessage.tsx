import { memo, useMemo } from 'react'
import type { SessionMessage as SessionMessageType } from '../../types'
import { RecommendationSegments } from './RecommendationSegments'
import { PartProposalCard } from './PartProposalCard'
import { ValueProposalCard } from './ValueProposalCard'
import { IntentionCard } from './IntentionCard'
import { extractPartProposal, extractValueProposal, extractPresence } from '../../ai/partProposalParser'
import { extractIntentionOffer } from '../../ai/intentionOfferParser'
import { extractPromiseMarkers } from '../../ai/promiseParser'
import { scrubLeakedRiskMarker } from '../../ai/openrouter'

interface Props {
  message: SessionMessageType
  onRecommendationTap?: (target: string) => void
  // Set only for the ACTIVE session with the sessionIntentions flag on —
  // history and closed sessions never grow offer cards.
  intentionOfferSessionId?: string | null
}

export const SessionMessageBubble = memo(function SessionMessageBubble({
  message,
  onRecommendationTap,
  intentionOfferSessionId,
}: Props) {
  const isUser = message.speaker === 'user'
  // Therapist messages persisted while older parsers were live can carry a
  // leaked `<<RISK:N>>` preamble — scrub at render so history stays clean.
  const scrubbed = isUser ? message.content : scrubLeakedRiskMarker(message.content)
  // Part-proposal / intention-offer markers: phrases render as plain text; the
  // consent cards render beneath.
  const { content, proposal, offer, valueProposal, presence } = useMemo(() => {
    if (isUser) return { content: scrubbed, proposal: null, offer: null, valueProposal: null, presence: false }
    const partPass = extractPartProposal(scrubbed)
    const valuePass = extractValueProposal(partPass.cleanText)
    const offerPass = extractIntentionOffer(valuePass.cleanText)
    const promisePass = extractPromiseMarkers(offerPass.cleanText)
    const presencePass = extractPresence(promisePass.cleanText)
    return { content: presencePass.cleanText, proposal: partPass.proposal, offer: offerPass.offer, valueProposal: valuePass.proposal, presence: presencePass.presence }
  }, [isUser, scrubbed])
  const showRecommendations =
    !isUser && typeof message.content === 'string' && onRecommendationTap

  return (
    <>
      {message.isEmergence && !isUser && (
        <div style={{
          height: 1,
          background: 'linear-gradient(to right, transparent, var(--border-subtle), transparent)',
          margin: '24px 0',
        }} />
      )}
      <div style={{ marginBottom: 20, opacity: isUser ? 1 : 0.88 }}>
        {!isUser && message.partName && (
          <div style={{
            fontSize: 11,
            fontFamily: "'Inter', sans-serif",
            fontWeight: 500,
            color: 'var(--text-secondary)',
            marginBottom: 4,
            letterSpacing: '0.02em',
          }}>
            {message.partName}
          </div>
        )}
        <div
          className="session-message-text"
          style={{
            color: isUser ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontStyle: isUser ? 'normal' : 'italic',
          }}
        >
          {showRecommendations
            ? <RecommendationSegments text={content} onTap={onRecommendationTap} />
            : content}
        </div>
        {presence && intentionOfferSessionId && (
          <div aria-hidden="true" style={{ marginTop: 6 }}>
            <span style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--text-secondary)',
              opacity: 0.5,
              animation: 'us-presence-breathe 4s ease-in-out infinite',
            }} />
          </div>
        )}
        {proposal && <PartProposalCard partId={proposal.partId} />}
        {valueProposal && <ValueProposalCard valueId={valueProposal.valueId} />}
        {offer && intentionOfferSessionId && (
          <IntentionCard phrase={offer.phrase} sessionId={intentionOfferSessionId} />
        )}
      </div>
    </>
  )
})
