import { describe, expect, it } from 'vitest'
import { getCapabilities } from './capabilities'

describe('getCapabilities', () => {
  it('reports openrouter supports vision, video, and tool use', () => {
    expect(getCapabilities('openrouter')).toEqual({ vision: true, video: true, toolUse: true })
  })

  it('reports openai and anthropic support vision and tool use but not video', () => {
    expect(getCapabilities('openai').video).toBe(false)
    expect(getCapabilities('openai').toolUse).toBe(true)
    expect(getCapabilities('anthropic').video).toBe(false)
    expect(getCapabilities('anthropic').toolUse).toBe(true)
  })

  it('reports openai-compatible defaults', () => {
    const caps = getCapabilities('openai-compatible')
    expect(caps.toolUse).toBe(true)
    expect(caps.video).toBe(false)
  })
})
