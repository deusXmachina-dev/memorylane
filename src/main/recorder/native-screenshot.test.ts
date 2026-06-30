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

interface MockChildProcess extends EventEmitter {
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
    vi.mocked(childProcess.spawn)
      .mockReturnValueOnce(firstChild as unknown as ReturnType<typeof childProcess.spawn>)
      .mockReturnValueOnce(secondChild as unknown as ReturnType<typeof childProcess.spawn>)

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

    await daemon.stop()
  })
})
