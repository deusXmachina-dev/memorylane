import { generateText } from 'ai'
import log from '../logger'
import type { ProviderConfig, ProviderKind } from './provider'
import type { ProviderResolver } from './resolver'

const DEFAULT_PROBE_MODELS: Record<ProviderKind, string | null> = {
  openrouter: 'openai/gpt-4o-mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  google: 'gemini-2.5-flash',
  // openai-compatible servers vary widely; skip unless the user supplied a default model.
  'openai-compatible': null,
}

const DEFAULT_TIMEOUT_MS = 15_000

export type ProviderHealthResult =
  | { state: 'ok'; model: string; latencyMs: number }
  | { state: 'failed'; error: string }
  | { state: 'skipped'; reason: string }

export async function pingProvider(
  resolver: ProviderResolver,
  provider: ProviderConfig,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ProviderHealthResult> {
  const modelId = provider.defaultModel?.trim() || DEFAULT_PROBE_MODELS[provider.kind]
  if (!modelId) {
    return {
      state: 'skipped',
      reason: 'No default model set — health check skipped',
    }
  }

  const startedAt = Date.now()
  try {
    const model = resolver.build(provider, modelId)
    const result = await Promise.race([
      generateText({ model, prompt: 'Reply with the single word OK.' }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ])
    const text = result.text?.trim() ?? ''
    if (text.length === 0) {
      return { state: 'failed', error: 'Empty response from provider' }
    }
    const latencyMs = Date.now() - startedAt
    log.info(
      `[ProviderHealth] Ping ok provider=${provider.id} kind=${provider.kind} model=${modelId} ${latencyMs}ms`,
    )
    return { state: 'ok', model: modelId, latencyMs }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.warn(
      `[ProviderHealth] Ping failed provider=${provider.id} kind=${provider.kind} model=${modelId}: ${error}`,
    )
    return { state: 'failed', error }
  }
}
