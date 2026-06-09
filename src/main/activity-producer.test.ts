import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACTIVITY_CONFIG } from '@constants'
import type { EventWindow, InteractionContext } from '../shared/types'
import { InMemoryStream } from './streams/in-memory-stream'
import type { StreamSubscription } from './streams/stream'
import type { Frame } from './recorder/screen-capturer'
import type { Activity } from './activity-types'
import { ActivityProducer } from './activity-producer'
import { ActivityExtractor } from './activity-extractor'

vi.mock('./logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function makeFrame(
  timestamp: number,
  sequenceNumber: number,
  app?: { appName: string; bundleId?: string },
): Frame {
  return {
    filepath: `frame-${sequenceNumber}.png`,
    timestamp,
    width: 1280,
    height: 720,
    displayId: 1,
    sequenceNumber,
    ...(app ?? {}),
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
  const originalActivityConfig = {
    min: ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS,
    max: ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS,
  }

  afterEach(async () => {
    ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS = originalActivityConfig.min
    ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS = originalActivityConfig.max
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
    const activityStream = new InMemoryStream<Activity>()
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

    const activities: Activity[] = []
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
      const activities: Activity[] = []
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
    const activities: Activity[] = []
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
    const activities: Activity[] = []
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
    const activities: Activity[] = []
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
    const activities: Activity[] = []
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

  it('excludes a frame whose stamped app does not match the window context', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(
      makeFrame(1_000, 0, { appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
    )
    await frameStream.append(
      makeFrame(1_200, 1, { appName: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' }),
    )
    await eventStream.append(
      makeWindow({
        id: 'code-window',
        startTimestamp: 900,
        endTimestamp: 1_500,
        closedBy: 'flush',
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

    await waitFor(() => activities.length === 1, 'Expected one activity')
    expect(activities[0].context.appName).toBe('Code')
    expect(activities[0].frames.map((f) => f.frame.filepath)).toEqual(['frame-0.png'])
  })

  it('retains an app-less (unstamped) frame regardless of context', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(makeFrame(1_000, 0)) // no app stamp
    await eventStream.append(
      makeWindow({
        id: 'code-window',
        startTimestamp: 900,
        endTimestamp: 1_500,
        closedBy: 'flush',
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

    await waitFor(() => activities.length === 1, 'Expected one activity')
    expect(activities[0].frames).toHaveLength(1)
  })

  it('matches on appName when the frame carries no bundleId', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(makeFrame(1_000, 0, { appName: 'Code' })) // matches by appName
    await frameStream.append(makeFrame(1_200, 1, { appName: 'Slack' })) // excluded by appName
    await eventStream.append(
      makeWindow({
        id: 'code-window',
        startTimestamp: 900,
        endTimestamp: 1_500,
        closedBy: 'flush',
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

    await waitFor(() => activities.length === 1, 'Expected one activity')
    expect(activities[0].frames.map((f) => f.frame.filepath)).toEqual(['frame-0.png'])
  })

  it('prefers bundleId: excludes a frame whose bundleId differs even if appName matches', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(makeFrame(1_000, 0, { appName: 'Helper', bundleId: 'com.a' }))
    await frameStream.append(makeFrame(1_200, 1, { appName: 'Helper', bundleId: 'com.b' }))
    await eventStream.append(
      makeWindow({
        id: 'helper-window',
        startTimestamp: 900,
        endTimestamp: 1_500,
        closedBy: 'flush',
        events: [
          makeEvent(900, 'app_change', {
            activeWindow: { title: 'A', processName: 'Helper', bundleId: 'com.a' },
          }),
        ],
      }),
    )

    await waitFor(() => activities.length === 1, 'Expected one activity')
    expect(activities[0].frames.map((f) => f.frame.filepath)).toEqual(['frame-0.png'])
  })

  it('treats a window whose only frames are app-mismatched as frameless and finalizes the incompatible pending activity', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(
      makeFrame(1_500, 0, { appName: 'Ghostty', bundleId: 'com.mitchellh.ghostty' }),
    )
    // Lands in W2's time range but is stamped with the PREVIOUS app (the leak):
    // excluded from the Electron window, leaving it frameless.
    await frameStream.append(
      makeFrame(2_100, 1, { appName: 'Ghostty', bundleId: 'com.mitchellh.ghostty' }),
    )

    await eventStream.append(
      makeWindow({
        id: 'ghostty',
        startTimestamp: 1_000,
        endTimestamp: 2_000,
        closedBy: 'app_change',
        events: [
          makeEvent(1_000, 'app_change', {
            displayId: 1,
            activeWindow: {
              title: 'session',
              processName: 'Ghostty',
              bundleId: 'com.mitchellh.ghostty',
            },
          }),
          makeEvent(1_600, 'scroll'),
        ],
      }),
    )

    const lastOffset = await eventStream.append(
      makeWindow({
        id: 'electron',
        startTimestamp: 2_000,
        endTimestamp: 2_200,
        closedBy: 'gap',
        events: [
          makeEvent(2_000, 'app_change', {
            displayId: 1,
            activeWindow: {
              title: 'MemoryLane',
              processName: 'Electron',
              bundleId: 'com.github.Electron',
            },
          }),
        ],
      }),
    )

    await waitFor(
      () => activities.length === 1 && producer.getStats().droppedNoFrameWindows === 1,
      'Expected the Ghostty activity to emit and the app-mismatched Electron window to drop',
    )
    expect(activities.map((a) => a.context.appName)).toEqual(['Ghostty'])
    expect(activities[0].frames.map((f) => f.frame.filepath)).toEqual(['frame-0.png'])
    expect(producer.getStats().emittedActivities).toBe(1)

    // The incompatible frameless window finalized the pending activity, so the
    // event offsets ack without an explicit flush/stop.
    await waitFor(
      async () => (await eventStream.getAck('test:event')) === lastOffset,
      'Expected event offsets to ack after the pending activity is finalized',
    )
  })

  it('drops a concrete-app-stamped frame in an Unknown-context window', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(
      makeFrame(1_050, 0, { appName: 'Ghostty', bundleId: 'com.mitchellh.ghostty' }),
    )
    await eventStream.append(
      makeWindow({
        id: 'unknown',
        startTimestamp: 1_000,
        endTimestamp: 1_100,
        closedBy: 'flush',
        events: [makeEvent(1_020, 'keyboard')], // no app_change -> 'Unknown' context
      }),
    )

    await waitFor(
      () => producer.getStats().droppedNoFrameWindows === 1,
      'Expected the Unknown-context window to drop the mismatched frame',
    )
    expect(activities).toHaveLength(0)
  })

  it('keeps a mismatched frame when the app filter is disabled', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer({
      enableFrameAppFilter: false,
    })
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(
      makeFrame(1_000, 0, { appName: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' }),
    )
    await eventStream.append(
      makeWindow({
        id: 'code-window',
        startTimestamp: 900,
        endTimestamp: 1_500,
        closedBy: 'flush',
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

    await waitFor(() => activities.length === 1, 'Expected one activity')
    expect(activities[0].frames).toHaveLength(1)
  })

  it('drops the trailing frame when an activity is finalized by a different app', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(
      makeFrame(1_200, 0, { appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
    )
    await frameStream.append(
      makeFrame(1_800, 1, { appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
    )
    await frameStream.append(
      makeFrame(2_500, 2, { appName: 'Slack', bundleId: 'com.tinyspeck.slackmacgap' }),
    )

    await eventStream.append(
      makeWindow({
        id: 'code',
        startTimestamp: 1_000,
        endTimestamp: 2_000,
        closedBy: 'app_change',
        events: [
          makeEvent(1_000, 'app_change', {
            activeWindow: { title: 'Repo', processName: 'Code', bundleId: 'com.microsoft.VSCode' },
          }),
          makeEvent(1_500, 'scroll'),
        ],
      }),
    )
    await eventStream.append(
      makeWindow({
        id: 'slack',
        startTimestamp: 2_000,
        endTimestamp: 3_000,
        closedBy: 'flush',
        events: [
          makeEvent(2_000, 'app_change', {
            activeWindow: {
              title: 'general',
              processName: 'Slack',
              bundleId: 'com.tinyspeck.slackmacgap',
            },
          }),
        ],
      }),
    )

    await waitFor(() => activities.length === 2, 'Expected two activities')
    expect(activities.map((a) => a.context.appName)).toEqual(['Code', 'Slack'])
    // Code's trailing frame (1_800, offset 1) is the transition bleed -> dropped.
    expect(activities[0].frames.map((f) => f.frame.filepath)).toEqual(['frame-0.png'])
    expect(activities[0].provenance.frameOffsets).toEqual([0])
    // Slack is finalized by flush (not an app switch), so its frame is kept.
    expect(activities[1].frames.map((f) => f.frame.filepath)).toEqual(['frame-2.png'])
  })

  it('keeps the trailing frame when dropAppSwitchTrailingFrame is disabled', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer({
      dropAppSwitchTrailingFrame: false,
    })
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(
      makeFrame(1_200, 0, { appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
    )
    await frameStream.append(
      makeFrame(1_800, 1, { appName: 'Code', bundleId: 'com.microsoft.VSCode' }),
    )
    await eventStream.append(
      makeWindow({
        id: 'code',
        startTimestamp: 1_000,
        endTimestamp: 2_000,
        closedBy: 'app_change',
        events: [
          makeEvent(1_000, 'app_change', {
            activeWindow: { title: 'Repo', processName: 'Code', bundleId: 'com.microsoft.VSCode' },
          }),
        ],
      }),
    )
    await eventStream.append(
      makeWindow({
        id: 'slack',
        startTimestamp: 2_000,
        endTimestamp: 3_000,
        closedBy: 'flush',
        events: [
          makeEvent(2_000, 'app_change', {
            activeWindow: {
              title: 'general',
              processName: 'Slack',
              bundleId: 'com.tinyspeck.slackmacgap',
            },
          }),
        ],
      }),
    )

    await waitFor(
      () => activities.some((a) => a.context.appName === 'Code'),
      'Expected the Code activity',
    )
    const code = activities.find((a) => a.context.appName === 'Code')!
    expect(code.frames.map((f) => f.frame.filepath)).toEqual(['frame-0.png', 'frame-1.png'])
  })

  it('does not drop the trailing frame on a same-app tld boundary', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    const chrome = { appName: 'Google Chrome', bundleId: 'com.google.Chrome' }
    await frameStream.append(makeFrame(1_200, 0, chrome))
    await frameStream.append(makeFrame(1_800, 1, chrome))
    await frameStream.append(makeFrame(2_500, 2, chrome)) // lands in the second (other.org) window

    await eventStream.append(
      makeWindow({
        id: 'chrome-a',
        startTimestamp: 1_000,
        endTimestamp: 2_000,
        closedBy: 'app_change',
        events: [
          makeEvent(1_000, 'app_change', {
            activeWindow: { title: 'A', ...chrome, url: 'https://example.com/a' },
          }),
          makeEvent(1_500, 'scroll'),
        ],
      }),
    )
    await eventStream.append(
      makeWindow({
        id: 'chrome-b',
        startTimestamp: 2_000,
        endTimestamp: 3_000,
        closedBy: 'flush',
        events: [
          makeEvent(2_000, 'app_change', {
            activeWindow: { title: 'B', ...chrome, url: 'https://other.org/b' },
          }),
        ],
      }),
    )

    await waitFor(() => activities.length === 2, 'Expected two activities split by tld')
    // Same app across the boundary -> no transition bleed -> both frames kept.
    expect(activities[0].frames.map((f) => f.frame.filepath)).toEqual([
      'frame-0.png',
      'frame-1.png',
    ])
  })

  // Regression for the "trailing pending activity" data loss: the producer keeps
  // a single pendingActivity. It used to be emitted only when a LATER frame-backed
  // window with an incompatible context arrived (-> context_change finalize) or on
  // an explicit flush/stop. A no-frame successor is dropped BEFORE
  // buildWindowChunks/integrateChunk run, so it never finalized the pending
  // activity, and the last frame-backed window of a session was stranded and lost.
  // Now a frameless window with an incompatible context still finalizes the
  // pending activity.
  //
  // Mirrors a real recording: App-X (Unknown) -> Ghostty (frames) -> switch to a
  // frameless window at session end. Both App-X and Ghostty must be persisted.
  it('finalizes the trailing pending activity when its successor is an incompatible no-frame window', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer()
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()

    // Frames for the first two windows; the trailing window gets none.
    await frameStream.append(makeFrame(1_500, 0)) // App-X window
    await frameStream.append(makeFrame(2_500, 1)) // Ghostty window
    await frameStream.append(makeFrame(3_500, 2)) // Ghostty window

    // W1 - pre-existing focus, no app_change inside it -> 'Unknown' context.
    // Closed by the switch to Ghostty (the app_change lands in the NEXT window).
    await eventStream.append(
      makeWindow({
        id: 'appx',
        startTimestamp: 1_000,
        endTimestamp: 2_000,
        closedBy: 'app_change',
        events: [makeEvent(1_500, 'scroll')],
      }),
    )

    // W2 - Ghostty: frame-backed, valid context, well above min duration.
    // Its arrival is what flushes W1 out (incompatible context), and it then
    // becomes the trailing pendingActivity.
    await eventStream.append(
      makeWindow({
        id: 'ghostty',
        startTimestamp: 2_000,
        endTimestamp: 4_000,
        closedBy: 'app_change',
        events: [
          makeEvent(2_000, 'app_change', {
            displayId: 1,
            activeWindow: {
              title: 'activity-boundary-bugs',
              processName: 'Ghostty',
              bundleId: 'com.mitchellh.ghostty',
            },
          }),
          makeEvent(3_000, 'scroll'),
        ],
      }),
    )

    // W3 - switch to a context whose window has no frames yet (end of session).
    // Dropped as a no-frame window WITHOUT flushing the pending Ghostty activity.
    const lastOffset = await eventStream.append(
      makeWindow({
        id: 'electron',
        startTimestamp: 4_000,
        endTimestamp: 4_200,
        closedBy: 'gap',
        events: [
          makeEvent(4_000, 'app_change', {
            displayId: 1,
            activeWindow: {
              title: 'MemoryLane',
              processName: 'Electron',
              bundleId: 'com.github.Electron',
            },
          }),
        ],
      }),
    )

    // All three windows processed - WITHOUT any explicit flush/stop: App-X
    // emitted, Ghostty finalized by the incompatible frameless successor, and
    // the trailing no-frame window dropped.
    await waitFor(
      () => activities.length === 2 && producer.getStats().droppedNoFrameWindows === 1,
      'Expected both App-X and Ghostty to emit, and the trailing no-frame window to drop',
    )

    // Ghostty (frames + valid context + 2000ms duration) is persisted even though
    // its only successor was a frameless window, instead of being stranded.
    expect(activities.map((a) => a.context.appName)).toEqual(['Unknown', 'Ghostty'])
    expect(activities[1].provenance.sourceWindowIds).toEqual(['ghostty'])
    expect(producer.getStats().emittedActivities).toBe(2)

    // The pending activity was finalized by the incompatible window, so its event
    // offsets ack without needing a flush/stop.
    await waitFor(
      async () => (await eventStream.getAck('test:event')) === lastOffset,
      'Expected event offsets to ack after the pending activity is finalized',
    )
  })

  it('shutdown: trailing activities emitted at stop are still persisted by the extractor', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer({
      minActivityDurationMs: 0,
    })
    const persisted: string[] = []
    let releaseFirst: (() => void) | null = null
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstSeen = false

    const extractor = new ActivityExtractor({
      activityStream,
      transformer: {
        transform: async (a) => {
          // Hold the FIRST activity's transform in-flight to mirror the real
          // timing: the first activity's (slow LLM) transform is still running
          // when capture stops and the trailing activities are emitted.
          if (!firstSeen) {
            firstSeen = true
            await firstGate
          }
          return {
            activityId: a.id,
            startTimestamp: a.startTimestamp,
            endTimestamp: a.endTimestamp,
            appName: a.context.appName,
            windowTitle: a.context.windowTitle ?? '',
            tld: a.context.tld,
            summary: '',
            summaryModel: '',
            ocrText: '',
            vector: [0, 0, 0],
          }
        },
      },
      sink: {
        persist: async ({ extracted }) => {
          persisted.push(extracted.appName)
        },
      },
      config: { consumerId: 'shutdown:x', maxConcurrent: 1, maxRetries: 0, retryBackoffMs: 0 },
    })

    await producer.start()
    await extractor.start()

    // App-X (no app_change -> Unknown), closed by switch to Ghostty.
    await frameStream.append(makeFrame(1_500, 0))
    await eventStream.append(
      makeWindow({
        id: 'appx',
        startTimestamp: 1_000,
        endTimestamp: 2_000,
        closedBy: 'app_change',
        events: [makeEvent(1_500, 'scroll')],
      }),
    )
    // Ghostty, closed by switch to Electron.
    await frameStream.append(makeFrame(2_500, 1))
    await frameStream.append(makeFrame(3_500, 2))
    await eventStream.append(
      makeWindow({
        id: 'ghostty',
        startTimestamp: 2_000,
        endTimestamp: 4_000,
        closedBy: 'app_change',
        events: [
          makeEvent(2_000, 'app_change', {
            displayId: 1,
            activeWindow: {
              title: 'term',
              processName: 'Ghostty',
              bundleId: 'com.mitchellh.ghostty',
            },
          }),
          makeEvent(3_000, 'scroll'),
        ],
      }),
    )
    // Electron (final app), closed by switch (becomes trailing pending).
    await frameStream.append(makeFrame(4_500, 3))
    await eventStream.append(
      makeWindow({
        id: 'electron',
        startTimestamp: 4_000,
        endTimestamp: 5_000,
        closedBy: 'app_change',
        events: [
          makeEvent(4_000, 'app_change', {
            displayId: 1,
            activeWindow: {
              title: 'MemoryLane',
              processName: 'Electron',
              bundleId: 'com.github.Electron',
            },
          }),
        ],
      }),
    )

    // Wait until the first emitted activity (Unknown) is in-flight on the gate.
    await waitFor(() => firstSeen, 'Expected the first activity transform to start')

    // Mirror harness.stop(): producer first (flushes the trailing pending), then extractor.
    const stopProducer = producer.stop()
    releaseFirst?.()
    await stopProducer
    await extractor.stop()

    // Every emitted activity must be persisted — nothing lost in the shutdown drain.
    expect(persisted).toContain('Unknown')
    expect(persisted).toContain('Ghostty')
    expect(persisted).toContain('Electron')
  })

  it('enforces max activity duration while keeping each emitted activity frame-backed', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer({
      maxActivityDurationMs: 60_000,
    })
    const activities: Activity[] = []
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
    const activityStream = new InMemoryStream<Activity>()
    const config = {
      frameJoinGraceMs: 0,
      maxFrameWaitMs: 0,
      minActivityDurationMs: 0,
      maxActivityDurationMs: 300_000,
      frameBufferRetentionMs: 600_000,
      eventConsumerId: 'test:event:restart',
      frameConsumerId: 'test:frame:restart',
    }

    const activities: Activity[] = []
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

  it('uses current ACTIVITY_CONFIG defaults when min/max are not provided', async () => {
    ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS = 5_000
    ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS = 60_000

    const frameStream = new InMemoryStream<Frame>()
    const eventStream = new InMemoryStream<EventWindow>()
    const activityStream = new InMemoryStream<Activity>()
    const producer = new ActivityProducer({
      frameStream,
      eventStream,
      activityStream,
      config: {
        frameJoinGraceMs: 0,
        maxFrameWaitMs: 0,
        frameBufferRetentionMs: 120_000,
        eventConsumerId: 'test:event:defaults',
        frameConsumerId: 'test:frame:defaults',
      },
    })
    producers.push(producer)

    const activities: Activity[] = []
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
        id: 'short-by-default',
        startTimestamp: 0,
        endTimestamp: 1_500,
        closedBy: 'flush',
        events: [
          makeEvent(0, 'app_change', {
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
      async () => (await eventStream.getAck('test:event:defaults')) === 0,
      'Expected short window to be processed',
    )
    expect(activities).toHaveLength(0)
  })

  it('applies updated activity window config at runtime', async () => {
    const { producer, frameStream, eventStream, activityStream } = createProducer({
      minActivityDurationMs: 0,
      maxActivityDurationMs: 300_000,
    })
    const activities: Activity[] = []
    subscriptions.push(
      activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await producer.start()
    await frameStream.append(makeFrame(1_000, 0))
    await frameStream.append(makeFrame(2_000, 1))

    await eventStream.append(
      makeWindow({
        id: 'before-update',
        startTimestamp: 0,
        endTimestamp: 2_100,
        closedBy: 'flush',
        events: [
          makeEvent(0, 'app_change', {
            activeWindow: {
              title: 'Code',
              processName: 'Code',
              bundleId: 'com.microsoft.VSCode',
            },
          }),
        ],
      }),
    )

    await waitFor(() => activities.length === 1, 'Expected first window to emit')

    producer.updateActivityWindowConfig({
      minActivityDurationMs: 10_000,
      maxActivityDurationMs: 300_000,
    })

    await frameStream.append(makeFrame(20_000, 2))
    await frameStream.append(makeFrame(21_000, 3))
    await eventStream.append(
      makeWindow({
        id: 'after-update',
        startTimestamp: 20_000,
        endTimestamp: 21_500,
        closedBy: 'flush',
        events: [
          makeEvent(20_000, 'app_change', {
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
      async () => (await eventStream.getAck('test:event')) === 1,
      'Expected second window to be processed',
    )
    expect(activities).toHaveLength(1)
  })
})
