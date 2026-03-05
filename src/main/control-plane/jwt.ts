import { createSign, createVerify, generateKeyPairSync, KeyObject, randomUUID } from 'node:crypto'

interface JwtHeader {
  alg: 'ES256'
  typ: 'JWT'
  kid: string
}

export interface AccessTokenClaims {
  iss: string
  aud: string
  sub: string
  scope: string
  client_id: string
  iat: number
  exp: number
  jti: string
}

interface JwkEcPublicKey {
  crv: string
  kty: string
  x: string
  y: string
}

interface SignTokenParams {
  subject: string
  audience: string
  clientId: string
  scope: string
  ttlSeconds: number
}

export interface TokenIssuerOptions {
  issuer: string
  keyId?: string
}

function encodeBase64Url(input: string | Buffer): string {
  const asBuffer = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input
  return asBuffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replaceAll('-', '+').replaceAll('_', '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(normalized + padding, 'base64')
}

export class TokenIssuer {
  private readonly issuer: string
  private readonly privateKey: KeyObject
  private readonly publicKey: KeyObject
  private readonly keyId: string

  constructor(options: TokenIssuerOptions) {
    this.issuer = options.issuer
    this.keyId = options.keyId ?? randomUUID()

    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    })
    this.privateKey = privateKey
    this.publicKey = publicKey
  }

  public signAccessToken(input: SignTokenParams): string {
    const now = Math.floor(Date.now() / 1000)
    const claims: AccessTokenClaims = {
      iss: this.issuer,
      aud: input.audience,
      sub: input.subject,
      scope: input.scope,
      client_id: input.clientId,
      iat: now,
      exp: now + input.ttlSeconds,
      jti: randomUUID(),
    }

    const header: JwtHeader = {
      alg: 'ES256',
      typ: 'JWT',
      kid: this.keyId,
    }

    const encodedHeader = encodeBase64Url(JSON.stringify(header))
    const encodedPayload = encodeBase64Url(JSON.stringify(claims))
    const signingInput = `${encodedHeader}.${encodedPayload}`

    const signer = createSign('SHA256')
    signer.update(signingInput)
    signer.end()
    const signature = signer.sign(this.privateKey)

    return `${signingInput}.${encodeBase64Url(signature)}`
  }

  public verifyAccessToken(token: string): AccessTokenClaims | null {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [encodedHeader, encodedPayload, encodedSignature] = parts
    let header: JwtHeader
    let claims: AccessTokenClaims

    try {
      header = JSON.parse(decodeBase64Url(encodedHeader).toString('utf-8')) as JwtHeader
      claims = JSON.parse(decodeBase64Url(encodedPayload).toString('utf-8')) as AccessTokenClaims
    } catch {
      return null
    }

    if (header.alg !== 'ES256' || header.typ !== 'JWT' || header.kid !== this.keyId) {
      return null
    }

    const verifier = createVerify('SHA256')
    verifier.update(`${encodedHeader}.${encodedPayload}`)
    verifier.end()

    const signature = decodeBase64Url(encodedSignature)
    if (!verifier.verify(this.publicKey, signature)) {
      return null
    }

    const now = Math.floor(Date.now() / 1000)
    if (claims.exp <= now) {
      return null
    }

    if (claims.iss !== this.issuer) {
      return null
    }

    return claims
  }

  public getJwks(): {
    keys: Array<{
      kid: string
      use: string
      alg: string
      crv: string
      kty: string
      x: string
      y: string
    }>
  } {
    const exported = this.publicKey.export({ format: 'jwk' }) as JwkEcPublicKey
    return {
      keys: [
        {
          kid: this.keyId,
          use: 'sig',
          alg: 'ES256',
          crv: exported.crv,
          kty: exported.kty,
          x: exported.x,
          y: exported.y,
        },
      ],
    }
  }
}
