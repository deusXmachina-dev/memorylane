import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SummaryModeTracker } from './summary-mode-tracker'
import type { SummaryOutcome } from '../semantic/summary-reason'

const outcome = (o: Partial<SummaryOutcome>): SummaryOutcome => ({
  mode: '',
  reason: '',
  failureDetail: '',
  ...o,
})

describe('SummaryModeTracker', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-mode-tracker-'))
    filePath = path.join(dir, 'summary-mode-stats.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('counts outcomes by mode and reason', () => {
    const tracker = new SummaryModeTracker(filePath)
    tracker.record(outcome({ mode: 'video', reason: 'video' }))
    tracker.record(outcome({ mode: 'snapshot', reason: 'video_timeout' }))
    tracker.record(outcome({ mode: 'snapshot', reason: 'video_timeout' }))

    const stats = tracker.getStats()
    expect(stats.total).toBe(3)
    expect(stats.byMode).toEqual({ video: 1, snapshot: 2 })
    expect(stats.byReason).toEqual({ video: 1, video_timeout: 2 })
  })

  it('keeps a sample failure detail per reason, skipping empty details', () => {
    const tracker = new SummaryModeTracker(filePath)
    tracker.record(outcome({ mode: 'video', reason: 'video' })) // no detail
    tracker.record(
      outcome({ mode: 'snapshot', reason: 'video_http_error', failureDetail: '404 Not Found' }),
    )
    tracker.record(
      outcome({ mode: 'snapshot', reason: 'video_http_error', failureDetail: '404 gone now' }),
    )

    const stats = tracker.getStats()
    expect(stats.lastDetailByReason).toEqual({ video_http_error: '404 gone now' })
    expect(stats.lastDetailByReason.video).toBeUndefined()
  })

  it('persists and reloads across instances', () => {
    const first = new SummaryModeTracker(filePath)
    first.record(outcome({ mode: 'snapshot', reason: 'video_timeout', failureDetail: 'timed out' }))

    const second = new SummaryModeTracker(filePath)
    const stats = second.getStats()
    expect(stats.total).toBe(1)
    expect(stats.byReason).toEqual({ video_timeout: 1 })
    expect(stats.lastDetailByReason).toEqual({ video_timeout: 'timed out' })
  })

  it('reset clears all counts', () => {
    const tracker = new SummaryModeTracker(filePath)
    tracker.record(outcome({ mode: 'video', reason: 'video' }))
    tracker.reset()
    expect(tracker.getStats()).toMatchObject({ total: 0, byMode: {}, byReason: {} })
  })
})
