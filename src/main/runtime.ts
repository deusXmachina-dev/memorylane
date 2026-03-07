import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from './logger'
import { ApiKeyManager } from './settings/api-key-manager'
import { CustomEndpointManager } from './settings/custom-endpoint-manager'
import { DeviceIdentity } from './settings/device-identity'
import { ManagedKeyService } from './services/managed-key-service'
import { StorageService } from './storage'
import { applyMigrations } from './storage/migrator'
import { EmbeddingService } from './processor/embedding'
import { activityOcrService } from './processor/ocr'
import { UsageTracker } from './services/usage-tracker'
import { createPipelineHarness } from './pipeline-harness'
import { DefaultActivityTransformer } from './activity-transformer'
import { SqliteActivitySink } from './sqlite-activity-sink'
import { FfmpegVideoStitcher } from './video/video-stitcher'
import { ActivitySemanticService, SemanticFileDebugDumper } from './activity-semantic-service'
import type { SemanticPipelinePreference } from './activity-semantic-service'
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
  apiKeyManager: ApiKeyManager
  customEndpointManager: CustomEndpointManager
  semanticService: ActivitySemanticService
  managedKeyService: ManagedKeyService
  updateExclusions(exclusions: {
    apps: string[]
    windowTitlePatterns: string[]
    urlPatterns: string[]
    excludePrivateBrowsing: boolean
  }): void
  dispose(): Promise<void>
}

export async function createMainRuntime(params?: {
  onCaptureStateChanged?: () => void
  semanticPipelinePreference?: SemanticPipelinePreference
  semanticRequestTimeoutMs?: number
  excludedApps?: string[]
  excludedWindowTitlePatterns?: string[]
  excludedUrlPatterns?: string[]
  excludePrivateBrowsing?: boolean
}): Promise<MainRuntime> {
  const onCaptureStateChanged = params?.onCaptureStateChanged ?? (() => undefined)

  const interactionMonitor = await import('./recorder/interaction-monitor')

  const apiKeyManager = new ApiKeyManager()
  const customEndpointManager = new CustomEndpointManager()
  const dev = !app.isPackaged
  const userDataPath = app.getPath('userData')
  const dbFile = dev ? 'memorylane-dev.db' : 'memorylane.db'
  const dbPath = path.join(userDataPath, dbFile)
  const storage = new StorageService(dbPath)
  applyMigrations(storage.getDatabase())
  const usageTracker = new UsageTracker()

  const debugDumper =
    !app.isPackaged && process.env.DEBUG_PIPELINE
      ? new SemanticFileDebugDumper({
          rootDir: path.join(app.getAppPath(), '.debug-pipeline'),
          cleanRootDir: true,
          copyMediaAssets: true,
        })
      : undefined

  const savedEndpoint = customEndpointManager.getEndpoint()
  const semanticService = new ActivitySemanticService(apiKeyManager.getApiKey() || undefined, {
    usageTracker,
    debugDumper,
    pipelinePreference: params?.semanticPipelinePreference,
    requestTimeoutMs: params?.semanticRequestTimeoutMs,
    endpointConfig: savedEndpoint
      ? {
          serverURL: savedEndpoint.serverURL,
          model: savedEndpoint.model,
          apiKey: savedEndpoint.apiKey,
        }
      : undefined,
  })

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
  })

  const capture: RuntimeCaptureController = createCaptureController({
    harness,
    interactionMonitor,
    outputDir,
    onStateChanged: () => onCaptureStateChanged(),
  })

  const blacklistCoordinator = createCaptureBlacklistCoordinator({
    initialExcludedApps: params?.excludedApps,
    initialExcludedWindowTitlePatterns: params?.excludedWindowTitlePatterns,
    initialExcludedUrlPatterns: params?.excludedUrlPatterns,
    initialExcludePrivateBrowsing: params?.excludePrivateBrowsing,
    forwardInteraction: (event) => {
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

  const deviceIdentity = new DeviceIdentity()
  const managedKeyService = new ManagedKeyService(deviceIdentity)

  let disposePromise: Promise<void> | null = null

  return {
    capture,
    storage,
    usageTracker,
    apiKeyManager,
    customEndpointManager,
    semanticService,
    managedKeyService,
    updateExclusions(exclusions): void {
      blacklistCoordinator.updateExclusions(exclusions)
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
          storage.close()
        } catch (error) {
          log.warn('[Runtime] Failed to close storage:', error)
        }
      })()

      return disposePromise
    },
  }
}
