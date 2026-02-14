import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { extractTextWindowsNative } from './ocr-windows-native'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

interface MockChildProcess extends EventEmitter {
  readonly stdout: EventEmitter
  readonly stderr: EventEmitter
}

function createMockChildProcess(): MockChildProcess {
  const processEmitter = new EventEmitter()
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()

  Reflect.set(processEmitter, 'stdout', stdout)
  Reflect.set(processEmitter, 'stderr', stderr)

  return processEmitter as MockChildProcess
}

describe('extractTextWindowsNative', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns parsed OCR text when script succeeds', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    const mockChild = createMockChildProcess()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const promise = extractTextWindowsNative('C:\\tmp\\shot.png')

    mockChild.stdout.emit('data', '{"text":"Hello from OCR"}')
    mockChild.emit('close', 0)

    await expect(promise).resolves.toBe('Hello from OCR')
  })

  it('fails when script returns invalid JSON', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    const mockChild = createMockChildProcess()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const promise = extractTextWindowsNative('C:\\tmp\\shot.png')

    mockChild.stdout.emit('data', 'not-json')
    mockChild.emit('close', 0)

    await expect(promise).rejects.toThrow('[OCR:windows:runtime_failed]')
  })

  it('fails when script exits with non-zero status', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    const mockChild = createMockChildProcess()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const promise = extractTextWindowsNative('C:\\tmp\\shot.png')

    mockChild.stderr.emit('data', 'WinRT OCR failed')
    mockChild.emit('close', 1)

    await expect(promise).rejects.toThrow('Windows native OCR failed with code 1')
  })

  it('fails fast when OCR script is unavailable', async () => {
    const fs = await import('fs')
    vi.mocked(fs.existsSync).mockReturnValue(false)

    await expect(extractTextWindowsNative('C:\\tmp\\shot.png')).rejects.toThrow(
      '[OCR:windows:backend_unavailable]',
    )
  })
})
