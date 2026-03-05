import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto'
import { URL } from 'node:url'
import { TokenIssuer, type AccessTokenClaims } from './jwt'
import { verifyPkce } from './pkce'
import { RelayBroker } from './relay-broker'

type Scope =
  | 'context.search'
  | 'context.timeline'
  | 'context.details'
  | 'patterns.read'
  | 'mcp.connect'

interface OAuthClient {
  clientId: string
  redirectUris: string[]
}

interface AuthorizationCodeRecord {
  code: string
  userId: string
  clientId: string
  redirectUri: string
  scope: string
  codeChallenge: string
  codeChallengeMethod: 'S256' | 'plain'
  expiresAt: number
  consumed: boolean
}

interface RefreshTokenRecord {
  token: string
  userId: string
  clientId: string
  scope: string
  expiresAt: number
}

interface DeviceRecord {
  deviceId: string
  userId: string
  deviceName: string
  tokenHash: string
  createdAt: number
  updatedAt: number
  lastSeenAt: number | null
}

interface JsonObject {
  [key: string]: unknown
}

interface ServerOptions {
  issuer: string
  audience: string
  accessTokenTtlSeconds: number
  refreshTokenTtlSeconds: number
  defaultScope: string
  pollTimeoutMs: number
  relayTimeoutMs: number
  clients: OAuthClient[]
}

const DEFAULT_OPTIONS: ServerOptions = {
  issuer: 'http://localhost:8787',
  audience: 'memorylane-control-plane',
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
  defaultScope: 'context.search context.timeline mcp.connect',
  pollTimeoutMs: 25_000,
  relayTimeoutMs: 20_000,
  clients: [
    {
      clientId: 'memorylane-claude',
      redirectUris: ['http://127.0.0.1:3737/callback', 'http://localhost:3737/callback'],
    },
  ],
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function createOpaqueToken(size = 32): string {
  return randomBytes(size).toString('base64url')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      if (Buffer.concat(chunks).length > 1024 * 1024) {
        reject(new Error('Request body too large'))
      }
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'))
    })
    req.on('error', reject)
  })
}

function parseFormBody(raw: string): Record<string, string> {
  const params = new URLSearchParams(raw)
  const result: Record<string, string> = {}
  for (const [key, value] of params.entries()) {
    result[key] = value
  }
  return result
}

function sendJson(res: ServerResponse, statusCode: number, payload: JsonObject): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}

function sendOAuthError(
  res: ServerResponse,
  statusCode: number,
  error:
    | 'invalid_request'
    | 'invalid_client'
    | 'invalid_grant'
    | 'unsupported_grant_type'
    | 'invalid_scope',
  errorDescription: string,
): void {
  sendJson(res, statusCode, {
    error,
    error_description: errorDescription,
  })
}

function getBearerToken(req: IncomingMessage): string | null {
  const raw = req.headers.authorization
  if (!raw) return null
  const [scheme, value] = raw.split(' ')
  if (scheme !== 'Bearer' || !value) return null
  return value
}

function getRequestedScope(input: string | null, fallback: string): string {
  const value = input?.trim()
  return value && value.length > 0 ? value : fallback
}

function hasRequiredScope(claims: AccessTokenClaims, required: Scope): boolean {
  const scopes = new Set(claims.scope.split(' ').filter(Boolean))
  return scopes.has(required)
}

function requiredScopeForTool(toolName: string): Scope | null {
  switch (toolName) {
    case 'search_context':
      return 'context.search'
    case 'browse_timeline':
      return 'context.timeline'
    case 'get_activity_details':
      return 'context.details'
    case 'list_patterns':
    case 'search_patterns':
    case 'get_pattern_details':
      return 'patterns.read'
    default:
      return null
  }
}

function parseClientsFromEnv(raw: string | undefined): OAuthClient[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const clients: OAuthClient[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const candidate = item as { clientId?: unknown; redirectUris?: unknown }
      if (typeof candidate.clientId !== 'string') continue
      if (!Array.isArray(candidate.redirectUris)) continue
      const uris = candidate.redirectUris.filter((uri): uri is string => typeof uri === 'string')
      if (uris.length === 0) continue
      clients.push({ clientId: candidate.clientId, redirectUris: uris })
    }
    return clients.length > 0 ? clients : null
  } catch {
    return null
  }
}

class ControlPlaneState {
  public readonly tokenIssuer: TokenIssuer
  public readonly broker = new RelayBroker()
  public readonly clientsById = new Map<string, OAuthClient>()
  public readonly authorizationCodes = new Map<string, AuthorizationCodeRecord>()
  public readonly refreshTokens = new Map<string, RefreshTokenRecord>()
  public readonly devicesById = new Map<string, DeviceRecord>()
  public readonly deviceIdByTokenHash = new Map<string, string>()
  public readonly options: ServerOptions

  constructor(options: ServerOptions) {
    this.options = options
    this.tokenIssuer = new TokenIssuer({ issuer: options.issuer })
    for (const client of options.clients) {
      this.clientsById.set(client.clientId, client)
    }
  }

  public cleanupExpired(): void {
    const now = Date.now()
    for (const [code, record] of this.authorizationCodes.entries()) {
      if (record.expiresAt <= now || record.consumed) {
        this.authorizationCodes.delete(code)
      }
    }
    for (const [token, record] of this.refreshTokens.entries()) {
      if (record.expiresAt <= now) {
        this.refreshTokens.delete(token)
      }
    }
  }

  public createAuthorizationCode(input: {
    userId: string
    clientId: string
    redirectUri: string
    scope: string
    codeChallenge: string
    codeChallengeMethod: 'S256' | 'plain'
  }): AuthorizationCodeRecord {
    const record: AuthorizationCodeRecord = {
      code: createOpaqueToken(24),
      userId: input.userId,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      scope: input.scope,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      expiresAt: Date.now() + 5 * 60 * 1000,
      consumed: false,
    }
    this.authorizationCodes.set(record.code, record)
    return record
  }

  public issueRefreshToken(input: {
    userId: string
    clientId: string
    scope: string
  }): RefreshTokenRecord {
    const record: RefreshTokenRecord = {
      token: createOpaqueToken(48),
      userId: input.userId,
      clientId: input.clientId,
      scope: input.scope,
      expiresAt: Date.now() + this.options.refreshTokenTtlSeconds * 1000,
    }
    this.refreshTokens.set(record.token, record)
    return record
  }

  public issueAccessToken(input: { userId: string; clientId: string; scope: string }): {
    token: string
    expiresIn: number
  } {
    const expiresIn = this.options.accessTokenTtlSeconds
    const token = this.tokenIssuer.signAccessToken({
      subject: input.userId,
      audience: this.options.audience,
      clientId: input.clientId,
      scope: input.scope,
      ttlSeconds: expiresIn,
    })

    return { token, expiresIn }
  }

  public upsertDevice(input: { userId: string; deviceId: string; deviceName: string }): {
    device: DeviceRecord
    deviceToken: string
  } {
    const deviceToken = createOpaqueToken(48)
    const tokenHash = sha256Hex(deviceToken)
    const now = Date.now()

    const existing = this.devicesById.get(input.deviceId)
    if (existing && existing.userId !== input.userId) {
      throw new Error('Device ID is already linked to a different user')
    }

    if (existing) {
      this.deviceIdByTokenHash.delete(existing.tokenHash)
      existing.tokenHash = tokenHash
      existing.deviceName = input.deviceName
      existing.updatedAt = now
      this.deviceIdByTokenHash.set(tokenHash, existing.deviceId)
      return { device: existing, deviceToken }
    }

    const record: DeviceRecord = {
      deviceId: input.deviceId,
      userId: input.userId,
      deviceName: input.deviceName,
      tokenHash,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: null,
    }
    this.devicesById.set(record.deviceId, record)
    this.deviceIdByTokenHash.set(tokenHash, record.deviceId)

    return { device: record, deviceToken }
  }

  public getDeviceFromToken(rawToken: string): DeviceRecord | null {
    const tokenHash = sha256Hex(rawToken)
    const deviceId = this.deviceIdByTokenHash.get(tokenHash)
    if (!deviceId) return null
    const device = this.devicesById.get(deviceId)
    if (!device) return null

    const expected = Buffer.from(device.tokenHash, 'hex')
    const actual = Buffer.from(tokenHash, 'hex')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return null
    }

    device.lastSeenAt = Date.now()
    return device
  }
}

export interface CreateControlPlaneServerInput {
  options?: Partial<ServerOptions>
}

export function createControlPlaneServer(input?: CreateControlPlaneServerInput) {
  const clientsFromEnv = parseClientsFromEnv(process.env.CONTROL_PLANE_OAUTH_CLIENTS_JSON)
  const options: ServerOptions = {
    ...DEFAULT_OPTIONS,
    ...(input?.options ?? {}),
    clients: clientsFromEnv ?? input?.options?.clients ?? DEFAULT_OPTIONS.clients,
  }
  const state = new ControlPlaneState(options)

  const server = createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendJson(res, 400, { error: 'invalid_request', error_description: 'Missing URL or method' })
        return
      }

      state.cleanupExpired()

      const url = new URL(req.url, options.issuer)
      const path = url.pathname
      const method = req.method.toUpperCase()

      if (method === 'GET' && path === '/healthz') {
        sendJson(res, 200, { ok: true, service: 'memorylane-control-plane' })
        return
      }

      if (method === 'GET' && path === '/.well-known/jwks.json') {
        sendJson(res, 200, state.tokenIssuer.getJwks())
        return
      }

      if (method === 'GET' && path === '/authorize') {
        const responseType = url.searchParams.get('response_type')
        const clientId = url.searchParams.get('client_id')
        const redirectUri = url.searchParams.get('redirect_uri')
        const stateParam = url.searchParams.get('state')
        const codeChallenge = url.searchParams.get('code_challenge')
        const codeChallengeMethod = (url.searchParams.get('code_challenge_method') ?? 'S256') as
          | 'S256'
          | 'plain'
        const userId = url.searchParams.get('user_id')
        const scope = getRequestedScope(url.searchParams.get('scope'), options.defaultScope)

        if (responseType !== 'code') {
          sendOAuthError(res, 400, 'invalid_request', 'response_type must be "code"')
          return
        }
        if (!clientId || !redirectUri || !codeChallenge || !userId) {
          sendOAuthError(
            res,
            400,
            'invalid_request',
            'client_id, redirect_uri, user_id, and code_challenge are required',
          )
          return
        }
        if (codeChallengeMethod !== 'S256' && codeChallengeMethod !== 'plain') {
          sendOAuthError(res, 400, 'invalid_request', 'Unsupported code_challenge_method')
          return
        }

        const client = state.clientsById.get(clientId)
        if (!client) {
          sendOAuthError(res, 401, 'invalid_client', 'Unknown client_id')
          return
        }
        if (!client.redirectUris.includes(redirectUri)) {
          sendOAuthError(res, 400, 'invalid_request', 'redirect_uri is not allowed for this client')
          return
        }

        const codeRecord = state.createAuthorizationCode({
          userId,
          clientId,
          redirectUri,
          scope,
          codeChallenge,
          codeChallengeMethod,
        })

        const redirect = new URL(redirectUri)
        redirect.searchParams.set('code', codeRecord.code)
        if (stateParam) {
          redirect.searchParams.set('state', stateParam)
        }

        res.statusCode = 302
        res.setHeader('Location', redirect.toString())
        res.end()
        return
      }

      if (method === 'POST' && path === '/token') {
        const rawBody = await readBody(req)
        const contentType = req.headers['content-type'] ?? ''
        const body = contentType.includes('application/json')
          ? (JSON.parse(rawBody) as Record<string, string>)
          : parseFormBody(rawBody)

        const grantType = body.grant_type
        if (!grantType) {
          sendOAuthError(res, 400, 'invalid_request', 'grant_type is required')
          return
        }

        if (grantType === 'authorization_code') {
          const code = body.code
          const clientId = body.client_id
          const redirectUri = body.redirect_uri
          const codeVerifier = body.code_verifier
          if (!code || !clientId || !redirectUri || !codeVerifier) {
            sendOAuthError(
              res,
              400,
              'invalid_request',
              'code, client_id, redirect_uri, and code_verifier are required',
            )
            return
          }

          const codeRecord = state.authorizationCodes.get(code)
          if (!codeRecord) {
            sendOAuthError(res, 400, 'invalid_grant', 'Invalid authorization code')
            return
          }
          if (codeRecord.consumed || codeRecord.expiresAt <= Date.now()) {
            sendOAuthError(res, 400, 'invalid_grant', 'Authorization code expired or already used')
            return
          }
          if (codeRecord.clientId !== clientId || codeRecord.redirectUri !== redirectUri) {
            sendOAuthError(res, 400, 'invalid_grant', 'client_id or redirect_uri mismatch')
            return
          }
          if (!verifyPkce(codeVerifier, codeRecord.codeChallenge, codeRecord.codeChallengeMethod)) {
            sendOAuthError(res, 400, 'invalid_grant', 'Invalid code_verifier')
            return
          }

          codeRecord.consumed = true

          const accessToken = state.issueAccessToken({
            userId: codeRecord.userId,
            clientId,
            scope: codeRecord.scope,
          })
          const refreshToken = state.issueRefreshToken({
            userId: codeRecord.userId,
            clientId,
            scope: codeRecord.scope,
          })

          sendJson(res, 200, {
            token_type: 'Bearer',
            access_token: accessToken.token,
            expires_in: accessToken.expiresIn,
            refresh_token: refreshToken.token,
            scope: codeRecord.scope,
          })
          return
        }

        if (grantType === 'refresh_token') {
          const refreshToken = body.refresh_token
          const clientId = body.client_id
          if (!refreshToken || !clientId) {
            sendOAuthError(res, 400, 'invalid_request', 'refresh_token and client_id are required')
            return
          }

          const record = state.refreshTokens.get(refreshToken)
          if (!record || record.expiresAt <= Date.now()) {
            sendOAuthError(res, 400, 'invalid_grant', 'Invalid refresh token')
            return
          }
          if (record.clientId !== clientId) {
            sendOAuthError(res, 400, 'invalid_grant', 'client_id mismatch')
            return
          }

          state.refreshTokens.delete(refreshToken)

          const accessToken = state.issueAccessToken({
            userId: record.userId,
            clientId: record.clientId,
            scope: record.scope,
          })
          const nextRefreshToken = state.issueRefreshToken({
            userId: record.userId,
            clientId: record.clientId,
            scope: record.scope,
          })

          sendJson(res, 200, {
            token_type: 'Bearer',
            access_token: accessToken.token,
            expires_in: accessToken.expiresIn,
            refresh_token: nextRefreshToken.token,
            scope: record.scope,
          })
          return
        }

        sendOAuthError(res, 400, 'unsupported_grant_type', 'Unsupported grant_type')
        return
      }

      if (method === 'POST' && path === '/devices/link') {
        const claims = requireUserToken(req, state, options.audience)
        if (!claims) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }

        if (!hasRequiredScope(claims, 'mcp.connect')) {
          sendJson(res, 403, {
            error: 'insufficient_scope',
            required_scope: 'mcp.connect',
          })
          return
        }

        const raw = await readBody(req)
        const body = JSON.parse(raw) as { device_id?: string; device_name?: string }
        const deviceId = body.device_id?.trim() || randomUUID()
        const deviceName = body.device_name?.trim() || 'MemoryLane device'

        try {
          const { device, deviceToken } = state.upsertDevice({
            userId: claims.sub,
            deviceId,
            deviceName,
          })
          sendJson(res, 200, {
            device_id: device.deviceId,
            device_name: device.deviceName,
            device_token: deviceToken,
            linked_at: device.updatedAt,
          })
        } catch (error) {
          sendJson(res, 409, {
            error: 'conflict',
            error_description: error instanceof Error ? error.message : String(error),
          })
        }
        return
      }

      if (method === 'GET' && path === '/devices') {
        const claims = requireUserToken(req, state, options.audience)
        if (!claims) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }

        const devices = [...state.devicesById.values()]
          .filter((device) => device.userId === claims.sub)
          .map((device) => ({
            device_id: device.deviceId,
            device_name: device.deviceName,
            created_at: device.createdAt,
            updated_at: device.updatedAt,
            last_seen_at: device.lastSeenAt,
          }))
        sendJson(res, 200, { devices })
        return
      }

      if (method === 'POST' && path === '/tunnel/poll') {
        const device = requireDeviceToken(req, state)
        if (!device) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }

        const raw = await readBody(req)
        const body = raw.trim().length > 0 ? (JSON.parse(raw) as { timeout_ms?: number }) : {}
        const timeoutMs = clampTimeout(body.timeout_ms, 1_000, options.pollTimeoutMs)
        const request = await state.broker.poll(device.deviceId, timeoutMs)
        sendJson(res, 200, {
          request: request
            ? {
                request_id: request.requestId,
                tool_name: request.payload.toolName,
                tool_input: request.payload.toolInput,
                created_at: request.createdAt,
              }
            : null,
        })
        return
      }

      if (method === 'POST' && path === '/tunnel/respond') {
        const device = requireDeviceToken(req, state)
        if (!device) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }

        const raw = await readBody(req)
        const body = JSON.parse(raw) as {
          request_id?: string
          result?: unknown
          error?: string
        }

        if (!body.request_id) {
          sendJson(res, 400, {
            error: 'invalid_request',
            error_description: 'request_id is required',
          })
          return
        }

        const resolved = state.broker.resolve(body.request_id, {
          result: body.result,
          error: body.error,
        })

        if (!resolved) {
          sendJson(res, 404, {
            error: 'not_found',
            error_description: 'Unknown or expired request_id',
          })
          return
        }

        device.lastSeenAt = Date.now()
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && path === '/context/query') {
        const claims = requireUserToken(req, state, options.audience)
        if (!claims) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }

        const raw = await readBody(req)
        const body = JSON.parse(raw) as {
          device_id?: string
          tool_name?: string
          tool_input?: unknown
          timeout_ms?: number
        }

        const deviceId = body.device_id?.trim()
        const toolName = body.tool_name?.trim()
        if (!deviceId || !toolName) {
          sendJson(res, 400, {
            error: 'invalid_request',
            error_description: 'device_id and tool_name are required',
          })
          return
        }

        const device = state.devicesById.get(deviceId)
        if (!device || device.userId !== claims.sub) {
          sendJson(res, 404, {
            error: 'not_found',
            error_description: 'Device not found for user',
          })
          return
        }

        const requiredScope = requiredScopeForTool(toolName)
        if (!requiredScope) {
          sendJson(res, 400, {
            error: 'invalid_request',
            error_description: `Unsupported tool_name: ${toolName}`,
          })
          return
        }
        if (!hasRequiredScope(claims, requiredScope)) {
          sendJson(res, 403, {
            error: 'insufficient_scope',
            required_scope: requiredScope,
          })
          return
        }

        const timeoutMs = clampTimeout(body.timeout_ms, 1_000, options.relayTimeoutMs)

        try {
          const response = await state.broker.enqueue(
            deviceId,
            {
              toolName,
              toolInput: body.tool_input ?? {},
            },
            timeoutMs,
          )

          if (response.error) {
            sendJson(res, 502, {
              error: 'device_error',
              error_description: response.error,
            })
            return
          }

          sendJson(res, 200, {
            device_id: deviceId,
            tool_name: toolName,
            result: response.result ?? null,
          })
          return
        } catch (error) {
          sendJson(res, 504, {
            error: 'gateway_timeout',
            error_description: error instanceof Error ? error.message : String(error),
          })
          return
        }
      }

      sendJson(res, 404, { error: 'not_found' })
    } catch (error) {
      sendJson(res, 500, {
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
      })
    }
  })

  return server
}

function requireUserToken(
  req: IncomingMessage,
  state: ControlPlaneState,
  expectedAudience: string,
): AccessTokenClaims | null {
  const token = getBearerToken(req)
  if (!token) return null
  const claims = state.tokenIssuer.verifyAccessToken(token)
  if (!claims) return null
  if (claims.aud !== expectedAudience) return null
  return claims
}

function requireDeviceToken(req: IncomingMessage, state: ControlPlaneState): DeviceRecord | null {
  const token = getBearerToken(req)
  if (!token) return null
  return state.getDeviceFromToken(token)
}

function clampTimeout(input: number | undefined, min: number, max: number): number {
  if (!Number.isFinite(input)) return max
  return Math.max(min, Math.min(max, Math.floor(input ?? max)))
}
