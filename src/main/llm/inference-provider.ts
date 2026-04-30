import type { LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ApiKeyManager } from '../settings/api-key-manager'
import type { CustomEndpointManager } from '../settings/custom-endpoint-manager'
import type { CustomEndpointConfig } from '../../shared/types'
import log from '../logger'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export interface InferenceRouteSnapshot {
  baseURL: string
  apiKey: string
}

export interface InferenceProvider {
  isConfigured(): boolean
  /**
   * Resolve a Vercel AI SDK LanguageModel handle for the given model id, pointed
   * at the active route (custom endpoint if configured, OpenRouter otherwise).
   * Throws when no route is configured.
   */
  languageModel(modelId: string): LanguageModel
  /**
   * Snapshot of the active route's credentials. Used by code paths that send
   * raw HTTP requests (e.g. multimodal video, which the OpenAI-compatible
   * adapter does not handle).
   */
  getRouteSnapshot(): InferenceRouteSnapshot | null
  /**
   * Notify the provider that ApiKeyManager / CustomEndpointManager state has
   * changed. Invalidates the cached SDK provider and fires listeners.
   */
  notifyConfigChanged(): void
  onConfigChanged(listener: () => void): () => void
}

export interface InferenceProviderOptions {
  apiKeyManager?: ApiKeyManager | null
  customEndpointManager?: CustomEndpointManager | null
  /**
   * Direct API key, taking precedence over `apiKeyManager`. For CLI scripts
   * and tests that hold a key in hand and don't want to construct a real
   * `ApiKeyManager` (which depends on Electron's `safeStorage` and `userData`).
   */
  apiKeyOverride?: string
  /**
   * Direct custom-endpoint config, taking precedence over `customEndpointManager`.
   * For tests; mirrors `apiKeyOverride`.
   */
  customEndpointOverride?: CustomEndpointConfig | null
  /**
   * Optional custom fetch implementation, primarily for tests. Forwarded to
   * the underlying @ai-sdk/openai-compatible provider.
   */
  fetch?: typeof globalThis.fetch
}

export class InferenceProviderImpl implements InferenceProvider {
  private readonly apiKeyManager: ApiKeyManager | null
  private readonly customEndpointManager: CustomEndpointManager | null
  private readonly apiKeyOverride: string | null
  private readonly hasCustomEndpointOverride: boolean
  private readonly customEndpointOverride: CustomEndpointConfig | null
  private readonly customFetch: typeof globalThis.fetch | undefined
  private cachedSignature: string | null = null
  private cachedSdkProvider: ReturnType<typeof createOpenAICompatible> | null = null
  private readonly listeners = new Set<() => void>()

  constructor(options: InferenceProviderOptions = {}) {
    this.apiKeyManager = options.apiKeyManager ?? null
    this.customEndpointManager = options.customEndpointManager ?? null
    this.apiKeyOverride = options.apiKeyOverride ?? null
    this.hasCustomEndpointOverride = 'customEndpointOverride' in options
    this.customEndpointOverride = options.customEndpointOverride ?? null
    this.customFetch = options.fetch
  }

  isConfigured(): boolean {
    return this.resolveRoute() !== null
  }

  languageModel(modelId: string): LanguageModel {
    const route = this.resolveRoute()
    if (!route) {
      throw new Error(
        'InferenceProvider has no active route (no API key and no custom endpoint configured)',
      )
    }
    const signature = this.signatureFor(route)
    if (this.cachedSignature !== signature || !this.cachedSdkProvider) {
      this.cachedSdkProvider = createOpenAICompatible({
        baseURL: route.baseURL,
        name: 'inference-provider',
        apiKey: route.apiKey,
        fetch: this.customFetch,
      })
      this.cachedSignature = signature
    }
    return this.cachedSdkProvider.languageModel(modelId)
  }

  getRouteSnapshot(): InferenceRouteSnapshot | null {
    return this.resolveRoute()
  }

  notifyConfigChanged(): void {
    this.cachedSignature = null
    this.cachedSdkProvider = null
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        log.warn('[InferenceProvider] config-change listener threw', error)
      }
    }
  }

  onConfigChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private resolveApiKey(): string | null {
    if (this.apiKeyOverride && this.apiKeyOverride.trim().length > 0) {
      return this.apiKeyOverride
    }
    return this.apiKeyManager?.getApiKey() ?? null
  }

  private resolveCustomEndpoint(): CustomEndpointConfig | null {
    if (this.hasCustomEndpointOverride) {
      return this.customEndpointOverride
    }
    return this.customEndpointManager?.getEndpoint() ?? null
  }

  private resolveRoute(): InferenceRouteSnapshot | null {
    const endpoint = this.resolveCustomEndpoint()
    if (endpoint) {
      const apiKey = endpoint.apiKey ?? this.resolveApiKey() ?? ''
      return {
        baseURL: endpoint.serverURL,
        apiKey,
      }
    }
    const apiKey = this.resolveApiKey()
    if (apiKey && apiKey.trim().length > 0) {
      return {
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
      }
    }
    return null
  }

  private signatureFor(route: InferenceRouteSnapshot): string {
    return `${route.baseURL}|${route.apiKey}`
  }
}
