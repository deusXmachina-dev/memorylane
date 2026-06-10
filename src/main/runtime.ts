import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from './logger'
import { VendorCredentialsManager } from './settings/vendor-credentials-manager'
import { DeviceIdentity } from './settings/device-identity'
import { createAccessProvider, type AccessProvider } from './access'
import type { AppEdition } from '../shared/edition'
import { StorageService } from './storage'
import { applyMigrations } from './storage/migrator'
import { applyPendingDatabaseImport } from './ui/database-import'
import { EmbeddingService } from './processor/embedding'
import { activityOcrService } from './processor/ocr'
import { UsageTracker } from './services/usage-tracker'
import { createPipelineHarness } from './pipeline-harness'
import { DefaultActivityTransformer } from './activity-transformer'
import { SqliteActivitySink } from './sqlite-activity-sink'
import { FfmpegVideoStitcher } from './video/video-stitcher'
import { ActivitySemanticService, SemanticFileDebugDumper } from './activity-semantic-service'
import type { SemanticPipelinePreference } from './activity-semantic-service'
import { InteractionEventDebugDumper } from './interaction-event-debug-dump'
import { InferenceProviderImpl, type InferenceProvider } from './llm'
import type { Vendor } from '../shared/types'
import { VENDOR_PRESETS, buildModelChain } from '../shared/vendor-defaults'
import { createCaptureBlacklistCoordinator } from './capture-blacklist-coordinator'
import {
  createCaptureController,
  type RuntimeCapture,
  type RuntimeCaptureController,
} from './capture-controller'

export interface MainRuntime {
  capture: RuntimeCapture
  storage: StorageService
  usageTracker: UsageTracker
  vendorCredentials: VendorCredentialsManager
  inferenceProvider: InferenceProvider
  semanticService: ActivitySemanticService
  accessProvider: AccessProvider
  updateExclusions(exclusions: {
    apps: string[]
    windowTitlePatterns: string[]
    urlPatterns: string[]
    excludePrivateBrowsing: boolean
  }): void
  purgeAll(): Promise<void>
  dispose(): Promise<void>
}

export async function createMainRuntime(params: {
  onCaptureStateChanged?: () => void
  onPrivacyBlockingChanged?: (blocked: boolean) => void
  semanticPipelinePreference?: SemanticPipelinePreference
  semanticRequestTimeoutMs?: number
  excludedApps?: string[]
  excludedWindowTitlePatterns?: string[]
  excludedUrlPatterns?: string[]
  excludePrivateBrowsing?: boolean
  deviceIdentity?: DeviceIdentity
  edition: AppEdition
  vendorCredentials: VendorCredentialsManager
  getActiveVendor: () => Vendor
  initialVideoModel?: string
  initialSnapshotModel?: string
}): Promise<MainRuntime> {
  const onCaptureStateChanged = params.onCaptureStateChanged ?? (() => undefined)

  const interactionMonitor = await import('./recorder/interaction-monitor')

  const vendorCredentials = params.vendorCredentials
  const inferenceProvider = new InferenceProviderImpl({
    credentials: vendorCredentials,
    getActiveVendor: params.getActiveVendor,
  })
  const dev = !app.isPackaged
  const userDataPath = app.getPath('userData')
  const dbFile = dev ? 'memorylane-dev.db' : 'memorylane.db'
  const dbPath = path.join(userDataPath, dbFile)
  applyPendingDatabaseImport(dbPath)
  const storage = new StorageService(dbPath)
  applyMigrations(storage.getDatabase())
  const usageTracker = new UsageTracker()

  const debugPipelineDir = path.join(app.getAppPath(), '.debug-pipeline')
  const debugDumper =
    !app.isPackaged && process.env.DEBUG_PIPELINE
      ? new SemanticFileDebugDumper({
          rootDir: debugPipelineDir,
          cleanRootDir: true,
          copyMediaAssets: true,
        })
      : undefined
  // Created after the semantic dumper so its cleanRootDir has already run.
  const interactionDumper = debugDumper
    ? new InteractionEventDebugDumper(debugPipelineDir)
    : undefined

  // Debug-only: keep screenshots (skip per-activity cleanup + the stale sweep)
  // so frames survive for inspection. On by default whenever the debug pipeline
  // is active, and independently togglable via MEMORYLANE_RETAIN_SCREENSHOTS.
  const retainScreenshots =
    dev && Boolean(process.env.DEBUG_PIPELINE || process.env.MEMORYLANE_RETAIN_SCREENSHOTS)
  if (retainScreenshots) {
    log.info(
      '[Runtime] Screenshot retention enabled — captured frames will not be cleaned up (debug only)',
    )
  }

  const presets = VENDOR_PRESETS[params.getActiveVendor()]
  const initialVideoModels = buildModelChain(params.initialVideoModel ?? '', presets.semanticVideo)
  const initialSnapshotModels = buildModelChain(
    params.initialSnapshotModel ?? '',
    presets.semanticSnapshot,
  )
  const semanticService = new ActivitySemanticService(inferenceProvider, {
    usageTracker,
    debugDumper,
    pipelinePreference: params.semanticPipelinePreference,
    requestTimeoutMs: params.semanticRequestTimeoutMs,
    videoModels: initialVideoModels,
    snapshotModels: initialSnapshotModels,
  })

  semanticService.setUserContext(() => storage.userContext.get()?.shortSummary ?? null)

  const outputDir = path.join(userDataPath, 'screenshots')
  fs.mkdirSync(outputDir, { recursive: true })
  const activityCount = storage.activities.count()

  log.info(
    `[Runtime] Persistence targets: mode=${dev ? 'dev' : 'packaged'} ` +
      `userData=${userDataPath} db=${dbPath} screenshots=${outputDir} activityCount=${activityCount}`,
  )

  const embedder = new EmbeddingService()
  try {
    await embedder.init()
  } catch (error) {
    log.error(
      '[Runtime] Failed to initialize embedding model; aborting runtime startup so activity persistence does not silently fail.',
      error,
    )
    throw error
  }

  const transformer = new DefaultActivityTransformer(
    new FfmpegVideoStitcher(),
    activityOcrService,
    semanticService,
    embedder,
    {
      outputDir,
      getPipelinePreference: () => semanticService.getPipelinePreference(),
    },
  )
  const sink = new SqliteActivitySink(storage.activities)

  const harness = createPipelineHarness({
    outputDir,
    extractorTransformer: transformer,
    extractorSink: sink,
    retainScreenshots,
  })

  const capture: RuntimeCaptureController = createCaptureController({
    harness,
    interactionMonitor,
    outputDir,
    onStateChanged: () => onCaptureStateChanged(),
  })

  const blacklistCoordinator = createCaptureBlacklistCoordinator({
    initialExcludedApps: params.excludedApps,
    initialExcludedWindowTitlePatterns: params.excludedWindowTitlePatterns,
    initialExcludedUrlPatterns: params.excludedUrlPatterns,
    initialExcludePrivateBrowsing: params.excludePrivateBrowsing,
    onPrivacyBlockingChanged: params.onPrivacyBlockingChanged,
    forwardInteraction: (event) => {
      // Dump only events that passed the blacklist — excluded window
      // titles/URLs must never reach the plaintext JSONL.
      interactionDumper?.dump(event)
      harness.handleEvent(event)
    },
    flushEvents: () => {
      harness.eventCapturer.flush()
    },
    setScreenshotsSuppressed: (suppressed) => {
      capture.setFrameCaptureSuppressed(suppressed)
    },
  })

  const interactionHandler = (event: Parameters<typeof harness.handleEvent>[0]): void => {
    blacklistCoordinator.handleInteraction(event)
  }
  interactionMonitor.onInteraction(interactionHandler)

  const deviceIdentity = params.deviceIdentity ?? new DeviceIdentity()
  const accessProvider = createAccessProvider(params.edition, deviceIdentity)

  let disposePromise: Promise<void> | null = null

  return {
    capture,
    storage,
    usageTracker,
    vendorCredentials,
    inferenceProvider,
    semanticService,
    accessProvider,
    updateExclusions(exclusions): void {
      blacklistCoordinator.updateExclusions(exclusions)
    },
    async purgeAll(): Promise<void> {
      const wasCapturing = capture.isCapturingNow()

      // Stop accepting new work synchronously, then drain in-flight work.
      // If quiescing fails the DB may still be receiving writes, so abort
      // rather than racing storage.purge() against active writers.
      capture.stopCapture()
      try {
        await capture.forceClose()
        await capture.waitForIdle()
      } catch (error) {
        log.error('[Runtime] Failed to quiesce capture; aborting purge:', error)
        if (wasCapturing) {
          try {
            capture.startCapture()
          } catch (resumeError) {
            log.warn('[Runtime] Failed to resume capture after aborted purge:', resumeError)
          }
        }
        throw new Error('Failed to stop capture before purge')
      }

      storage.purge()

      try {
        if (fs.existsSync(outputDir)) {
          for (const entry of fs.readdirSync(outputDir)) {
            fs.rmSync(path.join(outputDir, entry), { recursive: true, force: true })
          }
        }
        fs.mkdirSync(outputDir, { recursive: true })
      } catch (error) {
        log.warn('[Runtime] Failed to clear screenshots directory during purge:', error)
      }

      if (wasCapturing) {
        try {
          capture.startCapture()
        } catch (error) {
          log.warn('[Runtime] Failed to resume capture after purge:', error)
        }
      }

      log.info('[Runtime] Purge complete')
    },
    async dispose(): Promise<void> {
      if (disposePromise) return disposePromise

      disposePromise = (async () => {
        try {
          await capture.forceClose()
          capture.stopCapture()
          await capture.waitForIdle()
        } catch (error) {
          log.warn('[Runtime] Error while stopping capture during dispose:', error)
        }

        try {
          interactionMonitor.clearInteractionCallback(interactionHandler)
        } catch (error) {
          log.warn('[Runtime] Failed to clear interaction callback:', error)
        }

        try {
          semanticService.dispose()
        } catch (error) {
          log.warn('[Runtime] Failed to dispose semantic service:', error)
        }

        try {
          storage.close()
        } catch (error) {
          log.warn('[Runtime] Failed to close storage:', error)
        }
      })()

      return disposePromise
    },
  }
}
