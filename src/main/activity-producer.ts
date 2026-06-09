import { isBrowserApp } from '../shared/app-utils'
import { extractTld } from './recorder/tld-utils'
import log from './logger'
import type { EventWindow, InteractionContext } from '../shared/types'
import type { Frame } from './recorder/screen-capturer'
import type { DurableStream, Offset, StreamRecord, StreamSubscription } from './streams/stream'
import { v5 as uuidv5 } from 'uuid'
import {
  createDefaultActivityProducerConfig,
  type Activity,
  type ActivityContext,
  type ActivityFrame,
  type ActivityProducerConfig,
} from './activity-types'

const ACTIVITY_ID_NAMESPACE = uuidv5('memorylane:v2-activity', uuidv5.DNS)

export interface ActivityProducerStats {
  emittedActivities: number
  // Windows dropped because no frame fell in their time range at all.
  droppedNoFrameWindows: number
  // Windows that had frames in their time range but every one was excluded by
  // the grab-time app filter (the leak signature: in-range frames all stamped
  // with a different app than the window context).
  droppedAllFramesFilteredWindows: number
  droppedUnknownContextWindows: number
  // Total frames kept out of a window by the grab-time app filter (includes the
  // ones counted by droppedAllFramesFilteredWindows). A proxy for how often the
  // leak the filter guards against actually fires in production.
  framesExcludedByAppFilter: number
  // Total trailing "transition bleed" frames dropped at app-switch boundaries.
  trailingFramesDropped: number
}

interface ChunkContext {
  eventOffset: Offset
  windowId: string
  closedBy: EventWindow['closedBy']
  startTimestamp: number
  endTimestamp: number
  frames: ActivityFrame[]
  interactions: InteractionContext[]
  context: ActivityContext
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function uniqueSortedOffsets(offsets: Offset[]): Offset[] {
  return [...new Set(offsets)].sort((a, b) => a - b)
}

function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort()
}

export class ActivityProducer {
  private readonly frameStream: DurableStream<Frame>
  private readonly eventStream: DurableStream<EventWindow>
  private readonly activityStream: DurableStream<Activity>
  private config: ActivityProducerConfig

  private frameSubscription: StreamSubscription | null = null
  private eventSubscription: StreamSubscription | null = null
  private frameBuffer: StreamRecord<Frame>[] = []
  private latestFrameTimestamp: number = Number.NEGATIVE_INFINITY
  private processingChain: Promise<void> = Promise.resolve()
  private started = false
  private processingError: Error | null = null
  private lastAckedFrameOffset: Offset | null = null
  private lastKnownContext: ActivityContext | null = null
  private pendingActivity: Activity | null = null
  private deferredEventAckOffset: Offset | null = null
  private readonly stats: ActivityProducerStats = {
    emittedActivities: 0,
    droppedNoFrameWindows: 0,
    droppedAllFramesFilteredWindows: 0,
    droppedUnknownContextWindows: 0,
    framesExcludedByAppFilter: 0,
    trailingFramesDropped: 0,
  }

  constructor(params: {
    frameStream: DurableStream<Frame>
    eventStream: DurableStream<EventWindow>
    activityStream: DurableStream<Activity>
    config?: Partial<ActivityProducerConfig>
  }) {
    this.frameStream = params.frameStream
    this.eventStream = params.eventStream
    this.activityStream = params.activityStream
    this.config = {
      ...createDefaultActivityProducerConfig(),
      ...(params.config ?? {}),
    }

    this.validateConfig(this.config)
  }

  updateActivityWindowConfig(input: {
    minActivityDurationMs: number
    maxActivityDurationMs: number
    frameBufferRetentionMs?: number
  }): void {
    const nextConfig: ActivityProducerConfig = {
      ...this.config,
      minActivityDurationMs: input.minActivityDurationMs,
      maxActivityDurationMs: input.maxActivityDurationMs,
      frameBufferRetentionMs:
        input.frameBufferRetentionMs ?? Math.max(input.maxActivityDurationMs * 2, 1),
    }
    this.validateConfig(nextConfig)
    this.config = nextConfig
    this.trimFrameBufferByAge()
  }

  async start(): Promise<void> {
    if (this.started) return
    if (this.processingError) {
      throw this.processingError
    }
    this.started = true

    const frameStartOffset = await this.resolveReplayStartOffset(
      this.frameStream,
      this.config.frameConsumerId,
    )
    const eventStartOffset = await this.resolveReplayStartOffset(
      this.eventStream,
      this.config.eventConsumerId,
    )

    this.frameSubscription = this.frameStream.subscribe({
      startAt: { type: 'offset', offset: frameStartOffset },
      onRecord: (record) => this.onFrameRecord(record),
    })

    this.eventSubscription = this.eventStream.subscribe({
      startAt: { type: 'offset', offset: eventStartOffset },
      onRecord: (record) => this.enqueueEventRecord(record),
    })
  }

  async flush(): Promise<void> {
    if (!this.started) return
    this.processingChain = this.processingChain.then(async () => {
      await this.finalizePendingActivity('flush')
      await this.flushDeferredEventAck()
    })
    await this.processingChain
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false

    this.frameSubscription?.unsubscribe()
    this.frameSubscription = null

    this.eventSubscription?.unsubscribe()
    this.eventSubscription = null

    try {
      await this.processingChain
    } catch {
      // Error already captured and logged via fail-fast handler.
    }

    if (!this.processingError) {
      await this.finalizePendingActivity('flush')
      await this.flushDeferredEventAck()
    }
  }

  getStats(): ActivityProducerStats {
    return { ...this.stats }
  }

  private onFrameRecord(record: StreamRecord<Frame>): void {
    this.frameBuffer.push(record)
    this.latestFrameTimestamp = Math.max(this.latestFrameTimestamp, record.payload.timestamp)
    this.trimFrameBufferByAge()
  }

  private enqueueEventRecord(record: StreamRecord<EventWindow>): void {
    if (this.processingError) {
      return
    }

    this.processingChain = this.processingChain.then(() => this.processEventRecord(record))
    this.processingChain.catch((err: unknown) => {
      if (this.processingError) return
      const asError = err instanceof Error ? err : new Error(String(err))
      this.processingError = asError
      this.started = false
      this.eventSubscription?.unsubscribe()
      this.eventSubscription = null
      log.error('[ActivityProducer] Fatal processing error. Producer halted:', asError)
    })
  }

  private async processEventRecord(record: StreamRecord<EventWindow>): Promise<void> {
    const window = record.payload
    await this.waitForFramesToSettle(window.endTimestamp)

    const windowContext = this.deriveWindowContext(window.events)
    if (windowContext === null) {
      this.stats.droppedUnknownContextWindows++
      log.info(
        `[ActivityProducer] Dropping window ${window.id} at offset ${record.offset}: unknown app context`,
      )
      await this.markRecordProcessed(record.offset)
      await this.advanceFrameAck(window.endTimestamp)
      return
    }

    const { frames: candidateFrames, excludedByAppFilter } = this.getFramesInRange(
      window.startTimestamp,
      window.endTimestamp,
      windowContext,
    )
    this.stats.framesExcludedByAppFilter += excludedByAppFilter
    if (candidateFrames.length === 0) {
      // Distinguish "no frames captured in this window" from "frames were
      // captured but all belonged to a different app" — the latter is the leak
      // signature and worth tracking separately for diagnosis.
      if (excludedByAppFilter > 0) {
        this.stats.droppedAllFramesFilteredWindows++
      } else {
        this.stats.droppedNoFrameWindows++
      }
      log.info(
        `[ActivityProducer] Dropping window ${window.id} at offset ${record.offset}: ` +
          `${excludedByAppFilter > 0 ? `all ${excludedByAppFilter} frame(s) app-filtered out` : 'no frames'} ` +
          `in ${window.startTimestamp}-${window.endTimestamp}`,
      )
      // A frameless window can neither seed nor extend an activity, but if its
      // context is incompatible with the in-progress pendingActivity it still
      // marks a real boundary. Finalize the pending activity here so it isn't
      // stranded waiting for a frame-backed successor that may never arrive
      // (e.g. the last app of a session, before capture stops). A compatible
      // frameless window is left alone so the same activity keeps accruing.
      if (
        this.pendingActivity !== null &&
        !this.canMergeContexts(this.pendingActivity.context, windowContext)
      ) {
        await this.finalizePendingActivity('context_change', { droppedToApp: windowContext })
        await this.flushDeferredEventAck()
      }
      await this.markRecordProcessed(record.offset)
      await this.advanceFrameAck(window.endTimestamp)
      return
    }

    const chunks = this.buildWindowChunks({
      eventWindowRecord: record,
      frames: candidateFrames,
      context: windowContext,
    })

    for (const chunk of chunks) {
      await this.integrateChunk(chunk)
    }

    if (window.closedBy === 'flush') {
      await this.finalizePendingActivity('flush')
      await this.flushDeferredEventAck()
    }

    await this.markRecordProcessed(record.offset)
    await this.advanceFrameAck(window.endTimestamp)
  }

  private buildWindowChunks(params: {
    eventWindowRecord: StreamRecord<EventWindow>
    frames: StreamRecord<Frame>[]
    context: ActivityContext
  }): ChunkContext[] {
    const { eventWindowRecord, frames, context } = params
    const window = eventWindowRecord.payload
    const maxDuration = this.config.maxActivityDurationMs

    const chunks: ChunkContext[] = []
    let chunkStart = window.startTimestamp

    while (chunkStart <= window.endTimestamp) {
      const chunkEnd = Math.min(window.endTimestamp, chunkStart + maxDuration - 1)
      const frameSlice = frames.filter(
        (f) => f.payload.timestamp >= chunkStart && f.payload.timestamp <= chunkEnd,
      )
      if (frameSlice.length > 0) {
        const interactionSlice = window.events.filter(
          (event) => event.timestamp >= chunkStart && event.timestamp <= chunkEnd,
        )
        chunks.push({
          eventOffset: eventWindowRecord.offset,
          windowId: window.id,
          closedBy: window.closedBy,
          startTimestamp: chunkStart,
          endTimestamp: chunkEnd,
          frames: frameSlice.map((frameRecord) => ({
            offset: frameRecord.offset,
            frame: frameRecord.payload,
          })),
          interactions: interactionSlice,
          context,
        })
      }
      chunkStart = chunkEnd + 1
    }

    return chunks
  }

  private async integrateChunk(chunk: ChunkContext): Promise<void> {
    if (this.pendingActivity === null) {
      this.pendingActivity = this.createPendingActivity(chunk)
      return
    }

    const combinedDuration = chunk.endTimestamp - this.pendingActivity.startTimestamp
    const compatible =
      this.canMergeContexts(this.pendingActivity.context, chunk.context) &&
      combinedDuration <= this.config.maxActivityDurationMs

    if (!compatible) {
      await this.finalizePendingActivity(
        combinedDuration > this.config.maxActivityDurationMs ? 'max_duration' : 'context_change',
        { droppedToApp: chunk.context },
      )
      await this.flushDeferredEventAck()
      this.pendingActivity = this.createPendingActivity(chunk)
      return
    }

    this.mergeChunkIntoPending(chunk)
  }

  private createPendingActivity(chunk: ChunkContext): Activity {
    const activityKey = `${chunk.windowId}:${chunk.eventOffset}:${chunk.startTimestamp}:${chunk.endTimestamp}`
    return {
      id: uuidv5(activityKey, ACTIVITY_ID_NAMESPACE),
      startTimestamp: chunk.startTimestamp,
      endTimestamp: chunk.endTimestamp,
      context: { ...chunk.context },
      interactions: [...chunk.interactions],
      frames: [...chunk.frames],
      provenance: {
        eventWindowOffsets: [chunk.eventOffset],
        frameOffsets: chunk.frames.map((f) => f.offset),
        sourceWindowIds: [chunk.windowId],
        sourceClosedBy: [chunk.closedBy],
      },
    }
  }

  private mergeChunkIntoPending(chunk: ChunkContext): void {
    if (this.pendingActivity === null) return

    this.pendingActivity.endTimestamp = Math.max(
      this.pendingActivity.endTimestamp,
      chunk.endTimestamp,
    )
    this.pendingActivity.interactions.push(...chunk.interactions)

    const existingFrameOffsets = new Set(this.pendingActivity.frames.map((frame) => frame.offset))
    for (const frame of chunk.frames) {
      if (existingFrameOffsets.has(frame.offset)) continue
      existingFrameOffsets.add(frame.offset)
      this.pendingActivity.frames.push(frame)
    }
    this.pendingActivity.frames.sort((a, b) => a.frame.timestamp - b.frame.timestamp)

    this.pendingActivity.provenance.eventWindowOffsets = uniqueSortedOffsets([
      ...this.pendingActivity.provenance.eventWindowOffsets,
      chunk.eventOffset,
    ])
    this.pendingActivity.provenance.frameOffsets = uniqueSortedOffsets([
      ...this.pendingActivity.provenance.frameOffsets,
      ...chunk.frames.map((f) => f.offset),
    ])
    this.pendingActivity.provenance.sourceWindowIds = uniqueSortedStrings([
      ...this.pendingActivity.provenance.sourceWindowIds,
      chunk.windowId,
    ])
    this.pendingActivity.provenance.sourceClosedBy = [
      ...this.pendingActivity.provenance.sourceClosedBy,
      chunk.closedBy,
    ]
  }

  private async finalizePendingActivity(
    reason: 'context_change' | 'max_duration' | 'flush',
    options?: { droppedToApp?: ActivityContext },
  ): Promise<void> {
    if (this.pendingActivity === null) return

    this.maybeDropTrailingBoundaryFrame(this.pendingActivity, options?.droppedToApp)

    const durationMs = this.pendingActivity.endTimestamp - this.pendingActivity.startTimestamp
    const eventOffsetsToAck = [...this.pendingActivity.provenance.eventWindowOffsets]
    const activityToEmit = this.pendingActivity
    this.pendingActivity = null

    if (durationMs < this.config.minActivityDurationMs) {
      log.info(
        `[ActivityProducer] Dropping short activity ${activityToEmit.id} (${durationMs}ms < ${this.config.minActivityDurationMs}ms, reason: ${reason})`,
      )
      this.deferAckOffsets(eventOffsetsToAck)
      return
    }

    await this.activityStream.append(activityToEmit)
    this.stats.emittedActivities++
    this.deferAckOffsets(eventOffsetsToAck)
  }

  private deferAckOffsets(offsets: Offset[]): void {
    if (offsets.length === 0) return
    const maxOffset = Math.max(...offsets)
    this.deferredEventAckOffset =
      this.deferredEventAckOffset === null
        ? maxOffset
        : Math.max(this.deferredEventAckOffset, maxOffset)
  }

  private async markRecordProcessed(offset: Offset): Promise<void> {
    if (this.pendingActivity === null) {
      const target =
        this.deferredEventAckOffset === null
          ? offset
          : Math.max(this.deferredEventAckOffset, offset)
      await this.ackAndTrimEventStream(target)
      this.deferredEventAckOffset = null
      return
    }

    this.deferredEventAckOffset =
      this.deferredEventAckOffset === null ? offset : Math.max(this.deferredEventAckOffset, offset)
  }

  private async flushDeferredEventAck(): Promise<void> {
    if (this.pendingActivity !== null) return
    if (this.deferredEventAckOffset === null) return

    await this.ackAndTrimEventStream(this.deferredEventAckOffset)
    this.deferredEventAckOffset = null
  }

  private async ackAndTrimEventStream(offset: Offset): Promise<void> {
    await this.eventStream.ack(this.config.eventConsumerId, offset)
    await this.eventStream.trimBefore(offset + 1)
  }

  private canMergeContexts(left: ActivityContext, right: ActivityContext): boolean {
    if (
      left.displayId !== undefined &&
      right.displayId !== undefined &&
      left.displayId !== right.displayId
    ) {
      return false
    }

    if (!this.appsEqual(left, right)) return false

    const browser = isBrowserApp({
      processName: left.appName,
      bundleId: left.bundleId,
    })
    if (!browser) return true
    if (!left.tld || !right.tld) return false
    return left.tld === right.tld
  }

  /** App-identity equality: bundleId-preferred, appName fallback. */
  private appsEqual(left: ActivityContext, right: ActivityContext): boolean {
    return left.bundleId && right.bundleId
      ? left.bundleId === right.bundleId
      : left.appName === right.appName
  }

  /**
   * Drop the activity's last frame when it's finalized because a *different* app
   * took over. In the sub-second skew between screen compositing and the
   * frontmost-app signal, that trailing frame tends to already show the next app
   * (a one-frame "transition bleed"). Only drops on a real app change, and never
   * empties an activity (keeps at least one frame).
   */
  private maybeDropTrailingBoundaryFrame(activity: Activity, successor?: ActivityContext): void {
    if (!this.config.dropAppSwitchTrailingFrame) return
    if (successor === undefined) return
    if (this.appsEqual(activity.context, successor)) return
    if (activity.frames.length <= 1) return

    // Frames are kept sorted ascending by timestamp, so the latest is the bleed.
    const dropped = activity.frames.pop()
    if (dropped === undefined) return
    this.stats.trailingFramesDropped++
    activity.provenance.frameOffsets = activity.provenance.frameOffsets.filter(
      (offset) => offset !== dropped.offset,
    )
    log.info(
      `[ActivityProducer] Dropped trailing boundary frame ${dropped.frame.filepath} from ` +
        `${activity.context.appName} activity (switch to ${successor.appName})`,
    )
  }

  /**
   * Whether a candidate frame belongs to a window's derived app context.
   *
   * The frame carries the frontmost app observed by the native daemon at the
   * grab instant — an observation independent of the app-watcher's (lagging)
   * event timeline. Comparing it against the window context catches frames that
   * fall in a window's time range but were actually captured under a different
   * app (the "leak" around an app switch).
   *
   * Only app identity is compared, mirroring the app half of canMergeContexts
   * (bundleId-preferred, appName fallback). We deliberately do NOT compare
   * tld/url (frames carry none; browser tld boundaries are enforced by window
   * splitting) nor displayId (the frame's displayId is the capture target,
   * which can differ from the focused-window display on multi-display setups).
   *
   * Frames with no app stamp are always kept (backward compatible: pre-fix
   * frames, platforms that don't stamp yet, and frames the daemon couldn't
   * resolve). The filter can also be disabled wholesale via config.
   */
  private frameAppMatchesContext(frame: Frame, context: ActivityContext): boolean {
    if (!this.config.enableFrameAppFilter) return true
    if (frame.appName === undefined && frame.bundleId === undefined) return true

    return frame.bundleId && context.bundleId
      ? frame.bundleId === context.bundleId
      : frame.appName === context.appName
  }

  private deriveWindowContext(events: InteractionContext[]): ActivityContext | null {
    const recentEvents = [...events].reverse()
    const activeWindowEvent = recentEvents.find((event) => event.activeWindow)
    const latestDisplayId = recentEvents.find((event) => event.displayId !== undefined)?.displayId
    const latestWindowTitle = recentEvents.find((event) => event.windowTitle)?.windowTitle

    if (activeWindowEvent?.activeWindow) {
      const context: ActivityContext = {
        appName: activeWindowEvent.activeWindow.processName,
        bundleId: activeWindowEvent.activeWindow.bundleId,
        windowTitle: activeWindowEvent.activeWindow.title ?? latestWindowTitle,
        url: activeWindowEvent.activeWindow.url,
        tld: extractTld(activeWindowEvent.activeWindow.url) ?? undefined,
        displayId: latestDisplayId ?? undefined,
      }
      this.lastKnownContext = context
      return context
    }

    if (this.lastKnownContext === null) {
      return {
        appName: 'Unknown',
        displayId: latestDisplayId ?? undefined,
        windowTitle: latestWindowTitle,
      }
    }

    return {
      ...this.lastKnownContext,
      displayId: latestDisplayId ?? this.lastKnownContext.displayId,
      windowTitle: latestWindowTitle ?? this.lastKnownContext.windowTitle,
    }
  }

  private getFramesInRange(
    startTimestamp: number,
    endTimestamp: number,
    context: ActivityContext,
  ): { frames: StreamRecord<Frame>[]; excludedByAppFilter: number } {
    const inTimeRange = this.frameBuffer.filter(
      (record) =>
        record.payload.timestamp >= startTimestamp && record.payload.timestamp <= endTimestamp,
    )
    const frames = inTimeRange.filter((record) =>
      this.frameAppMatchesContext(record.payload, context),
    )
    return { frames, excludedByAppFilter: inTimeRange.length - frames.length }
  }

  private async waitForFramesToSettle(windowEndTimestamp: number): Promise<void> {
    const targetTimestamp = windowEndTimestamp + this.config.frameJoinGraceMs
    const deadline = Date.now() + this.config.maxFrameWaitMs

    while (Date.now() < deadline) {
      if (this.latestFrameTimestamp >= targetTimestamp) return
      await sleep(20)
    }
  }

  private trimFrameBufferByAge(): void {
    if (!Number.isFinite(this.latestFrameTimestamp)) return
    const minTimestamp = this.latestFrameTimestamp - this.config.frameBufferRetentionMs
    this.frameBuffer = this.frameBuffer.filter(
      (record) =>
        record.payload.timestamp >= minTimestamp &&
        (this.lastAckedFrameOffset === null || record.offset > this.lastAckedFrameOffset),
    )
  }

  private async advanceFrameAck(windowEndTimestamp: number): Promise<void> {
    let ackTarget: Offset | null = null
    for (const frame of this.frameBuffer) {
      if (frame.payload.timestamp <= windowEndTimestamp) {
        ackTarget = frame.offset
      }
    }

    if (ackTarget === null) return
    if (this.lastAckedFrameOffset !== null && ackTarget <= this.lastAckedFrameOffset) return

    await this.frameStream.ack(this.config.frameConsumerId, ackTarget)
    await this.frameStream.trimBefore(ackTarget + 1)
    this.lastAckedFrameOffset = ackTarget
    this.frameBuffer = this.frameBuffer.filter((record) => record.offset > ackTarget)
  }

  private async resolveReplayStartOffset<T>(
    stream: DurableStream<T>,
    consumerId: string,
  ): Promise<Offset> {
    const [lowest, ack] = await Promise.all([
      stream.getLowestAvailableOffset(),
      stream.getAck(consumerId),
    ])
    if (ack === null) return lowest
    return Math.max(lowest, ack + 1)
  }

  private validateConfig(config: ActivityProducerConfig): void {
    if (config.maxActivityDurationMs <= 0) {
      throw new Error('maxActivityDurationMs must be > 0')
    }
    if (config.minActivityDurationMs < 0) {
      throw new Error('minActivityDurationMs must be >= 0')
    }
    if (config.frameBufferRetentionMs <= 0) {
      throw new Error('frameBufferRetentionMs must be > 0')
    }
  }
}
