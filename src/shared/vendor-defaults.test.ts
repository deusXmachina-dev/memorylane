import { describe, it, expect } from 'vitest'
import { buildModelChain, VENDOR_PRESETS } from './vendor-defaults'

describe('buildModelChain', () => {
  const presets = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ]

  it('returns full preset id list when userPick is empty', () => {
    expect(buildModelChain('', presets)).toEqual(['a', 'b', 'c'])
  })

  it('puts userPick first and filters it out of the tail when it matches a preset', () => {
    expect(buildModelChain('b', presets)).toEqual(['b', 'a', 'c'])
  })

  it('puts userPick first and keeps the full preset list as tail when not in presets', () => {
    expect(buildModelChain('custom-id', presets)).toEqual(['custom-id', 'a', 'b', 'c'])
  })

  it('returns empty list when both userPick and presets are empty', () => {
    expect(buildModelChain('', [])).toEqual([])
  })

  it('returns just userPick when presets are empty', () => {
    expect(buildModelChain('only-one', [])).toEqual(['only-one'])
  })

  it('produces a real fallback chain for the OpenRouter video slot', () => {
    const chain = buildModelChain(
      VENDOR_PRESETS.openrouter.semanticVideo[0].id,
      VENDOR_PRESETS.openrouter.semanticVideo,
    )
    expect(chain[0]).toBe(VENDOR_PRESETS.openrouter.semanticVideo[0].id)
    expect(chain.length).toBe(VENDOR_PRESETS.openrouter.semanticVideo.length)
  })
})
