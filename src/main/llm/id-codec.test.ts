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

  it('round-trips across prefixes without collision', () => {
    const aliases = new PositionalAliases()
    aliases.encode('c', 'cluster-uuid')
    aliases.encode('s', 'sighting-uuid')
    expect(aliases.decode('c1')).toBe('cluster-uuid')
    expect(aliases.decode('s1')).toBe('sighting-uuid')
  })

  it('decodes unknown and malformed handles as undefined', () => {
    const aliases = new PositionalAliases()
    aliases.encode('c', 'cluster-uuid')
    expect(aliases.decode('c2')).toBeUndefined()
    expect(aliases.decode('nonsense')).toBeUndefined()
    expect(aliases.decode('')).toBeUndefined()
  })

  it('tolerates surrounding whitespace on decode', () => {
    const aliases = new PositionalAliases()
    aliases.encode('a', 'activity-uuid')
    expect(aliases.decode(' a1 ')).toBe('activity-uuid')
  })

  it('counts unmapped ids and keeps the order of those that resolved', () => {
    const aliases = new PositionalAliases()
    aliases.encode('a', 'first')
    aliases.encode('a', 'second')
    expect(aliases.decodeMany(['a2', 'a9', 'a1'])).toEqual({
      ids: ['second', 'first'],
      unmapped: 1,
    })
  })

  it('exposes a prefix-bound IdCodec view over the same table', () => {
    const aliases = new PositionalAliases()
    const activities = aliases.namespace('a')
    expect(activities.encode('activity-uuid')).toBe('a1')
    expect(aliases.decode('a1')).toBe('activity-uuid')
    expect(activities.decode('a1')).toBe('activity-uuid')
  })
})
