import { describe, it, expect } from 'vitest'
import { aliasReviewInput, resolveReviewOutput } from './id-alias'
import type { ReviewCluster, ReviewInput, ReviewSighting } from './types'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

function sighting(id: string): ReviewSighting {
  return {
    sighting_id: id,
    title: 'Process invoice',
    subject: 'Invoice #4471',
    description: 'd',
    apps: ['app.example.com'],
    active_min: 5,
    date: '2026-07-30',
  }
}

function cluster(id: string, memberIds: string[]): ReviewCluster {
  return {
    id,
    splittable: true,
    label: '',
    stats: { times_seen: memberIds.length, span_days: 3, median_active_min: 5 },
    members: memberIds.map(sighting),
  }
}

const input: ReviewInput = {
  clusters: [cluster(UUID_A, ['s-a1', 's-a2']), cluster(UUID_B, ['s-b1'])],
  mergeCandidates: [[UUID_A, UUID_B]],
}

describe('aliasReviewInput', () => {
  it('replaces every uuid with a short handle', () => {
    const { input: aliased } = aliasReviewInput(input)
    const serialized = JSON.stringify(aliased)

    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(aliased.clusters[0].id).toBe('c1')
    expect(aliased.clusters[1].id).toBe('c2')
    expect(aliased.mergeCandidates).toEqual([['c1', 'c2']])
  })

  it('numbers sightings across the whole payload, not per cluster', () => {
    const { input: aliased } = aliasReviewInput(input)
    expect(aliased.clusters[0].members.map((m) => m.sighting_id)).toEqual(['s1', 's2'])
    expect(aliased.clusters[1].members.map((m) => m.sighting_id)).toEqual(['s3'])
  })

  it('leaves everything but the ids alone', () => {
    const { input: aliased } = aliasReviewInput(input)
    expect(aliased.clusters[0].stats).toEqual(input.clusters[0].stats)
    expect(aliased.clusters[0].members[0].subject).toBe('Invoice #4471')
  })
})

describe('resolveReviewOutput', () => {
  it('round-trips verdicts, splits and merges back to real ids', () => {
    const { aliases } = aliasReviewInput(input)

    const { output, unresolved } = resolveReviewOutput(
      {
        clusters: [
          { id: 'c1', label: 'Process invoice', split: [{ sighting_ids: ['s1'] }] },
          { id: 'c2', label: 'Other' },
        ],
        merges: [{ merge: ['c1', 'c2'] }],
      },
      aliases,
    )

    expect(unresolved).toBe(0)
    expect(output?.clusters?.[0].id).toBe(UUID_A)
    expect(output?.clusters?.[0].split).toEqual([{ sighting_ids: ['s-a1'] }])
    expect(output?.clusters?.[1].id).toBe(UUID_B)
    expect(output?.merges).toEqual([{ merge: [UUID_A, UUID_B] }])
  })

  it('drops a verdict whose own id will not decode, keeping its siblings', () => {
    const { aliases } = aliasReviewInput(input)

    const { output, unresolved } = resolveReviewOutput(
      { clusters: [{ id: 'c9', label: 'Invented' }, { id: 'c2' }] },
      aliases,
    )

    expect(output?.clusters).toHaveLength(1)
    expect(output?.clusters?.[0].id).toBe(UUID_B)
    expect(unresolved).toBe(1)
  })

  it('drops both verdicts when two claim the same cluster', () => {
    const { aliases } = aliasReviewInput(input)

    const { output, unresolved } = resolveReviewOutput(
      {
        clusters: [
          { id: 'c1', label: 'Process invoice' },
          { id: 'c1', label: 'Reconcile payouts' },
          { id: 'c2', label: 'Other' },
        ],
      },
      aliases,
    )

    expect(output?.clusters).toEqual([{ id: UUID_B, label: 'Other', split: undefined }])
    expect(unresolved).toBe(2)
  })

  it('drops a verdict citing a sighting handle as its cluster id', () => {
    const { aliases } = aliasReviewInput(input)

    const { output } = resolveReviewOutput(
      { clusters: [{ id: 's1', label: 'Wrong kind' }] },
      aliases,
    )

    expect(output?.clusters).toEqual([])
  })

  it('drops undecodable sighting ids from a split, keeping the rest', () => {
    const { aliases } = aliasReviewInput(input)

    const { output, unresolved } = resolveReviewOutput(
      {
        clusters: [
          { id: 'c1', split: [{ sighting_ids: ['s1', 's99'] }, { sighting_ids: ['s2'] }] },
        ],
      },
      aliases,
    )

    expect(output?.clusters?.[0].split).toEqual([
      { sighting_ids: ['s-a1'] },
      { sighting_ids: ['s-a2'] },
    ])
    expect(unresolved).toBe(1)
  })

  it('drops only the unreadable merge proposal and marks the list incomplete', () => {
    const { aliases } = aliasReviewInput(input)

    const { output, unresolved, mergesIncomplete } = resolveReviewOutput(
      { clusters: [], merges: [{ merge: ['c1', 'c2'] }, { merge: ['c1', 'c7'] }] },
      aliases,
    )

    expect(output?.merges).toEqual([{ merge: [UUID_A, UUID_B] }])
    expect(mergesIncomplete).toBe(true)
    expect(unresolved).toBe(1)
  })

  it('keeps the cluster verdicts when a merge proposal is dropped', () => {
    const { aliases } = aliasReviewInput(input)

    const { output, mergesIncomplete } = resolveReviewOutput(
      { clusters: [{ id: 'c1', label: 'Process invoice' }], merges: [{ merge: ['c1', 'c7'] }] },
      aliases,
    )

    expect(output?.clusters).toEqual([{ id: UUID_A, label: 'Process invoice' }])
    expect(output?.merges).toEqual([])
    expect(mergesIncomplete).toBe(true)
  })

  it('leaves a fully readable merge list complete', () => {
    const { aliases } = aliasReviewInput(input)
    const { output, mergesIncomplete } = resolveReviewOutput(
      { merges: [{ merge: ['c1', 'c2'] }] },
      aliases,
    )
    expect(output?.merges).toEqual([{ merge: [UUID_A, UUID_B] }])
    expect(mergesIncomplete).toBe(false)
  })

  it('keeps an empty merges array — it is a real answer that declines candidates', () => {
    const { aliases } = aliasReviewInput(input)
    const { output, mergesIncomplete } = resolveReviewOutput({ clusters: [], merges: [] }, aliases)
    expect(output?.merges).toEqual([])
    expect(mergesIncomplete).toBe(false)
  })

  it('leaves an absent merges key absent', () => {
    const { aliases } = aliasReviewInput(input)
    const { output } = resolveReviewOutput({ clusters: [] }, aliases)
    expect(output && 'merges' in output).toBe(false)
  })

  it('rejects a response that is not a JSON object', () => {
    const { aliases } = aliasReviewInput(input)

    expect(resolveReviewOutput(null, aliases).output).toBeNull()
    expect(resolveReviewOutput('{"clusters":[]}', aliases).output).toBeNull()
    expect(resolveReviewOutput([{ id: 'c1' }], aliases).output).toBeNull()
  })

  it('tolerates malformed shapes instead of throwing', () => {
    const { aliases } = aliasReviewInput(input)
    const malformed = (value: unknown) => resolveReviewOutput(value, aliases)

    expect(malformed({ clusters: {} }).output).toBeNull()
    expect(malformed({ merges: {} }).output).toBeNull()
    expect(malformed({ merges: ['c1'] }).output?.merges).toEqual([])
    expect(malformed({ merges: ['c1'] }).mergesIncomplete).toBe(true)
    expect(malformed({ clusters: [null, 3, { id: 5 }] }).output?.clusters).toEqual([])

    const badSplit = malformed({ clusters: [{ id: 'c1', label: 'Keep', split: {} }] })
    expect(badSplit.output?.clusters).toEqual([{ id: UUID_A, label: 'Keep' }])
    expect(badSplit.unresolved).toBe(1)

    const badGroup = malformed({ clusters: [{ id: 'c1', split: [{ sighting_ids: 's1' }, 4] }] })
    expect(badGroup.output?.clusters?.[0].split).toEqual([
      { sighting_ids: [] },
      { sighting_ids: [] },
    ])
    expect(badGroup.unresolved).toBe(2)
  })
})
