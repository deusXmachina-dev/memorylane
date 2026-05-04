import type { Vendor } from '../../shared/types'

export function videoUnsupportedCacheKey(input: {
  vendor: Vendor
  baseURL: string | null
  model: string | null
}): string | null {
  if (input.vendor !== 'openai-compatible') return null
  if (!input.baseURL || !input.model) return null
  return `${input.baseURL}::${input.model}`
}

export function isLikelyVideoUnsupportedError(message: string): boolean {
  const text = message.toLowerCase()
  if (text.includes('input_video')) return true
  if (text.includes('invalid message format')) return true

  const hasVideoCue = ['video', 'mp4'].some((cue) => text.includes(cue))
  if (!hasVideoCue) return false

  return [
    'unsupported',
    'not supported',
    'does not support',
    'only image',
    'images only',
    'invalid type',
    'unknown type',
  ].some((cue) => text.includes(cue))
}
