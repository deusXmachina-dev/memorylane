export const LLM_IMAGE_MAX_WIDTH = 1920

export const MODEL_PRICING_USD_PER_MILLION: Record<
  string,
  { input_tokens_per_million: number; completion_tokens_per_million: number }
> = {
  'google/gemini-2.5-flash-lite-preview-09-2025': {
    input_tokens_per_million: 0.1,
    completion_tokens_per_million: 0.4,
  },
  'google/gemini-2.5-flash': {
    input_tokens_per_million: 0.3,
    completion_tokens_per_million: 2.5,
  },
  'mistralai/mistral-small-3.2-24b-instruct': {
    input_tokens_per_million: 0.08,
    completion_tokens_per_million: 0.2,
  },
  'google/gemini-2.5-flash-lite': {
    input_tokens_per_million: 0.1,
    completion_tokens_per_million: 0.4,
  },
  'google/gemini-3-flash-preview': {
    input_tokens_per_million: 0.5,
    completion_tokens_per_million: 3,
  },
  'minimax/minimax-m3': {
    input_tokens_per_million: 0.3,
    completion_tokens_per_million: 1.2,
  },
  'google/gemini-3.1-flash-lite': {
    input_tokens_per_million: 0.25,
    completion_tokens_per_million: 1.5,
  },
  'google/gemini-3.1-flash-lite-preview': {
    input_tokens_per_million: 0.25,
    completion_tokens_per_million: 1.5,
  },
  'deepseek/deepseek-v4-flash': {
    input_tokens_per_million: 0.09,
    completion_tokens_per_million: 0.18,
  },
  'xiaomi/mimo-v2.5': {
    input_tokens_per_million: 0.105,
    completion_tokens_per_million: 0.28,
  },
  'tencent/hy3-preview': {
    input_tokens_per_million: 0.063,
    completion_tokens_per_million: 0.21,
  },
  'z-ai/glm-5.2': {
    input_tokens_per_million: 0.93,
    completion_tokens_per_million: 3.0,
  },
  'moonshotai/kimi-k2.5': {
    input_tokens_per_million: 0.375,
    completion_tokens_per_million: 2.025,
  },
  'google/gemini-3.5-flash-lite': {
    input_tokens_per_million: 0.3,
    completion_tokens_per_million: 2.5,
  },
  'google/gemini-3.5-flash': {
    input_tokens_per_million: 1.5,
    completion_tokens_per_million: 9,
  },
  'moonshotai/kimi-k3': {
    input_tokens_per_million: 3,
    completion_tokens_per_million: 15,
  },
  'google/gemini-3.6-flash': {
    input_tokens_per_million: 1.5,
    completion_tokens_per_million: 7.5,
  },
}
