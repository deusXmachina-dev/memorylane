import { isBrowserApp } from '../../shared/app-utils'
import { extractTld } from '../recorder/tld-utils'
import log from '../logger'
import type { EventWindow, InteractionContext } from '../../shared/types'
import type { Frame } from './recorder/screen-capturer'
import type { DurableStream, Offset, StreamRecord, StreamSubscription } from './streams/stream'
import { v5 as uuidv5 } from 'uuid'
import {
  DEFAULT_V2_ACTIVITY_PRODUCER_CONFIG,
  type V2Activity,
  type V2ActivityContext,
  type V2ActivityFrame,
  type V2ActivityProducerConfig,
} from './activity-types'

const ACTIVITY_ID_NAMESPACE = uuidv5('memorylane:v2-activity', uuidv5.DNS)

export interface ActivityProducerStats {
  emittedActivities: number
  droppedNoFrameWindows: number
  droppedUnknownContextWindows: number
}

interface ChunkContext {
  eventOffset: Offset
  windowId: string
  closedBy: EventWindow['closedBy']
  startTimestamp: number
  endTimestamp: number
  frames: V2ActivityFrame[]
  interactions: InteractionContext[]
  context: V2ActivityContext
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
  private readonly activityStream: DurableStream<V2Activity>
  private readonly config: V2ActivityProducerConfig

  private frameSubscription: StreamSubscription | null = null
  private eventSubscription: StreamSubscription | null = null
  private frameBuffer: StreamRecord<Frame>[] = []
  private latestFrameTimestamp: number = Number.NEGATIVE_INFINITY
  private processingChain: Promise<void> = Promise.resolve()
  private started = false
  private processingError: Error | null = null
  private lastAckedFrameOffset: Offset | null = null
  private lastKnownContext: V2ActivityContext | null = null
  private pendingActivity: V2Activity | null = null
  private deferredEventAckOffset: Offset | null = null
  private readonly stats: ActivityProducerStats = {
    emittedActivities: 0,
    droppedNoFrameWindows: 0,
    droppedUnknownContextWindows: 0,
  }

  constructor(params: {
    frameStream: DurableStream<Frame>
    eventStream: DurableStream<EventWindow>
    activityStream: DurableStream<V2Activity>
    config?: Partial<V2ActivityProducerConfig>
  }) {
    this.frameStream = params.frameStream
    this.eventStream = params.eventStream
    this.activityStream = params.activityStream
    this.config = {
      ...DEFAULT_V2_ACTIVITY_PRODUCER_CONFIG,
      ...(params.config ?? {}),
    }

    if (this.config.maxActivityDurationMs <= 0) {
      throw new Error('maxActivityDurationMs must be > 0')
    }
    if (this.config.minActivityDurationMs < 0) {
      throw new Error('minActivityDurationMs must be >= 0')
    }
    if (this.config.frameBufferRetentionMs <= 0) {
      throw new Error('frameBufferRetentionMs must be > 0')
    }
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

    const candidateFrames = this.getFramesInRange(window.startTimestamp, window.endTimestamp)
    if (candidateFrames.length === 0) {
      this.stats.droppedNoFrameWindows++
      log.info(
        `[ActivityProducer] Dropping window ${window.id} at offset ${record.offset}: no frames in ${window.startTimestamp}-${window.endTimestamp}`,
      )
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
    context: V2ActivityContext
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
      )
      await this.flushDeferredEventAck()
      this.pendingActivity = this.createPendingActivity(chunk)
      return
    }

    this.mergeChunkIntoPending(chunk)
  }

  private createPendingActivity(chunk: ChunkContext): V2Activity {
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
  ): Promise<void> {
    if (this.pendingActivity === null) return

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

  private canMergeContexts(left: V2ActivityContext, right: V2ActivityContext): boolean {
    if (
      left.displayId !== undefined &&
      right.displayId !== undefined &&
      left.displayId !== right.displayId
    ) {
      return false
    }

    const sameApp =
      left.bundleId && right.bundleId
        ? left.bundleId === right.bundleId
        : left.appName === right.appName
    if (!sameApp) return false

    const browser = isBrowserApp({
      processName: left.appName,
      bundleId: left.bundleId,
    })
    if (!browser) return true
    if (!left.tld || !right.tld) return false
    return left.tld === right.tld
  }

  private deriveWindowContext(events: InteractionContext[]): V2ActivityContext | null {
    const recentEvents = [...events].reverse()
    const activeWindowEvent = recentEvents.find((event) => event.activeWindow)
    const latestDisplayId = recentEvents.find((event) => event.displayId !== undefined)?.displayId
    const latestWindowTitle = recentEvents.find((event) => event.windowTitle)?.windowTitle

    if (activeWindowEvent?.activeWindow) {
      const context: V2ActivityContext = {
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

  private getFramesInRange(startTimestamp: number, endTimestamp: number): StreamRecord<Frame>[] {
    return this.frameBuffer.filter(
      (record) =>
        record.payload.timestamp >= startTimestamp && record.payload.timestamp <= endTimestamp,
    )
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
}
