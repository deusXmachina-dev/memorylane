import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVITY_CONFIG, VISUAL_DETECTOR_CONFIG } from '@constants'
import type { Activity, ActivityFrame } from './activity-types'
import { ActivitySemanticService, SemanticFileDebugDumper } from './activity-semantic-service'
import { InferenceProviderImpl } from './llm'
import { VendorCredentialsManager } from './settings/vendor-credentials-manager'
import type { Vendor } from '../shared/types'

function makeSafeStorageShim() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  }
}

const tempDirs: string[] = []

vi.mock('./logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('sharp', () => ({
  default: vi.fn((input: string) => {
    const seed = [...String(input)]
      .map((char) => char.charCodeAt(0))
      .reduce((acc, value) => (acc + value) % 256, 0)
    return {
      ensureAlpha: vi.fn().mockReturnThis(),
      resize: vi.fn().mockReturnThis(),
      raw: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi.fn(async (options?: { resolveWithObject?: boolean }) => {
        if (options?.resolveWithObject) {
          const width = 9
          const height = 8
          const channels = 4
          const data = Buffer.alloc(width * height * channels)
          for (let i = 0; i < data.length; i += channels) {
            const pixel = i / channels
            data[i] = (seed + pixel * 17) % 256
            data[i + 1] = (seed + pixel * 29 + 33) % 256
            data[i + 2] = (seed + pixel * 41 + 67) % 256
            data[i + 3] = 255
          }
          return { data, info: { width, height, channels } }
        }
        return Buffer.from('mock-jpeg-bytes')
      }),
    }
  }),
}))

const DEFAULT_VIDEO_MODELS = [
  'google/gemini-2.5-flash-lite-preview-09-2025',
  'google/gemini-3-flash-preview',
  'allenai/molmo-2-8b',
]

const DEFAULT_SNAPSHOT_MODELS = [
  'mistralai/mistral-small-3.2-24b-instruct',
  'google/gemini-2.5-flash-lite',
]

interface MockChatCompletionBody {
  model: string
  messages: Array<{
    role: string
    content: Array<{
      type: string
      text?: string
      image_url?: { url: string }
      video_url?: { url: string }
    }>
  }>
}

interface FetchCall {
  url: string
  body: MockChatCompletionBody
}

type FetchHandler = (call: FetchCall) => unknown | Promise<unknown>

interface FetchMock {
  fn: ReturnType<typeof vi.fn>
  calls: FetchCall[]
  setHandler: (handler: FetchHandler) => void
}

function makeFetchMock(): FetchMock {
  const calls: FetchCall[] = []
  let handler: FetchHandler = () => {
    throw new Error('fetch handler not configured')
  }

  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawBody = init?.body as string | undefined
    const body = rawBody
      ? (JSON.parse(rawBody) as MockChatCompletionBody)
      : ({} as MockChatCompletionBody)
    const call: FetchCall = { url: String(url), body }
    calls.push(call)
    const value = await handler(call)
    if (value instanceof Response) return value
    if (value instanceof Error) throw value
    if (
      typeof value === 'object' &&
      value !== null &&
      '__http' in value &&
      typeof (value as { __http: unknown }).__http === 'object'
    ) {
      const http = (value as { __http: { status: number; body: unknown } }).__http
      return new Response(JSON.stringify(http.body), {
        status: http.status,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  return {
    fn,
    calls,
    setHandler: (h) => {
      handler = h
    },
  }
}

function chatCompletionResponse(
  summary: string,
  promptTokens = 10,
  completionTokens = 5,
): Record<string, unknown> {
  return {
    id: 'chatcmpl-mock',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'mock-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: summary },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}

function httpError(status: number, body: unknown) {
  return { __http: { status, body } }
}

function bodyHasVideo(body: MockChatCompletionBody): boolean {
  return body.messages.some((m) => m.content.some((c) => c.type === 'input_video'))
}

interface SetupOptions {
  apiKey?: string | null
  endpoint?: { serverURL: string; model: string; apiKey?: string } | null
  videoModels?: string[]
  snapshotModels?: string[]
  pipelinePreference?: 'auto' | 'video' | 'image'
  requestTimeoutMs?: number
  usageTracker?: {
    recordUsage: (usage: {
      prompt_tokens: number
      completion_tokens: number
      cost?: number
    }) => void
  }
  debugDumper?: SemanticFileDebugDumper
}

function setupService(options: SetupOptions = {}): {
  service: ActivitySemanticService
  fetchMock: FetchMock
  provider: InferenceProviderImpl
} {
  const fetchMock = makeFetchMock()
  const storedKey = options.apiKey === undefined ? 'test-key' : options.apiKey
  const storedEndpoint = options.endpoint ?? null
  const activeVendor: Vendor = storedEndpoint ? 'openai-compatible' : 'openrouter'

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sem-svc-test-'))
  tempDirs.push(tmpDir)
  const vendorCredentials = new VendorCredentialsManager({
    configPath: path.join(tmpDir, 'vendor-credentials.json'),
    legacyApiKeyConfigPath: path.join(tmpDir, '__missing-api-key.json'),
    legacyCustomEndpointConfigPath: path.join(tmpDir, '__missing-endpoint.json'),
    safeStorage: makeSafeStorageShim(),
    env: {},
  })
  if (storedEndpoint) {
    vendorCredentials.saveCredentials('openai-compatible', {
      apiKey: storedEndpoint.apiKey ?? 'noop',
      baseURL: storedEndpoint.serverURL,
    })
  } else if (storedKey) {
    vendorCredentials.saveCredentials('openrouter', { apiKey: storedKey })
  }

  const provider = new InferenceProviderImpl({
    credentials: vendorCredentials,
    getActiveVendor: () => activeVendor,
    fetch: fetchMock.fn as unknown as typeof globalThis.fetch,
  })

  // For custom-endpoint runs, the configured model becomes the only model for
  // both video and snapshot (mirrors the legacy single-model custom-endpoint
  // behavior). Otherwise the test fixtures' default chains are used.
  const videoModels =
    options.videoModels ?? (storedEndpoint ? [storedEndpoint.model] : [...DEFAULT_VIDEO_MODELS])
  const snapshotModels =
    options.snapshotModels ??
    (storedEndpoint ? [storedEndpoint.model] : [...DEFAULT_SNAPSHOT_MODELS])

  const service = new ActivitySemanticService(provider, {
    videoModels,
    snapshotModels,
    pipelinePreference: options.pipelinePreference,
    requestTimeoutMs: options.requestTimeoutMs,
    usageTracker: options.usageTracker ?? { recordUsage: vi.fn() },
    debugDumper: options.debugDumper,
    fetchImpl: fetchMock.fn as unknown as typeof globalThis.fetch,
  })
  return { service, fetchMock, provider }
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-test-'))
}

function createVideoFile(dir: string, name = 'activity.mp4'): string {
  const filepath = path.join(dir, name)
  fs.writeFileSync(filepath, 'fake-video-binary')
  return filepath
}

function createImageFile(dir: string, name: string): string {
  const filepath = path.join(dir, name)
  fs.writeFileSync(filepath, 'fake-image-binary')
  return filepath
}

function makeFrame(filepath: string, timestamp: number, sequenceNumber: number): ActivityFrame {
  return {
    offset: sequenceNumber,
    frame: {
      filepath,
      timestamp,
      width: 1280,
      height: 720,
      displayId: 1,
      sequenceNumber,
    },
  }
}

function makeActivity(params?: {
  id?: string
  startTimestamp?: number
  endTimestamp?: number
  frames?: ActivityFrame[]
  interactions?: Activity['interactions']
}): Activity {
  const startTimestamp = params?.startTimestamp ?? 1_000
  return {
    id: params?.id ?? 'activity-1',
    startTimestamp,
    endTimestamp: params?.endTimestamp ?? 61_000,
    context: {
      appName: 'Code',
      bundleId: 'com.microsoft.VSCode',
      windowTitle: 'src/main/activity-semantic-service.ts',
      tld: undefined,
    },
    interactions: params?.interactions ?? [
      { type: 'keyboard', timestamp: startTimestamp + 1_000, keyCount: 12 },
      { type: 'scroll', timestamp: startTimestamp + 2_000 },
    ],
    frames: params?.frames ?? [],
    provenance: {
      eventWindowOffsets: [0],
      frameOffsets: (params?.frames ?? []).map((frame) => frame.offset),
      sourceWindowIds: ['window-1'],
      sourceClosedBy: ['flush'],
    },
  }
}

describe('ActivitySemanticService', () => {
  const originalSnapshotCap = ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM
  const originalVisualThreshold = VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT
  const originalSemanticTimeout = ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS

  beforeEach(() => {
    vi.clearAllMocks()
    ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM = originalSnapshotCap
    VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT = originalVisualThreshold
    ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS = originalSemanticTimeout
  })

  afterEach(() => {
    ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM = originalSnapshotCap
    VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT = originalVisualThreshold
    ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS = originalSemanticTimeout
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('reports configured when an API key is set', () => {
    const { service } = setupService({ apiKey: 'test-key' })
    expect(service.isConfigured()).toBe(true)
    expect(service.isConfigured()).toBe(true)
  })

  it('reports configured when only a custom endpoint is set', () => {
    const { service } = setupService({
      apiKey: null,
      endpoint: { serverURL: 'http://localhost:11434/v1', model: 'custom-model' },
    })
    expect(service.isConfigured()).toBe(true)
  })

  it('uses shared semantic timeout default when requestTimeoutMs is not provided', async () => {
    ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS = 5
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const { service, fetchMock } = setupService({
      videoModels: ['slow/model'],
      snapshotModels: [],
      pipelinePreference: 'video',
    })
    fetchMock.setHandler(() => new Promise(() => undefined))

    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.attempts[0]?.error).toContain('semantic model request timed out after 5ms')
  })

  it('supports runtime semantic timeout updates', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const { service, fetchMock } = setupService({
      requestTimeoutMs: 60_000,
      videoModels: ['slow/model'],
      snapshotModels: [],
      pipelinePreference: 'video',
    })
    fetchMock.setHandler(() => new Promise(() => undefined))

    service.updateRequestTimeoutMs(7)
    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.attempts[0]?.error).toContain('semantic model request timed out after 7ms')
  })

  it('forwards configured custom model name in the request body', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const { service, fetchMock } = setupService({
      apiKey: null,
      endpoint: { serverURL: 'http://localhost:11434/v1', model: 'my-custom-model' },
    })
    fetchMock.setHandler(() => chatCompletionResponse('custom model summary'))

    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
    })

    expect(fetchMock.calls[0]?.body.model).toBe('my-custom-model')
    expect(fetchMock.calls[0]?.url).toContain('http://localhost:11434/v1')
  })

  it('uses first video model when it succeeds', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const usageTracker = { recordUsage: vi.fn() }
    const { service, fetchMock } = setupService({ usageTracker })
    fetchMock.setHandler(() => chatCompletionResponse('video summary'))

    const result = await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
    })

    expect(result.summary).toBe('video summary')
    expect(fetchMock.calls).toHaveLength(1)
    expect(fetchMock.calls[0]?.body.model).toBe(DEFAULT_VIDEO_MODELS[0])
    expect(service.getLlmHealthStatus()).toEqual({
      configured: true,
      state: 'active',
      consecutiveFailures: 0,
      lastError: null,
      lastAttemptAt: expect.any(Number),
    })
  })

  it('falls back through video models until one succeeds', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const { service, fetchMock } = setupService()
    fetchMock.setHandler(({ body }) => {
      if (body.model === DEFAULT_VIDEO_MODELS[0]) return httpError(500, { error: 'primary failed' })
      if (body.model === DEFAULT_VIDEO_MODELS[1])
        return httpError(500, { error: 'secondary failed' })
      return chatCompletionResponse('third model summary')
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
    })

    expect(result.summary).toBe('third model summary')
    expect(fetchMock.calls.map((c) => c.body.model)).toEqual(DEFAULT_VIDEO_MODELS)
    expect(service.getLlmHealthStatus().state).toBe('active')
  })

  it('reports configured but waiting before any semantic request runs', () => {
    const { service } = setupService()
    expect(service.getLlmHealthStatus()).toEqual({
      configured: true,
      state: 'unknown',
      consecutiveFailures: 0,
      lastError: null,
      lastAttemptAt: null,
    })
  })

  it('marks LLM active after a successful connection test', async () => {
    const { service, fetchMock } = setupService()
    fetchMock.setHandler(() => chatCompletionResponse('OK'))

    await service.testConnection()

    expect(service.getLlmHealthStatus()).toEqual({
      configured: true,
      state: 'active',
      consecutiveFailures: 0,
      lastError: null,
      lastAttemptAt: expect.any(Number),
    })
  })

  it('marks LLM failing after a failed connection test', async () => {
    const { service, fetchMock } = setupService()
    fetchMock.setHandler(() => new Error('connect ECONNREFUSED'))

    await service.testConnection()

    expect(service.getLlmHealthStatus()).toEqual({
      configured: true,
      state: 'failing',
      consecutiveFailures: 1,
      lastError: expect.stringContaining('connect ECONNREFUSED'),
      lastAttemptAt: expect.any(Number),
    })
  })

  it('counts consecutive failed summary requests', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const { service, fetchMock } = setupService({
      snapshotModels: [],
      pipelinePreference: 'video',
    })
    fetchMock.setHandler(() => new Error('connect ECONNREFUSED'))

    await service.summarizeFromVideo({
      activity: makeActivity({ id: 'activity-1' }),
      videoPath,
    })
    await service.summarizeFromVideo({
      activity: makeActivity({ id: 'activity-2' }),
      videoPath,
    })

    expect(service.getLlmHealthStatus()).toEqual({
      configured: true,
      state: 'failing',
      consecutiveFailures: 2,
      lastError: expect.stringContaining('connect ECONNREFUSED'),
      lastAttemptAt: expect.any(Number),
    })
  })

  it('falls from video pipeline to snapshot pipeline', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 1_000, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 25_000, 1),
      makeFrame(createImageFile(tempDir, 'f2.png'), 45_000, 2),
    ]

    const { service, fetchMock } = setupService()
    fetchMock.setHandler(({ body }) => {
      if (DEFAULT_VIDEO_MODELS.includes(body.model))
        return httpError(500, { error: 'video model failure' })
      return chatCompletionResponse('snapshot summary')
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
    })

    expect(result.summary).toBe('snapshot summary')
    expect(fetchMock.calls.map((c) => c.body.model)).toEqual([
      ...DEFAULT_VIDEO_MODELS,
      DEFAULT_SNAPSHOT_MODELS[0],
    ])
    expect(service.getLastRunDiagnostics()?.chosenMode).toBe('snapshot')
  })

  it('supports image-only mode without attempting video or requiring a stitched file', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)

    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 1_000, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 25_000, 1),
    ]

    const { service, fetchMock } = setupService({ pipelinePreference: 'image' })
    fetchMock.setHandler(() => chatCompletionResponse('image summary only'))

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
    })

    expect(result.summary).toBe('image summary only')
    expect(fetchMock.calls).toHaveLength(1)
    expect(bodyHasVideo(fetchMock.calls[0]!.body)).toBe(false)
    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.pipelinePreference).toBe('image')
    expect(diagnostics?.attempts.map((a) => a.mode)).toEqual(['snapshot'])
    expect(diagnostics?.chosenMode).toBe('snapshot')
  })

  it('supports video-only mode without snapshot fallback', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 1_000, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 25_000, 1),
    ]

    const { service, fetchMock } = setupService({ pipelinePreference: 'video' })
    fetchMock.setHandler(() => httpError(500, { error: 'video failed' }))

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
    })

    expect(result.summary).toBe('')
    expect(fetchMock.calls.map((c) => c.body.model)).toEqual(DEFAULT_VIDEO_MODELS)
    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.pipelinePreference).toBe('video')
    expect(diagnostics?.attempts.map((a) => a.mode)).toEqual(['video', 'video', 'video'])
    expect(diagnostics?.chosenMode).toBeNull()
  })

  it('uses custom endpoint model for both video and snapshot attempts', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)
    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 1_000, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 25_000, 1),
    ]

    const { service, fetchMock } = setupService({
      apiKey: null,
      endpoint: { serverURL: 'http://localhost:11434/v1', model: 'moondream:latest' },
    })
    fetchMock.setHandler(({ body }) => {
      if (bodyHasVideo(body)) {
        return httpError(400, { error: { message: 'input_video is not supported by this model' } })
      }
      return chatCompletionResponse('snapshot summary from custom model')
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
    })

    expect(result.summary).toBe('snapshot summary from custom model')
    expect(fetchMock.calls.map((c) => c.body.model)).toEqual([
      'moondream:latest',
      'moondream:latest',
    ])
    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.attempts.map((a) => a.mode)).toEqual(['video', 'snapshot'])
    expect(diagnostics?.chosenMode).toBe('snapshot')
    expect(diagnostics?.chosenModel).toBe('moondream:latest')
  })

  it('cache-skips video after a structured 422 with input_video details', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)
    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 1_000, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 25_000, 1),
    ]

    const { service, fetchMock } = setupService({
      apiKey: null,
      endpoint: { serverURL: 'https://example.test/openai/v1', model: 'mistral-small-2503' },
    })

    let firstVideoCallSeen = false
    fetchMock.setHandler(({ body }) => {
      if (bodyHasVideo(body) && !firstVideoCallSeen) {
        firstVideoCallSeen = true
        return httpError(422, {
          error: {
            code: 'Invalid input',
            message: 'invalid input error',
            details: [
              {
                loc: ['body', 'messages', 0, 'content'],
                msg: "Input should be 'text', 'image' or 'image_url'",
                input: 'input_video',
                ctx: { expected: "'text', 'image' or 'image_url'" },
              },
            ],
          },
        })
      }
      return chatCompletionResponse('snapshot summary after cached skip')
    })

    const firstResult = await service.summarizeFromVideo({
      activity: makeActivity({ id: 'activity-1', frames }),
      videoPath,
    })
    expect(firstResult.summary).toBe('snapshot summary after cached skip')

    fetchMock.calls.length = 0

    const secondResult = await service.summarizeFromVideo({
      activity: makeActivity({ id: 'activity-2', frames }),
      videoPath,
    })

    expect(secondResult.summary).toBe('snapshot summary after cached skip')
    expect(fetchMock.calls).toHaveLength(1)
    expect(bodyHasVideo(fetchMock.calls[0]!.body)).toBe(false)

    const secondDiagnostics = service.getLastRunDiagnostics()
    expect(secondDiagnostics?.attempts.map((a) => a.mode)).toEqual(['snapshot'])
    expect(secondDiagnostics?.fallbackReason).toBe(
      'active model marked video-unsupported (session)',
    )
  })

  it('skips video on subsequent calls after custom model reports video unsupported', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)
    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 1_000, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 25_000, 1),
      makeFrame(createImageFile(tempDir, 'f2.png'), 45_000, 2),
    ]

    const { service, fetchMock } = setupService({
      apiKey: null,
      endpoint: { serverURL: 'http://localhost:11434/v1', model: 'moondream:latest' },
    })
    fetchMock.setHandler(({ body }) => {
      if (bodyHasVideo(body)) {
        return httpError(400, {
          error: { message: 'video input not supported; input_video unsupported' },
        })
      }
      return chatCompletionResponse('snapshot summary')
    })

    await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
    })

    const firstDiagnostics = service.getLastRunDiagnostics()
    expect(firstDiagnostics?.attempts.some((a) => a.mode === 'video')).toBe(true)
    expect(firstDiagnostics?.chosenMode).toBe('snapshot')

    fetchMock.calls.length = 0

    const secondResult = await service.summarizeFromVideo({
      activity: makeActivity({ id: 'activity-2', frames }),
      videoPath,
    })

    expect(secondResult.summary).toBe('snapshot summary')
    expect(fetchMock.calls).toHaveLength(1)
    expect(bodyHasVideo(fetchMock.calls[0]!.body)).toBe(false)

    const secondDiagnostics = service.getLastRunDiagnostics()
    expect(secondDiagnostics?.attempts.map((a) => a.mode)).toEqual(['snapshot'])
    expect(secondDiagnostics?.fallbackReason).toBe(
      'active model marked video-unsupported (session)',
    )
    expect(secondDiagnostics?.chosenMode).toBe('snapshot')
  })

  it('does not cache-skip video after generic failures', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)
    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 1_000, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 25_000, 1),
    ]

    const { service, fetchMock } = setupService({
      apiKey: null,
      endpoint: { serverURL: 'http://localhost:11434/v1', model: 'moondream:latest' },
    })
    fetchMock.setHandler(({ body }) => {
      if (bodyHasVideo(body)) {
        return new Error('network timeout')
      }
      return chatCompletionResponse('snapshot summary')
    })

    await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
    })
    const firstDiagnostics = service.getLastRunDiagnostics()
    expect(firstDiagnostics?.attempts.map((a) => a.mode)).toEqual(['video', 'snapshot'])

    fetchMock.calls.length = 0
    await service.summarizeFromVideo({
      activity: makeActivity({ id: 'activity-3', frames }),
      videoPath,
    })
    const secondDiagnostics = service.getLastRunDiagnostics()
    expect(secondDiagnostics?.attempts.map((a) => a.mode)).toEqual(['video', 'snapshot'])
  })

  it('snapshot sampling selects frames nearest to interaction anchors', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT = 0

    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 0, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 10_000, 1),
      makeFrame(createImageFile(tempDir, 'f2.png'), 20_000, 2),
      makeFrame(createImageFile(tempDir, 'f3.png'), 30_000, 3),
    ]

    const { service, fetchMock } = setupService({
      videoModels: ['video/fail'],
      snapshotModels: ['snapshot/success'],
    })
    fetchMock.setHandler(() => chatCompletionResponse('snapshot summary'))

    await service.summarizeFromVideo({
      activity: makeActivity({
        frames,
        startTimestamp: 0,
        endTimestamp: 30_000,
        interactions: [
          { type: 'keyboard', timestamp: 9_100 },
          { type: 'scroll', timestamp: 18_900 },
          { type: 'click', timestamp: 28_500 },
        ],
      }),
      videoPath: path.join(tempDir, 'missing.mp4'),
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.selectedSnapshotPaths.map((fp) => path.basename(fp))).toEqual([
      'f0.png',
      'f1.png',
      'f2.png',
      'f3.png',
    ])
  })

  it('snapshot sampling obeys ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM=6', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM = 6
    VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT = 0

    const frames: ActivityFrame[] = []
    for (let i = 0; i < 12; i++) {
      frames.push(makeFrame(createImageFile(tempDir, `frame-${i}.png`), 1_000 + i * 25_000, i))
    }

    const { service, fetchMock } = setupService()
    fetchMock.setHandler(({ body }) => {
      if (DEFAULT_VIDEO_MODELS.includes(body.model)) return httpError(500, { error: 'video fail' })
      return chatCompletionResponse('snapshot summary')
    })

    await service.summarizeFromVideo({
      activity: makeActivity({
        frames,
        interactions: frames.map((frame) => ({
          type: 'keyboard',
          timestamp: frame.frame.timestamp,
        })),
      }),
      videoPath: path.join(tempDir, 'missing.mp4'),
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.selectedSnapshotPaths).toHaveLength(6)
  })

  it('uses MAX_SCREENSHOTS_FOR_LLM as snapshot cap by default', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM = 3
    VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT = 0

    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 0, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 10_000, 1),
      makeFrame(createImageFile(tempDir, 'f2.png'), 20_000, 2),
      makeFrame(createImageFile(tempDir, 'f3.png'), 30_000, 3),
      makeFrame(createImageFile(tempDir, 'f4.png'), 40_000, 4),
    ]

    const { service, fetchMock } = setupService({
      videoModels: ['video/fail'],
      snapshotModels: ['snapshot/success'],
    })
    fetchMock.setHandler(() => chatCompletionResponse('snapshot summary'))

    await service.summarizeFromVideo({
      activity: makeActivity({
        frames,
        startTimestamp: 0,
        endTimestamp: 40_000,
        interactions: frames.map((frame) => ({
          type: 'keyboard',
          timestamp: frame.frame.timestamp,
        })),
      }),
      videoPath: path.join(tempDir, 'missing.mp4'),
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.selectedSnapshotPaths).toHaveLength(3)
  })

  it('snapshot sampling has no synthetic gap filter when visual threshold is disabled', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT = 0

    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 0, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 5_000, 1),
      makeFrame(createImageFile(tempDir, 'f2.png'), 20_000, 2),
      makeFrame(createImageFile(tempDir, 'f3.png'), 25_000, 3),
      makeFrame(createImageFile(tempDir, 'f4.png'), 40_000, 4),
      makeFrame(createImageFile(tempDir, 'f5.png'), 60_000, 5),
    ]

    const { service, fetchMock } = setupService({
      videoModels: ['video/fail'],
      snapshotModels: ['snapshot/success'],
    })
    fetchMock.setHandler(() => chatCompletionResponse('snapshot summary'))

    await service.summarizeFromVideo({
      activity: makeActivity({
        frames,
        startTimestamp: 0,
        endTimestamp: 60_000,
        interactions: frames.map((frame) => ({ type: 'scroll', timestamp: frame.frame.timestamp })),
      }),
      videoPath: path.join(tempDir, 'missing.mp4'),
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.selectedSnapshotPaths.map((fp) => path.basename(fp))).toEqual([
      'f0.png',
      'f1.png',
      'f2.png',
      'f3.png',
      'f4.png',
      'f5.png',
    ])
  })

  it('applies visual threshold to drop near-identical middle frames', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT = 101

    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 0, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 10_000, 1),
      makeFrame(createImageFile(tempDir, 'f2.png'), 20_000, 2),
      makeFrame(createImageFile(tempDir, 'f3.png'), 30_000, 3),
    ]

    const { service, fetchMock } = setupService({
      videoModels: ['video/fail'],
      snapshotModels: ['snapshot/success'],
    })
    fetchMock.setHandler(() => chatCompletionResponse('snapshot summary'))

    await service.summarizeFromVideo({
      activity: makeActivity({
        frames,
        startTimestamp: 0,
        endTimestamp: 30_000,
        interactions: [
          { type: 'keyboard', timestamp: 9_000 },
          { type: 'keyboard', timestamp: 19_000 },
          { type: 'keyboard', timestamp: 29_000 },
        ],
      }),
      videoPath: path.join(tempDir, 'missing.mp4'),
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.selectedSnapshotPaths.map((fp) => path.basename(fp))).toEqual([
      'f0.png',
      'f3.png',
    ])
  })

  it('snapshot sampling always includes first and last when available', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM = 3
    VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT = 0

    const frames = [
      makeFrame(createImageFile(tempDir, 'first.png'), 1_000, 0),
      makeFrame(createImageFile(tempDir, 'middle-a.png'), 5_000, 1),
      makeFrame(createImageFile(tempDir, 'middle-b.png'), 10_000, 2),
      makeFrame(createImageFile(tempDir, 'last.png'), 30_000, 3),
    ]

    const { service, fetchMock } = setupService({
      videoModels: ['video/fail'],
      snapshotModels: ['snapshot/success'],
    })
    fetchMock.setHandler(() => chatCompletionResponse('snapshot summary'))

    await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath: path.join(tempDir, 'missing.mp4'),
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.selectedSnapshotPaths.map((fp) => path.basename(fp))).toContain('first.png')
    expect(diagnostics?.selectedSnapshotPaths.map((fp) => path.basename(fp))).toContain('last.png')
  })

  it('never sends OCR text to the LLM payload', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const { service, fetchMock } = setupService()
    fetchMock.setHandler(() => chatCompletionResponse('summary'))

    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
    })

    expect(JSON.stringify(fetchMock.calls[0]!.body)).not.toContain('VERY_SECRET_OCR_TEXT')
  })

  it('trims summary output', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const { service, fetchMock } = setupService()
    fetchMock.setHandler(() => chatCompletionResponse('  trimmed summary  '))

    const result = await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
    })

    expect(result.summary).toBe('trimmed summary')
  })

  it('records usage stats on success', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const usageTracker = { recordUsage: vi.fn() }
    const { service, fetchMock } = setupService({
      videoModels: ['mistralai/mistral-small-3.2-24b-instruct'],
      usageTracker,
    })
    fetchMock.setHandler(() => chatCompletionResponse('summary', 123, 45))

    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
    })

    expect(usageTracker.recordUsage).toHaveBeenCalledTimes(1)
    expect(usageTracker.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt_tokens: 123,
        completion_tokens: 45,
      }),
    )
  })

  it('records unknown model cost as 0', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const usageTracker = { recordUsage: vi.fn() }
    const { service, fetchMock } = setupService({
      videoModels: ['unknown/video-model'],
      usageTracker,
    })
    fetchMock.setHandler(() => chatCompletionResponse('summary', 200, 100))

    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
    })

    expect(usageTracker.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt_tokens: 200,
        completion_tokens: 100,
        cost: 0,
      }),
    )
  })

  it('returns empty summary when all models fail', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const frames = [makeFrame(createImageFile(tempDir, 'f0.png'), 1_000, 0)]
    const { service, fetchMock } = setupService()
    fetchMock.setHandler(() => new Error('all failed'))

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
    })

    expect(result.summary).toBe('')
    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.attempts).toHaveLength(
      DEFAULT_VIDEO_MODELS.length + DEFAULT_SNAPSHOT_MODELS.length,
    )
  })

  it('dumps request and response payloads when debug dumper is configured', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)
    const dumpRootDir = path.join(tempDir, 'dumps')
    const dumper = new SemanticFileDebugDumper({
      rootDir: dumpRootDir,
      copyMediaAssets: true,
    })

    const { service, fetchMock } = setupService({
      videoModels: ['model-for-dump'],
      snapshotModels: [],
      debugDumper: dumper,
    })
    fetchMock.setHandler(() => chatCompletionResponse('dumped summary'))

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ id: 'debug-activity' }),
      videoPath,
    })

    expect(result.summary).toBe('dumped summary')

    const runDir = dumper.getRunDir()
    const attempts = fs.readdirSync(runDir)
    expect(attempts).toHaveLength(1)

    const attemptDir = path.join(runDir, attempts[0])
    const summaryTxt = fs.readFileSync(path.join(attemptDir, 'summary.txt'), 'utf8')
    const metadata = JSON.parse(
      fs.readFileSync(path.join(attemptDir, 'metadata.json'), 'utf8'),
    ) as {
      success: boolean
      activityId: string
      model: string
      copiedMediaFiles: string[]
    }

    expect(summaryTxt).toBe('dumped summary\n')
    expect(metadata.success).toBe(true)
    expect(metadata.activityId).toBe('debug-activity')
    expect(metadata.model).toBe('model-for-dump')
    expect(metadata.copiedMediaFiles).toEqual(['input-video-01.mp4'])
  })
})
