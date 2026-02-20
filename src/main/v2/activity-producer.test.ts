import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventWindow, InteractionContext } from '../../shared/types'
import { InMemoryStream } from './streams/in-memory-stream'
import type { StreamSubscription } from './streams/stream'
import type { Frame } from './recorder/screen-capturer'
import type { V2Activity } from './activity-types'
import { ActivityProducer } from './activity-producer'

vi.mock('../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function makeFrame(timestamp: number, sequenceNumber: number): Frame {
  return {
    filepath: `frame-${sequenceNumber}.png`,
    timestamp,
    width: 1280,
    height: 720,
    displayId: 1,
    sequenceNumber,
  }
}

function makeEvent(
  timestamp: number,
  type: InteractionContext['type'] = 'keyboard',
  overrides?: Partial<InteractionContext>,
): InteractionContext {
  return {
    type,
    timestamp,
    ...overrides,
  }
}

function makeWindow(params: {
  id: string
  startTimestamp: number
  endTimestamp: number
  events: InteractionContext[]
  closedBy?: EventWindow['closedBy']
}): EventWindow {
  return {
    id: params.id,
    startTimestamp: params.startTimestamp,
    endTimestamp: params.endTimestamp,
    events: params.events,
    closedBy: params.closedBy ?? 'gap',
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 1_500,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

describe('ActivityProducer', () => {
  const subscriptions: StreamSubscription[] = []
  const producers: ActivityProducer[] = []

  afterEach(async () => {
    for (const sub of subscriptions.splice(0)) {
      sub.unsubscribe()
    }
    for (const producer of producers.splice(0)) {
      await producer.stop()
    }
  })

  function createProducer(
    params?: Partial<ConstructorParameters<typeof ActivityProducer>[0]['config']>,
  ) {
    const frameStream = new InMemoryStream<Frame>()
    const eventStream = new InMemoryStream<EventWindow>()
    const activityStream = new InMemoryStream<V2Activity>()
    const producer = new ActivityProducer({
      frameStream,
      eventStream,
      activityStream,
      config: {
        frameJoinGraceMs: 0,
        maxFrameWaitMs: 0,
        minActivityDurationMs: 0,
        maxActivityDurationMs: 300_000,
        frameBufferRetentionMs: 600_000,
        eventConsumerId: 'test:event',
        frameConsumerId: 'test:frame',
        ...(params ?? {}),
      },
    })
    producers.push(producer)
    return { producer, frameStream, eventStream, activityStream }
  }

  it('emits on flush and includes joined frames', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()

    const activities: V2Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(makeFrame(1_000, 0))
    await frameStream.append(makeFrame(1_400, 1))
    const eventOffset = await eventStream.append(
      makeWindow({
        id: 'window-1',
        startTimestamp: 900,
        endTimestamp: 1_500,
        closedBy: 'flush',
        events: [
          makeEvent(900, 'app_change', {
            activeWindow: {
              title: 'Repo',
              processName: 'Code',
              bundleId: 'com.microsoft.VSCode',
              url: 'https://github.com/filip',
            },
          }),
          makeEvent(1_250, 'keyboard'),
        ],
      }),
    )

    await waitFor(() => activities.length === 1, 'Expected one activity')
    expect(activities[0].frames).toHaveLength(2)
    expect(activities[0].context.appName).toBe('Code')
    expect(activities[0].provenance.eventWindowOffsets).toEqual([eventOffset])
    expect(await eventStream.getAck('test:event')).toBe(eventOffset)
    expect(await eventStream.getLowestAvailableOffset()).toBe(eventOffset + 1)
    expect(await frameStream.getAck('test:frame')).toBe(1)
    expect(await frameStream.getLowestAvailableOffset()).toBe(2)
  })

  it('emits deterministic UUIDv5 ids for the same source window chunk', async () => {
    const runOnce = async (): Promise<string> => {
      const { producer, frameStream, eventStream, activityStream } = createProducer()
      const activities: V2Activity[] = []
      subscriptions.push(
        activityStream.subscribe({
          startAt: { type: 'now' },
          onRecord: (record) => activities.push(record.payload),
        }),
      )

      await producer.start()
      await frameStream.append(makeFrame(1_000, 0))
      await eventStream.append(
        makeWindow({
          id: 'stable-window',
          startTimestamp: 900,
          endTimestamp: 1_100,
          closedBy: 'flush',
          events: [
            makeEvent(900, 'app_change', {
              activeWindow: {
                title: 'Stable',
                processName: 'Code',
                bundleId: 'com.microsoft.VSCode',
              },
            }),
          ],
        }),
      )

      await waitFor(() => activities.length === 1, 'Expected one activity')
      return activities[0].id
    }

    const firstId = await runOnce()
    const secondId = await runOnce()

    expect(firstId).toBe(secondId)
    expect(firstId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('trims deferred event offsets when a later flush closes the pending activity', async () => {
    const { producer, frameStream, eventStream } = createProducer()

    await producer.start()
    await frameStream.append(makeFrame(1_000, 0))
    await frameStream.append(makeFrame(2_000, 1))

    const firstOffset = await eventStream.append(
      makeWindow({
        id: 'deferred-window-1',
        startTimestamp: 900,
        endTimestamp: 1_500,
        events: [
          makeEvent(900, 'app_change', {
            activeWindow: {
              title: 'Repo',
              processName: 'Code',
              bundleId: 'com.microsoft.VSCode',
            },
          }),
        ],
      }),
    )

    const secondOffset = await eventStream.append(
      makeWindow({
        id: 'deferred-window-2',
        startTimestamp: 1_600,
        endTimestamp: 2_100,
        closedBy: 'flush',
        events: [makeEvent(1_650, 'keyboard')],
      }),
    )

    await waitFor(
      async () => (await eventStream.getAck('test:event')) === secondOffset,
      'Expected event stream ack to include deferred offsets',
    )
    expect(firstOffset).toBeLessThan(secondOffset)
    expect(await eventStream.getLowestAvailableOffset()).toBe(secondOffset + 1)
  })

  it('merges adjacent windows with same app + same tld and finalizes on context change', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: V2Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(makeFrame(1_000, 0))
    await frameStream.append(makeFrame(2_000, 1))
    await frameStream.append(makeFrame(3_000, 2))
    await frameStream.append(makeFrame(4_000, 3))

    const firstOffset = await eventStream.append(
      makeWindow({
        id: 'w1',
        startTimestamp: 900,
        endTimestamp: 2_100,
        events: [
          makeEvent(900, 'app_change', {
            activeWindow: {
              title: 'Github A',
              processName: 'Google Chrome',
              bundleId: 'com.google.Chrome',
              url: 'https://github.com/a',
            },
          }),
          makeEvent(1_700, 'keyboard'),
        ],
      }),
    )

    const secondOffset = await eventStream.append(
      makeWindow({
        id: 'w2',
        startTimestamp: 2_200,
        endTimestamp: 3_200,
        events: [
          makeEvent(2_200, 'app_change', {
            activeWindow: {
              title: 'Github B',
              processName: 'Google Chrome',
              bundleId: 'com.google.Chrome',
              url: 'https://github.com/b',
            },
          }),
          makeEvent(2_900, 'scroll'),
        ],
      }),
    )

    await eventStream.append(
      makeWindow({
        id: 'w3',
        startTimestamp: 3_300,
        endTimestamp: 4_100,
        closedBy: 'flush',
        events: [
          makeEvent(3_300, 'app_change', {
            activeWindow: {
              title: 'Slack',
              processName: 'Slack',
              bundleId: 'com.tinyspeck.slackmacgap',
            },
          }),
        ],
      }),
    )

    await waitFor(() => activities.length >= 1, 'Expected merged activity')
    const merged = activities.find((a) => a.provenance.sourceWindowIds.includes('w1'))
    expect(merged).toBeDefined()
    expect(merged!.provenance.sourceWindowIds).toEqual(['w1', 'w2'])
    expect(merged!.provenance.eventWindowOffsets).toEqual([firstOffset, secondOffset])
  })

  it('splits browser windows when tld changes', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: V2Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(makeFrame(10_000, 0))
    await frameStream.append(makeFrame(11_000, 1))
    await frameStream.append(makeFrame(12_000, 2))

    await eventStream.append(
      makeWindow({
        id: 'chrome-github',
        startTimestamp: 9_900,
        endTimestamp: 10_500,
        events: [
          makeEvent(9_900, 'app_change', {
            activeWindow: {
              title: 'GitHub',
              processName: 'Google Chrome',
              bundleId: 'com.google.Chrome',
              url: 'https://github.com',
            },
          }),
        ],
      }),
    )

    await eventStream.append(
      makeWindow({
        id: 'chrome-docs',
        startTimestamp: 10_600,
        endTimestamp: 11_500,
        closedBy: 'flush',
        events: [
          makeEvent(10_600, 'app_change', {
            activeWindow: {
              title: 'Docs',
              processName: 'Google Chrome',
              bundleId: 'com.google.Chrome',
              url: 'https://docs.google.com',
            },
          }),
        ],
      }),
    )

    await waitFor(() => activities.length === 2, 'Expected two split activities')
    expect(activities[0].provenance.sourceWindowIds).toEqual(['chrome-github'])
    expect(activities[1].provenance.sourceWindowIds).toEqual(['chrome-docs'])
  })

  it('splits activities when display changes even with same app and tld', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: V2Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(makeFrame(20_000, 0))
    await frameStream.append(makeFrame(21_000, 1))
    await frameStream.append(makeFrame(22_000, 2))

    await eventStream.append(
      makeWindow({
        id: 'chrome-display-1',
        startTimestamp: 19_900,
        endTimestamp: 20_500,
        events: [
          makeEvent(19_900, 'app_change', {
            displayId: 1,
            activeWindow: {
              title: 'GitHub',
              processName: 'Google Chrome',
              bundleId: 'com.google.Chrome',
              url: 'https://github.com/deusXmachina-dev',
            },
          }),
        ],
      }),
    )

    await eventStream.append(
      makeWindow({
        id: 'chrome-display-2',
        startTimestamp: 20_600,
        endTimestamp: 22_100,
        closedBy: 'flush',
        events: [
          makeEvent(20_600, 'app_change', {
            displayId: 2,
            activeWindow: {
              title: 'GitHub',
              processName: 'Google Chrome',
              bundleId: 'com.google.Chrome',
              url: 'https://github.com/deusXmachina-dev/memorylane',
            },
          }),
        ],
      }),
    )

    await waitFor(() => activities.length === 2, 'Expected two activities split by display')
    expect(activities[0].context.displayId).toBe(1)
    expect(activities[1].context.displayId).toBe(2)
    expect(activities[0].provenance.sourceWindowIds).toEqual(['chrome-display-1'])
    expect(activities[1].provenance.sourceWindowIds).toEqual(['chrome-display-2'])
  })

  it('falls back to unknown context for first window and still drops no-frame windows', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: V2Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(makeFrame(1_050, 0))

    const noContextOffset = await eventStream.append(
      makeWindow({
        id: 'unknown',
        startTimestamp: 1_000,
        endTimestamp: 1_100,
        closedBy: 'flush',
        events: [makeEvent(1_020, 'keyboard')],
      }),
    )

    const noFrameOffset = await eventStream.append(
      makeWindow({
        id: 'no-frame',
        startTimestamp: 2_000,
        endTimestamp: 2_200,
        events: [
          makeEvent(2_000, 'app_change', {
            activeWindow: {
              title: 'Code',
              processName: 'Code',
              bundleId: 'com.microsoft.VSCode',
            },
          }),
        ],
      }),
    )

    await waitFor(
      async () => (await eventStream.getAck('test:event')) === noFrameOffset,
      'Expected windows to be processed and acked',
    )
    expect(await eventStream.getLowestAvailableOffset()).toBe(noFrameOffset + 1)
    expect(activities).toHaveLength(1)
    expect(activities[0].context.appName).toBe('Unknown')
    expect(activities[0].provenance.eventWindowOffsets).toEqual([noContextOffset])
    expect(producer.getStats().droppedUnknownContextWindows).toBe(0)
    expect(producer.getStats().droppedNoFrameWindows).toBe(1)
    expect(noContextOffset).toBeLessThan(noFrameOffset)
  })

  it('enforces max activity duration while keeping each emitted activity frame-backed', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer({
      maxActivityDurationMs: 60_000,
    })
    const activities: V2Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(makeFrame(1_000, 0))
    await frameStream.append(makeFrame(30_000, 1))
    await frameStream.append(makeFrame(61_000, 2))
    await frameStream.append(makeFrame(90_000, 3))

    await eventStream.append(
      makeWindow({
        id: 'long-window',
        startTimestamp: 0,
        endTimestamp: 120_000,
        closedBy: 'flush',
        events: [
          makeEvent(0, 'app_change', {
            activeWindow: {
              title: 'Long Session',
              processName: 'Code',
              bundleId: 'com.microsoft.VSCode',
            },
          }),
          makeEvent(80_000, 'keyboard'),
        ],
      }),
    )

    await waitFor(() => activities.length >= 2, 'Expected split activities')
    for (const activity of activities) {
      expect(activity.endTimestamp - activity.startTimestamp + 1).toBeLessThanOrEqual(60_000)
      expect(activity.frames.length).toBeGreaterThan(0)
    }
  })

  it('replays from ack on restart without duplicating prior windows', async () => {
    const frameStream = new InMemoryStream<Frame>()
    const eventStream = new InMemoryStream<EventWindow>()
    const activityStream = new InMemoryStream<V2Activity>()
    const config = {
      frameJoinGraceMs: 0,
      maxFrameWaitMs: 0,
      minActivityDurationMs: 0,
      maxActivityDurationMs: 300_000,
      frameBufferRetentionMs: 600_000,
      eventConsumerId: 'test:event:restart',
      frameConsumerId: 'test:frame:restart',
    }

    const activities: V2Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'offset', offset: 0 },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    const producerA = new ActivityProducer({
      frameStream,
      eventStream,
      activityStream,
      config,
    })
    producers.push(producerA)
    await producerA.start()

    await frameStream.append(makeFrame(5_000, 0))
    await eventStream.append(
      makeWindow({
        id: 'window-a',
        startTimestamp: 4_900,
        endTimestamp: 5_100,
        closedBy: 'flush',
        events: [
          makeEvent(4_900, 'app_change', {
            activeWindow: {
              title: 'A',
              processName: 'Code',
              bundleId: 'com.microsoft.VSCode',
            },
          }),
        ],
      }),
    )

    await waitFor(() => activities.length === 1, 'Expected first activity before restart')
    await producerA.stop()
    producers.pop()

    const producerB = new ActivityProducer({
      frameStream,
      eventStream,
      activityStream,
      config,
    })
    producers.push(producerB)
    await producerB.start()

    await frameStream.append(makeFrame(6_000, 1))
    await eventStream.append(
      makeWindow({
        id: 'window-b',
        startTimestamp: 5_900,
        endTimestamp: 6_100,
        closedBy: 'flush',
        events: [
          makeEvent(5_900, 'app_change', {
            activeWindow: {
              title: 'B',
              processName: 'Code',
              bundleId: 'com.microsoft.VSCode',
            },
          }),
        ],
      }),
    )

    await waitFor(() => activities.length === 2, 'Expected only one new activity after restart')
    expect(
      activities.filter((a) => a.provenance.sourceWindowIds.includes('window-a')),
    ).toHaveLength(1)
    expect(
      activities.filter((a) => a.provenance.sourceWindowIds.includes('window-b')),
    ).toHaveLength(1)
  })
})
