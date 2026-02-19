import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as readline from 'readline'
import log from '../logger'

export interface NativeScreenshotResult {
  width: number
  height: number
  elapsed_ms: number
  path: string
}

interface ScreenshotExecutable {
  readonly command: string
  readonly args: readonly string[]
}

/**
 * Resolves the screenshot executable.
 * Production: pre-compiled binary from app resources.
 * Development: interprets the Swift script via `swift` command.
 */
export function getExecutable(): ScreenshotExecutable {
  let isPackaged = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    isPackaged = require('electron').app.isPackaged
  } catch {
    // Running under ELECTRON_RUN_AS_NODE — treat as dev
  }

  if (isPackaged) {
    const binaryPath = path.join(process.resourcesPath, 'swift', 'screenshot')
    if (fs.existsSync(binaryPath)) {
      return { command: binaryPath, args: [] }
    }
    throw new Error(`Screenshot binary not found at ${binaryPath}`)
  }

  // Dev: try compiled binary first, fall back to swift interpreter
  const compiledPath = path.resolve(process.cwd(), 'build', 'swift', 'screenshot')
  if (fs.existsSync(compiledPath)) {
    return { command: compiledPath, args: [] }
  }

  const scriptPath = path.resolve(
    process.cwd(),
    'src',
    'main',
    'recorder',
    'swift',
    'screenshot.swift',
  )
  if (fs.existsSync(scriptPath)) {
    return { command: 'swift', args: [scriptPath] }
  }

  throw new Error(`Screenshot script not found at ${scriptPath}`)
}

/**
 * Capture a single screenshot using the native Swift binary.
 */
export async function captureNative(
  outputPath: string,
  options?: { format?: 'png' | 'jpg'; displayId?: number },
): Promise<NativeScreenshotResult> {
  const { command, args } = getExecutable()
  const execArgs = [...args, outputPath]

  if (options?.format) {
    execArgs.push('--format', options.format)
  }
  if (options?.displayId !== undefined) {
    execArgs.push('--display', String(options.displayId))
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, execArgs)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Screenshot process failed (code ${code}): ${stderr.trim()}`))
      }
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch {
        reject(new Error(`Failed to parse screenshot result: ${stdout.trim()}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn screenshot process: ${err.message}`))
    })
  })
}

/**
 * A streaming screenshot session. Keeps the Swift binary alive and sends
 * capture requests via stdin, receiving JSON results on stdout.
 * Much more efficient for rapid/repeated captures.
 */
export class ScreenshotStream {
  private proc: ChildProcess | null = null
  private rl: readline.Interface | null = null
  private pending: Array<{
    resolve: (result: NativeScreenshotResult) => void
    reject: (err: Error) => void
  }> = []

  constructor(private options?: { format?: 'png' | 'jpg'; displayId?: number }) {}

  start(): void {
    if (this.proc) return

    const { command, args } = getExecutable()
    const execArgs = [...args, '--stream']

    if (this.options?.format) {
      execArgs.push('--format', this.options.format)
    }
    if (this.options?.displayId !== undefined) {
      execArgs.push('--display', String(this.options.displayId))
    }

    this.proc = spawn(command, execArgs)
    log.info(`[ScreenshotNative] Stream started (pid=${this.proc.pid})`)

    this.rl = readline.createInterface({ input: this.proc.stdout! })
    this.rl.on('line', (line) => {
      const waiter = this.pending.shift()
      if (!waiter) return
      try {
        const result = JSON.parse(line)
        if (result.error) {
          waiter.reject(new Error(result.error))
        } else {
          waiter.resolve(result)
        }
      } catch {
        waiter.reject(new Error(`Failed to parse: ${line}`))
      }
    })

    this.proc.on('close', (code) => {
      log.info(`[ScreenshotNative] Stream closed (code=${code})`)
      for (const waiter of this.pending) {
        waiter.reject(new Error('Screenshot stream closed'))
      }
      this.pending = []
      this.proc = null
      this.rl = null
    })
  }

  capture(outputPath: string): Promise<NativeScreenshotResult> {
    if (!this.proc || !this.proc.stdin) {
      return Promise.reject(new Error('Screenshot stream not started'))
    }

    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      this.proc!.stdin!.write(outputPath + '\n')
    })
  }

  stop(): void {
    if (this.proc) {
      this.proc.stdin?.end()
      this.proc = null
    }
  }

  get pid(): number | undefined {
    return this.proc?.pid
  }
}
