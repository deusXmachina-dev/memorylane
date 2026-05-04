import { describe, expect, it } from 'vitest'
import { parseActivationCode } from './activation-code'

describe('parseActivationCode', () => {
  const tenantToken = 'tt_GigKRAyNbQ1U8jBSEKTq7uiiufT392Si'
  const email = 'alice@corp.com'
  const emailEncoded = encodeUrlSafe(email)
  const code = `${tenantToken}.${emailEncoded}`

  it('parses a well-formed activation code', () => {
    expect(parseActivationCode(code)).toEqual({ tenantToken, email, backendUrl: null })
  })

  it('trims surrounding whitespace', () => {
    expect(parseActivationCode(`  ${code}\n`)).toEqual({ tenantToken, email, backendUrl: null })
  })

  it('accepts url-safe base64 with no padding for emails that need it', () => {
    // Inputs that produce '+' or '/' in standard base64 require url-safe alphabet
    const trickyEmail = 'sub++/test@corp.com'
    const tricky = encodeUrlSafe(trickyEmail)
    expect(parseActivationCode(`${tenantToken}.${tricky}`)).toEqual({
      tenantToken,
      email: trickyEmail,
      backendUrl: null,
    })
  })

  it('rejects standard-alphabet base64 with + or /', () => {
    expect(() => parseActivationCode(`${tenantToken}.abc+def`)).toThrow(/malformed/i)
    expect(() => parseActivationCode(`${tenantToken}.abc/def`)).toThrow(/malformed/i)
  })

  it('rejects base64 with `=` padding', () => {
    const padded = Buffer.from(email, 'utf8').toString('base64')
    expect(padded.endsWith('=')).toBe(true)
    expect(() => parseActivationCode(`${tenantToken}.${padded}`)).toThrow(/malformed/i)
  })

  it('rejects an empty string', () => {
    expect(() => parseActivationCode('   ')).toThrow(/required/i)
  })

  it('rejects codes without the tt_ prefix', () => {
    expect(() => parseActivationCode(`xx_abc.${emailEncoded}`)).toThrow(/must start with `tt_`/)
  })

  it('rejects codes missing the dot separator', () => {
    expect(() => parseActivationCode(tenantToken)).toThrow(/malformed/i)
  })

  it('rejects codes with more than two dots', () => {
    expect(() =>
      parseActivationCode(
        `${tenantToken}.${emailEncoded}.${encodeUrlSafe('https://x.com/')}.extra`,
      ),
    ).toThrow(/malformed/i)
  })

  it('rejects codes with empty token or email half', () => {
    expect(() => parseActivationCode(`${tenantToken}.`)).toThrow(/malformed/i)
    expect(() => parseActivationCode(`tt_.${emailEncoded}`)).toThrow(/malformed/i)
  })

  it('rejects codes whose decoded email lacks an @', () => {
    const noAt = encodeUrlSafe('not-an-email')
    expect(() => parseActivationCode(`${tenantToken}.${noAt}`)).toThrow(/malformed/i)
  })

  describe('with embedded backend URL', () => {
    it('parses an https URL', () => {
      const url = 'https://acme.trymemorylane.com/api/'
      const encoded = encodeUrlSafe(url)
      expect(parseActivationCode(`${code}.${encoded}`)).toEqual({
        tenantToken,
        email,
        backendUrl: url,
      })
    })

    it('normalizes a missing trailing slash on the path', () => {
      const url = 'https://acme.trymemorylane.com/api'
      const encoded = encodeUrlSafe(url)
      expect(parseActivationCode(`${code}.${encoded}`)).toEqual({
        tenantToken,
        email,
        backendUrl: 'https://acme.trymemorylane.com/api/',
      })
    })

    it('allows http for localhost', () => {
      const url = 'http://localhost:8000/api/'
      const encoded = encodeUrlSafe(url)
      expect(parseActivationCode(`${code}.${encoded}`)).toEqual({
        tenantToken,
        email,
        backendUrl: url,
      })
    })

    it('rejects http for non-localhost hosts', () => {
      const encoded = encodeUrlSafe('http://acme.example.com/api/')
      expect(() => parseActivationCode(`${code}.${encoded}`)).toThrow(/malformed/i)
    })

    it('rejects an unparseable URL', () => {
      const encoded = encodeUrlSafe('not a url')
      expect(() => parseActivationCode(`${code}.${encoded}`)).toThrow(/malformed/i)
    })

    it('rejects a non-base64url third segment', () => {
      expect(() => parseActivationCode(`${code}.has spaces`)).toThrow(/malformed/i)
      expect(() => parseActivationCode(`${code}.abc+def`)).toThrow(/malformed/i)
    })

    it('rejects an empty third segment', () => {
      expect(() => parseActivationCode(`${code}.`)).toThrow(/malformed/i)
    })
  })
})

function encodeUrlSafe(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
