import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InterventionOutcome, PersonalProtocol, ResearchEvent, TransferLevel } from '../../types'

function event(id: string, arm: ResearchEvent['assignedArm']): ResearchEvent {
  return {
    id, protocolId: 'response-grammar-v1', protocolVersion: 1, assignmentKind: 'randomized',
    status: 'delivered', source: 'talk', sourceId: `m-${id}`, sessionId: 's1',
    eligibilityPoint: id, assignmentSeed: id, assignedArm: arm, deliveredArm: arm,
    context: { state: 'looping', capacity: 'few_minutes', need: 'perspective' },
    provider: arm === 'designed_silence' ? 'deterministic' : 'openai',
    promptVersion: 'personal-science-v1', appVersion: 'test', createdAt: 1, updatedAt: 1,
  }
}

function outcome(id: string, immediate: InterventionOutcome['immediate']): InterventionOutcome {
  return { id: `o-${id}`, source: 'talk', sourceId: `m-${id}`, intervention: 'reflect', immediate, researchEventId: id, createdAt: 1, updatedAt: 1 }
}

const findingEvents = [event('r1', 'make_concrete'), event('r2', 'make_concrete'), event('r3', 'reflect')]
const findingOutcomes = [outcome('r1', 'helped'), outcome('r2', 'helped'), outcome('r3', 'worse')]
let eventRows = findingEvents
let outcomeRows = findingOutcomes
let protocolRows: PersonalProtocol[] = []
const add = vi.fn(async () => {})
const update = vi.fn(async () => {})

vi.mock('../../store/db', () => ({
  db: {
    researchEvents: { orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: async () => eventRows }) }) }) },
    interventionOutcomes: { orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: async () => outcomeRows }) }) }) },
    personalProtocols: {
      orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: async () => protocolRows }) }) }),
      add,
      update,
    },
    livingHypotheses: { orderBy: () => ({ reverse: () => ({ limit: () => ({ toArray: async () => [] }) }) }) },
  },
}))

const { WhatHelpsMeSection } = await import('./WhatHelpsMeSection')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  eventRows = findingEvents
  outcomeRows = findingOutcomes
  protocolRows = []
})

describe('WhatHelpsMeSection', () => {
  it('shows sample counts and requires the writer to keep a tentative finding', async () => {
    render(<WhatHelpsMeSection isOpen />)
    await waitFor(() => expect(screen.getByText('3 rated comparisons. Findings stay tentative until you keep them.')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /My Field Manual/i }))
    expect(screen.getByText(/making it concrete may fit when you are looping/i)).toBeInTheDocument()
    expect(screen.getByText(/early signal from 3 rated moments/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep as a protocol' }))
    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', preferredArm: 'make_concrete' })))
    fireEvent.click(await screen.findByRole('button', { name: 'Practice with less help' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.stringMatching(/^personal-/), expect.objectContaining({
      transferStatus: 'learning', transferLevel: 'companion_led',
    })))
  })

  it('lets the writer graduate a final-rung comparison instead of advancing automatically', async () => {
    const protocol: PersonalProtocol = {
      id: 'p-transfer', findingKey: 'f-transfer', title: 'Make it concrete myself',
      protocolId: 'response-grammar-v1', preferredArm: 'make_concrete',
      context: { state: 'looping', capacity: 'few_minutes', need: 'perspective' },
      evidenceEventIds: ['seed'], confidence: 'emerging', status: 'active',
      transferStatus: 'learning', transferLevel: 'minimal_cue', createdAt: 1, updatedAt: 1,
    }
    const transferEvent = (id: string, level: TransferLevel): ResearchEvent => ({
      ...event(id, `transfer_${level}` as ResearchEvent['assignedArm']),
      protocolId: 'transfer-ladder-v1', personalProtocolId: protocol.id, transferLevel: level,
    })
    eventRows = [
      transferEvent('m1', 'minimal_cue'), transferEvent('m2', 'minimal_cue'), transferEvent('m3', 'minimal_cue'),
      transferEvent('i1', 'independent'), transferEvent('i2', 'independent'), transferEvent('i3', 'independent'),
    ]
    outcomeRows = [
      { ...outcome('m1', 'helped'), agency: 'same' }, { ...outcome('m2', 'helped'), agency: 'same' }, { ...outcome('m3', 'nothing'), agency: 'same' },
      { ...outcome('i1', 'helped'), agency: 'more', delayed: 'used' }, { ...outcome('i2', 'helped'), agency: 'more' }, { ...outcome('i3', 'nothing'), agency: 'same' },
    ]
    protocolRows = [protocol]

    render(<WhatHelpsMeSection isOpen />)
    fireEvent.click(await screen.findByRole('button', { name: /My Field Manual/i }))
    expect(await screen.findByText(/lighter rung preserved usefulness/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'This is mine now' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith('p-transfer', expect.objectContaining({
      transferStatus: 'graduated', transferLevel: 'independent',
    })))
  })
})
