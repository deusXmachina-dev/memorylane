import { describe, expect, it } from 'vitest'
import { activityToTimelineEntry, formatTimelineEntry, sampleEntries } from './formatting'

describe('mcp formatting', () => {
  it('includes window title in timeline entries', () => {
    const entry = activityToTimelineEntry({
      id: 'activity-1',
      startTimestamp: new Date('2026-03-02T10:00:00.000Z').getTime(),
      endTimestamp: new Date('2026-03-02T10:05:00.000Z').getTime(),
      appName: 'KeePassXC',
      windowTitle: 'Q - KeePassXC',
      identity: 'KeePassXC',
      summary: 'Looked up a credential entry.',
    })

    expect(entry.windowTitle).toBe('Q - KeePassXC')
    expect(formatTimelineEntry(entry)).toContain('[window: "Q - KeePassXC"]')
  })

  it('shows the identity as the app on timeline lines', () => {
    const entry = activityToTimelineEntry({
      id: 'activity-3',
      startTimestamp: new Date('2026-03-02T10:20:00.000Z').getTime(),
      endTimestamp: new Date('2026-03-02T10:25:00.000Z').getTime(),
      appName: 'Google Chrome',
      windowTitle: 'Stripe',
      identity: 'dashboard.stripe.com',
      summary: 'Checked a payment.',
    })

    expect(formatTimelineEntry(entry)).toContain('[dashboard.stripe.com]')
    expect(formatTimelineEntry(entry)).not.toContain('Google Chrome')
  })

  it('omits the window field when no title is available', () => {
    const formatted = formatTimelineEntry({
      id: 'activity-2',
      timestamp: new Date('2026-03-02T10:10:00.000Z').getTime(),
      app: 'Terminal',
      windowTitle: '',
      summary: 'Ran tests.',
    })

    expect(formatted).not.toContain('[window:')
  })

  it('returns one item for uniform sampling with limit=1', () => {
    const sampled = sampleEntries(['a', 'b', 'c'], 1, 'uniform')
    expect(sampled).toEqual(['a'])
  })
})
