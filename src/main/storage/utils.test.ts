import { describe, it, expect } from 'vitest'
import { anyWordFtsQuery, rrf } from './utils'

describe('anyWordFtsQuery', () => {
  it('ORs quoted tokens', () => {
    expect(anyWordFtsQuery('faktura  "Alza"')).toBe('"faktura" OR """Alza"""')
  })

  it('returns the empty phrase for blank input', () => {
    expect(anyWordFtsQuery('   ')).toBe('""')
  })
})

describe('rrf', () => {
  const ids = (items: { id: string }[]): string[] => items.map((i) => i.id)

  it('ranks items found by both lists above single-list hits', () => {
    const fused = rrf([
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ id: 'c' }, { id: 'd' }],
    ])
    expect(ids(fused)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('keeps the first copy of each item', () => {
    const fused = rrf([[{ id: 'x', from: 'vector' }], [{ id: 'x', from: 'fts' }]])
    expect(fused).toEqual([{ id: 'x', from: 'vector' }])
  })
})
