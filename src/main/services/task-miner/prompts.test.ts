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

  it('asks for app-prefixed happy-path steps grounded in the cited activities', () => {
    const prompt = buildScanSystemPrompt('Monday')
    expect(prompt).toContain('"steps"')
    expect(prompt).toContain('describe only actions the cited activities evidence')
  })

  it('forbids identifying numbers but permits people, companies and emails', () => {
    const prompt = buildScanSystemPrompt('Monday')
    expect(prompt).toContain('Never copy a tax file number')
    expect(prompt).toContain('[bank account]')
    expect(prompt).toContain('[medicare number]')
    expect(prompt).toContain('People, companies and email addresses belong in the output')
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
  const UUID = '11111111-1111-4111-8111-111111111111'
  const candidate: Candidate = {
    title: 'Provision test tenant',
    subject: 'Acme staging tenant',
    description: 'Did the thing. Replace with: a script.',
    steps: ['admin.acme.com: create the tenant'],
    activity_ids: [UUID],
  }

  it('forbids identifying numbers from the OCR but permits names and emails', () => {
    const prompt = buildGroundingSystemPrompt(candidate, ['admin.acme.com'], ['a1'])
    expect(prompt).toContain('never copy a tax file number')
    expect(prompt).toContain('[redacted secret]')
    expect(prompt).toContain('Names, companies and email addresses from the OCR are fine to use')
  })

  it('carries subject through the keep-JSON so scanOnly=false persists it', () => {
    expect(buildGroundingSystemPrompt(candidate, ['admin.acme.com'], ['a1'])).toContain('"subject"')
  })

  it('asks for corrected steps in the keep-JSON', () => {
    expect(buildGroundingSystemPrompt(candidate, ['admin.acme.com'], ['a1'])).toContain('"steps"')
  })

  it('shows derived app identities and asks for no apps back', () => {
    const prompt = buildGroundingSystemPrompt(candidate, ['admin.acme.com', 'Ghostty'], ['a1'])
    expect(prompt).toContain('- Apps: admin.acme.com, Ghostty')
    expect(prompt).not.toContain('"apps"')
  })

  it('lists the handles it is given, never the candidate uuids', () => {
    const prompt = buildGroundingSystemPrompt(candidate, ['admin.acme.com'], ['a1', 'a2'])
    expect(prompt).toContain('- Activity IDs from scan: a1, a2')
    expect(prompt).not.toContain(UUID)
  })
})
