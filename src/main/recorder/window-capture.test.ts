import { describe, it, expect } from 'vitest'
import {
  captureWindow,
  findMatchingSource,
  WindowSource,
  GetWindowSourcesFn,
} from './window-capture'

/** Create a mock WindowSource with the given name and optional dimensions. */
function mockSource(name: string, id: string, width = 100, height = 100): WindowSource {
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes
  return {
    id,
    name,
    thumbnail: {
      getSize: () => ({ width, height }),
      toPNG: () => pngBuffer,
    },
  }
}

/** Create a mock getSources function that returns the given sources. */
function mockGetSources(sources: WindowSource[]): GetWindowSourcesFn {
  return async () => sources
}

// ---------------------------------------------------------------------------
// findMatchingSource (pure matching logic)
// ---------------------------------------------------------------------------

describe('findMatchingSource', () => {
  const sources = [
    mockSource('VS Code - window-capture.ts', 'window:1:0'),
    mockSource('Google Chrome - GitHub', 'window:2:0'),
    mockSource('Terminal', 'window:3:0'),
  ]

  it('returns the first source when no title is given', () => {
    const result = findMatchingSource(sources)
    expect(result).toBe(sources[0])
  })

  it('matches by case-insensitive substring', () => {
    expect(findMatchingSource(sources, 'chrome')?.id).toBe('window:2:0')
    expect(findMatchingSource(sources, 'TERMINAL')?.id).toBe('window:3:0')
    expect(findMatchingSource(sources, 'vs code')?.id).toBe('window:1:0')
  })

  it('returns null when title does not match', () => {
    expect(findMatchingSource(sources, 'Firefox')).toBeNull()
  })

  it('returns null for an empty source list', () => {
    expect(findMatchingSource([])).toBeNull()
    expect(findMatchingSource([], 'anything')).toBeNull()
  })

  it('returns the first match when multiple windows match', () => {
    const dupes = [
      mockSource('Chrome - Tab 1', 'window:1:0'),
      mockSource('Chrome - Tab 2', 'window:2:0'),
    ]
    expect(findMatchingSource(dupes, 'Chrome')?.id).toBe('window:1:0')
  })
})

// ---------------------------------------------------------------------------
// captureWindow (integration with getSources)
// ---------------------------------------------------------------------------

describe('captureWindow', () => {
  it('captures the frontmost window when no title is provided', async () => {
    const sources = [
      mockSource('My Editor - file.ts', 'window:1:0', 1920, 1080),
      mockSource('Terminal', 'window:2:0'),
    ]

    const result = await captureWindow({}, mockGetSources(sources))

    expect(result).not.toBeNull()
    expect(result!.title).toBe('My Editor - file.ts')
    expect(result!.sourceId).toBe('window:1:0')
    expect(result!.width).toBe(1920)
    expect(result!.height).toBe(1080)
    expect(result!.image).toBeInstanceOf(Buffer)
    expect(result!.image.length).toBeGreaterThan(0)
  })

  it('captures a window matching the given title', async () => {
    const sources = [
      mockSource('My Editor - file.ts', 'window:1:0'),
      mockSource('Google Chrome - GitHub', 'window:2:0', 2560, 1440),
      mockSource('Terminal', 'window:3:0'),
    ]

    const result = await captureWindow({ title: 'github' }, mockGetSources(sources))

    expect(result).not.toBeNull()
    expect(result!.title).toBe('Google Chrome - GitHub')
    expect(result!.sourceId).toBe('window:2:0')
    expect(result!.width).toBe(2560)
    expect(result!.height).toBe(1440)
  })

  it('returns null when no windows are available', async () => {
    const result = await captureWindow({}, mockGetSources([]))
    expect(result).toBeNull()
  })

  it('returns null when title does not match any window', async () => {
    const sources = [mockSource('Terminal', 'window:1:0')]
    const result = await captureWindow({ title: 'nonexistent' }, mockGetSources(sources))
    expect(result).toBeNull()
  })

  it('passes the correct thumbnailSize to getSources', async () => {
    const customSize = { width: 640, height: 480 }
    let receivedOpts: { types: string[]; thumbnailSize: { width: number; height: number } } | null =
      null

    const spyGetSources: GetWindowSourcesFn = async (opts) => {
      receivedOpts = opts
      return [mockSource('Test', 'window:1:0')]
    }

    await captureWindow({ thumbnailSize: customSize }, spyGetSources)

    expect(receivedOpts).not.toBeNull()
    expect(receivedOpts!.types).toEqual(['window'])
    expect(receivedOpts!.thumbnailSize).toEqual(customSize)
  })

  it('uses default thumbnailSize (3840x2160) when not specified', async () => {
    let receivedOpts: { types: string[]; thumbnailSize: { width: number; height: number } } | null =
      null

    const spyGetSources: GetWindowSourcesFn = async (opts) => {
      receivedOpts = opts
      return [mockSource('Test', 'window:1:0')]
    }

    await captureWindow({}, spyGetSources)

    expect(receivedOpts!.thumbnailSize).toEqual({ width: 3840, height: 2160 })
  })
})
