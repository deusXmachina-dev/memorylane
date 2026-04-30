import type { LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { normalizeCustomEndpointModel } from '../semantic/custom-endpoint-video-fallback'
import log from '../logger'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export type InferenceRouteKind = 'openrouter' | 'custom'

export interface InferenceRouteSnapshot {
  kind: InferenceRouteKind
  baseURL: string
  apiKey: string
  /** Custom endpoint's configured model id, if route is custom. */
  customEndpointModel: string | null
}

export interface InferenceProvider {
  isConfigured(): boolean
  isUsingCustomEndpoint(): boolean
  /** Custom endpoint's configured model id (or null when not using a custom endpoint). */
  getCustomEndpointModel(): string | null
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

interface ApiKeyAccessor {
  getApiKey(): string | null
}

interface CustomEndpointAccessor {
  getEndpoint(): { serverURL: string; model: string; apiKey?: string } | null
}

export interface InferenceProviderOptions {
  apiKeyManager?: ApiKeyAccessor | null
  customEndpointManager?: CustomEndpointAccessor | null
  /**
   * Optional custom fetch implementation, primarily for tests. Forwarded to
   * the underlying @ai-sdk/openai-compatible provider.
   */
  fetch?: typeof globalThis.fetch
}

export class InferenceProviderImpl implements InferenceProvider {
  private readonly apiKeyManager: ApiKeyAccessor | null
  private readonly customEndpointManager: CustomEndpointAccessor | null
  private readonly customFetch: typeof globalThis.fetch | undefined
  private cachedSignature: string | null = null
  private cachedSdkProvider: ReturnType<typeof createOpenAICompatible> | null = null
  private readonly listeners = new Set<() => void>()

  constructor(options: InferenceProviderOptions = {}) {
    this.apiKeyManager = options.apiKeyManager ?? null
    this.customEndpointManager = options.customEndpointManager ?? null
    this.customFetch = options.fetch
  }

  isConfigured(): boolean {
    return this.resolveRoute() !== null
  }

  isUsingCustomEndpoint(): boolean {
    return this.customEndpointManager?.getEndpoint() != null
  }

  getCustomEndpointModel(): string | null {
    return this.customEndpointManager?.getEndpoint()?.model ?? null
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
        name: route.kind,
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

  private resolveRoute(): InferenceRouteSnapshot | null {
    const endpoint = this.customEndpointManager?.getEndpoint()
    if (endpoint) {
      const apiKey = endpoint.apiKey ?? this.apiKeyManager?.getApiKey() ?? ''
      return {
        kind: 'custom',
        baseURL: endpoint.serverURL,
        apiKey,
        customEndpointModel: normalizeCustomEndpointModel(endpoint.model),
      }
    }
    const apiKey = this.apiKeyManager?.getApiKey()
    if (apiKey && apiKey.trim().length > 0) {
      return {
        kind: 'openrouter',
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
        customEndpointModel: null,
      }
    }
    return null
  }

  private signatureFor(route: InferenceRouteSnapshot): string {
    return `${route.kind}|${route.baseURL}|${route.apiKey}`
  }
}
