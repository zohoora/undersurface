import { describe, expect, it } from 'vitest'
import { buildRoomScore, detectRoomCommand, roomCuesInWindow, roomVoiceDensityAfter } from './roomEngine'

describe('roomEngine', () => {
  it('uses one monotonic score with a single return cue', () => {
    const score = buildRoomScore(5, 'sparse')
    expect(score.map(cue => cue.kind)).toEqual(['arrival', 'company', 'return'])
    expect(score.map(cue => cue.atMs)).toEqual([...score].map(cue => cue.atMs).sort((a, b) => a - b))
    expect(score.filter(cue => cue.kind === 'return')).toHaveLength(1)
  })

  it('keeps quiet company truly quiet', () => {
    expect(buildRoomScore(10, 'quiet')).toEqual([])
  })

  it('adjusts voice density without jumping from quiet to present', () => {
    expect(roomVoiceDensityAfter('present', 'less_voice')).toBe('sparse')
    expect(roomVoiceDensityAfter('sparse', 'less_voice')).toBe('quiet')
    expect(roomVoiceDensityAfter('quiet', 'more_voice')).toBe('sparse')
  })

  it('recognizes natural spoken controls', () => {
    expect(detectRoomCommand('Could you talk less?')).toBe('less_voice')
    expect(detectRoomCommand('Just silence for a while')).toBe('quiet')
    expect(detectRoomCommand('Can we change the soundscape?')).toBe('change_sound')
    expect(detectRoomCommand("That's enough for me")).toBe('end')
    expect(detectRoomCommand('I notice my shoulders dropping')).toBeNull()
  })

  // TECH_ISSUES_2026-10-14 #4: ordinary speech must never be read as a control.
  it.each([
    'At the end of the day I just feel tired',
    'I need to finish my thesis',
    "Honestly I'm done with him",
    'I want it all to end',
    "My boss wouldn't stop talking",
    "I haven't told her, not yet",
    'I just keep going and going',
    'end',
    'Finish.',
    'The end',
    "I'm done with all of this, I can't keep doing it",
    // Codex review T4: negation and reported speech.
    "Please don't stop now",
    "I'm not yet ready to talk about it",
    'she said "that\'s enough"',
    'He told me to be quiet',
    "Don't end this room",
    "That's not enough",
    "I'm not done",
    'Never stop talking',
  ])('treats %j as conversation, not a command', utterance => {
    expect(detectRoomCommand(utterance)).toBeNull()
  })

  it.each([
    ["that's enough", 'end'],
    ['That’s enough.', 'end'],
    ['less voice', 'less_voice'],
    ['be quiet', 'quiet'],
    ['Be quiet, please.', 'quiet'],
    ['change the sound', 'change_sound'],
    ['another minute', 'stay'],
    ['Okay, not yet', 'stay'],
    ['no more voice', 'quiet'],
    ['more voice please', 'more_voice'],
    ['End this room.', 'end'],
    ['Okay, end the room', 'end'],
  ] as const)('still recognizes the short whole utterance %j', (utterance, command) => {
    expect(detectRoomCommand(utterance)).toBe(command)
  })

  it('only recognizes spoken controls in English sessions', () => {
    expect(detectRoomCommand('be quiet', 'en')).toBe('quiet')
    expect(detectRoomCommand('be quiet', 'en-GB')).toBe('quiet')
    expect(detectRoomCommand('be quiet', 'de')).toBeNull()
    expect(detectRoomCommand("that's enough", 'ja')).toBeNull()
  })

  it('ignores long utterances even when they end in a control phrase', () => {
    expect(detectRoomCommand('could you please please please please talk less')).toBeNull()
  })
})

describe('Room cue clock', () => {
  it('returns only cues inside the current tick window', () => {
    const score = buildRoomScore(5, 'sparse')
    expect(roomCuesInWindow(score, -1, 250).map(cue => cue.kind)).toEqual(['arrival'])
    expect(roomCuesInWindow(score, 250, 500)).toEqual([])
  })

  it('does not replay past cues after a density change rebuilds the score', () => {
    // Two minutes into a 5-minute room the writer asks for more voice: the new
    // "present" score has arrival at 0 and company at 102s, both in the past.
    const present = buildRoomScore(5, 'present')
    expect(roomCuesInWindow(present, 120_000, 120_250)).toEqual([])
    expect(roomCuesInWindow(present, 197_750, 198_000).map(cue => cue.kind)).toEqual(['company'])
  })

  it('moves the return cue with a "stay another minute" extension', () => {
    const base = buildRoomScore(2, 'sparse').find(cue => cue.kind === 'return')!
    const extended = buildRoomScore(2, 'sparse', 60_000).find(cue => cue.kind === 'return')!
    expect(extended.atMs - base.atMs).toBe(60_000)
  })
})
