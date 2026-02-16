import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from '../logger'
import { ClassificationInput, SessionClassificationInput } from '../../shared/types'

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
   * Dump a full LLM round-trip to a timestamped subfolder.
   * Fire-and-forget — errors are logged but never thrown.
   */
  public dump(input: ClassificationInput, prompt: string, response: DebugPipelineResponse): void {
    try {
      const { startScreenshot, endScreenshot } = input
      const ts = new Date().toISOString().replace(/:/g, '-')
      const subDir = path.join(this.debugDir, `${ts}_${startScreenshot.id}`)

      fs.mkdirSync(subDir, { recursive: true })

      if (fs.existsSync(startScreenshot.filepath)) {
        fs.copyFileSync(startScreenshot.filepath, path.join(subDir, 'start.png'))
      }
      if (endScreenshot && fs.existsSync(endScreenshot.filepath)) {
        fs.copyFileSync(endScreenshot.filepath, path.join(subDir, 'end.png'))
      }

      fs.writeFileSync(path.join(subDir, 'prompt.txt'), prompt, 'utf-8')

      fs.writeFileSync(
        path.join(subDir, 'response.json'),
        JSON.stringify(response, null, 2),
        'utf-8',
      )

      log.info(`[DebugPipeline] Dumped round-trip to ${subDir}`)
    } catch (error) {
      log.warn('[DebugPipeline] Failed to dump round-trip:', error)
    }
  }

  /**
   * Dump a full session-level LLM round-trip with all sampled images.
   */
  public dumpSession(
    input: SessionClassificationInput,
    prompt: string,
    response: DebugPipelineResponse,
  ): void {
    try {
      const ts = new Date().toISOString().replace(/:/g, '-')
      const subDir = path.join(this.debugDir, `${ts}_${input.sessionId}`)

      fs.mkdirSync(subDir, { recursive: true })

      input.screenshots.forEach((screenshot, index) => {
        if (fs.existsSync(screenshot.filepath)) {
          const filename = `frame-${String(index + 1).padStart(2, '0')}_${screenshot.id}.png`
          fs.copyFileSync(screenshot.filepath, path.join(subDir, filename))
        }
      })

      fs.writeFileSync(path.join(subDir, 'prompt.txt'), prompt, 'utf-8')

      fs.writeFileSync(
        path.join(subDir, 'response.json'),
        JSON.stringify(response, null, 2),
        'utf-8',
      )

      log.info(`[DebugPipeline] Dumped session round-trip to ${subDir}`)
    } catch (error) {
      log.warn('[DebugPipeline] Failed to dump session round-trip:', error)
    }
  }
}
