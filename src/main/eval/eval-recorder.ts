/**
 * In-app eval recorder. Lets a non-technical operator record a real session from
 * the normal app and turn it into a committed replay fixture — no `DEBUG_PIPELINE`
 * env var, no CLI, no restart.
 *
 * It taps the producer's streams to a per-session staging dir:
 *   - `FrameDebugDumper` / `EventWindowDebugDumper` capture the producer's input,
 *   - `ActivityDebugDumper` captures each activity's live summary at the source, and
 *   - the harness's runtime `setRetainScreenshots(true)` holds the frame PNGs on
 *     disk for the duration so the cleanup sweep can't delete them mid-session.
 *
 * On stop it drains the pipeline (so the final activity is summarized + dumped),
 * runs `promoteCapture()` over the staging dir, then releases retention and
 * sweeps to reclaim the screenshots dir. Inert until `start()` is called.
 */

import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'
import type { StreamSubscription } from '../streams/stream'
import type { PipelineHarness } from '../pipeline-harness'
import type { RuntimeCaptureController } from '../capture-controller'
import { FrameDebugDumper } from '../frame-debug-dump'
import { EventWindowDebugDumper } from '../event-window-debug-dump'
import { ActivityDebugDumper } from './activity-debug-dump'
import { promoteCapture, type PromoteCaptureResult } from './promote-fixture'

export interface EvalRecordingStatus {
  recording: boolean
  name: string | null
  startedAt: number | null
}

/** Filesystem-safe fixture name (the dir under the fixtures root). */
export function sanitizeFixtureName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'recording'
}

export class EvalRecorder {
  private readonly harness: PipelineHarness
  private readonly capture: RuntimeCaptureController
  private readonly fixturesRoot: string

  private activeName: string | null = null
  private startedAt: number | null = null
  private stagingDir: string | null = null
  private frameSub: StreamSubscription | null = null
  private eventSub: StreamSubscription | null = null
  private activityUnsub: (() => void) | null = null
  private startedCapture = false

  constructor(deps: {
    harness: PipelineHarness
    capture: RuntimeCaptureController
    fixturesRoot: string
  }) {
    this.harness = deps.harness
    this.capture = deps.capture
    this.fixturesRoot = deps.fixturesRoot
  }

  isRecording(): boolean {
    return this.activeName !== null
  }

  getStatus(): EvalRecordingStatus {
    return { recording: this.isRecording(), name: this.activeName, startedAt: this.startedAt }
  }

  /** Begins capturing the producer's frame + event-window streams to a staging dir. */
  start(name: string): EvalRecordingStatus {
    if (this.isRecording()) throw new Error('A recording is already in progress')

    const safeName = sanitizeFixtureName(name)
    const stagingDir = path.join(this.fixturesRoot, '.staging', safeName)
    fs.rmSync(stagingDir, { recursive: true, force: true })
    fs.mkdirSync(stagingDir, { recursive: true })

    // Hold frame PNGs on disk for the whole recording so the cleanup sweep can't
    // delete them before we promote (the dumped frames.jsonl references them).
    this.harness.setRetainScreenshots(true)

    const frameDumper = new FrameDebugDumper(stagingDir)
    const eventDumper = new EventWindowDebugDumper(stagingDir)
    const activityDumper = new ActivityDebugDumper(stagingDir)
    this.frameSub = this.harness.frameStream.subscribe({
      startAt: { type: 'now' },
      onRecord: (record) => frameDumper.dump(record.payload),
    })
    this.eventSub = this.harness.eventStream.subscribe({
      startAt: { type: 'now' },
      onRecord: (record) => eventDumper.dump(record.payload),
    })
    // Tap the live extractor so each activity's real summary is captured at the
    // source. The golden is then seeded straight from these — no replay, no DB
    // time-overlap join. Fires after persist, so `extracted` carries the summary.
    this.activityUnsub =
      this.harness.activityExtractor?.addPersistedListener(({ activity, extracted }) => {
        activityDumper.dump({
          id: activity.id,
          startTimestamp: extracted.startTimestamp,
          endTimestamp: extracted.endTimestamp,
          appName: extracted.appName,
          windowTitle: extracted.windowTitle,
          tld: extracted.tld,
          summary: extracted.summary,
          summaryModel: extracted.summaryModel,
        })
      }) ?? null

    // Frames only flow while capture is running; start it for the operator if it
    // is off, and remember so we can restore the prior state on stop.
    this.startedCapture = !this.capture.isCapturingNow()
    if (this.startedCapture) this.capture.startCapture()

    this.activeName = safeName
    this.startedAt = Date.now()
    this.stagingDir = stagingDir
    log.info(`[EvalRecorder] Recording "${safeName}" -> ${stagingDir}`)
    return this.getStatus()
  }

  /** Stops the recording and promotes the staged capture into a fixture. */
  async stop(): Promise<PromoteCaptureResult> {
    const name = this.activeName
    const stagingDir = this.stagingDir
    if (!name || !stagingDir) throw new Error('No recording in progress')

    // Drain so the session's final activity closes, gets summarized, persisted,
    // and dumped before we promote — otherwise its golden summary seeds blank.
    // `drainActivities` waits on the extractor regardless of whether we started
    // capture, fixing the prior race where an already-running capture skipped the
    // extractor drain. The dumpers stay subscribed through this so the final
    // window/frame/activity is dumped.
    await this.capture.waitForIdle()
    try {
      await this.harness.drainActivities()
    } catch (error) {
      log.warn('[EvalRecorder] drainActivities failed:', error)
    }
    if (this.startedCapture) {
      // We turned capture on for this recording; turn it back off to restore the
      // operator's prior "capture off" state.
      this.capture.stopCapture()
      await this.capture.waitForIdle()
    }

    this.frameSub?.unsubscribe()
    this.eventSub?.unsubscribe()
    this.activityUnsub?.()
    this.frameSub = null
    this.eventSub = null
    this.activityUnsub = null

    try {
      const result = await promoteCapture({
        sourceDir: stagingDir,
        fixturesRoot: this.fixturesRoot,
        name,
        video: true,
        seed: true,
        // Always refresh the golden — re-recording the same name should reflect
        // this capture, not silently keep a stale scaffold.
        reseed: true,
      })
      log.info(`[EvalRecorder] Promoted "${name}" -> ${result.fixtureDir}`)
      return result
    } finally {
      // Release retention and reclaim the screenshots that piled up; drop staging.
      this.harness.setRetainScreenshots(false)
      this.harness.sweepNow()
      fs.rmSync(stagingDir, { recursive: true, force: true })
      this.activeName = null
      this.startedAt = null
      this.stagingDir = null
      this.startedCapture = false
    }
  }
}
