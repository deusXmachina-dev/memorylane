import * as fs from 'fs'
import { nativeImage } from 'electron'
import { OpenRouter } from '@openrouter/sdk'
import { ClassificationInput, ClassificationResult, InteractionContext } from '../../shared/types'
import { UsageTracker } from '../services/usage-tracker'
import log from '../logger'
import { DebugPipelineWriter } from './debug-pipeline'

const SUPPORTED_MODELS = {
  'mistralai/mistral-small-3.2-24b-instruct': {
    input_tokens_per_million: 0.08,
    completion_tokens_per_million: 0.2,
  },
  'openai/gpt-5-nano': {
    input_tokens_per_million: 0.05,
    completion_tokens_per_million: 0.4,
  },
  'x-ai/grok-4.1-fast': {
    input_tokens_per_million: 0.05,
    completion_tokens_per_million: 0.4,
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

const MAX_VISION_IMAGE_DIMENSION = 1280
const VISION_IMAGE_JPEG_QUALITY = 70

export class SemanticClassifierService {
  private summaryHistory: ClassificationResult[] = []
  private client: OpenRouter | null = null
  private model: ModelChoice
  private maxHistorySize: number
  private usageTracker: UsageTracker
  private debugWriter: DebugPipelineWriter | null

  constructor(
    apiKey?: string,
    model: ModelChoice = 'mistralai/mistral-small-3.2-24b-instruct',
    maxHistorySize = 5,
    usageTracker?: UsageTracker,
    debugWriter?: DebugPipelineWriter | null,
  ) {
    // Use provided key directly - caller (ApiKeyManager) handles env fallback
    if (apiKey) {
      this.client = new OpenRouter({ apiKey })
      log.info('[SemanticClassifier] Initialized with API key')
    } else {
      log.warn('[SemanticClassifier] No API key provided - classification disabled')
    }
    this.model = model
    this.maxHistorySize = maxHistorySize
    this.usageTracker = usageTracker || new UsageTracker()
    this.debugWriter = debugWriter ?? null
  }

  /**
   * Check if the classifier is configured with an API key
   */
  public isConfigured(): boolean {
    return this.client !== null
  }

  /**
   * Update the API key at runtime
   */
  public updateApiKey(apiKey: string | null): void {
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
   * Classify user activity between two screenshots with events.
   * Supports single-image mode when endScreenshot is omitted (used for app changes).
   */
  public async classify(input: ClassificationInput): Promise<string> {
    if (!this.client) {
      log.info('[SemanticClassifier] Skipping classification - no API key configured')
      return ''
    }

    const { startScreenshot, endScreenshot } = input
    const isSingleImage = !endScreenshot

    try {
      if (isSingleImage) {
        log.info(`[SemanticClassifier] Single-image classification for ${startScreenshot.id}`)
      } else {
        log.info(
          `[SemanticClassifier] Classifying activity between ${startScreenshot.id} and ${endScreenshot.id}`,
        )
      }
      log.info(`[SemanticClassifier] Events count: ${input.events.length}`)

      // Build the appropriate prompt
      const prompt = isSingleImage ? this.formatSingleImagePrompt(input) : this.formatPrompt(input)

      // Convert screenshot(s) to base64
      const startImageData = this.imageToDataUrl(startScreenshot.filepath)

      // Build content array with proper literal types
      const content = [
        {
          type: 'text' as const,
          text: prompt,
        },
        {
          type: 'image_url' as const,
          imageUrl: { url: startImageData },
        },
      ]

      // Add end image only if present (two-image mode)
      if (endScreenshot) {
        const endImageData = this.imageToDataUrl(endScreenshot.filepath)
        content.push({
          type: 'image_url' as const,
          imageUrl: { url: endImageData },
        })
      }

      // Call OpenRouter API with vision model
      const response = await this.client.chat.send({
        model: this.model,
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      })

      const messageContent = response.choices?.[0]?.message?.content
      const summary =
        typeof messageContent === 'string' ? messageContent.trim() : 'No summary generated'
      log.info(`[SemanticClassifier] Summary: ${summary}`)

      // Track usage - always increment request count for successful calls
      const promptTokens = response.usage?.promptTokens || 0
      const completionTokens = response.usage?.completionTokens || 0
      const modelCost = SUPPORTED_MODELS[this.model]
      const cost =
        (promptTokens / 1_000_000) * modelCost.input_tokens_per_million +
        (completionTokens / 1_000_000) * modelCost.completion_tokens_per_million
      this.usageTracker.recordUsage({
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cost: cost,
      })
      log.info(
        `[SemanticClassifier] Usage tracked - Tokens: ${promptTokens}/${completionTokens}, Cost: $${cost.toFixed(6)}`,
      )
      log.info(`[SemanticClassifier] Total stats: ${JSON.stringify(this.usageTracker.getStats())}`)

      this.debugWriter?.dump(input, prompt, {
        model: this.model,
        summary,
        promptTokens,
        completionTokens,
        cost,
        timestamp: Date.now(),
      })

      // Store in history (use start timestamp for single-image mode)
      const result: ClassificationResult = {
        summary,
        timestamp: endScreenshot?.timestamp ?? startScreenshot.timestamp,
      }
      this.summaryHistory.push(result)

      // Keep only recent summaries
      if (this.summaryHistory.length > this.maxHistorySize) {
        this.summaryHistory = this.summaryHistory.slice(-this.maxHistorySize)
      }

      return summary
    } catch (error) {
      log.error('[SemanticClassifier] Error during classification:', error)
      throw error
    }
  }

  /**
   * Format the prompt with events and previous summaries for context
   */
  private formatPrompt(input: ClassificationInput): string {
    const { events } = input

    let prompt = "You are analyzing two screenshots of a user's screen.\n\n"

    // Primary task
    prompt += '## Task\n'
    prompt +=
      'Compare the START and END screenshots. Describe what changed visually, then infer what the user accomplished in 5-10 words.\n\n'

    // Events as hints
    if (events.length > 0) {
      prompt += '## Hints (events that occurred between screenshots)\n'
      events.forEach((event) => {
        prompt += this.formatEvent(event) + '\n'
      })
      prompt += '\n'
    }

    // Previous context for continuity
    if (this.summaryHistory.length > 0) {
      prompt += '## Previous context (for continuity)\n'
      this.summaryHistory.forEach((result) => {
        const timeAgo = this.formatTimeAgo(Date.now() - result.timestamp)
        prompt += `- ${timeAgo} ago: "${result.summary}"\n`
      })
      prompt += '\n'
    }

    // Instructions
    prompt += '## Instructions\n'
    prompt += '- Focus on visual differences: What appeared, disappeared, or changed?\n'
    prompt += '- Use events as hints to understand HOW the change happened\n'
    prompt += '- BE SPECIFIC: Extract file names, document titles, UI elements, data labels\n'
    prompt += '- STRICT: Response must be ONLY 5-15 words. No explanations or analysis.\n\n'
    prompt += 'Examples:\n'
    prompt += '- "Implemented parseUserInput function in utils.ts"\n'
    prompt += '- "Filled in Q2 revenue numbers for Marketing department"\n'
    prompt += '- "Reviewed PR #142 comments on authentication refactor"\n'
    prompt += '- "Replied to email from John about project deadline"'

    return prompt
  }

  /**
   * Format the prompt for single-image classification (used when app changes)
   */
  private formatSingleImagePrompt(input: ClassificationInput): string {
    const { events } = input

    let prompt =
      "You are analyzing a screenshot of a user's screen taken just before they switched to a different app.\n\n"

    prompt += '## Task\n'
    prompt +=
      'Based on this screenshot, summarize what the user was doing in this app in 5-15 words. Focus on the visible content and context.\n\n'

    // Events as hints
    if (events.length > 0) {
      prompt += '## Hints (user interactions before leaving)\n'
      events.forEach((event) => {
        prompt += this.formatEvent(event) + '\n'
      })
      prompt += '\n'
    }

    // Previous context
    if (this.summaryHistory.length > 0) {
      prompt += '## Previous context\n'
      this.summaryHistory.forEach((result) => {
        const timeAgo = this.formatTimeAgo(Date.now() - result.timestamp)
        prompt += `- ${timeAgo} ago: "${result.summary}"\n`
      })
      prompt += '\n'
    }

    prompt += '## Instructions\n'
    prompt += '- Describe what the user was working on based on visible content\n'
    prompt += '- BE SPECIFIC: Extract file names, document titles, UI elements, data labels\n'
    prompt += '- STRICT: Response must be ONLY 5-15 words, no explanations\n\n'
    prompt += 'Examples:\n'
    prompt += '- "Editing processScreenshot function in index.ts"\n'
    prompt += '- "Reading PR #142 comments on auth refactor"\n'
    prompt += '- "Composing email reply to John about deadline"'

    return prompt
  }

  /**
   * Format a single event for the prompt
   */
  private formatEvent(event: InteractionContext): string {
    switch (event.type) {
      case 'click':
        return `- click at (${event.clickPosition?.x}, ${event.clickPosition?.y})`
      case 'keyboard':
        return `- keyboard: ${event.keyCount} keys over ${event.durationMs}ms`
      case 'scroll':
        return `- scroll: ${event.scrollDirection}, ${event.scrollAmount} rotation`
      case 'app_change': {
        const from = event.previousWindow
        const to = event.activeWindow
        if (from?.processName === to?.processName) {
          // Same app, different window/tab
          return `- switched tab: "${from?.title}" → "${to?.title}"`
        }
        return `- switched app: "${from?.title}" (${from?.processName}) → "${to?.title}" (${to?.processName})`
      }
      default:
        return `- ${event.type}`
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
   * Convert image file to an LLM-ready data URL.
   * Downscales large screenshots to reduce vision token usage.
   */
  private imageToDataUrl(filepath: string): string {
    const imageBuffer = fs.readFileSync(filepath)
    const image = nativeImage.createFromBuffer(imageBuffer)

    if (image.isEmpty()) {
      return `data:image/png;base64,${imageBuffer.toString('base64')}`
    }

    const size = image.getSize()
    const largestDimension = Math.max(size.width, size.height)
    const scale =
      largestDimension > MAX_VISION_IMAGE_DIMENSION
        ? MAX_VISION_IMAGE_DIMENSION / largestDimension
        : 1

    if (scale === 1) {
      const pngBuffer = image.toPNG()
      return `data:image/png;base64,${pngBuffer.toString('base64')}`
    }

    const resized = image.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'good',
    })

    const optimizedJpeg = resized.toJPEG(VISION_IMAGE_JPEG_QUALITY)
    return `data:image/jpeg;base64,${optimizedJpeg.toString('base64')}`
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
