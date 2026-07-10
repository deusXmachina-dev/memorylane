import { describe, it, expect } from 'vitest'
import { buildScanSystemPrompt, buildGroundingSystemPrompt } from './prompts'
import type { Candidate } from './types'

describe('buildScanSystemPrompt', () => {
  it('omits the Known procedures section when none are supplied', () => {
    expect(buildScanSystemPrompt('Monday')).not.toContain('## Known procedures')
  })

  it('omits the Known procedures section for an empty list (byte-identical to none)', () => {
    expect(buildScanSystemPrompt('Monday', undefined, [])).toBe(buildScanSystemPrompt('Monday'))
  })

  it('lists every supplied title under Known procedures', () => {
    const prompt = buildScanSystemPrompt('Monday', undefined, [
      'Provision test tenant',
      'Review tenant devices',
    ])
    expect(prompt).toContain('## Known procedures')
    expect(prompt).toContain('- Provision test tenant')
    expect(prompt).toContain('- Review tenant devices')
  })

  it('includes the guard sentence so the list never manufactures findings', () => {
    const prompt = buildScanSystemPrompt('Monday', undefined, ['Provision test tenant'])
    expect(prompt).toContain('These are names, not evidence')
    expect(prompt).toContain('reuse the known title EXACTLY as written')
  })

  it('instructs canonical, object-free titles', () => {
    const prompt = buildScanSystemPrompt('Monday')
    expect(prompt).toContain(
      'Word it so every future run of this same procedure would get this exact title',
    )
    expect(prompt).toContain('Titles name the procedure, subjects name the object')
  })
})

describe('buildGroundingSystemPrompt', () => {
  const candidate: Candidate = {
    title: 'Provision test tenant',
    subject: 'Acme staging tenant',
    description: 'Did the thing. Replace with: a script.',
    apps: ['Admin'],
    activity_ids: ['a1', 'a2'],
  }

  it('carries subject through the keep-JSON so scanOnly=false persists it', () => {
    expect(buildGroundingSystemPrompt(candidate)).toContain('"subject"')
  })
})
