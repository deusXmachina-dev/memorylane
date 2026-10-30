import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, afterEach } from 'vitest'
import { env } from '@huggingface/transformers'
import { EmbeddingService } from './embedding'
import { EMBEDDING_MODEL as MODEL_ID } from './embedding-model'

const BUNDLE_DIR = path.resolve(__dirname, '..', '..', '..', 'build', 'models')
const MODEL_DIR = path.join(BUNDLE_DIR, MODEL_ID)

const REQUIRED_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
]

describe('bundled embedding model', () => {
  it('download script produced all required files', () => {
    for (const file of REQUIRED_FILES) {
      const filePath = path.join(MODEL_DIR, file)
      expect(fs.existsSync(filePath), `missing: ${file}`).toBe(true)
      const stat = fs.statSync(filePath)
      expect(stat.size, `${file} is empty`).toBeGreaterThan(0)
    }
  })

  it('model loads fully offline from bundled path', { timeout: 30000 }, async () => {
    // Poison fetch so any network call fails the test immediately
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('Network call detected — bundled model should load without fetch')
    }) as typeof fetch
    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    env.localModelPath = BUNDLE_DIR
    env.allowRemoteModels = false

    const vector = await new EmbeddingService().generateEmbedding('test sentence')

    expect(vector.length).toBe(384)
    expect(typeof vector[0]).toBe('number')
    expect(isNaN(vector[0])).toBe(false)
  })
})
