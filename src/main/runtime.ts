import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from '@main/utils/logger'
import * as interactionMonitor from '@main/recorder/interaction-monitor'
import { VendorCredentialsManager } from '@main/settings/vendor-credentials-manager'
import { DeviceIdentity } from '@main/settings/device-identity'
import { createAccessProvider, type AccessProvider } from '@main/access'
import type { AppEdition } from '@/shared/edition'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { applyPendingDatabaseImport } from '@main/ui/database-import'
import { activityOcrService } from '@main/processor/ocr'
import { UsageTracker } from '@main/services/usage-tracker'
import { SummaryModeTracker } from '@main/services/summary-mode-tracker'
import { createPipelineHarness } from '@main/activity/pipeline-harness'
import { DefaultActivityTransformer } from '@main/activity/activity-transformer'
import { SqliteActivitySink } from '@main/activity/sqlite-activity-sink'
import { FfmpegVideoStitcher } from '@main/video/video-stitcher'
import {
  ActivitySemanticService,
  SemanticFileDebugDumper,
} from '@main/semantic/activity-semantic-service'
import type { SemanticPipelinePreference } from '@main/semantic/activity-semantic-service'
import { InteractionEventDebugDumper } from '@main/debug/interaction-event-debug-dump'
import { InferenceProviderImpl, type InferenceProvider } from '@main/llm'
import type { Vendor } from '@types'
import {
  createCaptureController,
  type RuntimeCaptureController,
} from '@main/capture/capture-controller'
import { HostEnvironment } from '@main/monitoring/host-environment'
import { EvalRecorder } from '@main/eval/eval-recorder'
import { EvalFixtureStore } from '@main/eval/eval-fixture-store'
import { TaskFixtureStore } from '@main/eval/task-fixture-store'
import { MlWorkerClient } from '@main/services/ml-worker-client'

export interface MainRuntime {
  capture: RuntimeCaptureController
  host: HostEnvironment
  storage: StorageService
  mlWorker: MlWorkerClient
  usageTracker: UsageTracker
  vendorCredentials: VendorCredentialsManager
  inferenceProvider: InferenceProvider
  semanticService: ActivitySemanticService
  accessProvider: AccessProvider
  evalRecorder: EvalRecorder
  evalFixtureStore: EvalFixtureStore
  taskFixtureStore: TaskFixtureStore
  evalFixturesRoot: string
  purgeAll(): Promise<void>
  dispose(): Promise<void>
}

export async function createMainRuntime(params: {
  onCaptureStateChanged?: () => void
  onPrivacyBlockingChanged?: (blocked: boolean) => void
  semanticPipelinePreference?: SemanticPipelinePreference
  semanticRequestTimeoutMs?: number
  excludedApps?: string[]
  excludedUrlPatterns?: string[]
  excludePrivateBrowsing?: boolean
  excludeLoginScreens?: boolean
  deviceIdentity?: DeviceIdentity
  edition: AppEdition
  vendorCredentials: VendorCredentialsManager
  getActiveVendor: () => Vendor
  initialVideoModels?: string[]
  initialSnapshotModels?: string[]
}): Promise<MainRuntime> {
  const onCaptureStateChanged = params.onCaptureStateChanged ?? (() => undefined)

  const host = new HostEnvironment()
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
  const summaryModeTracker = new SummaryModeTracker()

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

  const semanticService = new ActivitySemanticService(inferenceProvider, {
    usageTracker,
    summaryModeTracker,
    debugDumper,
    pipelinePreference: params.semanticPipelinePreference,
    requestTimeoutMs: params.semanticRequestTimeoutMs,
    videoModels: params.initialVideoModels ?? [],
    snapshotModels: params.initialSnapshotModels ?? [],
    healthStatePath: path.join(userDataPath, 'llm-health.json'),
  })

  semanticService.setUserContext(() => storage.userContext.get()?.shortSummary ?? null)

  const outputDir = path.join(userDataPath, 'screenshots')
  fs.mkdirSync(outputDir, { recursive: true })
  const activityCount = storage.activities.count()

  log.info(
    `[Runtime] Persistence targets: mode=${dev ? 'dev' : 'packaged'} ` +
      `userData=${userDataPath} db=${dbPath} screenshots=${outputDir} activityCount=${activityCount}`,
  )

  // Hosts the embedding model (live activity pipeline + task-miner
  // clustering) and the linkage math in a utilityProcess, off the main
  // thread. Initialized here so a broken model cache still aborts startup.
  const mlWorker = new MlWorkerClient()
  try {
    await mlWorker.init()
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
    mlWorker,
    {
      outputDir,
      getPipelinePreference: () => semanticService.getPipelinePreference(),
      summaryModeTracker,
    },
  )
  const sink = new SqliteActivitySink(storage.activities)

  const harness = createPipelineHarness({
    outputDir,
    extractorTransformer: transformer,
    extractorSink: sink,
    retainScreenshots,
    interactions: interactionMonitor,
    idle: host,
    exclusions: {
      apps: params.excludedApps,
      urlPatterns: params.excludedUrlPatterns,
      excludePrivateBrowsing: params.excludePrivateBrowsing,
      excludeLoginScreens: params.excludeLoginScreens,
    },
    onPrivacyBlockingChanged: params.onPrivacyBlockingChanged,
    // Excluded window titles/URLs must never reach the plaintext JSONL.
    onAcceptedEvent: interactionDumper ? (event) => interactionDumper.dump(event) : undefined,
  })
  const capture: RuntimeCaptureController = createCaptureController({
    harness,
    outputDir,
    onStateChanged: () => onCaptureStateChanged(),
  })

  const deviceIdentity = params.deviceIdentity ?? new DeviceIdentity()
  const accessProvider = createAccessProvider(params.edition, deviceIdentity)

  // In-app eval recorder (Developer mode). Inert until start() is called; ships
  // in every build but does nothing unless the hidden UI invokes it.
  const evalFixturesRoot = path.join(userDataPath, 'eval-fixtures')
  const evalRecorder = new EvalRecorder({
    harness,
    capture,
    fixturesRoot: evalFixturesRoot,
  })
  const evalFixtureStore = new EvalFixtureStore(evalFixturesRoot)
  const taskFixtureStore = new TaskFixtureStore(path.join(userDataPath, 'task-fixtures'))

  let disposePromise: Promise<void> | null = null

  return {
    capture,
    host,
    storage,
    mlWorker,
    usageTracker,
    vendorCredentials,
    inferenceProvider,
    semanticService,
    accessProvider,
    evalRecorder,
    evalFixtureStore,
    taskFixtureStore,
    evalFixturesRoot,
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
          harness.dispose()
        } catch (error) {
          log.warn('[Runtime] Failed to dispose pipeline harness:', error)
        }

        try {
          semanticService.dispose()
        } catch (error) {
          log.warn('[Runtime] Failed to dispose semantic service:', error)
        }

        try {
          mlWorker.dispose()
        } catch (error) {
          log.warn('[Runtime] Failed to dispose ml-worker:', error)
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
