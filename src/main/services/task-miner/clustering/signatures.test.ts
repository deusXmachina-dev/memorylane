import { describe, it, expect } from 'vitest'
import { computeAndStoreSignatures } from './signatures'
import type { StorageService } from '@main/storage'
import type { Sighting } from '@main/storage/sighting-repository'

const upserted = new Map<string, number[] | null>()
const upsertSignature: StorageService['clusters']['upsertSignature'] = (id, vector) => {
  upserted.set(id, vector)
}
const storage = { clusters: { upsertSignature } } as StorageService

// Mimics EmbeddingService's blank contract: blank text → zero vector.
const embedder = {
  embedBatch: async (texts: string[]) => {
    seenTexts.push(...texts)
    return texts.map((t) => (t.trim() ? [1, 0] : [0, 0]))
  },
}
const seenTexts: string[] = []

describe('computeAndStoreSignatures', () => {
  it('joins title and description, skipping empty fields', async () => {
    const sightings = [
      { id: 'both', title: 'Fix invoices', description: 'Open portal, export.' },
      { id: 'title-only', title: 'Fix invoices', description: '' },
      { id: 'no-text', title: '', description: '  ' },
    ] as Sighting[]

    const { signatures, unclustered } = await computeAndStoreSignatures(
      storage,
      sightings,
      embedder,
    )

    // A text-less sighting embeds a blank string (zero vector → NULL
    // signature), never a lone ".".
    expect(seenTexts).toEqual(['Fix invoices. Open portal, export.', 'Fix invoices', ''])
    expect(unclustered).toBe(1)
    expect(signatures.map((s) => s.sightingId)).toEqual(['both', 'title-only'])
    expect(upserted.get('no-text')).toBeNull()
  })
})
