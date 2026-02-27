import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from '../logger'
import { ApiKeyManager } from '../settings/api-key-manager'
import { CustomEndpointManager } from '../settings/custom-endpoint-manager'
import { CaptureSettingsManager } from '../settings/capture-settings-manager'
import { DeviceIdentity } from '../settings/device-identity'
import { ManagedKeyService } from '../services/managed-key-service'
import { StorageService } from '../storage'
import { EmbeddingService } from '../processor/embedding'
import { activityOcrService } from '../processor/ocr'
import { UsageTracker } from '../services/usage-tracker'
import { createV2PipelineHarness } from './pipeline-harness'
import { DefaultActivityTransformer } from './activity-transformer'
import { SqliteActivitySink } from './sqlite-activity-sink'
import { FfmpegVideoStitcher } from './video/video-stitcher'
import { V2ActivitySemanticService, V2SemanticFileDebugDumper } from './activity-semantic-service'
import {
  createV2CaptureController,
  type RuntimeCapture,
  type RuntimeCaptureController,
} from './capture-controller'
import { CustomEndpointConfig } from '../../shared/types'

interface SemanticService {
  updateApiKey(apiKey: string | null): void
  updateEndpoint(config: CustomEndpointConfig | null, openRouterKey?: string | null): void
}

export interface MainRuntime {
  capture: RuntimeCapture
  storage: StorageService
  usageTracker: UsageTracker
  apiKeyManager: ApiKeyManager
  customEndpointManager: CustomEndpointManager
  semanticService: SemanticService
  managedKeyService: ManagedKeyService
  dispose(): Promise<void>
}

export type V2MainRuntime = MainRuntime

export async function createMainRuntime(params?: {
  onCaptureStateChanged?: () => void
  captureSettingsManager?: CaptureSettingsManager
}): Promise<MainRuntime> {
  const onCaptureStateChanged = params?.onCaptureStateChanged ?? (() => undefined)
  const captureSettingsManager = params?.captureSettingsManager ?? new CaptureSettingsManager()
  const captureMode = captureSettingsManager.get().captureMode

  const interactionMonitor = await import('../recorder/interaction-monitor')

  const apiKeyManager = new ApiKeyManager()
  const customEndpointManager = new CustomEndpointManager()
  const storage = new StorageService(StorageService.getDefaultDbPath())
  const usageTracker = new UsageTracker()

  const outputDir = path.join(app.getPath('userData'), 'screenshots')
  fs.mkdirSync(outputDir, { recursive: true })

  const deviceIdentity = new DeviceIdentity()
  const managedKeyService = new ManagedKeyService(deviceIdentity)

  if (captureMode === 'v1') {
    return createV1Runtime({
      onCaptureStateChanged,
      interactionMonitor,
      apiKeyManager,
      customEndpointManager,
      storage,
      usageTracker,
      managedKeyService,
      outputDir,
    })
  }

  return createV2Runtime({
    onCaptureStateChanged,
    interactionMonitor,
    apiKeyManager,
    customEndpointManager,
    storage,
    usageTracker,
    managedKeyService,
    outputDir,
  })
}

export const createV2MainRuntime = createMainRuntime

// ---------------------------------------------------------------------------
// v2 runtime (video pipeline)
// ---------------------------------------------------------------------------

async function createV2Runtime(shared: {
  onCaptureStateChanged: () => void
  interactionMonitor: typeof import('../recorder/interaction-monitor')
  apiKeyManager: ApiKeyManager
  customEndpointManager: CustomEndpointManager
  storage: StorageService
  usageTracker: UsageTracker
  managedKeyService: ManagedKeyService
  outputDir: string
}): Promise<MainRuntime> {
  const {
    onCaptureStateChanged,
    interactionMonitor,
    apiKeyManager,
    customEndpointManager,
    storage,
    usageTracker,
    managedKeyService,
    outputDir,
  } = shared

  const debugDumper =
    !app.isPackaged && process.env.DEBUG_PIPELINE
      ? new V2SemanticFileDebugDumper({
          rootDir: path.join(app.getAppPath(), '.debug-pipeline'),
          cleanRootDir: true,
          copyMediaAssets: true,
        })
      : undefined

  const savedEndpoint = customEndpointManager.getEndpoint()
  const semanticService = new V2ActivitySemanticService(apiKeyManager.getApiKey() || undefined, {
    usageTracker,
    debugDumper,
    endpointConfig: savedEndpoint
      ? {
          serverURL: savedEndpoint.serverURL,
          model: savedEndpoint.model,
          apiKey: savedEndpoint.apiKey,
        }
      : undefined,
  })

  const transformer = new DefaultActivityTransformer(
    new FfmpegVideoStitcher(),
    activityOcrService,
    semanticService,
    new EmbeddingService(),
    { outputDir },
  )
  const sink = new SqliteActivitySink(storage.activities)

  const harness = createV2PipelineHarness({
    outputDir,
    extractorTransformer: transformer,
    extractorSink: sink,
  })

  const capture: RuntimeCaptureController = createV2CaptureController({
    harness,
    interactionMonitor,
    outputDir,
    onStateChanged: () => onCaptureStateChanged(),
  })

  const interactionHandler = (event: Parameters<typeof harness.handleEvent>[0]): void => {
    harness.handleEvent(event)
  }
  interactionMonitor.onInteraction(interactionHandler)

  let disposePromise: Promise<void> | null = null

  return {
    capture,
    storage,
    usageTracker,
    apiKeyManager,
    customEndpointManager,
    semanticService,
    managedKeyService,
    async dispose(): Promise<void> {
      if (disposePromise) return disposePromise

      disposePromise = (async () => {
        try {
          await capture.forceClose()
          capture.stopCapture()
          await capture.waitForIdle()
        } catch (error) {
          log.warn('[V2Runtime] Error while stopping capture during dispose:', error)
        }

        try {
          interactionMonitor.clearInteractionCallback(interactionHandler)
        } catch (error) {
          log.warn('[V2Runtime] Failed to clear interaction callback:', error)
        }

        try {
          storage.close()
        } catch (error) {
          log.warn('[V2Runtime] Failed to close storage:', error)
        }
      })()

      return disposePromise
    },
  }
}

// ---------------------------------------------------------------------------
// v1 runtime (event-driven snapshot pipeline)
// ---------------------------------------------------------------------------

async function createV1Runtime(shared: {
  onCaptureStateChanged: () => void
  interactionMonitor: typeof import('../recorder/interaction-monitor')
  apiKeyManager: ApiKeyManager
  customEndpointManager: CustomEndpointManager
  storage: StorageService
  usageTracker: UsageTracker
  managedKeyService: ManagedKeyService
  outputDir: string
}): Promise<MainRuntime> {
  const {
    onCaptureStateChanged,
    interactionMonitor,
    apiKeyManager,
    customEndpointManager,
    storage,
    usageTracker,
    managedKeyService,
    outputDir,
  } = shared

  const recorder = await import('../recorder/recorder')
  const { ActivityManager } = await import('../processor/activity-manager')
  const { ActivityProcessor } = await import('../processor/index')
  const { SemanticClassifierService } = await import('../processor/semantic-classifier')

  const savedEndpoint = customEndpointManager.getEndpoint()
  const classifierService = new SemanticClassifierService(
    apiKeyManager.getApiKey() || undefined,
    undefined, // default model
    undefined, // default maxHistorySize
    usageTracker,
    undefined, // no debug writer
    savedEndpoint
      ? {
          serverURL: savedEndpoint.serverURL,
          model: savedEndpoint.model,
          apiKey: savedEndpoint.apiKey,
        }
      : undefined,
  )

  const embeddingService = new EmbeddingService()
  const processor = new ActivityProcessor(embeddingService, storage, classifierService)

  const activityManager = new ActivityManager({
    captureImmediate: recorder.captureImmediate,
    captureIfVisualChange: recorder.captureIfVisualChange,
    captureWindowByTitle: recorder.captureWindowByTitle,
  })

  activityManager.onActivityComplete((activity) => {
    void processor.processActivity(activity)
  })

  let interactionHandler:
    | ((event: import('../../shared/types').InteractionContext) => void)
    | null = null

  const capture: RuntimeCaptureController = {
    isCapturingNow(): boolean {
      return recorder.isCapturingNow()
    },
    startCapture(): void {
      interactionHandler = (event) => {
        void activityManager.handleInteraction(event)
      }
      interactionMonitor.onInteraction(interactionHandler)
      recorder.startCapture()
      onCaptureStateChanged()
      log.info('[V1Runtime] Started capture')
    },
    stopCapture(): void {
      recorder.stopCapture()
      if (interactionHandler) {
        interactionMonitor.clearInteractionCallback(interactionHandler)
        interactionHandler = null
      }
      onCaptureStateChanged()
      log.info('[V1Runtime] Stopped capture')
    },
    async forceClose(): Promise<void> {
      await activityManager.forceClose()
    },
    getScreenshotsDir(): string {
      return outputDir
    },
    waitForIdle(): Promise<void> {
      return Promise.resolve()
    },
  }

  let disposePromise: Promise<void> | null = null

  return {
    capture,
    storage,
    usageTracker,
    apiKeyManager,
    customEndpointManager,
    semanticService: classifierService,
    managedKeyService,
    async dispose(): Promise<void> {
      if (disposePromise) return disposePromise

      disposePromise = (async () => {
        try {
          await activityManager.forceClose()
          recorder.stopCapture()
        } catch (error) {
          log.warn('[V1Runtime] Error while stopping capture during dispose:', error)
        }

        if (interactionHandler) {
          try {
            interactionMonitor.clearInteractionCallback(interactionHandler)
            interactionHandler = null
          } catch (error) {
            log.warn('[V1Runtime] Failed to clear interaction callback:', error)
          }
        }

        try {
          storage.close()
        } catch (error) {
          log.warn('[V1Runtime] Failed to close storage:', error)
        }
      })()

      return disposePromise
    },
  }
}
