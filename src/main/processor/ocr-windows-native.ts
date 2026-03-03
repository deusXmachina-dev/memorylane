import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { createOcrBackendError, type OcrErrorCode } from './ocr-errors'

interface WindowsOcrScriptDiagnostics {
  readonly engine: 'windows.media.ocr'
  readonly languageTag?: string | null
}

interface WindowsOcrScriptSuccess {
  readonly ok: true
  readonly text: string
  readonly diagnostics?: WindowsOcrScriptDiagnostics
}

type WindowsOcrScriptFailureCode =
  | 'image_not_found'
  | 'winrt_load_failed'
  | 'ocr_engine_unavailable'
  | 'image_decode_failed'
  | 'ocr_runtime_failed'
  | 'unexpected'

interface WindowsOcrScriptFailure {
  readonly ok: false
  readonly code: WindowsOcrScriptFailureCode
  readonly message: string
  readonly details?: string | null
}

type WindowsOcrScriptEnvelope = WindowsOcrScriptSuccess | WindowsOcrScriptFailure

export interface WindowsOcrReadiness {
  readonly ok: boolean
  readonly code: 'ready' | 'backend_unavailable' | 'not_ready' | 'runtime_failed'
  readonly message: string
}

const WINDOWS_OCR_TIMEOUT_MS = 15_000

function isWindowsOcrScriptEnvelope(value: unknown): value is WindowsOcrScriptEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const maybeOk = Reflect.get(value, 'ok')
  if (typeof maybeOk !== 'boolean') {
    return false
  }

  if (maybeOk) {
    return typeof Reflect.get(value, 'text') === 'string'
  }

  return (
    typeof Reflect.get(value, 'code') === 'string' &&
    typeof Reflect.get(value, 'message') === 'string'
  )
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

function parseScriptOutput(rawOutput: string): WindowsOcrScriptEnvelope {
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

  if (!isWindowsOcrScriptEnvelope(parsed)) {
    throw createOcrBackendError(
      'windows',
      'runtime_failed',
      `Windows OCR script returned unexpected output shape: ${trimmedOutput}`,
    )
  }

  return parsed
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

function mapScriptFailureToOcrErrorCode(code: WindowsOcrScriptFailureCode): OcrErrorCode {
  switch (code) {
    case 'ocr_engine_unavailable':
    case 'winrt_load_failed':
      return 'not_ready'
    case 'image_not_found':
    case 'image_decode_failed':
      return 'image_decode_failed'
    case 'ocr_runtime_failed':
    case 'unexpected':
      return 'runtime_failed'
  }
}

function toReadinessCode(code: WindowsOcrScriptFailureCode): WindowsOcrReadiness['code'] {
  switch (code) {
    case 'ocr_engine_unavailable':
    case 'winrt_load_failed':
      return 'not_ready'
    case 'image_not_found':
    case 'image_decode_failed':
    case 'ocr_runtime_failed':
    case 'unexpected':
      return 'runtime_failed'
  }
}

function toOcrError(envelope: WindowsOcrScriptFailure): Error {
  const code = mapScriptFailureToOcrErrorCode(envelope.code)
  const detailSuffix = envelope.details ? ` Details: ${envelope.details}` : ''
  return createOcrBackendError('windows', code, `${envelope.message}${detailSuffix}`)
}

interface RunWindowsOcrScriptOptions {
  readonly filepath?: string
  readonly probeOnly?: boolean
}

function runWindowsOcrScript({
  filepath,
  probeOnly = false,
}: RunWindowsOcrScriptOptions): Promise<WindowsOcrScriptEnvelope> {
  const scriptPath = getWindowsOcrScriptPath()

  return new Promise((resolve, reject) => {
    let settled = false
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
        ...(probeOnly ? ['-ProbeOnly'] : ['-ImagePath', filepath ?? '']),
      ],
      { windowsHide: true },
    )

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    const timeout = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      powershell.kill()
      reject(
        createOcrBackendError(
          'windows',
          'timeout',
          `Windows native OCR timed out after ${WINDOWS_OCR_TIMEOUT_MS}ms.`,
        ),
      )
    }, WINDOWS_OCR_TIMEOUT_MS)

    const resolveOnce = (value: WindowsOcrScriptEnvelope): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      resolve(value)
    }

    const rejectOnce = (error: Error): void => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      reject(error)
    }

    powershell.stdout.on('data', (data) => {
      stdoutChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)))
    })

    powershell.stderr.on('data', (data) => {
      stderrChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)))
    })

    powershell.on('error', (error) => {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        rejectOnce(
          createOcrBackendError(
            'windows',
            'backend_unavailable',
            'powershell.exe was not found on PATH, so Windows native OCR cannot run.',
          ),
        )
        return
      }

      rejectOnce(
        createOcrBackendError(
          'windows',
          'runtime_failed',
          `Failed to start Windows OCR process: ${error.message}`,
        ),
      )
    })

    powershell.on('close', (code) => {
      if (settled) {
        return
      }

      clearTimeout(timeout)
      const stdoutData = decodeOutput(stdoutChunks)
      const stderrData = decodeOutput(stderrChunks)

      try {
        const envelope = parseScriptOutput(stdoutData)
        resolveOnce(envelope)
      } catch (error) {
        if (code !== 0) {
          const errorDetail =
            stderrData.trim() || stdoutData.trim() || 'Unknown Windows OCR script error'
          rejectOnce(
            createOcrBackendError(
              'windows',
              'runtime_failed',
              `Windows native OCR failed with code ${code}: ${errorDetail}`,
            ),
          )
          return
        }

        if (error instanceof Error) {
          rejectOnce(error)
          return
        }

        rejectOnce(
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

export async function extractTextWindowsNative(filepath: string): Promise<string> {
  const envelope = await runWindowsOcrScript({ filepath })
  if (!envelope.ok) {
    throw toOcrError(envelope)
  }

  return envelope.text.trim()
}

export async function probeWindowsNativeOcrReadiness(): Promise<WindowsOcrReadiness> {
  try {
    const envelope = await runWindowsOcrScript({ probeOnly: true })
    if (envelope.ok) {
      return {
        ok: true,
        code: 'ready',
        message: 'Windows native OCR is ready.',
      }
    }

    return {
      ok: false,
      code: toReadinessCode(envelope.code),
      message: envelope.message,
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('[OCR:windows:backend_unavailable]')) {
      return {
        ok: false,
        code: 'backend_unavailable',
        message: error.message,
      }
    }

    return {
      ok: false,
      code: 'runtime_failed',
      message: error instanceof Error ? error.message : 'Windows native OCR probe failed.',
    }
  }
}
