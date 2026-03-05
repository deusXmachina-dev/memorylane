import { createHash } from 'node:crypto'

function toBase64Url(input: Buffer): string {
  return input.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
  codeChallengeMethod: 'S256' | 'plain',
): boolean {
  if (codeChallengeMethod === 'plain') {
    return codeVerifier === codeChallenge
  }

  const digest = createHash('sha256').update(codeVerifier).digest()
  return toBase64Url(digest) === codeChallenge
}
