import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { extractTextWindowsNative, probeWindowsNativeOcrReadiness } from './ocr-windows-native'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

interface MockChildProcess extends EventEmitter {
  readonly stdout: EventEmitter
  readonly stderr: EventEmitter
  readonly kill: ReturnType<typeof vi.fn>
}

function createMockChildProcess(): MockChildProcess {
  const processEmitter = new EventEmitter()
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const kill = vi.fn()

  Reflect.set(processEmitter, 'stdout', stdout)
  Reflect.set(processEmitter, 'stderr', stderr)
  Reflect.set(processEmitter, 'kill', kill)

  return processEmitter as MockChildProcess
}

describe('extractTextWindowsNative', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useRealTimers()
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

    mockChild.stdout.emit('data', '{"ok":true,"text":"Hello from OCR"}')
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

  it('parses JSON payload even when extra log lines are present', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    const mockChild = createMockChildProcess()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const promise = extractTextWindowsNative('C:\\tmp\\shot.png')

    mockChild.stdout.emit('data', 'Some preface log line\r\n')
    mockChild.stdout.emit('data', '{"ok":true,"text":"Recovered OCR text"}\r\n')
    mockChild.emit('close', 0)

    await expect(promise).resolves.toBe('Recovered OCR text')
  })

  it('decodes UTF-16 output from powershell', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    const mockChild = createMockChildProcess()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const promise = extractTextWindowsNative('C:\\tmp\\shot.png')

    const utf16Json = Buffer.from('\uFEFF{"ok":true,"text":"UTF16 OCR text"}', 'utf16le')
    mockChild.stdout.emit('data', utf16Json)
    mockChild.emit('close', 0)

    await expect(promise).resolves.toBe('UTF16 OCR text')
  })

  it('maps OCR engine unavailable to not_ready', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    const mockChild = createMockChildProcess()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const promise = extractTextWindowsNative('C:\\tmp\\shot.png')

    mockChild.stdout.emit(
      'data',
      JSON.stringify({
        ok: false,
        code: 'ocr_engine_unavailable',
        message: 'Windows OCR engine is unavailable for the current user profile languages.',
      }),
    )
    mockChild.emit('close', 1)

    await expect(promise).rejects.toThrow('[OCR:windows:not_ready]')
  })

  it('maps image decode failures from the script', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    const mockChild = createMockChildProcess()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const promise = extractTextWindowsNative('C:\\tmp\\shot.png')

    mockChild.stdout.emit(
      'data',
      JSON.stringify({
        ok: false,
        code: 'image_decode_failed',
        message: 'Windows OCR failed to open or decode the image.',
        details: 'Unsupported image format.',
      }),
    )
    mockChild.emit('close', 1)

    await expect(promise).rejects.toThrow('[OCR:windows:image_decode_failed]')
  })

  it('fails when script exits with non-zero status and no JSON envelope', async () => {
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

  it('times out and kills the powershell process', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    vi.useFakeTimers()

    const mockChild = createMockChildProcess()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const promise = extractTextWindowsNative('C:\\tmp\\shot.png')
    const expectation = expect(promise).rejects.toThrow('[OCR:windows:timeout]')

    await vi.advanceTimersByTimeAsync(15_000)

    await expectation
    expect(mockChild.kill).toHaveBeenCalledOnce()
  })
})

describe('probeWindowsNativeOcrReadiness', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns ready when the probe succeeds', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    const mockChild = createMockChildProcess()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const promise = probeWindowsNativeOcrReadiness()

    mockChild.stdout.emit(
      'data',
      JSON.stringify({
        ok: true,
        text: '',
        diagnostics: { engine: 'windows.media.ocr', languageTag: 'en-US' },
      }),
    )
    mockChild.emit('close', 0)

    await expect(promise).resolves.toEqual({
      ok: true,
      code: 'ready',
      message: 'Windows native OCR is ready.',
    })

    expect(childProcess.spawn).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-ProbeOnly']),
      expect.objectContaining({ windowsHide: true }),
    )
  })

  it('returns not_ready when the OCR engine is unavailable', async () => {
    const fs = await import('fs')
    const childProcess = await import('child_process')

    const mockChild = createMockChildProcess()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(childProcess.spawn).mockReturnValue(
      mockChild as unknown as ReturnType<typeof childProcess.spawn>,
    )

    const promise = probeWindowsNativeOcrReadiness()

    mockChild.stdout.emit(
      'data',
      JSON.stringify({
        ok: false,
        code: 'ocr_engine_unavailable',
        message: 'Windows OCR engine is unavailable for the current user profile languages.',
      }),
    )
    mockChild.emit('close', 1)

    await expect(promise).resolves.toEqual({
      ok: false,
      code: 'not_ready',
      message: 'Windows OCR engine is unavailable for the current user profile languages.',
    })
  })
})
