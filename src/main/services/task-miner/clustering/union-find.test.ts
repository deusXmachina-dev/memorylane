import { describe, it, expect } from 'vitest'
import { UnionFind } from './union-find'

describe('UnionFind', () => {
  it('starts with every element its own component', () => {
    const uf = new UnionFind(3)
    expect(uf.components()).toEqual([[0], [1], [2]])
  })

  it('groups transitively (single-linkage): A-B and B-C puts A,B,C together', () => {
    const uf = new UnionFind(4)
    uf.union(0, 1)
    uf.union(1, 2)
    const components = uf.components().map((c) => c.sort())
    expect(components).toContainEqual([0, 1, 2])
    expect(components).toContainEqual([3])
  })

  it('is idempotent on repeated unions', () => {
    const uf = new UnionFind(2)
    uf.union(0, 1)
    uf.union(1, 0)
    expect(uf.components()).toEqual([[0, 1]])
  })

  it('handles n = 0', () => {
    expect(new UnionFind(0).components()).toEqual([])
  })
})
