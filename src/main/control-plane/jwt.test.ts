import { TokenIssuer } from './jwt'

describe('TokenIssuer', () => {
  it('signs and verifies access tokens', () => {
    const issuer = new TokenIssuer({ issuer: 'http://localhost:8787' })
    const token = issuer.signAccessToken({
      subject: 'user-1',
      audience: 'memorylane-control-plane',
      clientId: 'memorylane-claude',
      scope: 'context.search mcp.connect',
      ttlSeconds: 60,
    })

    const claims = issuer.verifyAccessToken(token)
    expect(claims).not.toBeNull()
    expect(claims?.sub).toBe('user-1')
    expect(claims?.aud).toBe('memorylane-control-plane')
    expect(claims?.client_id).toBe('memorylane-claude')
  })

  it('rejects tampered token', () => {
    const issuer = new TokenIssuer({ issuer: 'http://localhost:8787' })
    const token = issuer.signAccessToken({
      subject: 'user-1',
      audience: 'memorylane-control-plane',
      clientId: 'memorylane-claude',
      scope: 'context.search',
      ttlSeconds: 60,
    })

    const parts = token.split('.')
    const tampered = `${parts[0]}.${parts[1]}-tampered.${parts[2]}`
    expect(issuer.verifyAccessToken(tampered)).toBeNull()
  })
})
