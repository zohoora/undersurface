import { describe, it, expect } from 'vitest'
import { extractPartProposal, containsPartProposal } from './partProposalParser'

describe('extractPartProposal', () => {
  it('extracts the proposal and renders the phrase as plain text', () => {
    const input = 'I have noticed [a part of you that braces — does that feel true?](#propose-part:up-42) lately.'
    const { cleanText, proposal } = extractPartProposal(input)
    expect(cleanText).toBe('I have noticed a part of you that braces — does that feel true? lately.')
    expect(proposal).toEqual({ partId: 'up-42', phrase: 'a part of you that braces — does that feel true?' })
  })

  it('returns null proposal and untouched text when no marker exists', () => {
    const { cleanText, proposal } = extractPartProposal('Just a normal reply.')
    expect(cleanText).toBe('Just a normal reply.')
    expect(proposal).toBeNull()
  })

  it('keeps only the first proposal; extra markers are stripped to phrases', () => {
    const input = '[first](#propose-part:a) and [second](#propose-part:b)'
    const { cleanText, proposal } = extractPartProposal(input)
    expect(cleanText).toBe('first and second')
    expect(proposal?.partId).toBe('a')
  })

  it('ignores malformed markers and does not touch recommendation markers', () => {
    const input = '[phrase](#propose-part:) and [go gentler](#switch:relax)'
    const { cleanText, proposal } = extractPartProposal(input)
    expect(proposal).toBeNull()
    expect(cleanText).toContain('[go gentler](#switch:relax)') // untouched — different marker family
  })
})

describe('containsPartProposal', () => {
  it('detects presence cheaply', () => {
    expect(containsPartProposal('x [p](#propose-part:id-1) y')).toBe(true)
    expect(containsPartProposal('x [p](#switch:relax) y')).toBe(false)
  })
})
