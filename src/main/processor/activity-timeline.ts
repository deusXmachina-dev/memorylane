import { Activity, InteractionContext } from '../../shared/types'

interface TimelineItem {
  timestamp: number
  text: string
  isClick?: boolean
  clickPosition?: { x: number; y: number }
}

/**
 * Build a chronological timeline interleaving screenshots and interactions.
 * Screenshots in the selected set are labeled [S1]–[SN] matching the attached images.
 * Adjacent clicks are aggregated to keep the timeline compact.
 */
export function buildChronologicalTimeline(
  activity: Activity,
  selectedScreenshotPaths: string[],
): string {
  const startTime = activity.startTimestamp
  const selectedPaths = new Set(selectedScreenshotPaths)

  const items: TimelineItem[] = []

  // Add selected screenshots
  let sIndex = 0
  for (const ss of activity.screenshots) {
    if (selectedPaths.has(ss.filepath)) {
      sIndex++
      const label =
        ss.trigger === 'activity_start'
          ? 'Activity started'
          : ss.trigger === 'activity_end'
            ? 'Activity ended'
            : 'Screen changed'
      items.push({ timestamp: ss.timestamp, text: `[S${sIndex}] ${label}` })
    }
  }

  // Add interactions (skip the first app_change — it's just the activity boundary trigger)
  for (let i = 0; i < activity.interactions.length; i++) {
    if (i === 0 && activity.interactions[i].type === 'app_change') continue
    const item = interactionToTimelineItem(activity.interactions[i])
    if (item) items.push(item)
  }

  // Sort chronologically
  items.sort((a, b) => a.timestamp - b.timestamp)

  // Aggregate adjacent clicks
  const merged = mergeAdjacentClicks(items)

  // Format with relative timestamps
  return merged
    .map((item) => {
      const relMs = item.timestamp - startTime
      return `${formatRelativeTime(relMs)} ${item.text}`
    })
    .join('\n')
}

/**
 * Convert a single interaction event into a timeline item.
 */
function interactionToTimelineItem(event: InteractionContext): TimelineItem | null {
  switch (event.type) {
    case 'click':
      return {
        timestamp: event.timestamp,
        text: 'Clicked',
        isClick: true,
        clickPosition: event.clickPosition,
      }
    case 'keyboard': {
      const keys = event.keyCount ?? 0
      const ctx = event.windowTitle ? ` in "${event.windowTitle}"` : ''
      return { timestamp: event.timestamp, text: `Typed ~${keys} keys${ctx}` }
    }
    case 'scroll':
      return {
        timestamp: event.timestamp,
        text: `Scrolled ${event.scrollDirection ?? 'vertically'}`,
      }
    case 'app_change':
      if (
        event.activeWindow?.title &&
        event.previousWindow?.title &&
        event.activeWindow.title !== event.previousWindow.title
      ) {
        return {
          timestamp: event.timestamp,
          text: `Window: "${event.previousWindow.title}" → "${event.activeWindow.title}"`,
        }
      }
      return null
    default:
      return null
  }
}

/**
 * Merge adjacent click items into "Clicked N times" to keep timelines compact.
 */
function mergeAdjacentClicks(items: TimelineItem[]): { timestamp: number; text: string }[] {
  const result: { timestamp: number; text: string }[] = []
  let clickRun = 0
  let clickTimestamp = 0
  let clickPositions: { x: number; y: number }[] = []

  const flushClicks = (): void => {
    if (clickRun === 0) return
    const posText = clickPositions.map((p) => `(${p.x},${p.y})`).join(', ')
    if (clickRun === 1) {
      result.push({
        timestamp: clickTimestamp,
        text: posText ? `Clicked at ${posText}` : 'Clicked',
      })
    } else {
      result.push({
        timestamp: clickTimestamp,
        text: posText ? `Clicked ${clickRun} times at ${posText}` : `Clicked ${clickRun} times`,
      })
    }
    clickRun = 0
    clickPositions = []
  }

  for (const item of items) {
    if (item.isClick) {
      if (clickRun === 0) clickTimestamp = item.timestamp
      clickRun++
      if (item.clickPosition) clickPositions.push(item.clickPosition)
    } else {
      flushClicks()
      result.push(item)
    }
  }

  flushClicks()
  return result
}

/**
 * Format milliseconds as relative time (M:SS).
 */
function formatRelativeTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
