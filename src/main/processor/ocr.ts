import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { createOcrBackendError } from './ocr-errors'
import { extractTextWindowsNative } from './ocr-windows-native'

type OcrBackend = (filepath: string) => Promise<string>

function assertImageExists(filepath: string): void {
  if (!fs.existsSync(filepath)) {
    throw new Error(`Image file not found: ${filepath}`)
  }
}

/**
 * Resolves the path to the Swift OCR script for macOS OCR.
 * In development, it looks in the src directory.
 * In production, it looks in the resources directory.
 */
function getMacOSOcrScriptPath(): string {
  let isPackaged = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    isPackaged = require('electron').app.isPackaged
  } catch {
    // Running under ELECTRON_RUN_AS_NODE — treat as dev
  }

  if (isPackaged) {
    const prodPath = path.join(process.resourcesPath, 'swift', 'ocr.swift')
    if (fs.existsSync(prodPath)) {
      return prodPath
    }
    throw createOcrBackendError(
      'macos',
      'backend_unavailable',
      `OCR script not found at ${prodPath}`,
    )
  }

  const devPath = path.resolve(process.cwd(), 'src', 'main', 'processor', 'swift', 'ocr.swift')
  if (fs.existsSync(devPath)) {
    return devPath
  }

  throw createOcrBackendError('macos', 'backend_unavailable', `OCR script not found at ${devPath}`)
}

async function extractTextMacOS(filepath: string): Promise<string> {
  const scriptPath = getMacOSOcrScriptPath()

  return new Promise((resolve, reject) => {
    const swift = spawn('swift', [scriptPath, filepath])

    let stdoutData = ''
    let stderrData = ''

    swift.stdout.on('data', (data) => {
      stdoutData += data.toString()
    })

    swift.stderr.on('data', (data) => {
      stderrData += data.toString()
    })

    swift.on('close', (code) => {
      if (code !== 0) {
        return reject(
          createOcrBackendError(
            'macos',
            'runtime_failed',
            `OCR process failed with code ${code}: ${stderrData.trim() || 'Unknown error'}`,
          ),
        )
      }

      resolve(stdoutData.trim())
    })

    swift.on('error', (err) => {
      reject(
        createOcrBackendError(
          'macos',
          'backend_unavailable',
          `Failed to spawn swift process: ${err.message}`,
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

  return backend(filepath)
}
