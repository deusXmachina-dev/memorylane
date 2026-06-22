import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { SummaryOutcome } from '../semantic/summary-reason'

/**
 * Aggregate counts of how activities were summarized, persisted locally so the
 * cause distribution survives restarts and ships with the logs-export ZIP.
 *
 * This answers "what's the common cause of degraded (snapshot-fallback) summary
 * quality?" in aggregate — `byReason` is the distribution, `lastDetailByReason`
 * keeps one raw example per reason (e.g. the exact timeout/provider-404 text).
 * It deliberately does NOT persist per-activity rows.
 */
export interface SummaryModeStats {
  /** Total semantic-summary outcomes recorded. */
  total: number
  /** Count per pipeline that produced the summary: 'video' | 'snapshot' | ''. */
  byMode: Record<string, number>
  /** Count per canonical reason ('video', 'video_timeout', 'not_configured', …). */
  byReason: Record<string, number>
  /** One sample raw failure detail per reason (latest wins); '' details skipped. */
  lastDetailByReason: Record<string, string>
  /** Unix ms of the last recorded outcome. */
  updatedAt: number
}

export class SummaryModeTracker {
  private stats: SummaryModeStats
  private filePath: string

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(app.getPath('userData'), 'summary-mode-stats.json')
    this.stats = this.loadStats()
  }

  private getDefaultStats(): SummaryModeStats {
    return {
      total: 0,
      byMode: {},
      byReason: {},
      lastDetailByReason: {},
      updatedAt: 0,
    }
  }

  private loadStats(): SummaryModeStats {
    if (!fs.existsSync(this.filePath)) {
      return this.getDefaultStats()
    }

    try {
      const data = fs.readFileSync(this.filePath, 'utf-8')
      const stored = JSON.parse(data) as Partial<SummaryModeStats>

      // Merge with defaults to handle schema evolution.
      return {
        ...this.getDefaultStats(),
        ...stored,
      }
    } catch (error) {
      console.error('[SummaryModeTracker] Error loading stats, using defaults:', error)
      return this.getDefaultStats()
    }
  }

  private saveStats(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.stats, null, 2))
    } catch (error) {
      console.error('[SummaryModeTracker] Error saving stats:', error)
    }
  }

  public record(outcome: SummaryOutcome): void {
    this.stats.total++
    this.stats.byMode[outcome.mode] = (this.stats.byMode[outcome.mode] ?? 0) + 1
    this.stats.byReason[outcome.reason] = (this.stats.byReason[outcome.reason] ?? 0) + 1
    if (outcome.failureDetail) {
      this.stats.lastDetailByReason[outcome.reason] = outcome.failureDetail
    }
    this.stats.updatedAt = Date.now()
    this.saveStats()
  }

  public getStats(): SummaryModeStats {
    return { ...this.stats }
  }

  public reset(): void {
    this.stats = this.getDefaultStats()
    this.saveStats()
  }
}
