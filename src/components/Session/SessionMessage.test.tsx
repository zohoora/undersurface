import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResearchArm, SessionMessage } from '../../types'

vi.mock('../../store/personalScience', () => ({ markResearchOverridden: vi.fn(async () => {}) }))
vi.mock('../../i18n', () => ({
  useTranslation: () => new Proxy({}, {
    get: (_target, key: string) => key === 'conductor.offer.decline' ? 'Not now' : key,
  }),
}))

const { SessionMessageBubble } = await import('./SessionMessage')

void React

afterEach(() => { cleanup() })

function conductorMessage(arm: ResearchArm): SessionMessage {
  return {
    id: `m-${arm}`,
    speaker: 'therapist',
    partId: null,
    partName: null,
    content: 'Another reply may be less useful than a change of atmosphere.',
    timestamp: 1,
    phase: 'deepening',
    isEmergence: false,
    researchEventId: 'conductor-u2',
    researchArm: arm,
  }
}

describe('SessionMessageBubble — conductor "Not now" (TECH_ISSUES #13)', () => {
  it.each(['room_arc', 'journal_arc', 'speak_arc', 'relax_arc', 'drift_arc'] as const)(
    'renders the decline control for a %s offer',
    arm => {
      render(<SessionMessageBubble message={conductorMessage(arm)} conductorOfferSessionId="sess-1" />)
      expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy()
    },
  )

  it('does not render it for non-surface conductor arms or closed sessions', () => {
    const { unmount } = render(<SessionMessageBubble message={conductorMessage('reflect' as ResearchArm)} conductorOfferSessionId="sess-1" />)
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()
    unmount()
    render(<SessionMessageBubble message={conductorMessage('room_arc')} conductorOfferSessionId={null} />)
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()
  })
})
