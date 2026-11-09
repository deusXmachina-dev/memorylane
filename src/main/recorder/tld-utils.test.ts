import { describe, it, expect } from 'vitest'
import { extractTld } from './tld-utils'

describe('extractTld', () => {
  it('should extract hostname from HTTPS URLs', () => {
    expect(extractTld('https://github.com/user/repo')).toBe('github.com')
    expect(extractTld('https://www.google.com/search?q=test')).toBe('www.google.com')
  })

  it('should extract hostname from HTTP URLs', () => {
    expect(extractTld('http://example.com')).toBe('example.com')
  })

  it('should extract hostname with subdomains', () => {
    expect(extractTld('https://docs.google.com/document/d/123')).toBe('docs.google.com')
    expect(extractTld('https://mail.google.com/mail/u/0')).toBe('mail.google.com')
  })

  it('should extract hostname with ports', () => {
    expect(extractTld('http://localhost:3000/path')).toBe('localhost:3000')
    expect(extractTld('https://example.com:8080')).toBe('example.com:8080')
  })

  it('should return null for null/undefined/empty', () => {
    expect(extractTld(null)).toBeNull()
    expect(extractTld(undefined)).toBeNull()
    expect(extractTld('')).toBeNull()
  })

  it('should return null for invalid URLs', () => {
    expect(extractTld('not-a-url')).toBeNull()
    expect(extractTld('just some text')).toBeNull()
    expect(extractTld('://missing-scheme')).toBeNull()
  })
})
