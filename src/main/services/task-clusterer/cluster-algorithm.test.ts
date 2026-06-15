import { describe, it, expect } from 'vitest'
import {
  cosine,
  jaccard,
  clusterSightings,
  type ClusterInput,
  type ClusterThresholds,
} from './cluster-algorithm'

const THRESHOLDS: ClusterThresholds = { cosThreshold: 0.82, appThreshold: 0.3, minClusterSize: 2 }

/** Build a unit vector pointing mostly along axis `dim` with a little noise. */
function vec(dim: number, noise = 0): number[] {
  const v = new Array(8).fill(0)
  v[dim] = 1
  if (noise) v[(dim + 1) % 8] = noise
  return v
}

function input(id: string, dim: number, apps: string[], noise = 0): ClusterInput {
  return { id, apps, startedAt: 0, interactionMin: 5, vector: vec(dim, noise) }
}

describe('cosine', () => {
  it('is 1 for identical vectors and 0 for orthogonal', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
  })
  it('handles empty / mismatched vectors', () => {
    expect(cosine([], [])).toBe(0)
    expect(cosine([1, 0], [1, 0, 0])).toBe(0)
  })
})

describe('jaccard', () => {
  it('is case-insensitive and bounded 0..1', () => {
    expect(jaccard(['Chrome', 'Sheets'], ['chrome', 'sheets'])).toBeCloseTo(1)
    expect(jaccard(['Chrome'], ['Slack'])).toBe(0)
    expect(jaccard(['A', 'B'], ['B', 'C'])).toBeCloseTo(1 / 3)
  })
})

describe('clusterSightings', () => {
  it('groups similar same-app sightings and drops singletons', () => {
    const inputs = [
      input('a', 0, ['Chrome', 'Sheets']),
      input('b', 0, ['Chrome', 'Sheets']),
      input('c', 3, ['Slack']), // unrelated one-off → singleton, dropped
    ]
    const groups = clusterSightings(inputs, THRESHOLDS)
    expect(groups).toHaveLength(1)
    expect(groups[0].memberIds).toEqual(['a', 'b'])
  })

  it('does NOT merge semantically similar sightings in different apps', () => {
    const inputs = [
      input('a', 0, ['Chrome']),
      input('b', 0, ['Photoshop']), // same vector, disjoint apps → no link
    ]
    expect(clusterSightings(inputs, THRESHOLDS)).toHaveLength(0)
  })

  it('is deterministic regardless of input order', () => {
    const base = [
      input('a', 0, ['Chrome', 'Sheets']),
      input('b', 0, ['Chrome', 'Sheets']),
      input('c', 1, ['Notion', 'Linear']),
      input('d', 1, ['Notion', 'Linear']),
    ]
    const forward = clusterSightings(base, THRESHOLDS)
    const reversed = clusterSightings([...base].reverse(), THRESHOLDS)
    expect(forward).toEqual(reversed)
    expect(forward).toHaveLength(2)
  })

  it('selects a stable medoid', () => {
    const inputs = [
      input('a', 0, ['Chrome', 'Sheets']),
      input('b', 0, ['Chrome', 'Sheets']),
      input('c', 0, ['Chrome', 'Sheets']),
    ]
    const groups = clusterSightings(inputs, THRESHOLDS)
    expect(groups).toHaveLength(1)
    expect(groups[0].memberIds).toEqual(['a', 'b', 'c'])
    // All equidistant → ties resolve to the lowest id.
    expect(groups[0].medoidId).toBe('a')
  })
})
