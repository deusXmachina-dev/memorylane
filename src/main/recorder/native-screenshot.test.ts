import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

vi.mock('@main/utils/logger', () => ({
  default: mockLogger,
}))

type MockChildProcess = ChildProcess & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  pid: number
  kill: (signal?: NodeJS.Signals) => boolean
}

function createMockChildProcess(pid: number): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.pid = pid
  Object.assign(child, { exitCode: null, signalCode: null })
  child.kill = vi.fn().mockReturnValue(true)
  return child
}

describe('ScreenshotDaemon', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exports ScreenshotDaemon class', async () => {
    const { ScreenshotDaemon } = await import('./native-screenshot')

    expect(ScreenshotDaemon).toBeDefined()
    expect(typeof ScreenshotDaemon).toBe('function')
  })

  it('send is a no-op before start', async () => {
    const { ScreenshotDaemon } = await import('./native-screenshot')
    const daemon = new ScreenshotDaemon()

    daemon.send({ displayId: 1 })

    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[ScreenshotDaemon] Cannot send command: daemon not running',
    )
  })

  it('restarts only once when a child emits both error and close', async () => {
    vi.useFakeTimers()
    const childProcess = await import('child_process')
    const { ScreenshotDaemon } = await import('./native-screenshot')

    const firstChild = createMockChildProcess(101)
    const secondChild = createMockChildProcess(202)
    vi.mocked(childProcess.spawn).mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild)

    const daemon = new ScreenshotDaemon({
      getExecutable: () => ({ command: '/tmp/screenshot', args: [] }),
      buildSpawnArgs: () => [],
      buildCommandPayload: (command) => command,
    })

    await daemon.start({
      outputDir: '/tmp/memorylane-test',
      onFrame: vi.fn(),
    })

    firstChild.emit('error', new Error('boom'))
    firstChild.emit('close', 1)

    await vi.advanceTimersByTimeAsync(1_000)

    expect(childProcess.spawn).toHaveBeenCalledTimes(2)

    const stopped = daemon.stop()
    await vi.advanceTimersByTimeAsync(2_000)
    await stopped
  })

  it('stop closes stdin and waits for a clean exit without signalling', async () => {
    const childProcess = await import('child_process')
    const { ScreenshotDaemon } = await import('./native-screenshot')

    const child = createMockChildProcess(404)
    vi.mocked(childProcess.spawn).mockReturnValue(child)
    child.stdin.on('finish', () => {
      child.emit('exit', 0)
      child.emit('close', 0)
    })

    const daemon = new ScreenshotDaemon({
      getExecutable: () => ({ command: '/tmp/screenshot', args: [] }),
      buildSpawnArgs: () => [],
      buildCommandPayload: (command) => command,
    })
    await daemon.start({ outputDir: '/tmp/memorylane-test', onFrame: vi.fn() })

    await daemon.stop()

    expect(child.kill).not.toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalledWith('[ScreenshotDaemon] Process exited with code 0')
    expect(childProcess.spawn).toHaveBeenCalledTimes(1)
  })

  it('stop falls back to SIGTERM, then SIGKILL, when the daemon ignores stdin EOF', async () => {
    vi.useFakeTimers()
    const childProcess = await import('child_process')
    const { ScreenshotDaemon } = await import('./native-screenshot')

    const child = createMockChildProcess(505)
    vi.mocked(childProcess.spawn).mockReturnValue(child)

    const daemon = new ScreenshotDaemon({
      getExecutable: () => ({ command: '/tmp/screenshot', args: [] }),
      buildSpawnArgs: () => [],
      buildCommandPayload: (command) => command,
    })
    await daemon.start({ outputDir: '/tmp/memorylane-test', onFrame: vi.fn() })

    const stopped = daemon.stop()
    await vi.advanceTimersByTimeAsync(999)
    expect(child.kill).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    await stopped
    expect(childProcess.spawn).toHaveBeenCalledTimes(1)
  })

  it('stop resolves as soon as the daemon exits after SIGTERM', async () => {
    vi.useFakeTimers()
    const childProcess = await import('child_process')
    const { ScreenshotDaemon } = await import('./native-screenshot')

    const child = createMockChildProcess(606)
    vi.mocked(childProcess.spawn).mockReturnValue(child)
    vi.mocked(child.kill).mockImplementation(() => {
      child.emit('exit', null)
      return true
    })

    const daemon = new ScreenshotDaemon({
      getExecutable: () => ({ command: '/tmp/screenshot', args: [] }),
      buildSpawnArgs: () => [],
      buildCommandPayload: (command) => command,
    })
    await daemon.start({ outputDir: '/tmp/memorylane-test', onFrame: vi.fn() })

    const stopped = daemon.stop()
    await vi.advanceTimersByTimeAsync(1_000)
    await stopped

    expect(child.kill).toHaveBeenCalledTimes(1)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('concurrent stops share one shutdown and start waits for it', async () => {
    vi.useFakeTimers()
    const childProcess = await import('child_process')
    const { ScreenshotDaemon } = await import('./native-screenshot')

    const firstChild = createMockChildProcess(707)
    const secondChild = createMockChildProcess(808)
    vi.mocked(childProcess.spawn).mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild)

    const daemon = new ScreenshotDaemon({
      getExecutable: () => ({ command: '/tmp/screenshot', args: [] }),
      buildSpawnArgs: () => [],
      buildCommandPayload: (command) => command,
    })
    await daemon.start({ outputDir: '/tmp/memorylane-test', onFrame: vi.fn() })

    let secondStopDone = false
    const firstStop = daemon.stop()
    const secondStop = daemon.stop().then(() => {
      secondStopDone = true
    })
    const restarted = daemon.start({ outputDir: '/tmp/memorylane-test', onFrame: vi.fn() })

    await vi.advanceTimersByTimeAsync(500)
    expect(secondStopDone).toBe(false)
    expect(childProcess.spawn).toHaveBeenCalledTimes(1)

    firstChild.emit('exit', 0)
    await Promise.all([firstStop, secondStop, restarted])
    expect(childProcess.spawn).toHaveBeenCalledTimes(2)

    const stopped = daemon.stop()
    await vi.advanceTimersByTimeAsync(2_000)
    await stopped
  })

  it('survives a stdin write that fails after the daemon dies', async () => {
    const childProcess = await import('child_process')
    const { ScreenshotDaemon } = await import('./native-screenshot')

    const child = createMockChildProcess(303)
    vi.mocked(childProcess.spawn).mockReturnValue(child)

    const daemon = new ScreenshotDaemon({
      getExecutable: () => ({ command: '/tmp/screenshot', args: [] }),
      buildSpawnArgs: () => [],
      buildCommandPayload: (command) => command,
    })

    await daemon.start({
      outputDir: '/tmp/memorylane-test',
      onFrame: vi.fn(),
    })

    // A display change queues a write while the daemon is still alive...
    daemon.send({ displayId: 2 })

    // ...the daemon is then killed, and the queued write flushes into a dead pipe.
    // An unhandled 'error' here is what took down the main process.
    expect(() => child.stdin.emit('error', new Error('write EPIPE'))).not.toThrow()

    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[ScreenshotDaemon] stdin write failed: write EPIPE',
    )

    await daemon.stop()
  })
})
