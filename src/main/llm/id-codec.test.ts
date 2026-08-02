import { describe, it, expect } from 'vitest'
import { PositionalAliases } from './id-codec'

describe('PositionalAliases', () => {
  it('numbers from one and mints on first encode', () => {
    const clusters = new PositionalAliases('c')
    expect(clusters.encode('cluster-uuid')).toBe('c1')
    expect(clusters.encode('other-cluster')).toBe('c2')
  })

  it('numbers independently per instance', () => {
    const clusters = new PositionalAliases('c')
    const sightings = new PositionalAliases('s')
    expect(clusters.encode('cluster-uuid')).toBe('c1')
    expect(sightings.encode('sighting-uuid')).toBe('s1')
    expect(clusters.encode('other-cluster')).toBe('c2')
  })

  it('returns the same handle for a repeated id', () => {
    const aliases = new PositionalAliases('a')
    const first = aliases.encode('activity-uuid')
    expect(aliases.encode('activity-uuid')).toBe(first)
    expect(aliases.encode('another')).toBe('a2')
  })

  it('gives one id encoded by two instances a handle per instance', () => {
    const clusters = new PositionalAliases('c')
    const sightings = new PositionalAliases('s')
    expect(clusters.encode('shared')).toBe('c1')
    expect(sightings.encode('shared')).toBe('s1')
    expect(clusters.decode('c1')).toBe('shared')
    expect(sightings.decode('s1')).toBe('shared')
  })

  it('refuses a handle minted by another instance', () => {
    const clusters = new PositionalAliases('c')
    const sightings = new PositionalAliases('s')
    clusters.encode('cluster-uuid')
    sightings.encode('sighting-uuid')
    expect(clusters.decode('s1')).toBeUndefined()
    expect(sightings.decode('c1')).toBeUndefined()
  })

  it('decodes unknown, malformed and non-string handles as undefined', () => {
    const aliases = new PositionalAliases('c')
    aliases.encode('cluster-uuid')
    expect(aliases.decode('c2')).toBeUndefined()
    expect(aliases.decode('nonsense')).toBeUndefined()
    expect(aliases.decode('c1x')).toBeUndefined()
    expect(aliases.decode('')).toBeUndefined()
    expect(aliases.decode(1)).toBeUndefined()
    expect(aliases.decode(undefined)).toBeUndefined()
    expect(aliases.decode({ id: 'c1' })).toBeUndefined()
  })

  it('tolerates surrounding whitespace on decode', () => {
    const aliases = new PositionalAliases('a')
    aliases.encode('activity-uuid')
    expect(aliases.decode(' a1 ')).toBe('activity-uuid')
  })

  it('counts unmapped ids and keeps the order of those that resolved', () => {
    const aliases = new PositionalAliases('a')
    aliases.encode('first')
    aliases.encode('second')
    expect(aliases.decodeMany(['a2', 'a9', 'a1', 7])).toEqual({
      ids: ['second', 'first'],
      unmapped: 2,
    })
  })

  it('reads an empty list as nothing lost and a non-list as one lost reference', () => {
    const aliases = new PositionalAliases('a')
    expect(aliases.decodeMany([])).toEqual({ ids: [], unmapped: 0 })
    expect(aliases.decodeMany(undefined)).toEqual({ ids: [], unmapped: 1 })
    expect(aliases.decodeMany('a1')).toEqual({ ids: [], unmapped: 1 })
    expect(aliases.decodeMany({ a1: true })).toEqual({ ids: [], unmapped: 1 })
  })
})
