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
   * Saves the exact content blocks sent to the LLM (base64-decoded media files).
   * Fire-and-forget — errors are logged but never thrown.
   */
  public dumpActivity(
    input: ActivityClassificationInput,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: Array<{ type: string; [key: string]: any }>,
    response: DebugPipelineResponse,
  ): void {
    try {
      const { activity } = input
      const ts = new Date().toISOString().replace(/:/g, '-')
      const subDir = path.join(this.debugDir, `${ts}_${activity.id}`)

      fs.mkdirSync(subDir, { recursive: true })

      // Extract and save media from content blocks (exact LLM payload)
      let imageIndex = 0
      const imageCount = content.filter((b) => b.type === 'image_url').length
      for (const block of content) {
        if (block.type === 'text') {
          fs.writeFileSync(path.join(subDir, 'prompt.txt'), block.text, 'utf-8')
        } else if (block.type === 'image_url') {
          const dataUrl: string = block.imageUrl?.url ?? ''
          const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
          const label =
            imageIndex === 0 ? 'start' : imageIndex === imageCount - 1 ? 'end' : `mid-${imageIndex}`
          fs.writeFileSync(path.join(subDir, `${label}.jpeg`), Buffer.from(base64, 'base64'))
          imageIndex++
        }
      }

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
