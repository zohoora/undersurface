import type { Part, SessionMessage, SessionPhase, IFSRole } from '../types'
import { buildSessionNotePrompt } from '../ai/sessionPrompts'
import { chatCompletion } from '../ai/openrouter'
import { isGroundingActive } from '../hooks/useGroundingMode'

const EMERGENCE_COOLDOWN = 3
const MAX_PARTS_PER_SESSION = 3

const ROLE_KEYWORDS: Record<IFSRole, string[]> = {
  protector: ['avoid', 'ignore', 'pretend', 'fine', 'okay', 'whatever', 'anyway', 'but', 'should', 'just', 'never mind'],
  exile: ['hurt', 'miss', 'wish', 'love', 'feel', 'heart', 'pain', 'alone', 'cry', 'soft', 'remember', 'lost', 'need'],
  self: ['wonder', 'what if', 'maybe', 'breathe', 'moment', 'notice', 'space', 'quiet', 'sit with', 'here'],
  firefighter: ['do', 'change', 'act', 'move', 'enough', 'tired of', 'want', 'go', 'make', 'try', 'decide', 'fight'],
  manager: ['again', 'always', 'every time', 'pattern', 'same', 'remind', 'before', 'back then', 'cycle', 'repeat'],
}

export class SessionOrchestrator {
  detectPhase(messages: SessionMessage[]): SessionPhase {
    const userMessageCount = messages.filter(m => m.speaker === 'user').length
    if (userMessageCount < 3) return 'opening'
    if (userMessageCount >= 12) return 'closing'
    return 'deepening'
  }

  getMaxTokens(phase: SessionPhase): number {
    switch (phase) {
      case 'opening': return 100
      case 'deepening': return 200
      case 'closing': return 250
    }
  }

  selectSpeaker(
    parts: Part[],
    messages: SessionMessage[],
    hostPartId: string,
    latestUserMessage: string,
  ): Part {
    const host = parts.find(p => p.id === hostPartId) ?? parts[0]
    const phase = this.detectPhase(messages)

    // Opening phase or grounding active — always host
    if (phase === 'opening' || isGroundingActive()) return host

    // Emergence cooldown — need at least EMERGENCE_COOLDOWN user messages since last emergence
    const messagesSinceEmergence = this.userMessagesSinceLastEmergence(messages)
    if (messagesSinceEmergence < EMERGENCE_COOLDOWN) return host

    // Max parts reached — only count unique partIds that have spoken
    const uniqueSpeakers = new Set(
      messages
        .filter(m => m.speaker === 'part' && m.partId)
        .map(m => m.partId),
    )
    if (uniqueSpeakers.size >= MAX_PARTS_PER_SESSION) {
      // Can still return a participant that already spoke, but no new parts
      const participants = parts.filter(p => p.id !== hostPartId && uniqueSpeakers.has(p.id))
      for (const participant of participants) {
        const participantScore = this.scorePartRelevance(participant, latestUserMessage)
        const hostScore = this.scorePartRelevance(host, latestUserMessage)
        if (participantScore > 1.5 * hostScore) return participant
      }
      return host
    }

    // Score non-participant parts for emergence
    const text = latestUserMessage.toLowerCase()
    const hostScore = this.scorePartRelevance(host, text)

    const nonParticipants = parts.filter(p => p.id !== hostPartId && !uniqueSpeakers.has(p.id))
    let bestCandidate: Part | null = null
    let bestCandidateScore = 0

    for (const part of nonParticipants) {
      const score = this.scorePartRelevance(part, text)
      if (score > bestCandidateScore) {
        bestCandidateScore = score
        bestCandidate = part
      }
    }

    // Emergence: best candidate must score > 1.5x host AND > 15 absolute
    if (bestCandidate && bestCandidateScore > 1.5 * hostScore && bestCandidateScore > 15) {
      return bestCandidate
    }

    // Among current participants (non-host), check if any scores > 1.5x host
    const participants = parts.filter(p => p.id !== hostPartId && uniqueSpeakers.has(p.id))
    for (const participant of participants) {
      const participantScore = this.scorePartRelevance(participant, text)
      if (participantScore > 1.5 * hostScore) return participant
    }

    // Default: host
    return host
  }

  private scorePartRelevance(part: Part, text: string): number {
    const lowerText = text.toLowerCase()
    let score = 0

    // Role keywords — +10 per match
    const roleKw = ROLE_KEYWORDS[part.ifsRole] || []
    for (const keyword of roleKw) {
      if (lowerText.includes(keyword)) score += 10
    }

    // Learned keywords — +5 per match
    const learnedKw = part.learnedKeywords || []
    for (const keyword of learnedKw) {
      if (lowerText.includes(keyword)) score += 5
    }

    // Random noise for organic feel
    score += Math.random() * 10

    return score
  }

  private userMessagesSinceLastEmergence(messages: SessionMessage[]): number {
    let count = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.isEmergence) return count
      if (msg.speaker === 'user') count++
    }
    return count
  }

  async generateSessionNote(messages: SessionMessage[], partNames: string[]): Promise<string> {
    const promptMessages = buildSessionNotePrompt(messages, partNames)
    return chatCompletion(promptMessages, 15000, 300)
  }
}
