import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/mock/userData' },
}))

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  promises: { unlink: vi.fn(() => Promise.resolve()) },
}))

const mockBackend = {
  captureScreen: vi.fn(),
  captureSampleBitmap: vi.fn(),
  captureWindow: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}

vi.mock('./capture-backend', () => ({
  createCaptureBackend: () => mockBackend,
}))

vi.mock('./visual-detector', () => ({
  startVisualDetection: vi.fn(),
  stopVisualDetection: vi.fn(),
  checkBitmapAgainstBaseline: vi.fn(),
  updateBaselineFromBitmap: vi.fn(),
}))

vi.mock('./interaction-monitor', () => ({
  startInteractionMonitoring: vi.fn(),
  stopInteractionMonitoring: vi.fn(),
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

describe('recorder', () => {
  let recorder: typeof import('./recorder')
  let visualDetector: typeof import('./visual-detector')
  let interactionMonitor: typeof import('./interaction-monitor')
  let fs: typeof import('fs')

  beforeEach(async () => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(1700000000000)

    recorder = await import('./recorder')
    visualDetector = await import('./visual-detector')
    interactionMonitor = await import('./interaction-monitor')
    fs = await import('fs')

    mockBackend.captureSampleBitmap.mockResolvedValue(Buffer.from([]))
  })

  afterEach(() => {
    // Reset module-level isCapturing state
    if (recorder.isCapturingNow()) {
      recorder.stopCapture()
    }
    vi.useRealTimers()
  })

  describe('captureImmediate', () => {
    it('calls backend.captureScreen and returns screenshot metadata', async () => {
      mockBackend.captureScreen.mockResolvedValue({
        width: 1920,
        height: 1080,
        displayId: 42,
      })

      const result = await recorder.captureImmediate('activity_start', 42)

      expect(mockBackend.captureScreen).toHaveBeenCalledWith(
        expect.stringMatching(/\/mock\/userData\/screenshots\/1700000000000_test-uuid-1234\.png$/),
        42,
      )

      expect(result).toEqual({
        id: 'test-uuid-1234',
        filepath: expect.stringContaining('1700000000000_test-uuid-1234.png'),
        timestamp: 1700000000000,
        trigger: 'activity_start',
        display: { id: 42, width: 1920, height: 1080 },
      })
    })

    it('creates screenshots directory if it does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      mockBackend.captureScreen.mockResolvedValue({ width: 100, height: 100, displayId: 0 })

      await recorder.captureImmediate('visual_change')

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('screenshots'), {
        recursive: true,
      })
    })
  })

  describe('captureIfVisualChange', () => {
    it('returns null when no visual change detected', async () => {
      vi.mocked(visualDetector.checkBitmapAgainstBaseline).mockReturnValue({
        changed: false,
        difference: 2.5,
      })

      const result = await recorder.captureIfVisualChange('visual_change')

      expect(mockBackend.captureSampleBitmap).toHaveBeenCalled()
      expect(mockBackend.captureScreen).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('captures and updates baseline when visual change detected', async () => {
      const sampleBitmap = Buffer.from([1, 2, 3, 4])
      mockBackend.captureSampleBitmap.mockResolvedValue(sampleBitmap)
      mockBackend.captureScreen.mockResolvedValue({ width: 1920, height: 1080, displayId: 0 })
      vi.mocked(visualDetector.checkBitmapAgainstBaseline).mockReturnValue({
        changed: true,
        difference: 15.0,
      })

      const result = await recorder.captureIfVisualChange('visual_change')

      expect(result).not.toBeNull()
      expect(result!.trigger).toBe('visual_change')
      expect(mockBackend.captureScreen).toHaveBeenCalled()
      expect(visualDetector.updateBaselineFromBitmap).toHaveBeenCalledWith(sampleBitmap)
    })
  })

  describe('captureWindowByTitle', () => {
    it('returns screenshot when window is found', async () => {
      mockBackend.captureWindow.mockResolvedValue({
        width: 1440,
        height: 900,
        displayId: 1,
      })

      const result = await recorder.captureWindowByTitle('Cursor', 'activity_end')

      expect(mockBackend.captureWindow).toHaveBeenCalledWith(
        'Cursor',
        expect.stringContaining('test-uuid-1234.png'),
      )
      expect(result).toEqual(
        expect.objectContaining({
          trigger: 'activity_end',
          display: { id: 1, width: 1440, height: 900 },
        }),
      )
    })

    it('returns null and cleans up when window not found', async () => {
      mockBackend.captureWindow.mockResolvedValue(null)

      const result = await recorder.captureWindowByTitle('NonExistent', 'activity_end')

      expect(result).toBeNull()
      expect(fs.promises.unlink).toHaveBeenCalledWith(expect.stringContaining('test-uuid-1234.png'))
    })
  })

  describe('startCapture / stopCapture', () => {
    it('starts backend, visual detector, and interaction monitor', () => {
      recorder.startCapture()

      expect(mockBackend.start).toHaveBeenCalled()
      expect(visualDetector.startVisualDetection).toHaveBeenCalled()
      expect(interactionMonitor.startInteractionMonitoring).toHaveBeenCalled()
      expect(recorder.isCapturingNow()).toBe(true)
    })

    it('stops backend, visual detector, and interaction monitor', () => {
      recorder.startCapture()
      recorder.stopCapture()

      expect(mockBackend.stop).toHaveBeenCalled()
      expect(visualDetector.stopVisualDetection).toHaveBeenCalled()
      expect(interactionMonitor.stopInteractionMonitoring).toHaveBeenCalled()
      expect(recorder.isCapturingNow()).toBe(false)
    })

    it('is idempotent — calling startCapture twice does not double-start', () => {
      recorder.startCapture()
      recorder.startCapture()

      expect(mockBackend.start).toHaveBeenCalledTimes(1)
    })

    it('is idempotent — calling stopCapture when not running is a no-op', () => {
      recorder.stopCapture()

      expect(mockBackend.stop).not.toHaveBeenCalled()
    })
  })
})
