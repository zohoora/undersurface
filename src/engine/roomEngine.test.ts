import { describe, expect, it } from 'vitest'
import { buildRoomScore, detectRoomCommand, roomVoiceDensityAfter } from './roomEngine'

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
})
