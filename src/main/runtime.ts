import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from '@main/utils/logger'
import * as interactionMonitor from '@main/recorder/interaction-monitor'
import type { VendorCredentialsManager } from '@main/settings/vendor-credentials-manager'
import type { AppSettingsManager } from '@main/settings/app-settings-manager'
import type { DeviceIdentity } from '@main/settings/device-identity'
import { applySettingsChange } from '@main/settings/apply-settings'
import { createAccessProvider, type AccessProvider } from '@main/access'
import { requiresActivation } from '@main/access/types'
import type { AppEdition } from '@/shared/edition'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { applyPendingDatabaseImport } from '@main/ui/database-import'
import { activityOcrService } from '@main/processor/ocr'
import { UsageTracker } from '@main/services/usage-tracker'
import { SummaryModeTracker } from '@main/services/summary-mode-tracker'
import { TaskMiner } from '@main/services/task-miner'
import { UserContextBuilder } from '@main/services/user-context-builder'
import { RemoteModelConfigService } from '@main/services/remote-model-config-service'
import {
  readRemoteModelConfig,
  writeRemoteModelConfig,
} from '@main/services/remote-model-config-store'
import { pushModelSelections, resolveModelPush } from '@main/ui/apply-models'
import { createPipelineHarness } from '@main/activity/pipeline-harness'
import { DefaultActivityTransformer } from '@main/activity/activity-transformer'
import { SqliteActivitySink } from '@main/activity/sqlite-activity-sink'
import { FfmpegVideoStitcher } from '@main/video/video-stitcher'
import {
  ActivitySemanticService,
  SemanticFileDebugDumper,
} from '@main/semantic/activity-semantic-service'
import { InteractionEventDebugDumper } from '@main/debug/interaction-event-debug-dump'
import { InferenceProviderImpl, type InferenceProvider } from '@main/llm'
import {
  createCaptureController,
  type RuntimeCaptureController,
} from '@main/capture/capture-controller'
import { HostEnvironment } from '@main/monitoring/host-environment'
import { EvalRecorder } from '@main/eval/eval-recorder'
import { EvalFixtureStore } from '@main/eval/eval-fixture-store'
import { TaskFixtureStore } from '@main/eval/task-fixture-store'
import { registerEvalMediaProtocol } from '@main/eval/eval-media-protocol'
import { MlWorkerClient } from '@main/services/ml-worker-client'
import { backendUrlFor } from '@main/system/edition'
import { listenerSet } from '@main/utils/listeners'

export interface MainRuntime {
  edition: AppEdition
  settings: AppSettingsManager
  vendorCredentials: VendorCredentialsManager
  deviceIdentity: DeviceIdentity
  capture: RuntimeCaptureController
  host: HostEnvironment
  storage: StorageService
  usageTracker: UsageTracker
  inferenceProvider: InferenceProvider
  semanticService: ActivitySemanticService
  accessProvider: AccessProvider
  remoteModels: RemoteModelConfigService
  taskMiner: TaskMiner
  userContextBuilder: UserContextBuilder
  evalRecorder: EvalRecorder
  evalFixtureStore: EvalFixtureStore
  taskFixtureStore: TaskFixtureStore
  isManaged(): boolean
  isEnterpriseActivated(): boolean
  requiresActivation(): boolean
  isPurging(): boolean
  applyModels(): void
  credentialsChanged(): void
  onStateChanged(listener: () => void): () => void
  notifyStateChanged(): void
  onPrivacyBlockingChanged(listener: (blocked: boolean) => void): () => void
  start(): void
  purgeAll(): Promise<void>
  dispose(): Promise<void>
}

export async function createMainRuntime(params: {
  edition: AppEdition
  settings: AppSettingsManager
  vendorCredentials: VendorCredentialsManager
  deviceIdentity: DeviceIdentity
}): Promise<MainRuntime> {
  const { edition, settings, vendorCredentials, deviceIdentity } = params
  const stateChanged = listenerSet<[]>()
  const privacyBlockingChanged = listenerSet<[boolean]>()
  const initialSettings = settings.get()

  const host = new HostEnvironment()
  const inferenceProvider = new InferenceProviderImpl({
    credentials: vendorCredentials,
    getActiveVendor: () => settings.get().activeVendor,
  })
  const accessProvider = createAccessProvider(edition, deviceIdentity)
  const isManaged = (): boolean =>
    vendorCredentials.getStatus(settings.get().activeVendor).source === 'managed'
  const isEnterpriseActivated = (): boolean => accessProvider.getAccessState().isEnterpriseActivated

  const remoteModels = new RemoteModelConfigService({
    getDeviceId: () => deviceIdentity.getDeviceId(),
    isActivated: () => isManaged() && (edition !== 'enterprise' || isEnterpriseActivated()),
    getBackendUrl: () => backendUrlFor(edition),
    onChange: () => applyModels(),
    readStored: () => readRemoteModelConfig(),
    writeStored: (config) => writeRemoteModelConfig(config),
  })
  const getRemoteModelConfig = () => (isManaged() ? remoteModels.getConfig() : null)

  const dev = !app.isPackaged
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, dev ? 'memorylane-dev.db' : 'memorylane.db')
  applyPendingDatabaseImport(dbPath)
  const storage = new StorageService(dbPath)
  applyMigrations(storage.getDatabase())
  const usageTracker = new UsageTracker()
  const summaryModeTracker = new SummaryModeTracker()

  const debugPipelineDir = path.join(app.getAppPath(), '.debug-pipeline')
  const debugDumper =
    dev && process.env.DEBUG_PIPELINE
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

  const retainScreenshots =
    dev && Boolean(process.env.DEBUG_PIPELINE || process.env.MEMORYLANE_RETAIN_SCREENSHOTS)
  if (retainScreenshots) {
    log.info(
      '[Runtime] Screenshot retention enabled — captured frames will not be cleaned up (debug only)',
    )
  }

  const initialModels = resolveModelPush(initialSettings, getRemoteModelConfig(), isManaged())
  const semanticService = new ActivitySemanticService(inferenceProvider, {
    usageTracker,
    summaryModeTracker,
    debugDumper,
    pipelinePreference: initialSettings.semanticPipelineMode,
    requestTimeoutMs: initialSettings.activityRequestTimeoutMs,
    videoModels: initialModels.videoModels,
    snapshotModels: initialModels.snapshotModels,
    healthStatePath: path.join(userDataPath, 'llm-health.json'),
  })
  semanticService.setUserContext(() => storage.userContext.get()?.shortSummary ?? null)

  const outputDir = path.join(userDataPath, 'screenshots')
  fs.mkdirSync(outputDir, { recursive: true })
  log.info(
    `[Runtime] Persistence targets: mode=${dev ? 'dev' : 'packaged'} ` +
      `userData=${userDataPath} db=${dbPath} screenshots=${outputDir} ` +
      `activityCount=${storage.activities.count()}`,
  )

  // Initialized here so a broken model cache aborts startup instead of
  // silently failing activity persistence.
  const mlWorker = new MlWorkerClient()
  try {
    await mlWorker.init()
  } catch (error) {
    log.error('[Runtime] Failed to initialize embedding model; aborting startup.', error)
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
  const harness = createPipelineHarness({
    outputDir,
    extractorTransformer: transformer,
    extractorSink: new SqliteActivitySink(storage.activities),
    retainScreenshots,
    interactions: interactionMonitor,
    idle: host,
    exclusions: {
      apps: initialSettings.excludedApps,
      urlPatterns: initialSettings.excludedUrlPatterns,
      excludePrivateBrowsing: initialSettings.excludePrivateBrowsing,
      excludeLoginScreens: initialSettings.excludeLoginScreens,
    },
    onPrivacyBlockingChanged: (blocked) => privacyBlockingChanged.emit(blocked),
    // Excluded window titles/URLs must never reach the plaintext JSONL.
    onAcceptedEvent: interactionDumper ? (event) => interactionDumper.dump(event) : undefined,
  })
  const capture = createCaptureController({
    harness,
    outputDir,
    onStateChanged: () => stateChanged.emit(),
  })

  const userContextBuilder = new UserContextBuilder(storage, inferenceProvider)
  const taskMiner = new TaskMiner(storage, inferenceProvider, mlWorker, host)
  taskMiner.setEnabled(initialSettings.patternDetectionEnabled)

  const applyModels = (): void => {
    pushModelSelections(
      { semanticService, userContextBuilder, taskMiner },
      settings.get(),
      getRemoteModelConfig(),
      isManaged(),
    )
  }
  applyModels()

  const unsubscribeSettings = settings.onChange((next, previous) =>
    applySettingsChange(
      { capture, semanticService, inferenceProvider, taskMiner, applyModels },
      next,
      previous,
    ),
  )

  const evalFixturesRoot = path.join(userDataPath, 'eval-fixtures')
  registerEvalMediaProtocol(evalFixturesRoot)
  const evalRecorder = new EvalRecorder({ harness, capture, fixturesRoot: evalFixturesRoot })
  const evalFixtureStore = new EvalFixtureStore(evalFixturesRoot)
  const taskFixtureStore = new TaskFixtureStore(path.join(userDataPath, 'task-fixtures'))

  let purging = false
  let disposePromise: Promise<void> | null = null

  const purgeAll = async (): Promise<void> => {
    const wasCapturing = capture.isCapturingNow()

    // Stop accepting new work, then drain in-flight work. If quiescing fails
    // the DB may still be receiving writes, so abort instead of racing purge().
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
  }

  const step = (name: string, fn: () => void): void => {
    try {
      fn()
    } catch (error) {
      log.warn(`[Runtime] Failed to ${name}:`, error)
    }
  }

  return {
    edition,
    settings,
    vendorCredentials,
    deviceIdentity,
    capture,
    host,
    storage,
    usageTracker,
    inferenceProvider,
    semanticService,
    accessProvider,
    remoteModels,
    taskMiner,
    userContextBuilder,
    evalRecorder,
    evalFixtureStore,
    taskFixtureStore,
    isManaged,
    isEnterpriseActivated,
    requiresActivation: () => requiresActivation(accessProvider.getAccessState()),
    isPurging: () => purging,
    applyModels,
    credentialsChanged(): void {
      applyModels()
      inferenceProvider.notifyConfigChanged()
      void semanticService.testConnection()
    },
    onStateChanged: stateChanged.add,
    notifyStateChanged: () => stateChanged.emit(),
    onPrivacyBlockingChanged: privacyBlockingChanged.add,
    start(): void {
      accessProvider.startPeriodicRefresh()
      remoteModels.start()
      // After a derived-data wipe migration the DB is still mined, so clusters
      // rebuild from sightings before the sweep poll starts.
      void taskMiner.rebuildClustersIfEmpty().then(() => taskMiner.startup())
      host.onAwake(() => taskMiner.kick())
    },
    async purgeAll(): Promise<void> {
      purging = true
      try {
        await purgeAll()
      } finally {
        purging = false
      }
    },
    dispose(): Promise<void> {
      if (disposePromise) return disposePromise
      disposePromise = (async () => {
        step('stop access refresh', () => accessProvider.stopPeriodicRefresh())
        step('stop remote model config', () => remoteModels.stop())
        step('stop task miner', () => taskMiner.stop())
        step('stop user context builder', () => userContextBuilder.stop())
        unsubscribeSettings()
        try {
          await capture.forceClose()
          capture.stopCapture()
          await capture.waitForIdle()
        } catch (error) {
          log.warn('[Runtime] Error while stopping capture during dispose:', error)
        }
        step('dispose pipeline harness', () => harness.dispose())
        step('dispose semantic service', () => semanticService.dispose())
        step('dispose ml-worker', () => mlWorker.dispose())
        step('close storage', () => storage.close())
      })()
      return disposePromise
    },
  }
}
