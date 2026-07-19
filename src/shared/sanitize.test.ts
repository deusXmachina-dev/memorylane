import { describe, expect, it } from 'vitest'
import { scrubPII } from './sanitize'

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
  })

  it('leaves clean recipe text untouched', () => {
    const text = 'Open the customer thread in Gmail (mail.google.com) and read the latest reply.'
    expect(scrubPII(text)).toBe(text)
  })
})
