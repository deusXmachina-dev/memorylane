import { describe, it, expect } from 'vitest'
import { handleMlWorkerRequest } from './ml-worker'
import { packVectors, unpackVectors } from './ml-worker-protocol'
import { PiiScrubber } from '@main/processor/pii-scrub'
import type { EmbeddingService } from '@main/processor/embedding'

const fakeService = {
  embedBatch: async (texts: string[]) => texts.map(() => [1, 0, 0]),
} as EmbeddingService

describe('packVectors / unpackVectors', () => {
  it('round-trips row vectors through one buffer', () => {
    const vectors = [
      [1, 0.5, -0.25],
      [0, -1, 2],
    ]
    const { buffer, dims } = packVectors(vectors)
    expect(dims).toBe(3)
    expect(unpackVectors(buffer, dims)).toEqual(vectors)
  })

  it('handles empty input', () => {
    const { buffer, dims } = packVectors([])
    expect(unpackVectors(buffer, dims)).toEqual([])
  })
})

describe('handleMlWorkerRequest', () => {
  it('embedBatch returns packed vectors', async () => {
    const response = await handleMlWorkerRequest(
      { id: 1, type: 'embedBatch', texts: ['a', 'b'] },
      fakeService,
    )
    expect(response.ok).toBe(true)
    if (!response.ok || response.result.type !== 'vectors') throw new Error('wrong response')
    expect(unpackVectors(response.result.vectors, response.result.dims)).toEqual([
      [1, 0, 0],
      [1, 0, 0],
    ])
  })

  it('clusterVectors groups by average linkage at the threshold', async () => {
    const { buffer, dims } = packVectors([
      [1, 0],
      [1, 0],
      [0, 1],
    ])
    const response = await handleMlWorkerRequest(
      { id: 2, type: 'clusterVectors', vectors: buffer, dims, threshold: 0.65 },
      fakeService,
    )
    expect(response.ok).toBe(true)
    if (!response.ok || response.result.type !== 'groups') throw new Error('wrong response')
    expect(response.result.groups).toEqual([[0, 1], [2]])
  })

  it('scrubBatch returns scrubbed texts', async () => {
    const scrubber = new PiiScrubber(async () => [
      { entity: 'B-GIVENNAME', score: 0.9, index: 1, word: 'jane', start: null, end: null },
    ])
    const response = await handleMlWorkerRequest(
      { id: 4, type: 'scrubBatch', texts: ['ping Jane about it'] },
      fakeService,
      scrubber,
    )
    expect(response.ok).toBe(true)
    if (!response.ok || response.result.type !== 'scrubbed') throw new Error('wrong response')
    expect(response.result.texts).toEqual(['ping [redacted name] about it'])
  })

  it('maps a thrown error to ok:false', async () => {
    const failingEmbedBatch: EmbeddingService['embedBatch'] = async () => {
      throw new Error('boom')
    }
    const failing = { embedBatch: failingEmbedBatch } as EmbeddingService
    const response = await handleMlWorkerRequest(
      { id: 3, type: 'embedBatch', texts: ['x'] },
      failing,
    )
    expect(response).toEqual({ id: 3, ok: false, error: 'boom' })
  })
})
