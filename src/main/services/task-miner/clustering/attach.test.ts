import { describe, it, expect } from 'vitest'
import { attachToCentroids, averageLinkageGroups } from './attach'
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

describe('averageLinkageGroups', () => {
  it('does not chain: a borderline bridge cannot join dissimilar endpoints', () => {
    // a~b and b~c both clear the threshold but a and c are far apart —
    // single-linkage would chain all three into one group.
    const step = Math.acos(0.8)
    const groups = averageLinkageGroups(
      [
        { sightingId: 'a', vector: u(0) },
        { sightingId: 'b', vector: u(step) },
        { sightingId: 'c', vector: u(2 * step) }, // cos(a,c) = 2·0.8² − 1 = 0.28
        { sightingId: 'lone', vector: [0, -1] },
      ],
      0.75,
    )
    // a-b merge at 0.8; then mean({a,b}, c) = (0.8 + 0.28)/2 = 0.54 < 0.75.
    const sorted = groups.map((g) => [...g].sort())
    expect(sorted).toContainEqual(['a', 'b'])
    expect(sorted).toContainEqual(['c'])
    expect(sorted).toContainEqual(['lone'])
  })

  it('groups members that are similar on average', () => {
    const step = Math.acos(0.95)
    const groups = averageLinkageGroups(
      [
        { sightingId: 'a', vector: u(0) },
        { sightingId: 'b', vector: u(step) },
        { sightingId: 'c', vector: u(2 * step) }, // cos(a,c) ≈ 0.805
      ],
      0.75,
    )
    expect(groups.map((g) => [...g].sort())).toContainEqual(['a', 'b', 'c'])
  })

  it('returns singletons as one-member groups', () => {
    const groups = averageLinkageGroups(
      [
        { sightingId: 'a', vector: [1, 0] },
        { sightingId: 'b', vector: [0, 1] },
      ],
      0.75,
    )
    expect(groups.map((g) => [...g].sort())).toEqual([['a'], ['b']])
  })

  it('handles empty input', () => {
    expect(averageLinkageGroups([], 0.75)).toEqual([])
  })

  it('normalize() output composes with the threshold as cosine', () => {
    const a = normalize([2, 0])!
    const b = normalize([3, 3])! // 45° apart → cos ≈ 0.707 < 0.75
    expect(
      averageLinkageGroups(
        [
          { sightingId: 'a', vector: a },
          { sightingId: 'b', vector: b },
        ],
        0.75,
      ),
    ).toHaveLength(2)
  })

  it('a non-finite vector sits out as a singleton without corrupting real groups', () => {
    // NaN distances corrupt agnes (duplicated groups, dropped members) —
    // every index must come back in exactly one group.
    const step = Math.acos(0.95)
    const groups = averageLinkageGroups(
      [
        { sightingId: 'a', vector: u(0) },
        { sightingId: 'poisoned', vector: [NaN, NaN] },
        { sightingId: 'b', vector: u(step) },
        { sightingId: 'zero', vector: [0, 0] },
      ],
      0.75,
    )
    const sorted = groups.map((g) => [...g].sort())
    expect(sorted).toContainEqual(['a', 'b'])
    expect(sorted).toContainEqual(['poisoned'])
    expect(sorted).toContainEqual(['zero'])
    expect(groups.flat().sort()).toEqual(['a', 'b', 'poisoned', 'zero'])
  })
})
