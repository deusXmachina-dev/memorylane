import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, afterEach } from 'vitest'
import { pipeline, env } from '@huggingface/transformers'

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const BUNDLE_DIR = path.resolve(__dirname, '..', '..', '..', 'build', 'models')
const MODEL_DIR = path.join(BUNDLE_DIR, MODEL_ID)

const REQUIRED_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model.onnx']

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

    const pipe = await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' })
    const result = await pipe('test sentence', { pooling: 'mean', normalize: true })
    const vector = Array.from(result.data as Float32Array)

    expect(vector.length).toBe(384)
    expect(typeof vector[0]).toBe('number')
    expect(isNaN(vector[0])).toBe(false)
  })
})
