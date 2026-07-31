import { describe, it, expect } from 'vitest'
import { PositionalAliases } from './id-codec'

describe('PositionalAliases', () => {
  it('numbers per prefix and mints on first encode', () => {
    const aliases = new PositionalAliases()
    expect(aliases.encode('c', 'cluster-uuid')).toBe('c1')
    expect(aliases.encode('s', 'sighting-uuid')).toBe('s1')
    expect(aliases.encode('c', 'other-cluster')).toBe('c2')
  })

  it('returns the same handle for a repeated id', () => {
    const aliases = new PositionalAliases()
    const first = aliases.encode('a', 'activity-uuid')
    expect(aliases.encode('a', 'activity-uuid')).toBe(first)
    expect(aliases.encode('a', 'another')).toBe('a2')
  })

  it('gives one id encoded under two prefixes a handle per prefix', () => {
    const aliases = new PositionalAliases()
    expect(aliases.encode('c', 'shared')).toBe('c1')
    expect(aliases.encode('s', 'shared')).toBe('s1')
    expect(aliases.decode('c', 'c1')).toBe('shared')
    expect(aliases.decode('s', 's1')).toBe('shared')
  })

  it('round-trips across prefixes without collision', () => {
    const aliases = new PositionalAliases()
    aliases.encode('c', 'cluster-uuid')
    aliases.encode('s', 'sighting-uuid')
    expect(aliases.decode('c', 'c1')).toBe('cluster-uuid')
    expect(aliases.decode('s', 's1')).toBe('sighting-uuid')
  })

  it('refuses a handle minted under another prefix', () => {
    const aliases = new PositionalAliases()
    aliases.encode('c', 'cluster-uuid')
    aliases.encode('s', 'sighting-uuid')
    expect(aliases.decode('c', 's1')).toBeUndefined()
    expect(aliases.decode('s', 'c1')).toBeUndefined()
  })

  it('decodes unknown, malformed and non-string handles as undefined', () => {
    const aliases = new PositionalAliases()
    aliases.encode('c', 'cluster-uuid')
    expect(aliases.decode('c', 'c2')).toBeUndefined()
    expect(aliases.decode('c', 'nonsense')).toBeUndefined()
    expect(aliases.decode('c', 'c1x')).toBeUndefined()
    expect(aliases.decode('c', '')).toBeUndefined()
    expect(aliases.decode('c', 1)).toBeUndefined()
    expect(aliases.decode('c', undefined)).toBeUndefined()
    expect(aliases.decode('c', { id: 'c1' })).toBeUndefined()
  })

  it('tolerates surrounding whitespace on decode', () => {
    const aliases = new PositionalAliases()
    aliases.encode('a', 'activity-uuid')
    expect(aliases.decode('a', ' a1 ')).toBe('activity-uuid')
  })

  it('counts unmapped ids and keeps the order of those that resolved', () => {
    const aliases = new PositionalAliases()
    aliases.encode('a', 'first')
    aliases.encode('a', 'second')
    expect(aliases.decodeMany('a', ['a2', 'a9', 'a1', 7])).toEqual({
      ids: ['second', 'first'],
      unmapped: 2,
    })
  })

  it('reports a non-array id list as unmapped instead of throwing', () => {
    const aliases = new PositionalAliases()
    expect(aliases.decodeMany('a', undefined)).toEqual({ ids: [], unmapped: 1 })
    expect(aliases.decodeMany('a', { a1: true } as never)).toEqual({ ids: [], unmapped: 1 })
  })
})
