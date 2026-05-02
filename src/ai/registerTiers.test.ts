import { describe, it, expect } from 'vitest'
import { REGISTER_TIERS, REGISTER_TIER_IDS, THERAPY_JARGON_BAN, renderRegisterBlock, applyGroundingCap } from './registerTiers'

describe('REGISTER_TIERS', () => {
  it('contains exactly the ids in REGISTER_TIER_IDS', () => {
    expect(Object.keys(REGISTER_TIERS).sort()).toEqual([...REGISTER_TIER_IDS].sort())
  })

  it('plain has the shortest sentence cap', () => {
    expect(REGISTER_TIERS.plain.sentenceCap).toBeLessThan(REGISTER_TIERS.conversational.sentenceCap!)
  })

  it('literate and scholarly have no sentence cap', () => {
    expect(REGISTER_TIERS.literate.sentenceCap).toBeNull()
    expect(REGISTER_TIERS.scholarly.sentenceCap).toBeNull()
  })

  it('every tier has a Wrong/Right example pair', () => {
    for (const tier of Object.values(REGISTER_TIERS)) {
      expect(tier.exampleWrong.length).toBeGreaterThan(0)
      expect(tier.exampleRight.length).toBeGreaterThan(0)
      expect(tier.exampleWrong).not.toEqual(tier.exampleRight)
    }
  })
})

describe('THERAPY_JARGON_BAN', () => {
  it('includes core jargon terms', () => {
    expect(THERAPY_JARGON_BAN).toContain('dysregulation')
    expect(THERAPY_JARGON_BAN).toContain('somatic')
    expect(THERAPY_JARGON_BAN).toContain('attunement')
  })
})

describe('renderRegisterBlock', () => {
  it('includes the tier description', () => {
    const block = renderRegisterBlock(REGISTER_TIERS.plain)
    expect(block).toContain(REGISTER_TIERS.plain.description)
  })

  it('lists the global therapy-jargon ban for every tier', () => {
    for (const tier of Object.values(REGISTER_TIERS)) {
      const block = renderRegisterBlock(tier)
      expect(block).toContain('dysregulation')
      expect(block).toContain('somatic')
    }
  })

  it('does not duplicate words when a tier-specific ban overlaps the global ban', () => {
    // Defensive: if someone adds 'somatic' to a tier's bannedWords by accident,
    // the rendered list should not contain it twice (current impl does NOT dedupe;
    // this test documents the contract that bannedWords MUST NOT overlap THERAPY_JARGON_BAN).
    for (const tier of Object.values(REGISTER_TIERS)) {
      for (const tierBan of tier.bannedWords) {
        expect(THERAPY_JARGON_BAN).not.toContain(tierBan)
      }
    }
  })

  it('includes tier-specific bans for plain', () => {
    const block = renderRegisterBlock(REGISTER_TIERS.plain)
    expect(block).toContain('profound')
    expect(block).toContain('intricate')
  })

  it('does not add tier-specific bans for conversational', () => {
    const block = renderRegisterBlock(REGISTER_TIERS.conversational)
    expect(block).not.toContain('profound')
    expect(block).not.toContain('intricate')
  })

  it('includes the Wrong/Right example pair', () => {
    const block = renderRegisterBlock(REGISTER_TIERS.conversational)
    expect(block).toContain(REGISTER_TIERS.conversational.exampleWrong)
    expect(block).toContain(REGISTER_TIERS.conversational.exampleRight)
  })

  it('includes the sentence cap line when sentenceCap is set', () => {
    const block = renderRegisterBlock(REGISTER_TIERS.plain)
    expect(block).toContain('12 words or fewer')
  })

  it('omits the sentence cap line when sentenceCap is null', () => {
    const block = renderRegisterBlock(REGISTER_TIERS.literate)
    expect(block).not.toMatch(/words or fewer/)
  })

  it('voice mode caps literate down to conversational', () => {
    const literateVoice = renderRegisterBlock(REGISTER_TIERS.literate, 'voice')
    const conversationalDesktop = renderRegisterBlock(REGISTER_TIERS.conversational, 'desktop')
    // The tier-defining content should match the conversational tier
    expect(literateVoice).toContain(REGISTER_TIERS.conversational.description)
    expect(literateVoice).toContain(REGISTER_TIERS.conversational.exampleRight)
    expect(literateVoice).not.toContain(REGISTER_TIERS.literate.exampleRight)
    expect(literateVoice).toContain('18 words or fewer')
    // Voice modality directive only appears in voice version
    expect(literateVoice).toContain('speaking aloud')
    expect(conversationalDesktop).not.toContain('speaking aloud')
  })

  it('voice mode caps scholarly down to conversational', () => {
    const block = renderRegisterBlock(REGISTER_TIERS.scholarly, 'voice')
    expect(block).toContain(REGISTER_TIERS.conversational.description)
    expect(block).not.toContain(REGISTER_TIERS.scholarly.exampleRight)
  })

  it('voice mode preserves plain', () => {
    const block = renderRegisterBlock(REGISTER_TIERS.plain, 'voice')
    expect(block).toContain(REGISTER_TIERS.plain.description)
    expect(block).toContain('profound') // tier-specific ban still present
    expect(block).toContain('12 words or fewer') // plain's tighter cap preserved
    expect(block).toContain('speaking aloud')
  })

  it('voice mode preserves conversational', () => {
    const block = renderRegisterBlock(REGISTER_TIERS.conversational, 'voice')
    expect(block).toContain(REGISTER_TIERS.conversational.description)
    expect(block).toContain('speaking aloud')
  })

  it('mobile mode adds tight-response directive', () => {
    const block = renderRegisterBlock(REGISTER_TIERS.conversational, 'mobile')
    expect(block).toContain('small screen')
    expect(block).not.toContain('speaking aloud')
  })

  it('desktop mode adds no modality directive', () => {
    const block = renderRegisterBlock(REGISTER_TIERS.conversational, 'desktop')
    expect(block).not.toContain('speaking aloud')
    expect(block).not.toContain('small screen')
  })

  it('defaults to desktop when currentInputMode is omitted', () => {
    const explicit = renderRegisterBlock(REGISTER_TIERS.conversational, 'desktop')
    const implicit = renderRegisterBlock(REGISTER_TIERS.conversational)
    expect(implicit).toEqual(explicit)
  })
})

describe('applyGroundingCap', () => {
  it('collapses literate to conversational', () => {
    expect(applyGroundingCap(REGISTER_TIERS.literate).id).toBe('conversational')
  })

  it('collapses scholarly to conversational', () => {
    expect(applyGroundingCap(REGISTER_TIERS.scholarly).id).toBe('conversational')
  })

  it('passes through plain unchanged', () => {
    expect(applyGroundingCap(REGISTER_TIERS.plain).id).toBe('plain')
  })

  it('passes through conversational unchanged', () => {
    expect(applyGroundingCap(REGISTER_TIERS.conversational).id).toBe('conversational')
  })
})
