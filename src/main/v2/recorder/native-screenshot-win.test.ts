import { describe, expect, it } from 'vitest'
import {
  resolveWindowsDisplayTargetFromScreen,
  type ElectronScreenLike,
} from './native-screenshot-win'

function createScreenStub(): ElectronScreenLike {
  const displays = [
    {
      id: 101,
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
    },
    {
      id: 202,
      bounds: { x: 1280, y: 0, width: 1920, height: 1080 },
    },
  ]

  return {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => displays[0],
    dipToScreenRect: (_window, rect) => ({
      x: rect.x * 2,
      y: rect.y * 2,
      width: rect.width * 2,
      height: rect.height * 2,
    }),
  }
}

describe('resolveWindowsDisplayTargetFromScreen', () => {
  it('resolves a requested Electron display id into physical bounds', () => {
    const target = resolveWindowsDisplayTargetFromScreen(createScreenStub(), 202)

    expect(target).toEqual({
      displayId: 202,
      displayBounds: {
        x: 2560,
        y: 0,
        width: 3840,
        height: 2160,
      },
    })
  })

  it('uses the primary display when asked to reset to main', () => {
    const target = resolveWindowsDisplayTargetFromScreen(createScreenStub(), null)

    expect(target).toEqual({
      displayId: 101,
      displayBounds: {
        x: 0,
        y: 0,
        width: 2560,
        height: 1440,
      },
    })
  })

  it('returns null when the display id does not exist', () => {
    expect(resolveWindowsDisplayTargetFromScreen(createScreenStub(), 999)).toBeNull()
  })
})
