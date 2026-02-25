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

vi.mock('../../logger', () => ({
  default: mockLogger,
}))

interface MockChildProcess extends EventEmitter {
  stdout: PassThrough
  stderr: PassThrough
  stdin: PassThrough
  pid: number
  killed: boolean
  kill: (signal?: NodeJS.Signals) => boolean
}

function createMockChildProcess(pid = 1001): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
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

function parseJsonLines(buffered: string[]): Record<string, unknown>[] {
  return buffered
    .join('')
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('screen-capturer-win backend', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.MEMORYLANE_SCREENSHOT_WIN_EXECUTABLE
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('forwards frame events after ready handshake', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(true)
    const child = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const bufferedWrites: string[] = []
    child.stdin.on('data', (chunk) => bufferedWrites.push(chunk.toString()))

    const { createScreenCapturerWin } = await import('./screen-capturer-win')
    const onFrame = vi.fn()
    const onError = vi.fn()
    const backend = createScreenCapturerWin({ onFrame, onError })

    backend.start({
      outputDir: 'C:\\tmp\\captures',
      intervalMs: 1000,
      maxDimensionPx: 1200,
      displayId: 7,
    })

    child.stdout.write('{"type":"ready","timestamp":1}\n')
    child.stdout.write(
      '{"type":"frame","timestamp":2,"filepath":"C:\\\\tmp\\\\captures\\\\frame-0.png","width":1600,"height":900,"displayId":7}\n',
    )
    await flushReadline()

    const commands = parseJsonLines(bufferedWrites)
    expect(commands[0]).toMatchObject({
      type: 'start',
      outputDir: 'C:\\tmp\\captures',
      intervalMs: 1000,
      maxDimensionPx: 1200,
      displayId: 7,
    })
    expect(onFrame).toHaveBeenCalledWith({
      type: 'frame',
      timestamp: 2,
      filepath: 'C:\\tmp\\captures\\frame-0.png',
      width: 1600,
      height: 900,
      displayId: 7,
    })
    expect(onError).not.toHaveBeenCalled()
    backend.stop()
  })

  it('sends display update command when display target changes', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(true)
    const child = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const bufferedWrites: string[] = []
    child.stdin.on('data', (chunk) => bufferedWrites.push(chunk.toString()))

    const { createScreenCapturerWin } = await import('./screen-capturer-win')
    const backend = createScreenCapturerWin({
      onFrame: vi.fn(),
      onError: vi.fn(),
    })

    backend.start({
      outputDir: 'C:\\tmp\\captures',
      intervalMs: 1000,
    })
    child.stdout.write('{"type":"ready","timestamp":1}\n')
    await flushReadline()
    bufferedWrites.length = 0

    backend.setDisplayId(11)
    await flushReadline()

    const commands = parseJsonLines(bufferedWrites)
    expect(commands[0]).toMatchObject({
      type: 'set_display',
      displayId: 11,
    })
    backend.stop()
  })

  it('restarts sidecar after unexpected exit', async () => {
    vi.useFakeTimers()
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(true)
    const firstChild = createMockChildProcess(101)
    const secondChild = createMockChildProcess(202)
    vi.mocked(childProcess.spawn)
      .mockReturnValueOnce(firstChild as unknown as ReturnType<typeof childProcess.spawn>)
      .mockReturnValueOnce(secondChild as unknown as ReturnType<typeof childProcess.spawn>)

    const { createScreenCapturerWin } = await import('./screen-capturer-win')
    const backend = createScreenCapturerWin({
      onFrame: vi.fn(),
      onError: vi.fn(),
    })
    backend.start({
      outputDir: 'C:\\tmp\\captures',
      intervalMs: 1000,
    })

    firstChild.emit('close', 1, null)
    await vi.advanceTimersByTimeAsync(1000)

    expect(childProcess.spawn).toHaveBeenCalledTimes(2)
    backend.stop()
  })

  it('logs malformed lines and keeps processing', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(true)
    const child = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const { createScreenCapturerWin } = await import('./screen-capturer-win')
    const onFrame = vi.fn()
    const backend = createScreenCapturerWin({
      onFrame,
      onError: vi.fn(),
    })
    backend.start({
      outputDir: 'C:\\tmp\\captures',
      intervalMs: 1000,
    })

    child.stdout.write('not-json\n')
    child.stdout.write(
      '{"type":"frame","timestamp":5,"filepath":"C:\\\\tmp\\\\captures\\\\frame-1.png","width":400,"height":300,"displayId":1}\n',
    )
    await flushReadline()

    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[ScreenCapturer:win] Could not parse line: not-json',
    )
    expect(onFrame).toHaveBeenCalledTimes(1)
    backend.stop()
  })
})
