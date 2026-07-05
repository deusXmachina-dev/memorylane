import { describe, it, expect } from 'vitest'
import { attachToCentroids, clusterLeftovers } from './attach'
import { normalize } from './vector-math'

// Unit vector at `angle` radians from the x-axis; dot(u(0), u(a)) = cos(a).
const u = (angle: number): number[] => [Math.cos(angle), Math.sin(angle)]

describe('attachToCentroids', () => {
  const centroids = [
    { clusterId: 'cx', centroid: u(0) },
    { clusterId: 'cy', centroid: [0, 1] },
  ]

  it('attaches at or above the threshold, leaves the rest', () => {
    const justAbove = u(Math.acos(0.751))
    const justBelow = u(Math.acos(0.749))
    const { attached, leftovers } = attachToCentroids(
      [
        { sightingId: 's1', vector: justAbove },
        { sightingId: 's2', vector: justBelow },
      ],
      centroids,
      0.75,
    )
    expect(attached).toEqual([{ sightingId: 's1', clusterId: 'cx' }])
    expect(leftovers.map((l) => l.sightingId)).toEqual(['s2'])
  })

  it('picks the best-matching cluster, not the first passing one', () => {
    // 80° from x-axis → cos 10° ≈ 0.98 to the y-cluster, cos 80° ≈ 0.17 to x.
    const nearY = u((80 * Math.PI) / 180)
    const { attached } = attachToCentroids([{ sightingId: 's', vector: nearY }], centroids, 0.75)
    expect(attached).toEqual([{ sightingId: 's', clusterId: 'cy' }])
  })

  it('leaves everything when there are no centroids', () => {
    const { attached, leftovers } = attachToCentroids([{ sightingId: 's', vector: u(0) }], [], 0.75)
    expect(attached).toEqual([])
    expect(leftovers).toHaveLength(1)
  })
})

describe('clusterLeftovers', () => {
  it('groups by transitive similarity and keeps dissimilar ones apart', () => {
    // a-b similar, b-c similar, but a-c below threshold → still one group.
    const step = Math.acos(0.8)
    const groups = clusterLeftovers(
      [
        { sightingId: 'a', vector: u(0) },
        { sightingId: 'b', vector: u(step) },
        { sightingId: 'c', vector: u(2 * step) },
        { sightingId: 'lone', vector: [0, -1] },
      ],
      0.75,
    )
    const sorted = groups.map((g) => [...g].sort())
    expect(sorted).toContainEqual(['a', 'b', 'c'])
    expect(sorted).toContainEqual(['lone'])
  })

  it('returns singletons as one-member groups', () => {
    const groups = clusterLeftovers(
      [
        { sightingId: 'a', vector: [1, 0] },
        { sightingId: 'b', vector: [0, 1] },
      ],
      0.75,
    )
    expect(groups.map((g) => [...g].sort())).toEqual([['a'], ['b']])
  })

  it('handles empty input', () => {
    expect(clusterLeftovers([], 0.75)).toEqual([])
  })

  it('normalize() output composes with the threshold as cosine', () => {
    const a = normalize([2, 0])!
    const b = normalize([3, 3])! // 45° apart → cos ≈ 0.707 < 0.75
    expect(
      clusterLeftovers(
        [
          { sightingId: 'a', vector: a },
          { sightingId: 'b', vector: b },
        ],
        0.75,
      ),
    ).toHaveLength(2)
  })
})
