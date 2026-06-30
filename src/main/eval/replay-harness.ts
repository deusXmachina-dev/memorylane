import * as fs from 'fs'
import * as path from 'path'
import { InMemoryStream } from '../streams/in-memory-stream'
import { ActivityProducer, type ActivityProducerStats } from '@main/activity/activity-producer'
import { ActivityExtractor } from '@main/activity/activity-extractor'
import type {
  Activity,
  ActivityProducerConfig,
  DroppedActivityInfo,
} from '@main/activity/activity-types'
import type {
  ActivitySink,
  ActivityTransformer,
  ExtractedActivity,
} from '@main/activity/activity-extraction-types'
import type {
  ActivityEmbeddingService,
  ActivityOcrService,
} from '@main/activity/activity-transformer-types'
import type { Frame } from '../recorder/screen-capturer'
import type { EventWindow } from '../../shared/types'
import type { SemanticRunDiagnostics } from '../semantic/types'
import type { DumpedFrame, ReplayActivity } from './types'
import { readJsonl } from './jsonl'

/**
 * Replays a captured fixture (frames + event windows) through the *real*
 * ActivityProducer and ActivityExtractor/transformer/LLM, with zero changes to
 * production timing code.
 *
 * Determinism: all frames are appended before any event window, and the producer
 * runs with `frameBufferRetentionMs = MAX_SAFE_INTEGER` (nothing trimmed) and
 * `maxFrameWaitMs = 0` (the only wall-clock dependency, `waitForFramesToSettle`,
 * returns immediately even for a final window that closed after the last frame).
 * Everything upstream of the LLM is therefore reproducible; the LLM call is the
 * intended variable.
 */

/** In-memory sink: keeps every persisted activity instead of writing to a DB. */
export class CollectingActivitySink implements ActivitySink {
  readonly collected: Array<{ activity: Activity; extracted: ExtractedActivity }> = []

  async persist(input: { activity: Activity; extracted: ExtractedActivity }): Promise<void> {
    this.collected.push(input)
  }
}

/** Constant-vector embedder; skips the MiniLM load when embeddings don't matter. */
export class StubEmbeddingService implements ActivityEmbeddingService {
  async embed(): Promise<number[]> {
    const vector = new Array(384).fill(0)
    vector[0] = 1
    return vector
  }
}

/**
 * No-op OCR. Eval summaries are produced from video/snapshots, not OCR text, so
 * OCR never changes the summary being scored — it only feeds the judge's
 * (opt-in) ground-truth channel. Stubbing it skips the per-activity Vision call.
 */
export class StubOcrService implements ActivityOcrService {
  async extractText(): Promise<string> {
    return ''
  }
}

/**
 * No-LLM transformer: fills app/title/tld/times straight from the producer's
 * `activity.context` and leaves the summary blank. Lets us scaffold a golden.md
 * from the real segmentation boundaries with no credentials, model call, OCR, or
 * video stitch — the user then writes each summary by hand.
 */
export class ScaffoldTransformer implements ActivityTransformer {
  async transform(activity: Activity): Promise<ExtractedActivity> {
    return {
      activityId: activity.id,
      startTimestamp: activity.startTimestamp,
      endTimestamp: activity.endTimestamp,
      appName: activity.context.appName,
      windowTitle: activity.context.windowTitle ?? '',
      tld: activity.context.tld,
      summary: '',
      summaryModel: '',
      ocrText: '',
      vector: [],
    }
  }
}

interface DumpedEventWindow extends EventWindow {
  dumpedAt?: number
  lagMs?: number
}

export interface ReplayFixtureParams {
  fixtureDir: string
  transformer: ActivityTransformer
  /** Producer overrides (e.g. min/max duration). Determinism keys are forced. */
  producerConfig?: Partial<ActivityProducerConfig>
  /**
   * Read the summarizer's diagnostics for the just-transformed activity. Safe
   * because the extractor runs single-concurrency, so this fires right after the
   * transform that set it and before the next one dispatches.
   */
  getLastDiagnostics?: () => SemanticRunDiagnostics | null
}

export interface ReplayFixtureOutput {
  activities: ReplayActivity[]
  /** Windows/activities the producer dropped (never emitted). Carry no summary. */
  droppedActivities: ReplayActivity[]
  producerStats: ActivityProducerStats
  /** Min frame timestamp = the session.mp4 clock's zero. Anchor golden offsets here. */
  sessionStartMs: number
}

export async function replayFixture(params: ReplayFixtureParams): Promise<ReplayFixtureOutput> {
  const { fixtureDir, transformer, getLastDiagnostics } = params

  const framesPath = path.join(fixtureDir, 'frames.jsonl')
  const windowsPath = path.join(fixtureDir, 'event-windows.jsonl')
  if (!fs.existsSync(framesPath)) throw new Error(`Fixture is missing frames.jsonl: ${framesPath}`)
  if (!fs.existsSync(windowsPath)) {
    throw new Error(`Fixture is missing event-windows.jsonl: ${windowsPath}`)
  }

  const frames: Frame[] = readJsonl<DumpedFrame>(framesPath)
    .map((f) => ({
      filepath: path.isAbsolute(f.filepath) ? f.filepath : path.resolve(fixtureDir, f.filepath),
      timestamp: f.timestamp,
      width: f.width,
      height: f.height,
      displayId: f.displayId,
      sequenceNumber: f.sequenceNumber,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)

  const windows: EventWindow[] = readJsonl<DumpedEventWindow>(windowsPath)
    .map((w) => ({
      id: w.id,
      startTimestamp: w.startTimestamp,
      endTimestamp: w.endTimestamp,
      events: w.events,
      closedBy: w.closedBy,
    }))
    .sort((a, b) => a.startTimestamp - b.startTimestamp || a.endTimestamp - b.endTimestamp)

  const frameStream = new InMemoryStream<Frame>()
  const eventStream = new InMemoryStream<EventWindow>()
  const activityStream = new InMemoryStream<Activity>()

  // Collect everything the producer drops so the golden transcript can show it.
  const droppedInfos: DroppedActivityInfo[] = []

  // Determinism keys win over caller overrides so settle/trim never wall-clock wait.
  const config: Partial<ActivityProducerConfig> = {
    ...params.producerConfig,
    frameBufferRetentionMs:
      params.producerConfig?.frameBufferRetentionMs ?? Number.MAX_SAFE_INTEGER,
    maxFrameWaitMs: params.producerConfig?.maxFrameWaitMs ?? 0,
    onActivityDropped: (info) => droppedInfos.push(info),
  }

  const producer = new ActivityProducer({ frameStream, eventStream, activityStream, config })
  const sink = new CollectingActivitySink()
  const extractor = new ActivityExtractor({
    activityStream,
    transformer,
    sink,
    config: { maxConcurrent: 1, maxRetries: 0 },
  })

  const diagnosticsById = new Map<string, SemanticRunDiagnostics | null>()
  if (getLastDiagnostics) {
    extractor.addPersistedListener(({ activity }) => {
      diagnosticsById.set(activity.id, getLastDiagnostics())
    })
  }

  await producer.start()
  await extractor.start()

  for (const frame of frames) {
    await frameStream.append(frame)
  }
  for (const window of windows) {
    await eventStream.append(window)
  }

  await producer.stop()
  await extractor.stop()

  const activities: ReplayActivity[] = sink.collected.map(({ activity, extracted }) => {
    const diagnostics = diagnosticsById.get(activity.id) ?? null
    return {
      activityId: activity.id,
      startTimestamp: activity.startTimestamp,
      endTimestamp: activity.endTimestamp,
      durationMs: activity.endTimestamp - activity.startTimestamp,
      appName: extracted.appName,
      windowTitle: extracted.windowTitle,
      tld: extracted.tld,
      interactionCount: activity.interactions.length,
      summary: extracted.summary,
      summaryModel: extracted.summaryModel,
      ocrText: extracted.ocrText,
      frameRefs: activity.frames.map((f) => f.frame.filepath),
      selectedSnapshotPaths: diagnostics?.selectedSnapshotPaths ?? [],
      diagnostics,
    }
  })

  const droppedActivities: ReplayActivity[] = droppedInfos.map((info, i) => ({
    activityId: `dropped-${i}`,
    startTimestamp: info.startTimestamp,
    endTimestamp: info.endTimestamp,
    durationMs: info.endTimestamp - info.startTimestamp,
    appName: info.appName ?? 'Unknown',
    windowTitle: info.windowTitle ?? '',
    tld: info.tld,
    interactionCount: 0,
    summary: '',
    summaryModel: '',
    ocrText: '',
    frameRefs: [],
    selectedSnapshotPaths: [],
    diagnostics: null,
    dropped: { reason: info.reason, detail: info.detail },
  }))

  // frames are sorted ascending above, so frames[0] is the session.mp4 clock zero.
  const sessionStartMs = frames.length ? frames[0].timestamp : (windows[0]?.startTimestamp ?? 0)

  return { activities, droppedActivities, producerStats: producer.getStats(), sessionStartMs }
}
