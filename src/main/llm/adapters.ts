import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { Vendor, VendorCredentials } from '../../shared/types'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

interface SdkProvider {
  languageModel(modelId: string): LanguageModel
}

export interface AdapterDeps {
  /** Optional fetch override forwarded to the underlying SDK (test seam). */
  fetch?: typeof globalThis.fetch
}

/**
 * Build a Vercel AI SDK provider for a vendor. Returns a uniform interface
 * exposing `languageModel(id)`. Throws if the credentials are insufficient
 * for the vendor (e.g. missing baseURL for openai-compatible).
 */
export function createSdkProvider(
  vendor: Vendor,
  creds: VendorCredentials,
  deps: AdapterDeps = {},
): SdkProvider {
  const fetchImpl = deps.fetch
  switch (vendor) {
    case 'openrouter':
      return createOpenAICompatible({
        baseURL: OPENROUTER_BASE_URL,
        name: 'openrouter',
        apiKey: creds.apiKey,
        fetch: fetchImpl,
      }) as SdkProvider
    case 'openai':
      return createOpenAI({
        apiKey: creds.apiKey,
        baseURL: creds.baseURL,
        fetch: fetchImpl,
      }) as unknown as SdkProvider
    case 'anthropic':
      return createAnthropic({
        apiKey: creds.apiKey,
        baseURL: creds.baseURL,
        fetch: fetchImpl,
      }) as unknown as SdkProvider
    case 'google':
      return createGoogleGenerativeAI({
        apiKey: creds.apiKey,
        fetch: fetchImpl,
      }) as unknown as SdkProvider
    case 'openai-compatible': {
      if (!creds.baseURL) {
        throw new Error('openai-compatible vendor requires a baseURL')
      }
      return createOpenAICompatible({
        baseURL: creds.baseURL,
        name: 'openai-compatible',
        apiKey: creds.apiKey,
        fetch: fetchImpl,
      }) as SdkProvider
    }
  }
}

/**
 * Whether the vendor can be reached via raw OpenAI-compatible chat-completions
 * HTTP. Only these vendors expose a usable `getRouteSnapshot()`; native vendors
 * (openai, anthropic, google) go through the AI SDK exclusively.
 */
export function vendorSupportsRawHttp(vendor: Vendor): boolean {
  return vendor === 'openrouter' || vendor === 'openai-compatible'
}

export function rawHttpBaseURL(vendor: Vendor, creds: VendorCredentials): string {
  switch (vendor) {
    case 'openrouter':
      return OPENROUTER_BASE_URL
    case 'openai-compatible':
      if (!creds.baseURL) throw new Error('openai-compatible vendor requires a baseURL')
      return creds.baseURL
    default:
      throw new Error(`vendor ${vendor} does not support raw HTTP`)
  }
}
