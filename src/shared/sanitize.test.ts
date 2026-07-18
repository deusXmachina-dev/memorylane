import { describe, expect, it } from 'vitest'
import { scrubPII } from './sanitize'

describe('scrubPII', () => {
  it('redacts email addresses', () => {
    expect(scrubPII('email jane.doe@acme.co about it')).toBe('email [redacted] about it')
  })

  it('redacts phone numbers in common formats', () => {
    expect(scrubPII('call +1 (555) 123-4567 now')).toBe('call [redacted] now')
    expect(scrubPII('555-123-4567')).toBe('[redacted]')
  })

  it('redacts long identifier runs', () => {
    expect(scrubPII('order 100294 shipped')).toBe('order [redacted] shipped')
  })

  it('preserves ordinary numbers in prose', () => {
    expect(scrubPII('4 steps, top 10 results')).toBe('4 steps, top 10 results')
    expect(scrubPII('sorted by rating')).toBe('sorted by rating')
  })

  it('leaves clean recipe text untouched', () => {
    const text = 'Open the customer thread in Gmail (mail.google.com) and read the latest reply.'
    expect(scrubPII(text)).toBe(text)
  })
})
