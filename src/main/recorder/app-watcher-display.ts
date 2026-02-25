import { screen } from 'electron'
import { AppWatcherEvent } from './app-watcher'

export type AppWatcherDisplayResolutionSource =
  | 'event_display_id'
  | 'window_bounds'
  | 'cursor_fallback'

export interface AppWatcherDisplayResolution {
  readonly displayId: number
  readonly source: AppWatcherDisplayResolutionSource
}

function resolveFromWindowBounds(
  windowBounds: NonNullable<AppWatcherEvent['windowBounds']>,
): number | null {
  const rect = {
    x: windowBounds.x,
    y: windowBounds.y,
    width: windowBounds.width,
    height: windowBounds.height,
  }
  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }

  const display = (() => {
    if (process.platform === 'win32') {
      const dipRect = screen.screenToDipRect(null, rect)
      return screen.getDisplayMatching(dipRect)
    }
    return screen.getDisplayMatching(rect)
  })()

  if (display.id === undefined || display.id === null) {
    return null
  }
  return display.id
}

export function resolveAppWatcherDisplay(event: AppWatcherEvent): AppWatcherDisplayResolution {
  if (event.displayId !== undefined) {
    return { displayId: event.displayId, source: 'event_display_id' }
  }

  if (event.windowBounds) {
    try {
      const fromBounds = resolveFromWindowBounds(event.windowBounds)
      if (fromBounds !== null) {
        return { displayId: fromBounds, source: 'window_bounds' }
      }
    } catch {
      // fall through to cursor fallback
    }
  }

  const cursorPoint = screen.getCursorScreenPoint()
  const cursorDisplayId = screen.getDisplayNearestPoint(cursorPoint).id
  return { displayId: cursorDisplayId, source: 'cursor_fallback' }
}
