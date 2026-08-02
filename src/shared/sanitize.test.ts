import { describe, expect, it } from 'vitest'
import { scrubPII, scrubPromptPII } from './sanitize'

const OPENAI_KEY = 'sk-' + 'proj-Ab12Cd34Ef56Gh78Ij90'
const GH_TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'
const GH_PAT = 'github_pat_' + '11ABCDEFG0abcdefghijklmnop'
const AWS_KEY_ID = 'AKIA' + 'IOSFODNN7EXAMPLE'
const JWT = 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9P'

describe('scrubPII', () => {
  it('replaces email addresses with a typed slot', () => {
    expect(scrubPII('email jane.doe@acme.co about it')).toBe('email [email address] about it')
  })

  it('replaces phone numbers in common formats', () => {
    expect(scrubPII('call +1 (555) 123-4567 now')).toBe('call [phone number] now')
    expect(scrubPII('555-123-4567')).toBe('[phone number]')
  })

  it('replaces long identifier runs', () => {
    expect(scrubPII('order 100294 shipped')).toBe('order [id number] shipped')
  })

  it('preserves ordinary numbers in prose', () => {
    expect(scrubPII('4 steps, top 10 results')).toBe('4 steps, top 10 results')
    expect(scrubPII('sorted by rating')).toBe('sorted by rating')
  })

  it('preserves dates and year ranges', () => {
    expect(scrubPII('filter to 2026-07-19')).toBe('filter to 2026-07-19')
    expect(scrubPII('the 2026/7/9 export')).toBe('the 2026/7/9 export')
    expect(scrubPII('fiscal year 2024-2025 report')).toBe('fiscal year 2024-2025 report')
    expect(scrubPII('due 19.07.2026')).toBe('due 19.07.2026')
    expect(scrubPII('due 19. 7. 2026')).toBe('due 19. 7. 2026')
  })

  it('preserves space-grouped amounts but still scrubs spaced phones', () => {
    expect(scrubPII('budgets over 1 000 000')).toBe('budgets over 1 000 000')
    expect(scrubPII('call 777 123 456')).toBe('call [phone number]')
    expect(scrubPII('call +420 777 123 456')).toBe('call [phone number]')
  })

  it('leaves clean recipe text untouched', () => {
    const text = 'Open the customer thread in Gmail (mail.google.com) and read the latest reply.'
    expect(scrubPII(text)).toBe(text)
  })

  it('replaces secret-shaped tokens', () => {
    expect(scrubPII(`export OPENAI_API_KEY=${OPENAI_KEY}`)).toBe(
      'export OPENAI_API_KEY=[redacted secret]',
    )
    expect(scrubPII(`git push with ${GH_TOKEN}`)).toBe('git push with [redacted secret]')
    expect(scrubPII(`token ${GH_PAT} created`)).toBe('token [redacted secret] created')
    expect(scrubPII(`aws configure ${AWS_KEY_ID}`)).toBe('aws configure [redacted secret]')
    expect(scrubPII(`Authorization: Bearer ${JWT}`)).toBe('Authorization: Bearer [redacted secret]')
  })

  it('replaces labeled secret values', () => {
    expect(scrubPII('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG')).toBe(
      'AWS_SECRET_ACCESS_KEY=[redacted secret]',
    )
    expect(scrubPII('api_key: 9f8e7d6c5b4a')).toBe('api_key: [redacted secret]')
    expect(scrubPII('set max_tokens: 4096 in the request')).toBe(
      'set max_tokens: 4096 in the request',
    )
  })

  it('replaces labeled passwords', () => {
    expect(scrubPII('password: Tr0ub4dor&3')).toBe('password: [redacted password]')
    expect(scrubPII('pwd=hunter42')).toBe('pwd=[redacted password]')
    expect(scrubPII('enter your password: ')).toBe('enter your password: ')
  })

  it('replaces password-shaped tokens on the line after a password label', () => {
    expect(scrubPII('Temporary password\nSumm3r!2026\nChange on first login')).toBe(
      'Temporary password\n[redacted password]\nChange on first login',
    )
    expect(scrubPII('Change password\nSettings')).toBe('Change password\nSettings')
  })

  it('replaces labeled employee ids', () => {
    expect(scrubPII('Employee ID: EMP-04481\nDepartment: Ops')).toBe(
      'Employee ID: [redacted employee id]\nDepartment: Ops',
    )
    expect(scrubPII('Emp No. E-118245 on shift')).toBe('Emp No. [redacted employee id] on shift')
    expect(scrubPII('the employee handbook')).toBe('the employee handbook')
  })

  it('replaces labeled dates of birth but not plain dates', () => {
    expect(scrubPII('DOB: 04/12/1985')).toBe('DOB: [redacted date of birth]')
    expect(scrubPII('Date of birth: 1985-04-12')).toBe('Date of birth: [redacted date of birth]')
    expect(scrubPII('born March 3, 1990 in Ohio')).toBe('born [redacted date of birth] in Ohio')
    expect(scrubPII('meeting on 04/12/2026 moved')).toBe('meeting on 04/12/2026 moved')
  })

  it('preserves technical identifiers', () => {
    expect(scrubPII('ssh deploy@192.168.1.100 failed')).toBe('ssh deploy@192.168.1.100 failed')
    expect(scrubPII('activity 550e8400-e29b-41d4-a716-446655440000 missing')).toBe(
      'activity 550e8400-e29b-41d4-a716-446655440000 missing',
    )
    expect(scrubPII('git checkout a1b2c3d4e5f6 to bisect')).toBe(
      'git checkout a1b2c3d4e5f6 to bisect',
    )
    expect(scrubPII('saved 2026-07-03T14-26-21-980Z.md to disk')).toBe(
      'saved 2026-07-03T14-26-21-980Z.md to disk',
    )
    expect(scrubPII('JIRA OPS-11842: rotate the certs')).toBe('JIRA OPS-11842: rotate the certs')
    expect(scrubPII('trace id 7f3c9a2b1d8e4f60 logged')).toBe('trace id 7f3c9a2b1d8e4f60 logged')
  })
})

describe('scrubPromptPII', () => {
  it('keeps emails but scrubs secrets, passwords, and digit runs', () => {
    expect(scrubPromptPII('mail jane.doe@acme.co about it')).toBe('mail jane.doe@acme.co about it')
    expect(scrubPromptPII(`key ${OPENAI_KEY} leaked`)).toBe('key [redacted secret] leaked')
    expect(scrubPromptPII('password: Tr0ub4dor&3')).toBe('password: [redacted password]')
    expect(scrubPromptPII('call +1 (555) 123-4567 now')).toBe('call [phone number] now')
    expect(scrubPromptPII('order 100294 shipped')).toBe('order [id number] shipped')
  })
})
