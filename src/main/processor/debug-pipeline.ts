import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from '../logger'
import { ActivityClassificationInput } from '../../shared/types'

function getDebugDir(): string {
  return path.join(app.getAppPath(), '.debug-pipeline')
}

export interface DebugPipelineResponse {
  model: string
  summary: string
  promptTokens: number
  completionTokens: number
  cost: number
  timestamp: number
}

export class DebugPipelineWriter {
  private readonly debugDir: string

  private constructor(debugDir: string) {
    this.debugDir = debugDir
  }

  /**
   * Factory: returns an instance if debug mode is active, null otherwise.
   * Hard-gated on non-production builds — packaged apps always return null.
   */
  public static create(): DebugPipelineWriter | null {
    if (app.isPackaged) {
      return null
    }
    if (!process.env.DEBUG_PIPELINE) {
      return null
    }

    const debugDir = getDebugDir()
    const writer = new DebugPipelineWriter(debugDir)
    log.info(`[DebugPipeline] Debug mode active — dumping LLM round-trips to ${debugDir}`)
    return writer
  }

  /**
   * Remove the debug directory on startup, unconditionally.
   * Safe to call even when debug mode is off.
   */
  public static cleanDebugDir(): void {
    try {
      const debugDir = getDebugDir()
      if (fs.existsSync(debugDir)) {
        fs.rmSync(debugDir, { recursive: true })
        log.info(`[DebugPipeline] Cleaned debug directory: ${debugDir}`)
      }
    } catch (error) {
      log.warn('[DebugPipeline] Failed to clean debug directory:', error)
    }
  }

  /**
   * Dump a full activity classification round-trip to a timestamped subfolder.
   * Fire-and-forget — errors are logged but never thrown.
   */
  public dumpActivity(
    input: ActivityClassificationInput,
    prompt: string,
    response: DebugPipelineResponse,
  ): void {
    try {
      const { activity, screenshotPaths } = input
      const ts = new Date().toISOString().replace(/:/g, '-')
      const subDir = path.join(this.debugDir, `${ts}_${activity.id}`)

      fs.mkdirSync(subDir, { recursive: true })

      // Copy video file if present
      if (input.videoPath && fs.existsSync(input.videoPath)) {
        fs.copyFileSync(input.videoPath, path.join(subDir, 'video.mp4'))
      }

      // Copy screenshot files
      for (let i = 0; i < screenshotPaths.length; i++) {
        const filepath = screenshotPaths[i]
        if (fs.existsSync(filepath)) {
          const label = i === 0 ? 'start' : i === screenshotPaths.length - 1 ? 'end' : `mid-${i}`
          fs.copyFileSync(filepath, path.join(subDir, `${label}.png`))
        }
      }

      fs.writeFileSync(path.join(subDir, 'prompt.txt'), prompt, 'utf-8')

      fs.writeFileSync(
        path.join(subDir, 'response.json'),
        JSON.stringify(response, null, 2),
        'utf-8',
      )

      fs.writeFileSync(
        path.join(subDir, 'activity.json'),
        JSON.stringify(
          {
            id: activity.id,
            appName: activity.appName,
            windowTitle: activity.windowTitle,
            url: activity.url,
            startTimestamp: activity.startTimestamp,
            endTimestamp: activity.endTimestamp,
            screenshotCount: activity.screenshots.length,
            interactionCount: activity.interactions.length,
          },
          null,
          2,
        ),
        'utf-8',
      )

      log.info(`[DebugPipeline] Dumped activity round-trip to ${subDir}`)
    } catch (error) {
      log.warn('[DebugPipeline] Failed to dump activity round-trip:', error)
    }
  }
}
