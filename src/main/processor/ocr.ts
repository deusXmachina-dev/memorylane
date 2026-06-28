import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { createOcrBackendError } from './ocr-errors'
import { extractTextWindowsNative } from './ocr-windows-native'
import { OCR_CONFIG } from '@constants'
import log from '../logger'
import type { ActivityOcrService } from '../activity-transformer-types'

type OcrBackend = (filepath: string) => Promise<string>

function assertImageExists(filepath: string): void {
  if (!fs.existsSync(filepath)) {
    throw new Error(`Image file not found: ${filepath}`)
  }
}

interface OcrExecutable {
  readonly command: string
  readonly args: readonly string[]
}

/**
 * Resolves the OCR executable.
 * In production, uses the pre-compiled binary shipped in the app resources.
 * In development, interprets the Swift script via the `swift` command.
 */
function getMacOSOcrExecutable(): OcrExecutable {
  let isPackaged = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    isPackaged = require('electron').app.isPackaged
  } catch {
    // Running under ELECTRON_RUN_AS_NODE — treat as dev
  }

  if (isPackaged) {
    const binaryPath = path.join(process.resourcesPath, 'swift', 'ocr')
    if (fs.existsSync(binaryPath)) {
      return { command: binaryPath, args: [] }
    }
    throw createOcrBackendError(
      'macos',
      'backend_unavailable',
      `OCR binary not found at ${binaryPath}`,
    )
  }

  const scriptPath = path.resolve(process.cwd(), 'src', 'main', 'processor', 'swift', 'ocr.swift')
  if (fs.existsSync(scriptPath)) {
    return { command: 'swift', args: [scriptPath] }
  }

  throw createOcrBackendError(
    'macos',
    'backend_unavailable',
    `OCR script not found at ${scriptPath}`,
  )
}

async function extractTextMacOS(filepath: string): Promise<string> {
  const { command, args } = getMacOSOcrExecutable()

  return new Promise((resolve, reject) => {
    const OCR_TIMEOUT_MS = 15_000
    const proc = spawn(command, [...args, filepath, '--mode', OCR_CONFIG.RECOGNITION_MODE])
    log.debug(`[OCR] Spawned process (pid=${proc.pid}) for ${path.basename(filepath)}`)

    let stdoutData = ''
    let stderrData = ''
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      log.warn(
        `[OCR] Process (pid=${proc.pid}) timed out after ${OCR_TIMEOUT_MS}ms, sending SIGTERM`,
      )
      proc.kill('SIGTERM')
    }, OCR_TIMEOUT_MS)

    proc.stdout.on('data', (data) => {
      stdoutData += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderrData += data.toString()
    })

    proc.on('close', (code) => {
      clearTimeout(timeout)

      if (timedOut) {
        log.error(`[OCR] Process (pid=${proc.pid}) killed after timeout`)
        return reject(new Error(`OCR process timed out after ${OCR_TIMEOUT_MS}ms`))
      }

      if (code !== 0) {
        log.error(`[OCR] Process (pid=${proc.pid}) exited with code ${code}: ${stderrData.trim()}`)
        return reject(
          createOcrBackendError(
            'macos',
            'runtime_failed',
            `OCR process failed with code ${code}: ${stderrData.trim() || 'Unknown error'}`,
          ),
        )
      }

      log.debug(
        `[OCR] Process (pid=${proc.pid}) completed, extracted ${stdoutData.trim().length} chars`,
      )
      resolve(stdoutData.trim())
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      reject(
        createOcrBackendError(
          'macos',
          'backend_unavailable',
          `Failed to spawn OCR process: ${err.message}`,
        ),
      )
    })
  })
}

const PLATFORM_OCR_BACKENDS: Partial<Record<NodeJS.Platform, OcrBackend>> = {
  darwin: extractTextMacOS,
  win32: extractTextWindowsNative,
}

/**
 * Extracts text from an image using a platform-specific OCR backend.
 *
 * @param filepath Absolute path to the image file
 * @returns Promise resolving to the extracted text
 * @throws Error when no OCR backend is configured for the running platform
 */
export async function extractText(filepath: string): Promise<string> {
  assertImageExists(filepath)

  const backend = PLATFORM_OCR_BACKENDS[process.platform]
  if (!backend) {
    throw createOcrBackendError(
      process.platform === 'win32' ? 'windows' : 'macos',
      'backend_unavailable',
      `OCR is not supported on platform "${process.platform}"`,
    )
  }

  const startMs = Date.now()
  const text = await backend(filepath)
  const elapsedMs = Date.now() - startMs
  log.debug(`[OCR] extractText completed in ${elapsedMs}ms for ${path.basename(filepath)}`)
  return text
}

export const activityOcrService: ActivityOcrService = {
  extractText,
}
