import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import log from '../logger'
import { ClassificationInput } from '../../shared/types'

function getDebugDir(): string {
  return path.join(app.getAppPath(), '.debug-pipeline')
}

export interface DebugPipelineResponse {
  model: string
  output: string
  promptTokens: number
  completionTokens: number
  cost: number
  timestamp: number
}

export class DebugPipelineWriter {
  private readonly debugDir: string
  private lastSubDir: string | null = null

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
   * Dump an LLM round-trip for the extraction phase (pass 1).
   * Creates the subfolder, copies screenshot images, and writes prompt/response.
   * The summary pass reuses the same subfolder via dumpSummary().
   */
  public dumpExtraction(
    input: ClassificationInput,
    prompt: string,
    response: DebugPipelineResponse,
  ): void {
    try {
      const { startScreenshot, endScreenshot } = input
      const ts = new Date().toISOString().replace(/:/g, '-')
      const subDir = path.join(this.debugDir, `${ts}_${startScreenshot.id}`)
      this.lastSubDir = subDir

      fs.mkdirSync(subDir, { recursive: true })

      if (fs.existsSync(startScreenshot.filepath)) {
        fs.copyFileSync(startScreenshot.filepath, path.join(subDir, 'start.png'))
      }
      if (endScreenshot && fs.existsSync(endScreenshot.filepath)) {
        fs.copyFileSync(endScreenshot.filepath, path.join(subDir, 'end.png'))
      }

      fs.writeFileSync(path.join(subDir, 'extraction-prompt.txt'), prompt, 'utf-8')

      fs.writeFileSync(
        path.join(subDir, 'extraction-response.json'),
        JSON.stringify(response, null, 2),
        'utf-8',
      )

      log.info(`[DebugPipeline] Dumped extraction to ${subDir}`)
    } catch (error) {
      log.warn('[DebugPipeline] Failed to dump extraction:', error)
    }
  }

  /**
   * Dump an LLM round-trip for the summary phase (pass 2).
   * Writes into the same subfolder created by the preceding dumpExtraction() call.
   * No screenshots are copied — the summary pass is text-only.
   */
  public dumpSummary(prompt: string, response: DebugPipelineResponse): void {
    try {
      if (!this.lastSubDir) {
        log.warn('[DebugPipeline] dumpSummary called without a preceding dumpExtraction')
        return
      }

      fs.writeFileSync(path.join(this.lastSubDir, 'summary-prompt.txt'), prompt, 'utf-8')

      fs.writeFileSync(
        path.join(this.lastSubDir, 'summary-response.json'),
        JSON.stringify(response, null, 2),
        'utf-8',
      )

      log.info(`[DebugPipeline] Dumped summary to ${this.lastSubDir}`)
    } catch (error) {
      log.warn('[DebugPipeline] Failed to dump summary:', error)
    }
  }
}
