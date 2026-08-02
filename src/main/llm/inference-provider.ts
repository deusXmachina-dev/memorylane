import type { LanguageModel } from 'ai'
import type { Vendor, VendorCredentials } from '../../shared/types'
import type { VendorCredentialsManager } from '../settings/vendor-credentials-manager'
import { createSdkProvider, rawHttpBaseURL, vendorSupportsRawHttp } from './adapters'
import log from '@main/utils/logger'

export interface VendorRouteSnapshot {
  vendor: Vendor
  baseURL: string
  apiKey: string
}

export interface InferenceProvider {
  /** True when the *active* vendor has usable credentials. */
  isConfigured(): boolean
  /** Currently active vendor. */
  getActiveVendor(): Vendor
  /**
   * Resolve a Vercel AI SDK LanguageModel for the active vendor and given
   * model id. Throws when the active vendor is not configured. Deadlines are
   * the caller's: pass `timeout` on the generateText call.
   */
  languageModel(modelId: string): LanguageModel
  /**
   * Snapshot of the active route's wire-level details. Returns non-null only
   * for vendors that speak the OpenAI-compatible chat-completions wire format
   * ('openrouter', 'openai-compatible'). Used by the raw-HTTP video pipeline.
   */
  getRouteSnapshot(): VendorRouteSnapshot | null
  /** Invalidate cached SDK providers and notify listeners. */
  notifyConfigChanged(): void
  onConfigChanged(listener: () => void): () => void
}

export interface InferenceProviderOptions {
  credentials: VendorCredentialsManager
  /**
   * Accessor returning the currently active vendor. Typically reads from
   * CaptureSettingsManager.
   */
  getActiveVendor: () => Vendor
  /** Optional fetch override forwarded to all underlying SDK providers (tests). */
  fetch?: typeof globalThis.fetch
}

/**
 * Deadline for callers that emit a bounded response (a summary, a judgement, a
 * user-context blob) and finish in seconds. Pass it as `timeout` on the
 * generateText call. Callers whose output is genuinely long-running pass their
 * own — see the activityRequestTimeoutMs and taskMiningRequestTimeoutMs
 * settings.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 3 * 60 * 1000

interface CacheEntry {
  signature: string
  sdkProvider: { languageModel(modelId: string): LanguageModel }
}

export class InferenceProviderImpl implements InferenceProvider {
  private readonly credentials: VendorCredentialsManager
  private readonly getActiveVendorAccessor: () => Vendor
  private readonly customFetch: typeof globalThis.fetch | undefined
  private readonly sdkCache = new Map<string, CacheEntry>()
  private readonly loggedRouteSnapshots = new Set<string>()
  private readonly listeners = new Set<() => void>()

  constructor(options: InferenceProviderOptions) {
    this.credentials = options.credentials
    this.getActiveVendorAccessor = options.getActiveVendor
    this.customFetch = options.fetch
  }

  isConfigured(): boolean {
    return this.credentials.getCredentials(this.getActiveVendor()) !== null
  }

  getActiveVendor(): Vendor {
    return this.getActiveVendorAccessor()
  }

  languageModel(modelId: string): LanguageModel {
    const vendor = this.getActiveVendor()
    const creds = this.credentials.getCredentials(vendor)
    if (!creds) {
      throw new Error(`InferenceProvider: vendor "${vendor}" is not configured`)
    }
    const signature = signatureFor(creds)
    const cached = this.sdkCache.get(vendor)
    if (cached && cached.signature === signature) {
      return cached.sdkProvider.languageModel(modelId)
    }
    const sdkProvider = createSdkProvider(vendor, creds, { fetch: this.customFetch })
    this.sdkCache.set(vendor, { signature, sdkProvider })
    log.info(`[InferenceProvider] built provider ${describeRoute(vendor, creds)}`)
    return sdkProvider.languageModel(modelId)
  }

  getRouteSnapshot(): VendorRouteSnapshot | null {
    const vendor = this.getActiveVendor()
    if (!vendorSupportsRawHttp(vendor)) return null
    const creds = this.credentials.getCredentials(vendor)
    if (!creds) return null
    const baseURL = rawHttpBaseURL(vendor, creds)
    const routeKey = `${vendor}|${baseURL}`
    if (!this.loggedRouteSnapshots.has(routeKey)) {
      this.loggedRouteSnapshots.add(routeKey)
      log.info(`[InferenceProvider] route snapshot vendor=${vendor} baseURL=${baseURL}`)
    }
    return {
      vendor,
      baseURL,
      apiKey: creds.apiKey,
    }
  }

  notifyConfigChanged(): void {
    this.sdkCache.clear()
    this.loggedRouteSnapshots.clear()
    log.info(
      `[InferenceProvider] config changed; sdk cache cleared; active vendor=${this.getActiveVendor()}`,
    )
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
}

function signatureFor(creds: VendorCredentials): string {
  return `${creds.baseURL ?? ''}|${creds.project ?? ''}|${creds.location ?? ''}|${creds.apiKey}`
}

function describeRoute(vendor: Vendor, creds: VendorCredentials): string {
  const apiKeyTail = creds.apiKey.length >= 4 ? creds.apiKey.slice(-4) : '****'
  const apiKey = `apiKey=…${apiKeyTail}`
  if (vendor === 'google') {
    return `vendor=${vendor} project=${creds.project ?? '?'} location=${creds.location ?? '?'} ${apiKey}`
  }
  return `vendor=${vendor} baseURL=${creds.baseURL ?? '(default)'} ${apiKey}`
}
