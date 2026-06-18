import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivityExtractor } from './activity-extractor'
import type {
  ActivitySink,
  ActivityTransformer,
  ActivityExtractorConfig,
  ExtractedActivity,
} from './activity-extraction-types'
import type { Activity } from './activity-types'
import { InMemoryStream } from './streams/in-memory-stream'

vi.mock('./logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 2_000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await sleep(10)
  }
  throw new Error(message)
}

function makeActivity(id: string, timestamp: number): Activity {
  return {
    id,
    startTimestamp: timestamp,
    endTimestamp: timestamp + 1_000,
    context: {
      appName: 'Code',
      bundleId: 'com.microsoft.VSCode',
      windowTitle: 'Editor',
      tld: undefined,
    },
    interactions: [],
    frames: [],
    provenance: {
      eventWindowOffsets: [],
      frameOffsets: [],
      sourceWindowIds: [],
      sourceClosedBy: [],
    },
  }
}

function makeExtracted(activity: Activity): ExtractedActivity {
  return {
    activityId: activity.id,
    startTimestamp: activity.startTimestamp,
    endTimestamp: activity.endTimestamp,
    appName: activity.context.appName,
    windowTitle: activity.context.windowTitle ?? '',
    tld: activity.context.tld,
    summary: `summary:${activity.id}`,
    summaryModel: '',
    summaryMode: '',
    summaryReason: '',
    summaryFailureDetail: '',
    ocrText: `ocr:${activity.id}`,
    vector: [0.1, 0.2, 0.3],
  }
}

describe('ActivityExtractor', () => {
  const extractors: ActivityExtractor[] = []

  afterEach(async () => {
    for (const extractor of extractors.splice(0)) {
      await extractor.stop()
    }
  })

  function createExtractor(params?: {
    transformer?: ActivityTransformer
    sink?: ActivitySink
    config?: Partial<ActivityExtractorConfig>
  }): {
    extractor: ActivityExtractor
    activityStream: InMemoryStream<Activity>
    consumerId: string
  } {
    const activityStream = new InMemoryStream<Activity>()
    const consumerId = params?.config?.consumerId ?? 'test:activity-extractor'
    const transformer: ActivityTransformer = params?.transformer ?? {
      transform: async (activity) => makeExtracted(activity),
    }
    const sink: ActivitySink = params?.sink ?? {
      persist: async () => undefined,
    }
    const extractor = new ActivityExtractor({
      activityStream,
      transformer,
      sink,
      config: {
        consumerId,
        maxConcurrent: 2,
        maxRetries: 2,
        retryBackoffMs: 1,
        ...(params?.config ?? {}),
      },
    })
    extractors.push(extractor)
    return { extractor, activityStream, consumerId }
  }

  it('processes activities and advances ack', async () => {
    const persisted: string[] = []
    const { extractor, activityStream, consumerId } = createExtractor({
      sink: {
        persist: async ({ activity, extracted }) => {
          persisted.push(activity.id)
          expect(extracted.activityId).toBe(activity.id)
        },
      },
    })

    await extractor.start()
    await activityStream.append(makeActivity('a0', 1_000))
    await activityStream.append(makeActivity('a1', 2_000))

    await waitFor(() => persisted.length === 2, 'Expected both activities persisted')
    await waitFor(
      async () => (await activityStream.getAck(consumerId)) === 1,
      'Expected ack to advance to latest offset',
    )
    expect(await activityStream.getLowestAvailableOffset()).toBe(2)
    expect(extractor.getStats().succeeded).toBe(2)
  })

  it('enforces maxConcurrent worker limit', async () => {
    let running = 0
    let maxRunning = 0
    let releaseGate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    let persistedCount = 0

    const { extractor, activityStream } = createExtractor({
      config: { maxConcurrent: 2 },
      transformer: {
        transform: async (activity) => {
          running++
          maxRunning = Math.max(maxRunning, running)
          await gate
          running--
          return makeExtracted(activity)
        },
      },
      sink: {
        persist: async () => {
          persistedCount++
        },
      },
    })

    await extractor.start()
    for (let i = 0; i < 5; i++) {
      await activityStream.append(makeActivity(`c${i}`, i * 1_000))
    }

    await waitFor(() => maxRunning === 2, 'Expected worker concurrency to reach configured max')
    releaseGate?.()

    await waitFor(() => persistedCount === 5, 'Expected all activities to be persisted')
    expect(maxRunning).toBe(2)
  })

  it('acks only contiguous completed offsets when tasks finish out of order', async () => {
    let releaseFirst: (() => void) | null = null
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const persisted: string[] = []

    const { extractor, activityStream, consumerId } = createExtractor({
      transformer: {
        transform: async (activity) => {
          if (activity.id === 'slow') {
            await firstGate
          }
          return makeExtracted(activity)
        },
      },
      sink: {
        persist: async ({ activity }) => {
          persisted.push(activity.id)
        },
      },
    })

    await extractor.start()
    await activityStream.append(makeActivity('slow', 1_000)) // offset 0
    await activityStream.append(makeActivity('fast', 2_000)) // offset 1

    await waitFor(() => persisted.includes('fast'), 'Expected fast activity to finish first')
    expect(await activityStream.getAck(consumerId)).toBeNull()

    releaseFirst?.()
    await waitFor(
      async () => (await activityStream.getAck(consumerId)) === 1,
      'Expected ack to advance after gap closes',
    )
  })

  it('retries transient failures and eventually persists', async () => {
    const attempts = new Map<string, number>()
    let persistedCount = 0
    const { extractor, activityStream, consumerId } = createExtractor({
      config: { maxRetries: 3, retryBackoffMs: 1 },
      transformer: {
        transform: async (activity) => {
          const attempt = (attempts.get(activity.id) ?? 0) + 1
          attempts.set(activity.id, attempt)
          if (attempt < 3) {
            throw new Error(`transient:${attempt}`)
          }
          return makeExtracted(activity)
        },
      },
      sink: {
        persist: async () => {
          persistedCount++
        },
      },
    })

    await extractor.start()
    await activityStream.append(makeActivity('retry-me', 3_000))

    await waitFor(() => persistedCount === 1, 'Expected retry activity to eventually persist')
    expect(attempts.get('retry-me')).toBe(3)
    expect(await activityStream.getAck(consumerId)).toBe(0)

    const stats = extractor.getStats()
    expect(stats.retried).toBe(2)
    expect(stats.deadLettered).toBe(0)
    expect(stats.succeeded).toBe(1)
  })

  it('notifies persisted listeners with extracted activity after sink persistence', async () => {
    const callOrder: string[] = []
    const listenerCalls: Array<{ activityId: string; summary: string }> = []
    const { extractor, activityStream, consumerId } = createExtractor({
      sink: {
        persist: async ({ activity }) => {
          callOrder.push(`persist:${activity.id}`)
        },
      },
    })

    extractor.addPersistedListener(async ({ activity, extracted }) => {
      callOrder.push(`listener:${activity.id}`)
      listenerCalls.push({
        activityId: activity.id,
        summary: extracted.summary,
      })
    })

    await extractor.start()
    await activityStream.append(makeActivity('listener-1', 4_000))

    await waitFor(() => listenerCalls.length === 1, 'Expected persisted listener to be called')
    expect(listenerCalls).toEqual([
      {
        activityId: 'listener-1',
        summary: 'summary:listener-1',
      },
    ])
    expect(callOrder).toEqual(['persist:listener-1', 'listener:listener-1'])
    expect(await activityStream.getAck(consumerId)).toBe(0)
  })

  it('dead-letters after retries are exhausted and unblocks later offsets', async () => {
    const persisted: string[] = []
    const { extractor, activityStream, consumerId } = createExtractor({
      config: { maxRetries: 1, retryBackoffMs: 1 },
      transformer: {
        transform: async (activity) => {
          if (activity.id === 'always-fail') {
            throw new Error('permanent')
          }
          return makeExtracted(activity)
        },
      },
      sink: {
        persist: async ({ activity }) => {
          persisted.push(activity.id)
        },
      },
    })

    await extractor.start()
    await activityStream.append(makeActivity('always-fail', 10_000)) // offset 0
    await activityStream.append(makeActivity('good', 11_000)) // offset 1

    await waitFor(
      async () => (await activityStream.getAck(consumerId)) === 1,
      'Expected ack to advance beyond dead-lettered offset',
    )

    expect(persisted).toEqual(['good'])
    const stats = extractor.getStats()
    expect(stats.failed).toBe(1)
    expect(stats.deadLettered).toBe(1)
    expect(stats.retried).toBe(1)
  })

  it('replays from ack on restart without reprocessing acked offsets', async () => {
    const activityStream = new InMemoryStream<Activity>()
    const consumerId = 'test:activity-extractor:restart'
    const processed: string[] = []

    const extractorA = new ActivityExtractor({
      activityStream,
      transformer: {
        transform: async (activity) => {
          processed.push(`A:${activity.id}`)
          return makeExtracted(activity)
        },
      },
      sink: {
        persist: async () => undefined,
      },
      config: {
        consumerId,
        maxConcurrent: 2,
        maxRetries: 0,
        retryBackoffMs: 0,
      },
    })
    extractors.push(extractorA)

    await extractorA.start()
    await activityStream.append(makeActivity('first', 20_000))
    await waitFor(async () => (await activityStream.getAck(consumerId)) === 0, 'Expected first ack')
    await extractorA.stop()

    const extractorB = new ActivityExtractor({
      activityStream,
      transformer: {
        transform: async (activity) => {
          processed.push(`B:${activity.id}`)
          return makeExtracted(activity)
        },
      },
      sink: {
        persist: async () => undefined,
      },
      config: {
        consumerId,
        maxConcurrent: 2,
        maxRetries: 0,
        retryBackoffMs: 0,
      },
    })
    extractors.push(extractorB)

    await extractorB.start()
    await activityStream.append(makeActivity('second', 21_000))
    await waitFor(
      async () => (await activityStream.getAck(consumerId)) === 1,
      'Expected second ack',
    )

    expect(processed.filter((entry) => entry.endsWith(':first'))).toHaveLength(1)
    expect(processed.filter((entry) => entry.endsWith(':second'))).toHaveLength(1)
    expect(processed.includes('B:first')).toBe(false)
  })

  it('fires onTaskComplete with succeeded after successful processing', async () => {
    const completions: Array<{ id: string; outcome: string }> = []
    const { extractor, activityStream } = createExtractor({
      config: {
        onTaskComplete: (activity, outcome) => {
          completions.push({ id: activity.id, outcome })
        },
      },
    })

    await extractor.start()
    await activityStream.append(makeActivity('ok-1', 30_000))
    await activityStream.append(makeActivity('ok-2', 31_000))

    await waitFor(() => completions.length === 2, 'Expected both completions')
    expect(completions).toEqual([
      { id: 'ok-1', outcome: 'succeeded' },
      { id: 'ok-2', outcome: 'succeeded' },
    ])
  })

  it('fires onTaskComplete with dead-lettered after retry exhaustion', async () => {
    const completions: Array<{ id: string; outcome: string }> = []
    const { extractor, activityStream } = createExtractor({
      config: {
        maxRetries: 0,
        retryBackoffMs: 0,
        onTaskComplete: (activity, outcome) => {
          completions.push({ id: activity.id, outcome })
        },
      },
      transformer: {
        transform: async () => {
          throw new Error('always fails')
        },
      },
    })

    await extractor.start()
    await activityStream.append(makeActivity('fail-1', 40_000))

    await waitFor(() => completions.length === 1, 'Expected dead-letter completion')
    expect(completions[0]).toEqual({ id: 'fail-1', outcome: 'dead-lettered' })
  })

  it('onTaskComplete errors do not crash the extractor', async () => {
    const persisted: string[] = []
    const { extractor, activityStream } = createExtractor({
      config: {
        onTaskComplete: () => {
          throw new Error('callback boom')
        },
      },
      sink: {
        persist: async ({ activity }) => {
          persisted.push(activity.id)
        },
      },
    })

    await extractor.start()
    await activityStream.append(makeActivity('survive-1', 50_000))
    await activityStream.append(makeActivity('survive-2', 51_000))

    await waitFor(
      () => persisted.length === 2,
      'Expected both activities to persist despite callback errors',
    )
    expect(extractor.getStats().succeeded).toBe(2)
  })
})
