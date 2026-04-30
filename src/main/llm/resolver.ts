import type { LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { ProviderConfig } from './provider'
import type { ProviderRegistry } from './registry'

export class ProviderResolver {
  constructor(private registry: ProviderRegistry) {}

  getActive(): ProviderConfig | null {
    return this.registry.getActive()
  }

  buildActive(modelId: string): LanguageModel {
    const active = this.registry.getActive()
    if (!active) {
      throw new Error('No active LLM provider configured')
    }
    return this.build(active, modelId)
  }

  build(provider: ProviderConfig, modelId: string): LanguageModel {
    const apiKey = this.registry.getApiKey(provider.id)
    if (!apiKey) {
      throw new Error(`Provider ${provider.id} has no API key`)
    }

    switch (provider.kind) {
      case 'openrouter': {
        const factory = createOpenRouter({ apiKey, baseURL: provider.baseURL })
        return factory(modelId)
      }
      case 'openai': {
        const factory = createOpenAI({ apiKey, baseURL: provider.baseURL })
        return factory(modelId)
      }
      case 'anthropic': {
        const factory = createAnthropic({ apiKey, baseURL: provider.baseURL })
        return factory(modelId)
      }
      case 'openai-compatible': {
        if (!provider.baseURL) {
          throw new Error('openai-compatible provider requires baseURL')
        }
        const factory = createOpenAICompatible({
          name: provider.name,
          apiKey,
          baseURL: provider.baseURL,
        })
        return factory(modelId)
      }
    }
  }
}
