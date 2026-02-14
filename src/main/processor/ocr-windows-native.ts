import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { createOcrBackendError } from './ocr-errors'

interface WindowsOcrScriptOutput {
  readonly text: string
}

function isWindowsOcrScriptOutput(value: unknown): value is WindowsOcrScriptOutput {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const maybeText = Reflect.get(value, 'text')
  return typeof maybeText === 'string'
}

function getWindowsOcrScriptPath(): string {
  let isPackaged = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    isPackaged = require('electron').app.isPackaged
  } catch {
    // Running under ELECTRON_RUN_AS_NODE — treat as dev
  }

  if (isPackaged) {
    const prodPath = path.join(process.resourcesPath, 'powershell', 'windows-ocr.ps1')
    if (fs.existsSync(prodPath)) {
      return prodPath
    }

    throw createOcrBackendError(
      'windows',
      'backend_unavailable',
      `Windows OCR script not found at ${prodPath}`,
    )
  }

  const devPath = path.resolve(
    process.cwd(),
    'src',
    'main',
    'processor',
    'powershell',
    'windows-ocr.ps1',
  )
  if (fs.existsSync(devPath)) {
    return devPath
  }

  throw createOcrBackendError(
    'windows',
    'backend_unavailable',
    `Windows OCR script not found at ${devPath}`,
  )
}

function parseScriptOutput(rawOutput: string): string {
  const trimmedOutput = rawOutput.trim()
  if (trimmedOutput.length === 0) {
    throw createOcrBackendError(
      'windows',
      'runtime_failed',
      'Windows OCR script completed without returning output.',
    )
  }

  let parsed: unknown = null
  try {
    parsed = JSON.parse(trimmedOutput)
  } catch {
    const firstBraceIdx = trimmedOutput.indexOf('{')
    const lastBraceIdx = trimmedOutput.lastIndexOf('}')
    if (firstBraceIdx >= 0 && lastBraceIdx > firstBraceIdx) {
      const candidate = trimmedOutput.slice(firstBraceIdx, lastBraceIdx + 1)
      try {
        parsed = JSON.parse(candidate)
      } catch {
        // Fall through to canonical error below
      }
    }
  }

  if (parsed === null) {
    const compactPreview =
      trimmedOutput.length > 800 ? `${trimmedOutput.slice(0, 800)}...[truncated]` : trimmedOutput
    throw createOcrBackendError(
      'windows',
      'runtime_failed',
      `Windows OCR script returned invalid JSON output: ${compactPreview}`,
    )
  }

  if (!isWindowsOcrScriptOutput(parsed)) {
    throw createOcrBackendError(
      'windows',
      'runtime_failed',
      `Windows OCR script returned unexpected output shape: ${trimmedOutput}`,
    )
  }

  return parsed.text.trim()
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function decodeOutput(bufferChunks: readonly Buffer[]): string {
  if (bufferChunks.length === 0) {
    return ''
  }

  const combined = Buffer.concat(bufferChunks)
  const utf8 = combined.toString('utf8').replace(/^\uFEFF/, '')
  const utf16 = combined.toString('utf16le').replace(/^\uFEFF/, '')

  const utf8NullCount = utf8.split('\u0000').length - 1
  const utf16NullCount = utf16.split('\u0000').length - 1

  return utf16NullCount < utf8NullCount ? utf16 : utf8
}

export async function extractTextWindowsNative(filepath: string): Promise<string> {
  const scriptPath = getWindowsOcrScriptPath()

  return new Promise((resolve, reject) => {
    const powershell = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-ImagePath',
        filepath,
      ],
      { windowsHide: true },
    )

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    powershell.stdout.on('data', (data) => {
      stdoutChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)))
    })

    powershell.stderr.on('data', (data) => {
      stderrChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)))
    })

    powershell.on('error', (error) => {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        reject(
          createOcrBackendError(
            'windows',
            'backend_unavailable',
            'powershell.exe was not found on PATH, so Windows native OCR cannot run.',
          ),
        )
        return
      }

      reject(
        createOcrBackendError(
          'windows',
          'runtime_failed',
          `Failed to start Windows OCR process: ${error.message}`,
        ),
      )
    })

    powershell.on('close', (code) => {
      const stdoutData = decodeOutput(stdoutChunks)
      const stderrData = decodeOutput(stderrChunks)

      if (code !== 0) {
        const errorDetail =
          stderrData.trim() || stdoutData.trim() || 'Unknown Windows OCR script error'
        reject(
          createOcrBackendError(
            'windows',
            'runtime_failed',
            `Windows native OCR failed with code ${code}: ${errorDetail}`,
          ),
        )
        return
      }

      try {
        resolve(parseScriptOutput(stdoutData))
      } catch (error) {
        if (error instanceof Error) {
          reject(error)
          return
        }

        reject(
          createOcrBackendError(
            'windows',
            'runtime_failed',
            'Failed to parse Windows OCR output for an unknown reason.',
          ),
        )
      }
    })
  })
}
