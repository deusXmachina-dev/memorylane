import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVITY_CONFIG, VISUAL_DETECTOR_CONFIG } from '@constants'
import type { Activity, ActivityFrame } from './activity-types'
import { ActivitySemanticService, SemanticFileDebugDumper } from './activity-semantic-service'

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

const mockSend = vi.fn()
vi.mock('@openrouter/sdk', () => ({
  OpenRouter: vi.fn().mockImplementation(function () {
    return { chat: { send: mockSend } }
  }),
}))

import { OpenRouter } from '@openrouter/sdk'

const DEFAULT_VIDEO_MODELS = [
  'google/gemini-2.5-flash-lite-preview-09-2025',
  'google/gemini-3-flash-preview',
  'allenai/molmo-2-8b',
]

const DEFAULT_SNAPSHOT_MODELS = [
  'mistralai/mistral-small-3.2-24b-instruct',
  'google/gemini-2.5-flash-lite',
]

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

function response(summary: string, promptTokens = 10, completionTokens = 5): unknown {
  return {
    choices: [{ message: { content: summary } }],
    usage: { promptTokens, completionTokens },
  }
}

describe('ActivitySemanticService', () => {
  const tempDirs: string[] = []
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

  it('creates OpenRouter client without serverURL by default', () => {
    new ActivitySemanticService('test-key', {
      usageTracker: { recordUsage: vi.fn() },
    })

    expect(OpenRouter).toHaveBeenCalledWith({ apiKey: 'test-key' })
  })

  it('uses shared semantic timeout default when requestTimeoutMs is not provided', async () => {
    ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS = 5
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send: () => new Promise(() => undefined) } },
      videoModels: ['slow/model'],
      snapshotModels: [],
      pipelinePreference: 'video',
      usageTracker: { recordUsage: vi.fn() },
    })

    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
      ocrText: 'ignored',
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.attempts[0]?.error).toContain('semantic model request timed out after 5ms')
  })

  it('supports runtime semantic timeout updates', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send: () => new Promise(() => undefined) } },
      requestTimeoutMs: 60_000,
      videoModels: ['slow/model'],
      snapshotModels: [],
      pipelinePreference: 'video',
      usageTracker: { recordUsage: vi.fn() },
    })

    service.updateRequestTimeoutMs(7)
    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
      ocrText: 'ignored',
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.attempts[0]?.error).toContain('semantic model request timed out after 7ms')
  })

  it('passes serverURL to OpenRouter when custom endpoint is provided', () => {
    new ActivitySemanticService('test-key', {
      endpointConfig: {
        serverURL: 'http://localhost:11434/v1',
        model: 'custom-model',
      },
      usageTracker: { recordUsage: vi.fn() },
    })

    expect(OpenRouter).toHaveBeenCalledWith({
      apiKey: 'test-key',
      serverURL: 'http://localhost:11434/v1',
    })
  })

  it('uses empty string as apiKey when custom endpoint has no key and no default key', () => {
    new ActivitySemanticService(undefined, {
      endpointConfig: {
        serverURL: 'http://localhost:11434/v1',
        model: 'custom-model',
      },
      usageTracker: { recordUsage: vi.fn() },
    })

    expect(OpenRouter).toHaveBeenCalledWith({
      apiKey: '',
      serverURL: 'http://localhost:11434/v1',
    })
  })

  it('uses custom endpoint apiKey over OpenRouter key', () => {
    new ActivitySemanticService('openrouter-key', {
      endpointConfig: {
        serverURL: 'http://localhost:11434/v1',
        model: 'custom-model',
        apiKey: 'custom-key',
      },
      usageTracker: { recordUsage: vi.fn() },
    })

    expect(OpenRouter).toHaveBeenCalledWith({
      apiKey: 'custom-key',
      serverURL: 'http://localhost:11434/v1',
    })
  })

  it('forwards configured custom model name in chat.send()', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)
    mockSend.mockResolvedValue(response('custom model summary'))

    const service = new ActivitySemanticService(undefined, {
      endpointConfig: {
        serverURL: 'http://localhost:11434/v1',
        model: 'my-custom-model',
      },
      usageTracker: { recordUsage: vi.fn() },
    })

    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
      ocrText: 'ignored',
    })

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ model: 'my-custom-model' }))
  })

  it('switches to custom endpoint via updateEndpoint()', () => {
    const service = new ActivitySemanticService('test-key', {
      usageTracker: { recordUsage: vi.fn() },
    })
    expect(service.isUsingCustomEndpoint()).toBe(false)

    service.updateEndpoint({
      serverURL: 'http://localhost:11434/v1',
      model: 'custom-model',
      apiKey: 'custom-key',
    })

    expect(service.isUsingCustomEndpoint()).toBe(true)
    expect(service.isConfigured()).toBe(true)
    expect(OpenRouter).toHaveBeenLastCalledWith({
      apiKey: 'custom-key',
      serverURL: 'http://localhost:11434/v1',
    })
  })

  it('reverts from custom endpoint via updateEndpoint(null, openRouterKey)', () => {
    const service = new ActivitySemanticService(undefined, {
      endpointConfig: {
        serverURL: 'http://localhost:11434/v1',
        model: 'custom-model',
      },
      usageTracker: { recordUsage: vi.fn() },
    })
    expect(service.isUsingCustomEndpoint()).toBe(true)

    service.updateEndpoint(null, 'openrouter-key')

    expect(service.isUsingCustomEndpoint()).toBe(false)
    expect(service.isConfigured()).toBe(true)
    expect(OpenRouter).toHaveBeenLastCalledWith({
      apiKey: 'openrouter-key',
    })
  })

  it('reverts to unconfigured when removing custom endpoint without OpenRouter key', () => {
    const service = new ActivitySemanticService(undefined, {
      endpointConfig: {
        serverURL: 'http://localhost:11434/v1',
        model: 'custom-model',
      },
      usageTracker: { recordUsage: vi.fn() },
    })

    service.updateEndpoint(null)

    expect(service.isUsingCustomEndpoint()).toBe(false)
    expect(service.isConfigured()).toBe(false)
  })

  it('reports isConfigured() true when custom endpoint is set without OpenRouter key', () => {
    const service = new ActivitySemanticService(undefined, {
      endpointConfig: {
        serverURL: 'http://localhost:11434/v1',
        model: 'custom-model',
      },
      usageTracker: { recordUsage: vi.fn() },
    })

    expect(service.isUsingCustomEndpoint()).toBe(true)
    expect(service.isConfigured()).toBe(true)
  })

  it('ignores updateApiKey when custom endpoint is active', () => {
    const service = new ActivitySemanticService(undefined, {
      endpointConfig: {
        serverURL: 'http://localhost:11434/v1',
        model: 'custom-model',
      },
      usageTracker: { recordUsage: vi.fn() },
    })

    service.updateApiKey('new-key')

    expect(service.isUsingCustomEndpoint()).toBe(true)
  })

  it('uses first video model when it succeeds', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const send = vi.fn().mockResolvedValue(response('video summary'))
    const usageTracker = { recordUsage: vi.fn() }

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      usageTracker,
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
      ocrText: 'ignored-ocr',
    })

    expect(result).toBe('video summary')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].model).toBe(DEFAULT_VIDEO_MODELS[0])
  })

  it('falls back through video models until one succeeds', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const send = vi.fn().mockImplementation(async (request: { model: string }) => {
      if (request.model === DEFAULT_VIDEO_MODELS[0]) throw new Error('primary failed')
      if (request.model === DEFAULT_VIDEO_MODELS[1]) throw new Error('secondary failed')
      return response('third model summary')
    })

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      usageTracker: { recordUsage: vi.fn() },
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
      ocrText: 'ignored',
    })

    expect(result).toBe('third model summary')
    expect(send.mock.calls.map((call) => call[0].model)).toEqual(DEFAULT_VIDEO_MODELS)
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

    const send = vi.fn().mockImplementation(async (request: { model: string }) => {
      if (DEFAULT_VIDEO_MODELS.includes(request.model)) {
        throw new Error('video model failure')
      }
      return response('snapshot summary')
    })

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      usageTracker: { recordUsage: vi.fn() },
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
      ocrText: 'ignored',
    })

    expect(result).toBe('snapshot summary')
    expect(send.mock.calls.map((call) => call[0].model)).toEqual([
      ...DEFAULT_VIDEO_MODELS,
      DEFAULT_SNAPSHOT_MODELS[0],
    ])

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.chosenMode).toBe('snapshot')
  })

  it('supports image-only mode without attempting video or requiring a stitched file', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)

    const frames = [
      makeFrame(createImageFile(tempDir, 'f0.png'), 1_000, 0),
      makeFrame(createImageFile(tempDir, 'f1.png'), 25_000, 1),
    ]

    const send = vi.fn().mockResolvedValue(response('image summary only'))
    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      pipelinePreference: 'image',
      usageTracker: { recordUsage: vi.fn() },
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      ocrText: 'ignored',
    })

    expect(result).toBe('image summary only')
    expect(send).toHaveBeenCalledTimes(1)
    expect(
      send.mock.calls[0][0].messages[0].content.some(
        (item: { type: string }) => item.type === 'input_video',
      ),
    ).toBe(false)
    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.pipelinePreference).toBe('image')
    expect(diagnostics?.attempts.map((attempt) => attempt.mode)).toEqual(['snapshot'])
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

    const send = vi.fn().mockRejectedValue(new Error('video failed'))
    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      pipelinePreference: 'video',
      usageTracker: { recordUsage: vi.fn() },
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
      ocrText: 'ignored',
    })

    expect(result).toBe('')
    expect(send.mock.calls.map((call) => call[0].model)).toEqual(DEFAULT_VIDEO_MODELS)
    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.pipelinePreference).toBe('video')
    expect(diagnostics?.attempts.map((attempt) => attempt.mode)).toEqual([
      'video',
      'video',
      'video',
    ])
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

    mockSend.mockImplementation(
      async (request: { model: string; messages: Array<{ content: Array<{ type: string }> }> }) => {
        const hasVideo = request.messages[0]?.content.some((item) => item.type === 'input_video')
        if (hasVideo) {
          throw new Error('input_video is not supported by this model')
        }
        return response('snapshot summary from custom model')
      },
    )

    const service = new ActivitySemanticService(undefined, {
      endpointConfig: {
        serverURL: 'http://localhost:11434/v1',
        model: 'moondream:latest',
      },
      usageTracker: { recordUsage: vi.fn() },
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
      ocrText: 'ignored',
    })

    expect(result).toBe('snapshot summary from custom model')
    expect(mockSend.mock.calls.map((call) => call[0].model)).toEqual([
      'moondream:latest',
      'moondream:latest',
    ])
    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.attempts.map((attempt) => attempt.mode)).toEqual(['video', 'snapshot'])
    expect(diagnostics?.chosenMode).toBe('snapshot')
    expect(diagnostics?.chosenModel).toBe('moondream:latest')
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

    mockSend.mockImplementation(
      async (request: { messages: Array<{ content: Array<{ type: string }> }> }) => {
        const hasVideo = request.messages[0]?.content.some((item) => item.type === 'input_video')
        if (hasVideo) {
          throw new Error('video input not supported; input_video unsupported')
        }
        return response('snapshot summary')
      },
    )

    const service = new ActivitySemanticService(undefined, {
      endpointConfig: {
        serverURL: 'http://localhost:11434/v1',
        model: 'moondream:latest',
      },
      usageTracker: { recordUsage: vi.fn() },
    })

    await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
      ocrText: 'ignored',
    })

    const firstDiagnostics = service.getLastRunDiagnostics()
    expect(firstDiagnostics?.attempts.some((attempt) => attempt.mode === 'video')).toBe(true)
    expect(firstDiagnostics?.chosenMode).toBe('snapshot')

    mockSend.mockClear()

    const secondResult = await service.summarizeFromVideo({
      activity: makeActivity({ id: 'activity-2', frames }),
      videoPath,
      ocrText: 'ignored',
    })

    expect(secondResult).toBe('snapshot summary')
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(
      mockSend.mock.calls[0][0].messages[0].content.some(
        (item: { type: string }) => item.type === 'input_video',
      ),
    ).toBe(false)

    const secondDiagnostics = service.getLastRunDiagnostics()
    expect(secondDiagnostics?.attempts.map((attempt) => attempt.mode)).toEqual(['snapshot'])
    expect(secondDiagnostics?.fallbackReason).toBe(
      'custom endpoint model marked video-unsupported (session)',
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

    mockSend.mockImplementation(
      async (request: { messages: Array<{ content: Array<{ type: string }> }> }) => {
        const hasVideo = request.messages[0]?.content.some((item) => item.type === 'input_video')
        if (hasVideo) {
          throw new Error('network timeout')
        }
        return response('snapshot summary')
      },
    )

    const service = new ActivitySemanticService(undefined, {
      endpointConfig: {
        serverURL: 'http://localhost:11434/v1',
        model: 'moondream:latest',
      },
      usageTracker: { recordUsage: vi.fn() },
    })

    await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
      ocrText: 'ignored',
    })
    const firstDiagnostics = service.getLastRunDiagnostics()
    expect(firstDiagnostics?.attempts.map((attempt) => attempt.mode)).toEqual(['video', 'snapshot'])

    mockSend.mockClear()
    await service.summarizeFromVideo({
      activity: makeActivity({ id: 'activity-3', frames }),
      videoPath,
      ocrText: 'ignored',
    })
    const secondDiagnostics = service.getLastRunDiagnostics()
    expect(secondDiagnostics?.attempts.map((attempt) => attempt.mode)).toEqual([
      'video',
      'snapshot',
    ])
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

    const send = vi.fn().mockResolvedValue(response('snapshot summary'))
    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      videoModels: ['video/fail'],
      snapshotModels: ['snapshot/success'],
      usageTracker: { recordUsage: vi.fn() },
    })

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
      ocrText: 'ignored',
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.selectedSnapshotPaths.map((filepath) => path.basename(filepath))).toEqual([
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

    const send = vi.fn().mockImplementation(async (request: { model: string }) => {
      if (DEFAULT_VIDEO_MODELS.includes(request.model)) {
        throw new Error('video fail')
      }
      return response('snapshot summary')
    })

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      usageTracker: { recordUsage: vi.fn() },
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
      ocrText: 'ignored',
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

    const send = vi.fn().mockResolvedValue(response('snapshot summary'))
    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      videoModels: ['video/fail'],
      snapshotModels: ['snapshot/success'],
      usageTracker: { recordUsage: vi.fn() },
    })

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
      ocrText: 'ignored',
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

    const send = vi.fn().mockResolvedValue(response('snapshot summary'))

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      videoModels: ['video/fail'],
      snapshotModels: ['snapshot/success'],
      usageTracker: { recordUsage: vi.fn() },
    })

    await service.summarizeFromVideo({
      activity: makeActivity({
        frames,
        startTimestamp: 0,
        endTimestamp: 60_000,
        interactions: frames.map((frame) => ({ type: 'scroll', timestamp: frame.frame.timestamp })),
      }),
      videoPath: path.join(tempDir, 'missing.mp4'),
      ocrText: 'ignored',
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.selectedSnapshotPaths.map((filepath) => path.basename(filepath))).toEqual([
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

    const send = vi.fn().mockResolvedValue(response('snapshot summary'))
    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      videoModels: ['video/fail'],
      snapshotModels: ['snapshot/success'],
      usageTracker: { recordUsage: vi.fn() },
    })

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
      ocrText: 'ignored',
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.selectedSnapshotPaths.map((filepath) => path.basename(filepath))).toEqual([
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

    const send = vi.fn().mockResolvedValue(response('snapshot summary'))

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      videoModels: ['video/fail'],
      snapshotModels: ['snapshot/success'],
      usageTracker: { recordUsage: vi.fn() },
    })

    await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath: path.join(tempDir, 'missing.mp4'),
      ocrText: 'ignored',
    })

    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.selectedSnapshotPaths.map((filepath) => path.basename(filepath))).toContain(
      'first.png',
    )
    expect(diagnostics?.selectedSnapshotPaths.map((filepath) => path.basename(filepath))).toContain(
      'last.png',
    )
  })

  it('never sends OCR text to the LLM payload', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const send = vi.fn().mockResolvedValue(response('summary'))

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      usageTracker: { recordUsage: vi.fn() },
    })

    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
      ocrText: 'VERY_SECRET_OCR_TEXT',
    })

    expect(JSON.stringify(send.mock.calls[0][0])).not.toContain('VERY_SECRET_OCR_TEXT')
  })

  it('trims summary output', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const send = vi.fn().mockResolvedValue(response('  trimmed summary  '))

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      usageTracker: { recordUsage: vi.fn() },
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
      ocrText: 'ignored',
    })

    expect(result).toBe('trimmed summary')
  })

  it('records usage stats on success', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)

    const send = vi.fn().mockResolvedValue(response('summary', 123, 45))
    const usageTracker = { recordUsage: vi.fn() }

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      videoModels: ['mistralai/mistral-small-3.2-24b-instruct'],
      usageTracker,
    })

    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
      ocrText: 'ignored',
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

    const send = vi.fn().mockResolvedValue(response('summary', 200, 100))
    const usageTracker = { recordUsage: vi.fn() }

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      videoModels: ['unknown/video-model'],
      usageTracker,
    })

    await service.summarizeFromVideo({
      activity: makeActivity(),
      videoPath,
      ocrText: 'ignored',
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

    const send = vi.fn().mockRejectedValue(new Error('all failed'))

    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      usageTracker: { recordUsage: vi.fn() },
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ frames }),
      videoPath,
      ocrText: 'ignored',
    })

    expect(result).toBe('')
    const diagnostics = service.getLastRunDiagnostics()
    expect(diagnostics?.attempts).toHaveLength(
      DEFAULT_VIDEO_MODELS.length + DEFAULT_SNAPSHOT_MODELS.length,
    )
  })

  it('dumps exact request and response payloads when debug dumper is configured', async () => {
    const tempDir = createTempDir()
    tempDirs.push(tempDir)
    const videoPath = createVideoFile(tempDir)
    const dumpRootDir = path.join(tempDir, 'dumps')
    const dumper = new SemanticFileDebugDumper({
      rootDir: dumpRootDir,
      copyMediaAssets: true,
    })

    const send = vi.fn().mockResolvedValue(response('dumped summary'))
    const service = new ActivitySemanticService(undefined, {
      client: { chat: { send } },
      debugDumper: dumper,
      usageTracker: { recordUsage: vi.fn() },
      videoModels: ['model-for-dump'],
      snapshotModels: [],
    })

    const result = await service.summarizeFromVideo({
      activity: makeActivity({ id: 'debug-activity' }),
      videoPath,
      ocrText: 'ignored',
    })

    expect(result).toBe('dumped summary')

    const runDir = dumper.getRunDir()
    const attempts = fs.readdirSync(runDir)
    expect(attempts).toHaveLength(1)

    const attemptDir = path.join(runDir, attempts[0])
    const requestJson = fs.readFileSync(path.join(attemptDir, 'request.json'), 'utf8')
    const responseJson = fs.readFileSync(path.join(attemptDir, 'response.json'), 'utf8')
    const summaryTxt = fs.readFileSync(path.join(attemptDir, 'summary.txt'), 'utf8')
    const copiedVideo = fs.readFileSync(path.join(attemptDir, 'input-video-01.mp4'))
    const metadata = JSON.parse(
      fs.readFileSync(path.join(attemptDir, 'metadata.json'), 'utf8'),
    ) as {
      success: boolean
      activityId: string
      model: string
      requestSha256: string
      responseSha256: string
      copiedMediaFiles: string[]
    }

    expect(requestJson).toBe(`${JSON.stringify(send.mock.calls[0][0], null, 2)}\n`)
    expect(responseJson).toBe(`${JSON.stringify(response('dumped summary'), null, 2)}\n`)
    expect(summaryTxt).toBe('dumped summary\n')
    expect(metadata.success).toBe(true)
    expect(metadata.activityId).toBe('debug-activity')
    expect(metadata.model).toBe('model-for-dump')
    expect(typeof metadata.requestSha256).toBe('string')
    expect(metadata.requestSha256.length).toBe(64)
    expect(typeof metadata.responseSha256).toBe('string')
    expect(metadata.responseSha256.length).toBe(64)
    expect(copiedVideo.toString('utf8')).toBe('fake-video-binary')
    expect(metadata.copiedMediaFiles).toEqual(['input-video-01.mp4'])
  })
})
