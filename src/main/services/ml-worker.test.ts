import { describe, it, expect } from 'vitest'
import { handleMlWorkerRequest } from './ml-worker'
import { packVectors, unpackVectors } from './ml-worker-protocol'
import type { EmbeddingService } from '@main/processor/embedding'

const fakeService = {
  embedBatch: async (texts: string[]) => texts.map(() => [1, 0, 0]),
} as unknown as EmbeddingService

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

  it('maps a thrown error to ok:false', async () => {
    const failing = {
      embedBatch: async () => {
        throw new Error('boom')
      },
    } as unknown as EmbeddingService
    const response = await handleMlWorkerRequest(
      { id: 3, type: 'embedBatch', texts: ['x'] },
      failing,
    )
    expect(response).toEqual({ id: 3, ok: false, error: 'boom' })
  })
})
