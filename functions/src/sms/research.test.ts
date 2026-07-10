import { describe, expect, it } from 'vitest'
import { buildSmsResearchEvent } from './research.js'

describe('SMS personal-science provenance', () => {
  it('records selected response grammar as observational, never randomized evidence', () => {
    const event = buildSmsResearchEvent('SM-in', 'SM-out', 'make_concrete', 123)
    expect(event).toMatchObject({
      id: 'research-sms-SM-in',
      protocolId: 'naturalistic-sms-v1',
      assignmentKind: 'observational',
      assignedArm: 'make_concrete',
      deliveredArm: 'make_concrete',
      modelVersion: 'gpt-5.5',
    })
    expect(JSON.stringify(event)).not.toContain('message body')
  })
})
