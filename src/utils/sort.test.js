import { describe, it, expect } from 'vitest'
import { sortLinks, SORT_OPTIONS, SORT_VALUES, DEFAULT_SORT } from './sort.js'

function link(id, createdAt, title = '', extra = {}) {
  return { id, createdAt, title, normalizedUrl: `https://example.com/${id}`, ...extra }
}

describe('sortLinks', () => {
  const A = link('a', '2026-01-01T00:00:00.000Z', 'Alpha')
  const B = link('b', '2026-01-02T00:00:00.000Z', 'beta')
  const C = link('c', '2026-01-03T00:00:00.000Z', 'Gamma')
  const noTitle = link('d', '2026-01-04T00:00:00.000Z', '')

  it('newest first (default)', () => {
    expect(sortLinks([A, C, B], 'newest').map(l => l.id)).toEqual(['c', 'b', 'a'])
  })

  it('oldest first', () => {
    expect(sortLinks([C, B, A], 'oldest').map(l => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('title A–Z is case-insensitive and deterministic', () => {
    // Alpha vs beta vs Gamma -> a, b, g case-insensitively
    expect(sortLinks([B, A, C], 'title-az').map(l => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('title Z–A reverses title order', () => {
    expect(sortLinks([A, B, C], 'title-za').map(l => l.id)).toEqual(['c', 'b', 'a'])
  })

  it('handles empty/missing titles safely (non-titled last)', () => {
    expect(sortLinks([A, noTitle, B], 'title-az').map(l => l.id)).toEqual(['a', 'b', 'd'])
  })

  it('ties break by createdAt then id (deterministic)', () => {
    const same = [
      link('x', '2026-01-01T00:00:00.000Z', 'Same'),
      link('y', '2026-01-01T00:00:00.000Z', 'Same')
    ]
    expect(sortLinks(same, 'title-az').map(l => l.id)).toEqual(['x', 'y'])
  })

  it('same createdAt values keep a stable order via id in newest', () => {
    const same = [
      link('y', '2026-01-01T00:00:00.000Z', ''),
      link('x', '2026-01-01T00:00:00.000Z', '')
    ]
    expect(sortLinks(same, 'newest').map(l => l.id)).toEqual(['x', 'y'])
  })

  it('does not mutate the original array', () => {
    const input = [C, B, A]
    const ids = input.map(l => l.id)
    sortLinks(input, 'newest')
    expect(input.map(l => l.id)).toEqual(ids)
  })

  it('does not modify link fields', () => {
    const input = [B, A]
    const snapshots = input.map(l => ({ ...l }))
    sortLinks(input, 'title-az')
    input.forEach((l, i) => expect(l).toEqual(snapshots[i]))
  })

  it('works on filtered/arbitrary subsets', () => {
    const subset = [A, C] // e.g. a filtered result
    expect(sortLinks(subset, 'newest').map(l => l.id)).toEqual(['c', 'a'])
    expect(sortLinks(subset, 'oldest').map(l => l.id)).toEqual(['a', 'c'])
  })

  it('returns a new array (element refs preserved)', () => {
    const input = [A, B]
    const out = sortLinks(input, 'newest')
    expect(out).not.toBe(input)
    expect(out[1]).toBe(A) // same object references
  })

  it('unknown sort value falls back to default (newest)', () => {
    expect(sortLinks([A, B, C], 'bogus').map(l => l.id)).toEqual(['c', 'b', 'a'])
  })

  it('non-array input returns []', () => {
    expect(sortLinks(null, 'newest')).toEqual([])
    expect(sortLinks(undefined, 'newest')).toEqual([])
  })

  it('exposes the expected option set', () => {
    expect(SORT_VALUES).toEqual(['newest', 'oldest', 'title-az', 'title-za'])
    expect(DEFAULT_SORT).toBe('newest')
    expect(SORT_OPTIONS.length).toBe(4)
  })
})
