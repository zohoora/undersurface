import type { CompanionResponseMode } from '../shared/companionKernel.js'

export interface SmsResearchEvent {
  id: string
  protocolId: 'naturalistic-sms-v1'
  protocolVersion: 1
  assignmentKind: 'observational'
  status: 'delivered'
  source: 'sms'
  sourceId: string
  eligibilityPoint: 'sms-inbound'
  assignmentSeed: string
  assignedArm: CompanionResponseMode
  deliveredArm: CompanionResponseMode
  responseMode: CompanionResponseMode
  provider: 'openai'
  deliveryFidelity: 'model_reported'
  modelVersion: 'gpt-5.5'
  promptVersion: 'personal-science-v1'
  appVersion: '2026-07-10.1'
  createdAt: number
  deliveredAt: number
  updatedAt: number
}

export function buildSmsResearchEvent(
  inboundMessageId: string,
  outboundMessageId: string,
  responseMode: CompanionResponseMode,
  createdAt: number,
): SmsResearchEvent {
  return {
    id: `research-sms-${inboundMessageId}`,
    protocolId: 'naturalistic-sms-v1',
    protocolVersion: 1,
    assignmentKind: 'observational',
    status: 'delivered',
    source: 'sms',
    sourceId: outboundMessageId,
    eligibilityPoint: 'sms-inbound',
    assignmentSeed: inboundMessageId,
    assignedArm: responseMode,
    deliveredArm: responseMode,
    responseMode,
    provider: 'openai',
    deliveryFidelity: 'model_reported',
    modelVersion: 'gpt-5.5',
    promptVersion: 'personal-science-v1',
    appVersion: '2026-07-10.1',
    createdAt,
    deliveredAt: createdAt,
    updatedAt: createdAt,
  }
}
