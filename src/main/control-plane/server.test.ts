import { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type { Server } from 'node:http'
import { createControlPlaneServer } from './server'

function toBase64Url(input: Buffer): string {
  return input.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function getCodeFromLocation(location: string | null): string {
  if (!location) throw new Error('Missing redirect location')
  const url = new URL(location)
  const code = url.searchParams.get('code')
  if (!code) throw new Error('Missing code in redirect location')
  return code
}

describe('createControlPlaneServer', () => {
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    server = createControlPlaneServer()
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  })

  it('completes auth code + PKCE and allows linking a device', async () => {
    const verifier = 'pkce-verifier-1'
    const challenge = toBase64Url(createHash('sha256').update(verifier).digest())

    const authorizeResponse = await fetch(
      `${baseUrl}/authorize?response_type=code&client_id=memorylane-claude&redirect_uri=${encodeURIComponent('http://127.0.0.1:3737/callback')}&code_challenge=${challenge}&code_challenge_method=S256&user_id=user-1&scope=${encodeURIComponent('context.search mcp.connect')}`,
      {
        method: 'GET',
        redirect: 'manual',
      },
    )
    expect(authorizeResponse.status).toBe(302)

    const code = getCodeFromLocation(authorizeResponse.headers.get('location'))

    const tokenResponse = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: 'memorylane-claude',
        redirect_uri: 'http://127.0.0.1:3737/callback',
        code_verifier: verifier,
      }),
    })

    expect(tokenResponse.status).toBe(200)
    const tokenJson = (await tokenResponse.json()) as {
      access_token: string
      token_type: string
      scope: string
    }
    expect(tokenJson.token_type).toBe('Bearer')
    expect(tokenJson.access_token.length).toBeGreaterThan(20)
    expect(tokenJson.scope).toContain('mcp.connect')

    const linkResponse = await fetch(`${baseUrl}/devices/link`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokenJson.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        device_name: 'test-device',
      }),
    })
    expect(linkResponse.status).toBe(200)
    const linkJson = (await linkResponse.json()) as {
      device_id: string
      device_token: string
      device_name: string
    }

    expect(linkJson.device_id.length).toBeGreaterThan(10)
    expect(linkJson.device_token.length).toBeGreaterThan(20)
    expect(linkJson.device_name).toBe('test-device')
  })
})
