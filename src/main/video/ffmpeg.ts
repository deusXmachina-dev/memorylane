import { spawn } from 'child_process'
import * as fs from 'fs'

const FFMPEG_EXECUTABLE_ENV = 'MEMORYLANE_FFMPEG_EXECUTABLE'

function isPathInsideAsarArchive(filepath: string): boolean {
  return /\.asar([/\\])/.test(filepath)
}

function resolveAsarUnpackedPath(filepath: string): string {
  return filepath.replace(/\.asar([/\\])/, '.asar.unpacked$1')
}

function resolveExecutablePath(filepath: string, source: string): string {
  const unpackedPath = resolveAsarUnpackedPath(filepath)

  if (unpackedPath !== filepath && fs.existsSync(unpackedPath)) {
    return unpackedPath
  }

  if (isPathInsideAsarArchive(filepath)) {
    throw new Error(
      `${source} resolved inside app.asar, but unpacked binary was not found: ${unpackedPath}`,
    )
  }

  if (!fs.existsSync(filepath)) {
    throw new Error(`${source} executable not found: ${filepath}`)
  }

  return filepath
}

function resolveFfmpegStaticPath(): string {
  let resolvedPath: string | null = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolvedPath = require('ffmpeg-static') as string | null
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to resolve ffmpeg-static module: ${detail}`)
  }

  if (!resolvedPath) {
    throw new Error('ffmpeg-static did not provide a binary for this platform')
  }

  return resolveExecutablePath(resolvedPath, 'ffmpeg-static')
}

export function resolveFfmpegExecutable(): string {
  const overridePath = process.env[FFMPEG_EXECUTABLE_ENV]
  if (overridePath && overridePath.length > 0) {
    if (!fs.existsSync(overridePath) && resolveAsarUnpackedPath(overridePath) === overridePath) {
      throw new Error(`ffmpeg executable override does not exist: ${overridePath}`)
    }
    return resolveExecutablePath(overridePath, 'ffmpeg executable override')
  }

  return resolveFfmpegStaticPath()
}

export function runFfmpeg(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let settled = false
    let stderr = ''

    const settleReject = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    proc.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        settleReject(new Error(`ffmpeg executable not found: ${command}`))
        return
      }
      settleReject(new Error(`Failed to spawn ffmpeg (${command}): ${error.message}`))
    })

    proc.on('close', (code) => {
      if (settled) return
      settled = true

      if (code === 0) {
        resolve()
        return
      }

      const details = stderr.trim()
      if (details.length > 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${details}`))
        return
      }

      reject(new Error(`ffmpeg exited with code ${code}`))
    })
  })
}
