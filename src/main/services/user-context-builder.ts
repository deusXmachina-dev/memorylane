/**
 * User context builder service.
 *
 * Analyzes the past week of activities via a single LLM call to produce a
 * short and detailed summary of who the user is. These summaries are stored
 * in the DB and injected into other LLM prompts for personalization.
 *
 * Scheduling mirrors PatternDetector: call scheduleRun() on screen unlock
 * and the service handles interval guards, settle delays, and error isolation.
 */

import { generateText, type LanguageModel } from 'ai'
import type { StorageService, ActivityDetail } from '../storage'
import type { ProviderResolver } from '../llm'
import type { UserContext } from '../storage/user-context-repository'
import { USER_CONTEXT_CONFIG } from '../../shared/constants'
import log from '../logger'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface UserContextBuilderConfig {
  model: string
  lookbackDays: number
}

export const DEFAULT_BUILDER_CONFIG: UserContextBuilderConfig = {
  model: USER_CONTEXT_CONFIG.MODEL,
  lookbackDays: USER_CONTEXT_CONFIG.LOOKBACK_DAYS,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserContextResult {
  shortSummary: string
  detailedSummary: string
  tokenUsage: { input: number; output: number }
}

export type ProgressCallback = (message: string) => void

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

function getDayBoundaries(daysBack: number): { start: number; end: number } {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack)
  const start = day.getTime()
  const end = start + 24 * 60 * 60 * 1000 - 1
  return { start, end }
}

interface AggregatedProfile {
  total_activities: number
  total_hours: number
  apps: { name: string; hours: number; count: number; top_windows: string[] }[]
  top_tlds: { tld: string; hours: number }[]
  sample_summaries: string[]
}

function aggregateActivities(activities: ActivityDetail[]): AggregatedProfile {
  const appMap = new Map<string, { totalMs: number; count: number; windows: Map<string, number> }>()
  const tldMap = new Map<string, number>()
  const summarySet = new Set<string>()

  for (const a of activities) {
    const durationMs = a.endTimestamp - a.startTimestamp

    let app = appMap.get(a.appName)
    if (!app) {
      app = { totalMs: 0, count: 0, windows: new Map() }
      appMap.set(a.appName, app)
    }
    app.totalMs += durationMs
    app.count++
    if (a.windowTitle) {
      app.windows.set(a.windowTitle, (app.windows.get(a.windowTitle) || 0) + durationMs)
    }

    if (a.tld) {
      tldMap.set(a.tld, (tldMap.get(a.tld) || 0) + durationMs)
    }

    if (a.summary) {
      summarySet.add(a.summary)
    }
  }

  const apps = [...appMap.entries()]
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .slice(0, 15)
    .map(([name, stats]) => ({
      name,
      hours: Math.round((stats.totalMs / 3_600_000) * 10) / 10,
      count: stats.count,
      top_windows: [...stats.windows.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([title]) => title),
    }))

  const top_tlds = [...tldMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tld, ms]) => ({
      tld,
      hours: Math.round((ms / 3_600_000) * 10) / 10,
    }))

  const allSummaries = [...summarySet]
  const maxSamples = 160
  const step = Math.max(1, Math.floor(allSummaries.length / maxSamples))
  const sample_summaries: string[] = []
  for (let i = 0; i < allSummaries.length && sample_summaries.length < maxSamples; i += step) {
    sample_summaries.push(allSummaries[i])
  }

  const totalMs = activities.reduce((sum, a) => sum + (a.endTimestamp - a.startTimestamp), 0)

  return {
    total_activities: activities.length,
    total_hours: Math.round((totalMs / 3_600_000) * 10) / 10,
    apps,
    top_tlds,
    sample_summaries,
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(existing: UserContext | null): string {
  let existingSection = ''
  if (existing) {
    existingSection = `

## Current profile

Below is the user's current profile from a previous run. Update it based on the new data — keep what's still accurate, revise what's changed, and add anything new.

Short: ${existing.shortSummary}

Detailed:
${existing.detailedSummary}`
  }

  return `Describe the user(s) of a computer based on the aggregated activity stats below.

You will receive: app usage ranked by time, top websites, and a sample of activity summaries.

Produce:

1. "short_summary": A single sentence (max 30 words) describing who uses this computer and what they primarily do.

2. "detailed_summary": 2-3 short paragraphs or bullet points covering:
   - What they do (role, domain, areas of focus)
   - What tools and apps they use most
   - Typical work patterns

Base everything strictly on observed data. Don't speculate. If names or identities are visible in the data, include them to help distinguish the user's own work from third-party content they visited.
${existingSection}

## Output

Output as JSON only, no other text:

\`\`\`json
{
  "short_summary": "...",
  "detailed_summary": "..."
}
\`\`\``
}

// ---------------------------------------------------------------------------
// Response extraction
// ---------------------------------------------------------------------------

interface ParsedContext {
  short_summary: string
  detailed_summary: string
}

function extractContextFromResponse(content: string): ParsedContext | null {
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : content

  try {
    const parsed = JSON.parse(jsonStr) as ParsedContext
    if (parsed.short_summary && parsed.detailed_summary) return parsed
    return null
  } catch {
    const objMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0]) as ParsedContext
        if (parsed.short_summary && parsed.detailed_summary) return parsed
        return null
      } catch {
        return null
      }
    }
    return null
  }
}

// ---------------------------------------------------------------------------
// UserContextBuilder
// ---------------------------------------------------------------------------

export class UserContextBuilder {
  private running = false
  private settleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly storage: StorageService,
    private readonly resolver?: ProviderResolver,
  ) {}

  /**
   * Try to schedule a context update. Call this on screen unlock / wake.
   * Runs once per day, analyzing the past week of activities.
   */
  scheduleRun(): void {
    if (this.running || this.settleTimer) return

    if (!this.resolver) {
      log.info('[UserContextBuilder] No resolver, skipping')
      return
    }

    const cfg = DEFAULT_BUILDER_CONFIG
    let model: LanguageModel
    try {
      model = this.resolver.buildActive(cfg.model)
    } catch (err) {
      log.info(`[UserContextBuilder] Cannot build model: ${(err as Error).message}, skipping`)
      return
    }

    const existing = this.storage.userContext.get()
    if (existing && isSameDay(existing.updatedAt, Date.now())) {
      log.info('[UserContextBuilder] Already ran today, skipping')
      return
    }

    const activityCount = this.storage.activities.count()
    if (activityCount < USER_CONTEXT_CONFIG.MIN_ACTIVITIES) {
      log.info(
        `[UserContextBuilder] Only ${activityCount} activities (need ${USER_CONTEXT_CONFIG.MIN_ACTIVITIES}), skipping`,
      )
      return
    }

    log.info(
      `[UserContextBuilder] Scheduling run in ${USER_CONTEXT_CONFIG.SETTLE_DELAY_MS / 1000}s`,
    )
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      void this.execute(model, cfg)
    }, USER_CONTEXT_CONFIG.SETTLE_DELAY_MS)
  }

  /**
   * Run context update immediately. Used by the CLI.
   */
  async run(
    model: LanguageModel,
    config: Partial<UserContextBuilderConfig> = {},
    onProgress?: ProgressCallback,
  ): Promise<UserContextResult> {
    return runUserContextUpdate(model, this.storage, config, onProgress)
  }

  private async execute(model: LanguageModel, cfg: UserContextBuilderConfig): Promise<void> {
    this.running = true
    try {
      const result = await runUserContextUpdate(model, this.storage, cfg)
      log.info(
        `[UserContextBuilder] Run complete, ` +
          `tokens: ${result.tokenUsage.input}in/${result.tokenUsage.output}out`,
      )
    } catch (error) {
      log.error('[UserContextBuilder] Run failed:', error)
    } finally {
      this.running = false
    }
  }
}

// ---------------------------------------------------------------------------
// Single-shot update
// ---------------------------------------------------------------------------

async function runUserContextUpdate(
  model: LanguageModel,
  storage: StorageService,
  config: Partial<UserContextBuilderConfig> = {},
  onProgress?: ProgressCallback,
): Promise<UserContextResult> {
  const cfg = { ...DEFAULT_BUILDER_CONFIG, ...config }

  const progress = (msg: string) => {
    log.info(`[UserContextBuilder] ${msg}`)
    onProgress?.(msg)
  }

  progress(`Starting run (lookback=${cfg.lookbackDays}d)`)

  const allActivities: ActivityDetail[] = []
  for (let d = 1; d <= cfg.lookbackDays; d++) {
    const { start, end } = getDayBoundaries(d)
    const dayActivities = storage.activities.getForDay(start, end)
    allActivities.push(...dayActivities)
  }

  progress(`Found ${allActivities.length} activities across ${cfg.lookbackDays} days`)

  if (allActivities.length === 0) {
    progress('No activities for this period, skipping')
    return {
      shortSummary: '',
      detailedSummary: '',
      tokenUsage: { input: 0, output: 0 },
    }
  }

  const profile = aggregateActivities(allActivities)
  progress(
    `Aggregated into ${profile.apps.length} apps, ${profile.top_tlds.length} TLDs, ${profile.sample_summaries.length} sample summaries`,
  )

  const existing = storage.userContext.get()

  const systemPrompt = buildSystemPrompt(existing)
  const userMessage = `Activity stats from the past ${cfg.lookbackDays} days:\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\``

  progress('Sending aggregated profile to LLM...')
  const response = await generateText({
    model,
    system: systemPrompt,
    prompt: userMessage,
  })

  const totalInputTokens = response.usage?.inputTokens ?? 0
  const totalOutputTokens = response.usage?.outputTokens ?? 0
  progress(`Response received (${totalInputTokens} in / ${totalOutputTokens} out tokens)`)

  const parsed = extractContextFromResponse(response.text)
  if (!parsed) {
    throw new Error('Failed to parse user context from LLM response')
  }

  storage.userContext.upsert(parsed.short_summary, parsed.detailed_summary)
  progress('User context updated')

  return {
    shortSummary: parsed.short_summary,
    detailedSummary: parsed.detailed_summary,
    tokenUsage: { input: totalInputTokens, output: totalOutputTokens },
  }
}
