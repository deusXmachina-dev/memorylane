import { createHash } from 'node:crypto'
import { verifyPkce } from './pkce'

function toBase64Url(input: Buffer): string {
  return input.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

describe('verifyPkce', () => {
  it('validates plain challenge', () => {
    expect(verifyPkce('abc123', 'abc123', 'plain')).toBe(true)
    expect(verifyPkce('abc123', 'other', 'plain')).toBe(false)
  })

  it('validates S256 challenge', () => {
    const verifier = 'test-verifier-123'
    const challenge = toBase64Url(createHash('sha256').update(verifier).digest())
    expect(verifyPkce(verifier, challenge, 'S256')).toBe(true)
    expect(verifyPkce(`${verifier}x`, challenge, 'S256')).toBe(false)
  })
})
