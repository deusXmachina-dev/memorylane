import sharp from 'sharp'
import { OpenRouter } from '@openrouter/sdk'
import {
  ClassificationResult,
  CustomEndpointConfig,
  ActivityClassificationInput,
} from '../../shared/types'
import { buildChronologicalTimeline } from './activity-timeline'
import { UsageTracker } from '../services/usage-tracker'
import log from '../logger'
import { DebugPipelineWriter } from './debug-pipeline'

/** Max width for screenshots sent to the LLM. Matches capture resolution; converts to JPEG. */
const LLM_IMAGE_MAX_WIDTH = 1920

const SUPPORTED_MODELS = {
  'mistralai/mistral-small-3.2-24b-instruct': {
    input_tokens_per_million: 0.08,
    completion_tokens_per_million: 0.2,
  },
  'google/gemini-2.5-flash-lite': {
    input_tokens_per_million: 0.1,
    completion_tokens_per_million: 0.4,
  },
} as const satisfies Record<
  string,
  { input_tokens_per_million: number; completion_tokens_per_million: number }
>

export type ModelChoice = keyof typeof SUPPORTED_MODELS

export interface EndpointConfig {
  serverURL?: string
  apiKey?: string
  model?: string
}

export class SemanticClassifierService {
  private summaryHistory: ClassificationResult[] = []
  private client: OpenRouter | null = null
  private model: string
  private isCustomEndpoint = false
  private maxHistorySize: number
  private usageTracker: UsageTracker
  private debugWriter: DebugPipelineWriter | null

  constructor(
    apiKey?: string,
    model: ModelChoice = 'mistralai/mistral-small-3.2-24b-instruct',
    maxHistorySize = 2,
    usageTracker?: UsageTracker,
    debugWriter?: DebugPipelineWriter | null,
    endpointConfig?: EndpointConfig,
  ) {
    this.maxHistorySize = maxHistorySize
    this.usageTracker = usageTracker || new UsageTracker()
    this.debugWriter = debugWriter ?? null

    if (endpointConfig?.serverURL) {
      // Custom endpoint takes priority
      const effectiveKey = endpointConfig.apiKey || apiKey || ''
      this.client = new OpenRouter({ apiKey: effectiveKey, serverURL: endpointConfig.serverURL })
      this.model = endpointConfig.model || model
      this.isCustomEndpoint = true
      log.info(`[SemanticClassifier] Initialized with custom endpoint: ${endpointConfig.serverURL}`)
    } else if (apiKey) {
      this.client = new OpenRouter({ apiKey })
      this.model = model
      log.info('[SemanticClassifier] Initialized with API key')
    } else {
      this.model = model
      log.warn('[SemanticClassifier] No API key provided - classification disabled')
    }
  }

  /**
   * Check if the classifier is configured (has either an API key or custom endpoint)
   */
  public isConfigured(): boolean {
    return this.client !== null
  }

  /**
   * Whether the classifier is currently using a custom endpoint
   */
  public isUsingCustomEndpoint(): boolean {
    return this.isCustomEndpoint
  }

  /**
   * Update the API key at runtime (for OpenRouter)
   */
  public updateApiKey(apiKey: string | null): void {
    if (this.isCustomEndpoint) {
      // Don't override custom endpoint with OpenRouter key changes
      log.info('[SemanticClassifier] Ignoring API key update - custom endpoint active')
      return
    }
    if (apiKey) {
      // Clear env var to prevent SDK from reading it and potentially duplicating keys
      delete process.env.OPENROUTER_API_KEY
      this.client = new OpenRouter({ apiKey })
      log.info('[SemanticClassifier] API key updated')
    } else {
      this.client = null
      log.info('[SemanticClassifier] API key cleared')
    }
  }

  /**
   * Switch to a custom endpoint or revert to OpenRouter
   */
  public updateEndpoint(config: CustomEndpointConfig | null, openRouterKey?: string | null): void {
    if (config) {
      const effectiveKey = config.apiKey || ''
      this.client = new OpenRouter({ apiKey: effectiveKey, serverURL: config.serverURL })
      this.model = config.model
      this.isCustomEndpoint = true
      log.info(`[SemanticClassifier] Switched to custom endpoint: ${config.serverURL}`)
    } else {
      // Revert to OpenRouter
      this.isCustomEndpoint = false
      if (openRouterKey) {
        this.client = new OpenRouter({ apiKey: openRouterKey })
        this.model = 'mistralai/mistral-small-3.2-24b-instruct'
        log.info('[SemanticClassifier] Reverted to OpenRouter')
      } else {
        this.client = null
        this.model = 'mistralai/mistral-small-3.2-24b-instruct'
        log.info('[SemanticClassifier] Custom endpoint removed, no OpenRouter key available')
      }
    }
  }

  /**
   * Classify an activity using multiple screenshots and interaction context.
   * Returns a richer summary describing the arc of the activity.
   */
  public async classifyActivity(input: ActivityClassificationInput): Promise<string> {
    if (!this.client) {
      log.info('[SemanticClassifier] Skipping activity classification - no API key configured')
      return ''
    }

    const { activity, screenshotPaths } = input

    try {
      const durationStr = this.formatDuration(
        (activity.endTimestamp ?? Date.now()) - activity.startTimestamp,
      )
      log.info(
        `[SemanticClassifier] Classifying activity ${activity.id}: ${activity.appName} (${durationStr}, ${screenshotPaths.length} screenshots)`,
      )

      const prompt = this.formatActivityPrompt(input)

      // Build content: text prompt + up to MAX_SCREENSHOTS_FOR_LLM images
      const content: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; imageUrl: { url: string; detail: 'high' } }
      > = [{ type: 'text' as const, text: prompt }]

      for (const filepath of screenshotPaths) {
        try {
          const imageData = await this.prepareImageForLLM(filepath)
          content.push({
            type: 'image_url' as const,
            imageUrl: { url: `data:image/jpeg;base64,${imageData}`, detail: 'high' },
          })
        } catch (error) {
          log.warn(`[SemanticClassifier] Failed to read screenshot ${filepath}:`, error)
        }
      }

      const response = await this.client.chat.send({
        model: this.model,
        messages: [{ role: 'user', content }],
      })

      const messageContent = response.choices?.[0]?.message?.content
      const summary =
        typeof messageContent === 'string' ? messageContent.trim() : 'No summary generated'
      log.info(`[SemanticClassifier] Activity summary: ${summary}`)

      // Track usage
      const promptTokens = response.usage?.promptTokens || 0
      const completionTokens = response.usage?.completionTokens || 0
      let cost = 0
      if (!this.isCustomEndpoint && this.model in SUPPORTED_MODELS) {
        const modelCost = SUPPORTED_MODELS[this.model as ModelChoice]
        cost =
          (promptTokens / 1_000_000) * modelCost.input_tokens_per_million +
          (completionTokens / 1_000_000) * modelCost.completion_tokens_per_million
      }
      this.usageTracker.recordUsage({
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cost,
      })
      log.info(
        `[SemanticClassifier] Usage tracked - Tokens: ${promptTokens}/${completionTokens}, Cost: $${cost.toFixed(6)}`,
      )

      this.debugWriter?.dumpActivity(input, prompt, {
        model: this.model,
        summary,
        promptTokens,
        completionTokens,
        cost,
        timestamp: Date.now(),
      })

      // Store in history
      const result: ClassificationResult = {
        summary,
        timestamp: activity.endTimestamp ?? Date.now(),
      }
      this.summaryHistory.push(result)
      if (this.summaryHistory.length > this.maxHistorySize) {
        this.summaryHistory = this.summaryHistory.slice(-this.maxHistorySize)
      }

      return summary
    } catch (error) {
      const detail = this.describeError(error)
      log.error(`[SemanticClassifier] Activity classification failed: ${detail}`)
      throw error
    }
  }

  /**
   * Format the prompt for activity classification with multiple screenshots.
   */
  private formatActivityPrompt(input: ActivityClassificationInput): string {
    const { activity, screenshotPaths } = input
    const durationMs = (activity.endTimestamp ?? Date.now()) - activity.startTimestamp
    const durationStr = this.formatDuration(durationMs)

    let prompt =
      'You are summarizing a user activity session from screenshots and interaction timeline.\n\n'

    // Rules first — sets the model's behavior before it sees any data
    prompt += '## Rules\n'
    prompt +=
      '- Screenshots are primary source. Timeline is secondary context for ordering/pacing.\n'
    prompt += '- Answer "What was I working on?" — useful for recall, not a play-by-play.\n'
    prompt +=
      '- NEVER mention raw interactions (clicks, scrolling, coordinates). Translate into meaningful actions.\n'
    prompt +=
      '- Be specific: name files, functions, errors, URLs, UI elements visible in screenshots.\n'
    prompt +=
      '- Match verb intensity to evidence: browsing/reviewing (no visible edits) \u2192 "browsed," "reviewed," "checked." Light editing (small visible changes) \u2192 "tweaked," "adjusted." Active work (sustained edits, new code, debugging) \u2192 "implemented," "debugged," "refactored." Evidence of editing = visible changed lines, new code, or diff markers in screenshots.\n'
    prompt +=
      '- Do NOT exaggerate. Switching files = browsing, not editing. Opening a file = reviewing, not working on it.\n'
    prompt +=
      "- If previous context is provided, only describe what's NEW. If nothing meaningfully new, say so briefly.\n"
    prompt +=
      '- Describe what changed between screenshots: new code, different tabs, updated content, navigation.\n'
    prompt +=
      '- Click coordinates: use them to identify WHAT was clicked by looking at that position in the screenshot. NEVER output raw coordinates.\n'
    prompt +=
      '- 40-100 words, 1-4 sentences, single paragraph, no bullet points. Low-activity sessions should use the lower end of the range.\n'
    prompt +=
      '- Start directly with the action or subject. NEVER start with "During this session", "In this session", "The user", or similar meta-phrases.\n'
    prompt += '\n'

    // Context
    prompt += '## Context\n'
    prompt += `- App: ${activity.appName}\n`
    prompt += `- Duration: ${durationStr}\n`
    if (activity.url) {
      prompt += `- URL: ${activity.url}\n`
    }
    prompt += '\n'

    // Timeline
    const timeline = buildChronologicalTimeline(activity, screenshotPaths)
    if (timeline) {
      prompt += `## Activity timeline (screenshots labeled [S1]\u2013[S${screenshotPaths.length}], attached as images below)\n`
      prompt += timeline + '\n\n'
    }

    // Previous context
    if (this.summaryHistory.length > 0) {
      prompt += '## Previous activity context\n'
      prompt +=
        'These summaries describe what the user was doing just before this session. Do NOT repeat information already covered here. Focus only on what is NEW or DIFFERENT in the current session.\n'
      for (const result of this.summaryHistory) {
        const timeAgo = this.formatTimeAgo(Date.now() - result.timestamp)
        prompt += `- ${timeAgo} ago: "${result.summary}"\n`
      }
      prompt += '\n'
    }

    // Task
    prompt += '## Task\n'
    prompt +=
      'Describe what was worked on. Start mid-sentence with the action (e.g. "Implemented...", "Reviewed...", "Debugged...").\n'

    return prompt
  }

  /**
   * Format milliseconds into a human-readable duration string.
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`
    } else {
      return `${seconds}s`
    }
  }

  /**
   * Format time difference in human-readable format
   */
  private formatTimeAgo(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`
    } else if (minutes > 0) {
      return `${minutes}m`
    } else {
      return `${seconds}s`
    }
  }

  /**
   * Resize screenshot to a reasonable width and convert to JPEG for the LLM.
   * Retina screenshots (3326x2160) are too large — text becomes unreadable
   * after the provider auto-downscales them. Resizing to ~1600px wide keeps
   * text sharp while cutting payload size significantly.
   */
  private async prepareImageForLLM(filepath: string): Promise<string> {
    const buffer = await sharp(filepath)
      .resize({ width: LLM_IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    return buffer.toString('base64')
  }

  /**
   * Build a human-readable description of an API error, pulling status codes
   * and response bodies from OpenRouter SDK errors when available.
   */
  private describeError(error: unknown): string {
    const endpoint = this.isCustomEndpoint ? 'custom endpoint' : 'OpenRouter'
    const parts = [`model=${this.model}`, `endpoint=${endpoint}`]

    if (error instanceof Error) {
      parts.push(`message="${error.message}"`)

      // OpenRouterError (parent of ChatError) carries HTTP details
      const httpErr = error as { statusCode?: number; body?: string }
      if (typeof httpErr.statusCode === 'number') {
        parts.push(`status=${httpErr.statusCode}`)
      }
      if (typeof httpErr.body === 'string') {
        const bodyPreview =
          httpErr.body.length > 500 ? httpErr.body.slice(0, 500) + '…' : httpErr.body
        parts.push(`body=${bodyPreview}`)
      }
    } else {
      parts.push(`error=${String(error)}`)
    }

    return parts.join(', ')
  }

  /**
   * Get the summary history
   */
  public getSummaryHistory(): ClassificationResult[] {
    return [...this.summaryHistory]
  }

  /**
   * Get the usage tracker instance
   */
  public getUsageTracker(): UsageTracker {
    return this.usageTracker
  }
}
