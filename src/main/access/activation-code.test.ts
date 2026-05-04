import { describe, expect, it } from 'vitest'
import { parseActivationCode } from './activation-code'

describe('parseActivationCode', () => {
  const tenantToken = 'tt_GigKRAyNbQ1U8jBSEKTq7uiiufT392Si'
  const email = 'alice@corp.com'
  const emailEncoded = encodeUrlSafe(email)
  const code = `${tenantToken}.${emailEncoded}`

  it('parses a well-formed activation code', () => {
    expect(parseActivationCode(code)).toEqual({ tenantToken, email })
  })

  it('trims surrounding whitespace', () => {
    expect(parseActivationCode(`  ${code}\n`)).toEqual({ tenantToken, email })
  })

  it('accepts url-safe base64 with no padding for emails that need it', () => {
    // Inputs that produce '+' or '/' in standard base64 require url-safe alphabet
    const trickyEmail = 'sub++/test@corp.com'
    const tricky = encodeUrlSafe(trickyEmail)
    expect(parseActivationCode(`${tenantToken}.${tricky}`)).toEqual({
      tenantToken,
      email: trickyEmail,
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

  it('rejects codes with more than one dot', () => {
    expect(() =>
      parseActivationCode(`${tenantToken}.${emailEncoded}.${encodeUrlSafe('https://x.com/')}`),
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
})

function encodeUrlSafe(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
