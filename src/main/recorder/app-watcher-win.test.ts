import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
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
vi.mock('../logger', () => ({
  default: mockLogger,
}))

interface MockChildProcess extends EventEmitter {
  stdout: PassThrough
  stderr: PassThrough
  pid: number
  killed: boolean
  kill: (signal?: NodeJS.Signals) => boolean
}

function createMockChildProcess(pid = 999): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.pid = pid
  child.killed = false
  child.kill = vi.fn().mockImplementation(() => {
    child.killed = true
    return true
  })
  return child
}

async function flushReadline(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('app-watcher-win backend', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.MEMORYLANE_APP_WATCHER_WIN_EXECUTABLE
  })

  afterEach(async () => {
    const mod = await import('./app-watcher-win')
    mod.stopAppWatcherWin()
    vi.useRealTimers()
  })

  it('parses JSON lines and forwards watcher events', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(true)
    const child = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const mod = await import('./app-watcher-win')
    const callback = vi.fn()
    mod.startAppWatcherWin(callback)

    child.stdout.write('{"type":"ready","timestamp":1}\n')
    child.stdout.write(
      '{"type":"app_change","timestamp":2,"app":"Code","pid":101,"title":"index.ts"}\n',
    )
    await flushReadline()

    expect(callback).toHaveBeenNthCalledWith(1, { type: 'ready', timestamp: 1 })
    expect(callback).toHaveBeenNthCalledWith(2, {
      type: 'app_change',
      timestamp: 2,
      app: 'Code',
      pid: 101,
      title: 'index.ts',
    })
  })

  it('logs malformed lines and continues', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(true)
    const child = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const mod = await import('./app-watcher-win')
    const callback = vi.fn()
    mod.startAppWatcherWin(callback)

    child.stdout.write('not-json\n')
    child.stdout.write('{"type":"ready","timestamp":3}\n')
    await flushReadline()

    expect(mockLogger.warn).toHaveBeenCalledWith('[AppWatcher:win] Could not parse line: not-json')
    expect(callback).toHaveBeenCalledWith({ type: 'ready', timestamp: 3 })
  })

  it('restarts watcher with backoff after unexpected exit', async () => {
    vi.useFakeTimers()
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(true)
    const firstChild = createMockChildProcess(111)
    const secondChild = createMockChildProcess(222)
    vi.mocked(childProcess.spawn)
      .mockReturnValueOnce(firstChild as unknown as ReturnType<typeof childProcess.spawn>)
      .mockReturnValueOnce(secondChild as unknown as ReturnType<typeof childProcess.spawn>)

    const mod = await import('./app-watcher-win')
    mod.startAppWatcherWin(vi.fn())

    firstChild.emit('close', 1, null)
    await vi.advanceTimersByTimeAsync(1000)

    expect(childProcess.spawn).toHaveBeenCalledTimes(2)
    mod.stopAppWatcherWin()
  })

  it('logs callback errors separately from JSON parse errors', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(true)
    const child = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const mod = await import('./app-watcher-win')
    mod.startAppWatcherWin(() => {
      throw new Error('callback exploded')
    })

    child.stdout.write('{"type":"app_change","timestamp":7,"app":"Code"}\n')
    await flushReadline()

    expect(mockLogger.error).toHaveBeenCalledWith(
      '[AppWatcher:win] Event callback failed: callback exploded',
    )
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('[AppWatcher:win] Could not parse line:'),
    )
  })

  it('emits error event when executable cannot be resolved', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(childProcess.spawn).mockImplementation(() => {
      throw new Error('spawn should not be called when binary is missing')
    })

    const mod = await import('./app-watcher-win')
    const callback = vi.fn()
    mod.startAppWatcherWin(callback)

    expect(callback).toHaveBeenCalledTimes(1)
    const event = callback.mock.calls[0][0]
    expect(event.type).toBe('error')
    expect(event.error).toContain('Windows app watcher binary not found')
  })
})
