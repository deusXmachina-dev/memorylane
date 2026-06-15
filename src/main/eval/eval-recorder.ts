/**
 * In-app eval recorder. Lets a non-technical operator record a real session from
 * the normal app and turn it into a committed replay fixture — no `DEBUG_PIPELINE`
 * env var, no CLI, no restart.
 *
 * It reuses the exact debug-pipeline machinery the CLI fixtures already trust:
 *   - the `FrameDebugDumper` / `EventWindowDebugDumper` tap the producer's input
 *     streams to a per-session staging dir, and
 *   - the harness's runtime `setRetainScreenshots(true)` holds the frame PNGs on
 *     disk for the duration so the cleanup sweep can't delete them mid-session.
 *
 * On stop it drains capture (so the final activity is summarized + persisted),
 * runs `promoteCapture()` over the staging dir, then releases retention and
 * sweeps to reclaim the screenshots dir. Inert until `start()` is called.
 */

import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'
import type { StorageService } from '../storage'
import type { StreamSubscription } from '../streams/stream'
import type { PipelineHarness } from '../pipeline-harness'
import type { RuntimeCaptureController } from '../capture-controller'
import { FrameDebugDumper } from '../frame-debug-dump'
import { EventWindowDebugDumper } from '../event-window-debug-dump'
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
  private readonly storage: StorageService
  private readonly fixturesRoot: string

  private activeName: string | null = null
  private startedAt: number | null = null
  private stagingDir: string | null = null
  private frameSub: StreamSubscription | null = null
  private eventSub: StreamSubscription | null = null
  private startedCapture = false

  constructor(deps: {
    harness: PipelineHarness
    capture: RuntimeCaptureController
    storage: StorageService
    fixturesRoot: string
  }) {
    this.harness = deps.harness
    this.capture = deps.capture
    this.storage = deps.storage
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
    this.frameSub = this.harness.frameStream.subscribe({
      startAt: { type: 'now' },
      onRecord: (record) => frameDumper.dump(record.payload),
    })
    this.eventSub = this.harness.eventStream.subscribe({
      startAt: { type: 'now' },
      onRecord: (record) => eventDumper.dump(record.payload),
    })

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

    // Flush + drain so the session's final activity closes, gets summarized, and
    // is persisted before we promote — otherwise its golden summary seeds blank.
    // The dumpers stay subscribed through this so any final window/frame is dumped.
    try {
      this.harness.eventCapturer.flush()
    } catch (error) {
      log.warn('[EvalRecorder] eventCapturer.flush failed:', error)
    }
    await this.capture.waitForIdle()
    if (this.startedCapture) {
      // We turned capture on for this recording; turning it off fully drains the
      // producer/extractor (final activity summarized + persisted) and restores
      // the operator's prior "capture off" state.
      this.capture.stopCapture()
      await this.capture.waitForIdle()
    }

    this.frameSub?.unsubscribe()
    this.eventSub?.unsubscribe()
    this.frameSub = null
    this.eventSub = null

    try {
      const result = await promoteCapture({
        sourceDir: stagingDir,
        fixturesRoot: this.fixturesRoot,
        name,
        storage: this.storage,
        video: true,
        seed: true,
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
