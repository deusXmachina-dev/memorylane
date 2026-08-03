/**
 * User context builder service.
 *
 * Analyzes the past week of activities via a single LLM call to produce a
 * short and detailed summary of who the user is. These summaries are stored
 * in the DB and injected into other LLM prompts for personalization.
 *
 * Scheduling mirrors TaskMiner: call scheduleRun() on screen unlock
 * and the service handles interval guards, settle delays, and error isolation.
 */

import { generateText } from 'ai'
import { isSameDay, getDayBoundaries } from '@main/utils/day'
import type { StorageService, ActivityDetail } from '../storage'
import { DEFAULT_REQUEST_TIMEOUT_MS, type InferenceProvider } from '../llm'
import type { UserContext } from '../storage/user-context-repository'
import { USER_CONTEXT_CONFIG } from '../../shared/constants'
import log from '@main/utils/logger'

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

interface AggregatedProfile {
  total_activities: number
  total_hours: number
  apps: { name: string; hours: number; count: number; top_windows: string[] }[]
  sample_summaries: string[]
}

function aggregateActivities(activities: ActivityDetail[]): AggregatedProfile {
  // Per-app stats
  const appMap = new Map<string, { totalMs: number; count: number; windows: Map<string, number> }>()
  // Collect unique summaries
  const summarySet = new Set<string>()

  for (const a of activities) {
    const durationMs = a.endTimestamp - a.startTimestamp

    // App stats
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

    // Summaries (deduplicate)
    if (a.summary) {
      summarySet.add(a.summary)
    }
  }

  // Sort apps by total time
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

  // Sample up to 80 unique summaries evenly across the set
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

You will receive: app usage ranked by time — websites and desktop apps alike — and a sample of activity summaries.

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

// Models occasionally return a summary as an array of bullets or a nested
// object instead of a plain string. Flatten those to text so they never reach
// SQLite as a non-primitive (better-sqlite3 treats an object arg as named
// params, yielding "Too few parameter values were provided").
function coerceSummary(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(coerceSummary).filter(Boolean).join('\n')
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(coerceSummary)
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function normalizeContext(parsed: {
  short_summary?: unknown
  detailed_summary?: unknown
}): ParsedContext | null {
  const short_summary = coerceSummary(parsed.short_summary).trim()
  const detailed_summary = coerceSummary(parsed.detailed_summary).trim()
  if (short_summary && detailed_summary) return { short_summary, detailed_summary }
  return null
}

function extractContextFromResponse(content: string): ParsedContext | null {
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : content

  try {
    return normalizeContext(JSON.parse(jsonStr))
  } catch {
    const objMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try {
        return normalizeContext(JSON.parse(objMatch[0]))
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
  private model = ''

  constructor(
    private readonly storage: StorageService,
    private readonly provider?: InferenceProvider,
  ) {}

  updateModel(model: string): void {
    this.model = model.trim()
    log.info(`[UserContextBuilder] Model updated to: ${this.model || '(none — builder idle)'}`)
  }

  /**
   * Try to schedule a context update. Call this on screen unlock / wake.
   * Runs once per day, analyzing the past week of activities.
   */
  scheduleRun(): void {
    if (this.running || this.settleTimer) return

    if (!this.provider || !this.provider.isConfigured()) {
      log.info('[UserContextBuilder] No inference provider configured, skipping')
      return
    }

    if (!this.model) {
      log.info('[UserContextBuilder] No model configured, skipping')
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
    const provider = this.provider
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      void this.execute(provider)
    }, USER_CONTEXT_CONFIG.SETTLE_DELAY_MS)
  }

  /**
   * Run context update immediately. Used by the CLI.
   */
  async run(
    provider: InferenceProvider,
    config: Partial<UserContextBuilderConfig> = {},
    onProgress?: ProgressCallback,
  ): Promise<UserContextResult> {
    return runUserContextUpdate(
      provider,
      this.storage,
      { model: this.model, ...config },
      onProgress,
    )
  }

  private async execute(provider: InferenceProvider): Promise<void> {
    this.running = true
    try {
      const result = await runUserContextUpdate(provider, this.storage, { model: this.model })
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
  provider: InferenceProvider,
  storage: StorageService,
  config: Partial<UserContextBuilderConfig> = {},
  onProgress?: ProgressCallback,
): Promise<UserContextResult> {
  const cfg = { ...DEFAULT_BUILDER_CONFIG, ...config }
  if (!cfg.model) {
    throw new Error('No model configured for user-context update')
  }

  const progress = (msg: string) => {
    log.info(`[UserContextBuilder] ${msg}`)
    onProgress?.(msg)
  }

  progress(`Starting run (model=${cfg.model}, lookback=${cfg.lookbackDays}d)`)

  // 1. Gather activities for the past week
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

  // 2. Aggregate activities into compact stats
  const profile = aggregateActivities(allActivities)
  progress(
    `Aggregated into ${profile.apps.length} apps, ${profile.sample_summaries.length} sample summaries`,
  )

  // 3. Load existing context for continuity
  const existing = storage.userContext.get()

  // 4. Build prompt and make LLM call
  const systemPrompt = buildSystemPrompt(existing)
  const userMessage = `Activity stats from the past ${cfg.lookbackDays} days:\n\n\`\`\`json\n${JSON.stringify(profile, null, 2)}\n\`\`\``

  progress(`Sending aggregated profile to ${cfg.model}...`)
  const result = await generateText({
    model: provider.languageModel(cfg.model),
    timeout: DEFAULT_REQUEST_TIMEOUT_MS,
    system: systemPrompt,
    prompt: userMessage,
  })

  const totalInputTokens = result.usage.inputTokens ?? 0
  const totalOutputTokens = result.usage.outputTokens ?? 0
  progress(`Response received (${totalInputTokens} in / ${totalOutputTokens} out tokens)`)

  // 5. Parse and persist
  const parsed = extractContextFromResponse(result.text)
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
