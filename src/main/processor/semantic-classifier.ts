import * as fs from 'fs'
import sharp from 'sharp'
import { OpenRouter } from '@openrouter/sdk'
import {
  ClassificationResult,
  CustomEndpointConfig,
  ActivityClassificationInput,
} from '../../shared/types'
import { buildChronologicalTimeline, buildVideoTimeline } from './activity-timeline'
import { UsageTracker } from '../services/usage-tracker'
import log from '../logger'
import { DebugPipelineWriter } from './debug-pipeline'

/** Max width for screenshots sent to the LLM. Matches capture resolution; converts to JPEG. */
const LLM_IMAGE_MAX_WIDTH = 1920

const SUPPORTED_MODELS = {
  'google/gemini-2.5-flash-lite-preview-09-2025': {
    input_tokens_per_million: 0.1,
    completion_tokens_per_million: 0.4,
  },
  'qwen/qwen3.5-397b-a17b': {
    input_tokens_per_million: 0.2,
    completion_tokens_per_million: 0.6,
  },
} as const satisfies Record<
  string,
  { input_tokens_per_million: number; completion_tokens_per_million: number }
>

export type ModelChoice = keyof typeof SUPPORTED_MODELS

const DEFAULT_MODEL: ModelChoice = 'google/gemini-2.5-flash-lite-preview-09-2025'
const FALLBACK_MODEL: ModelChoice = 'qwen/qwen3.5-397b-a17b'

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
    model: ModelChoice = DEFAULT_MODEL,
    maxHistorySize = 5,
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
        this.model = DEFAULT_MODEL
        log.info('[SemanticClassifier] Reverted to OpenRouter')
      } else {
        this.client = null
        this.model = DEFAULT_MODEL
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
    const hasVideo = !!(input.videoPath && fs.existsSync(input.videoPath))

    try {
      const durationMs = (activity.endTimestamp ?? Date.now()) - activity.startTimestamp
      const durationStr = this.formatDuration(durationMs)
      const mediaDesc = hasVideo ? '(video)' : `(${screenshotPaths.length} screenshots)`
      log.info(
        `[SemanticClassifier] Classifying activity ${activity.id}: ${activity.appName} (${durationStr}, ${mediaDesc})`,
      )

      const prompt = this.formatActivityPrompt(input, hasVideo)

      // Build content: text prompt + video or screenshots
      const content: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; imageUrl: { url: string; detail: 'high' } }
        | { type: 'video_url'; videoUrl: { url: string } }
      > = [{ type: 'text' as const, text: prompt }]

      if (hasVideo) {
        // Send video instead of screenshots
        const videoBuffer = fs.readFileSync(input.videoPath!)
        log.info(
          `[SemanticClassifier] Video file: ${(videoBuffer.length / 1024).toFixed(0)}KB raw, ${((videoBuffer.length * 4) / 3 / 1024).toFixed(0)}KB base64`,
        )
        const videoBase64 = videoBuffer.toString('base64')
        content.push({
          type: 'video_url' as const,
          videoUrl: { url: `data:video/mp4;base64,${videoBase64}` },
        })
      } else {
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
      }

      const response = await this.client.chat.send({
        messages: [{ role: 'user', content }],
        ...(this.isCustomEndpoint
          ? // Custom endpoint: single model, no provider routing
            { model: this.model }
          : hasVideo
            ? // Video via OpenRouter: force Google/Vertex (rejects base64 video otherwise)
              {
                model: this.model,
                provider: { order: ['Google'], allowFallbacks: false },
              }
            : // Screenshots via OpenRouter: primary model with Qwen fallback on rate-limit
              {
                models: [this.model, FALLBACK_MODEL],
                route: 'fallback' as const,
              }),
      })

      const messageContent = response.choices?.[0]?.message?.content
      const summary =
        typeof messageContent === 'string' ? messageContent.trim() : 'No summary generated'
      log.info(`[SemanticClassifier] Activity summary: ${summary}`)

      // Track usage — response.model reflects the model that actually served the request
      const actualModel = response.model || this.model
      const promptTokens = response.usage?.promptTokens || 0
      const completionTokens = response.usage?.completionTokens || 0
      let cost = 0
      if (!this.isCustomEndpoint && actualModel in SUPPORTED_MODELS) {
        const modelCost = SUPPORTED_MODELS[actualModel as ModelChoice]
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

      this.debugWriter?.dumpActivity(input, content, {
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
      if (error instanceof Error && 'error' in error) {
        const err = error as Record<string, unknown>
        const nested = err.error as Record<string, unknown> | undefined
        log.error(
          `[SemanticClassifier] Activity classification failed:`,
          `message=${nested?.message}`,
          `code=${nested?.code}`,
          `type=${nested?.type}`,
          `statusCode=${err.statusCode}`,
        )
        if (err.body) {
          log.error(`[SemanticClassifier] Response body: ${err.body}`)
        }
      } else {
        log.error(`[SemanticClassifier] Activity classification failed: ${error}`)
      }
      throw error
    }
  }

  /**
   * Format the prompt for activity classification with multiple screenshots.
   */
  private formatActivityPrompt(input: ActivityClassificationInput, hasVideo: boolean): string {
    const { activity, screenshotPaths } = input
    const durationMs = (activity.endTimestamp ?? Date.now()) - activity.startTimestamp
    const durationStr = this.formatDuration(durationMs)

    const mediaType = hasVideo ? 'video' : 'screenshots'
    let prompt = `You are summarizing a user activity session from ${mediaType} and interaction timeline.\n\n`

    // Rules first — sets the model's behavior before it sees any data
    prompt += '## Rules\n'
    if (hasVideo) {
      prompt +=
        '- The attached video is the primary source. Timeline is secondary context for ordering/pacing.\n'
    } else {
      prompt +=
        '- Screenshots are primary source. Timeline is secondary context for ordering/pacing.\n'
    }
    prompt += '- Answer "What was I working on?" — useful for recall, not a play-by-play.\n'
    prompt +=
      '- NEVER mention raw interactions (clicks, scrolling, coordinates). Translate into meaningful actions.\n'
    prompt += `- Be specific: name files, functions, errors, URLs, UI elements visible in the ${mediaType}.\n`
    prompt += `- Match verb intensity to evidence: browsing/reviewing (no visible edits) \u2192 "browsed," "reviewed," "checked." Light editing (small visible changes) \u2192 "tweaked," "adjusted." Active work (sustained edits, new code, debugging) \u2192 "implemented," "debugged," "refactored." Evidence of editing = visible changed lines, new code, or diff markers in the ${mediaType}.\n`
    prompt +=
      '- Do NOT exaggerate. Switching files = browsing, not editing. Opening a file = reviewing, not working on it.\n'
    prompt +=
      "- If previous context is provided, only describe what's NEW. If nothing meaningfully new, say so briefly.\n"
    if (hasVideo) {
      prompt +=
        '- Describe what changed during the video: new code, different tabs, updated content, navigation.\n'
    } else {
      prompt +=
        '- Describe what changed between screenshots: new code, different tabs, updated content, navigation.\n'
    }
    prompt +=
      '- Click coordinates: use them to identify WHAT was clicked by looking at that position in the screenshot. NEVER output raw coordinates.\n'
    prompt +=
      '- 40-100 words, 1-4 sentences, single paragraph, no bullet points. Low-activity sessions should use the lower end of the range.\n'
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
    if (hasVideo) {
      const timeline = buildVideoTimeline(activity)
      if (timeline) {
        prompt += '## Activity timeline (video attached below)\n'
        prompt += timeline + '\n\n'
      }
    } else {
      const timeline = buildChronologicalTimeline(activity, screenshotPaths)
      if (timeline) {
        prompt += `## Activity timeline (screenshots labeled [S1]\u2013[S${screenshotPaths.length}], attached as images below)\n`
        prompt += timeline + '\n\n'
      }
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
    prompt += 'Describe what the user was working on during this session.\n'

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
