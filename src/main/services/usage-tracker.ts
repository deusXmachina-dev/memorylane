import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'

export interface UsageStats {
  requestCount: number
  promptTokens: number
  completionTokens: number
  totalCost: number
}

export class UsageTracker {
  private stats: UsageStats
  private filePath: string

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'usage-stats.json')
    this.stats = this.loadStats()
  }

  private getDefaultStats(): UsageStats {
    return {
      requestCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalCost: 0,
    }
  }

  private loadStats(): UsageStats {
    if (!fs.existsSync(this.filePath)) {
      return this.getDefaultStats()
    }

    try {
      const data = fs.readFileSync(this.filePath, 'utf-8')
      const stored = JSON.parse(data) as Partial<UsageStats>

      // Merge with defaults to handle schema evolution
      return {
        ...this.getDefaultStats(),
        ...stored,
      }
    } catch (error) {
      log.warn('[UsageTracker] Error loading stats, using defaults:', error)
      return this.getDefaultStats()
    }
  }

  private saveStats(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.stats, null, 2))
    } catch (error) {
      log.warn('[UsageTracker] Error saving stats:', error)
    }
  }

  public recordUsage(usage: {
    prompt_tokens: number
    completion_tokens: number
    cost?: number
  }): void {
    this.stats.requestCount++
    this.stats.promptTokens += usage.prompt_tokens
    this.stats.completionTokens += usage.completion_tokens
    if (usage.cost !== undefined) {
      this.stats.totalCost += usage.cost
    }
    this.saveStats()
  }

  public getStats(): UsageStats {
    return { ...this.stats }
  }

  public reset(): void {
    this.stats = this.getDefaultStats()
    this.saveStats()
  }
}
