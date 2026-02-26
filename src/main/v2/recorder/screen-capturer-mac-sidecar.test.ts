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
  pid: number
  killed: boolean
  kill: (signal?: NodeJS.Signals) => boolean
}

function createMockChildProcess(pid = 321): MockChildProcess {
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

describe('screen-capturer-mac-sidecar', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.MEMORYLANE_SCREENSHOT_CAPTURER_MAC_EXECUTABLE
  })

  afterEach(async () => {
    const mod = await import('./screen-capturer-mac-sidecar')
    const sidecar = new mod.MacScreenCapturerSidecar()
    sidecar.stop()
    vi.useRealTimers()
  })

  it('parses screenshot_saved events and forwards frame payloads', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(true)
    const child = createMockChildProcess()
    vi.mocked(childProcess.spawn).mockReturnValue(
      child as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const { MacScreenCapturerSidecar } = await import('./screen-capturer-mac-sidecar')
    const onFrame = vi.fn()
    const onError = vi.fn()
    const sidecar = new MacScreenCapturerSidecar()
    sidecar.start({
      outputDir: '/tmp/ml-sidecar-test',
      intervalMs: 1000,
      onFrame,
      onError,
    })

    child.stdout.write('{"type":"ready","timestamp":1}\n')
    child.stdout.write(
      '{"type":"screenshot_saved","timestamp":2,"displayId":77,"filepath":"/tmp/a.png","width":100,"height":200}\n',
    )
    await flushReadline()

    expect(onFrame).toHaveBeenCalledWith({
      timestamp: 2,
      displayId: 77,
      filepath: '/tmp/a.png',
      width: 100,
      height: 200,
    })
    expect(onError).not.toHaveBeenCalled()
    sidecar.stop()
  })

  it('restarts after unexpected exit', async () => {
    vi.useFakeTimers()
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(true)
    const firstChild = createMockChildProcess(111)
    const secondChild = createMockChildProcess(222)
    vi.mocked(childProcess.spawn)
      .mockReturnValueOnce(firstChild as unknown as ReturnType<typeof childProcess.spawn>)
      .mockReturnValueOnce(secondChild as unknown as ReturnType<typeof childProcess.spawn>)

    const { MacScreenCapturerSidecar } = await import('./screen-capturer-mac-sidecar')
    const sidecar = new MacScreenCapturerSidecar()
    sidecar.start({
      outputDir: '/tmp/ml-sidecar-test',
      intervalMs: 1000,
      onFrame: vi.fn(),
      onError: vi.fn(),
    })

    firstChild.emit('close', 1, null)
    await vi.advanceTimersByTimeAsync(1000)

    expect(childProcess.spawn).toHaveBeenCalledTimes(2)
    sidecar.stop()
  })

  it('emits startup error when executable cannot be resolved', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(childProcess.spawn).mockImplementation(() => {
      throw new Error('spawn should not be called when binary is missing')
    })

    const { MacScreenCapturerSidecar } = await import('./screen-capturer-mac-sidecar')
    const onError = vi.fn()
    const sidecar = new MacScreenCapturerSidecar()
    sidecar.start({
      outputDir: '/tmp/ml-sidecar-test',
      intervalMs: 1000,
      onFrame: vi.fn(),
      onError,
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toContain('mac screenshot sidecar binary not found')
    sidecar.stop()
  })
})
