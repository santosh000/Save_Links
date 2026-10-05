// P15.2 — sidebar derivations: tag aggregation, folder subtree counts and the
// real metadata-size estimate for the storage meter.
import { describe, it, expect } from 'vitest'
import { collectTags, folderSubtreeCounts, estimateMetadataBytes, formatBytes } from './sidebarData.js'

const link = (overrides = {}) => ({ id: 'l1', folderId: null, tags: [], ...overrides })

describe('collectTags', () => {
  it('returns unique tags ordered by frequency, ties alphabetical', () => {
    const links = [
      link({ id: 'a', tags: ['react', 'javascript'] }),
      link({ id: 'b', tags: ['react', 'css'] }),
      link({ id: 'c', tags: ['react', 'css'] }),
      link({ id: 'd', tags: ['vue'] }),
    ]
    expect(collectTags(links)).toEqual(['react', 'css', 'javascript', 'vue'])
  })

  it('handles empty input and empty tags', () => {
    expect(collectTags([])).toEqual([])
    expect(collectTags([link(), link({ tags: [] })])).toEqual([])
  })

  it('ignores non-string and blank tags defensively', () => {
    expect(collectTags([link({ tags: ['ok', '', '   ', null, undefined, 7] })])).toEqual(['ok'])
  })

  it('does not mutate the stored tags', () => {
    const l = link({ tags: ['react'] })
    collectTags([l])
    expect(l.tags).toEqual(['react'])
  })
})

describe('folderSubtreeCounts', () => {
  const folders = [
    { id: 'work', name: 'Work', parentId: null },
    { id: 'design', name: 'Design', parentId: 'work' },
    { id: 'frontend', name: 'Frontend', parentId: 'design' },
    { id: 'personal', name: 'Personal', parentId: null },
  ]

  it('rolls descendant links up into every ancestor', () => {
    const links = [
      link({ id: '1', folderId: 'frontend' }),
      link({ id: '2', folderId: 'design' }),
      link({ id: '3', folderId: 'work' }),
      link({ id: '4', folderId: 'personal' }),
    ]
    const counts = folderSubtreeCounts(folders, links)
    expect(counts.get('frontend')).toBe(1)
    expect(counts.get('design')).toBe(2)
    expect(counts.get('work')).toBe(3)
    expect(counts.get('personal')).toBe(1)
  })

  it('keys every folder with zero when there are no links', () => {
    const counts = folderSubtreeCounts(folders, [])
    expect([...counts.keys()]).toEqual(['work', 'design', 'frontend', 'personal'])
    expect([...counts.values()]).toEqual([0, 0, 0, 0])
  })

  it('ignores unfiled links and dangling folder ids', () => {
    const links = [link({ id: '1', folderId: null }), link({ id: '2', folderId: 'deleted-folder' })]
    const counts = folderSubtreeCounts(folders, links)
    expect([...counts.values()]).toEqual([0, 0, 0, 0])
  })

  it('is cycle-safe on pathological trees', () => {
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]
    const counts = folderSubtreeCounts(cyclic, [link({ folderId: 'a' })])
    expect(counts.get('a')).toBe(1)
    expect(counts.get('b')).toBe(1)
  })
})

describe('estimateMetadataBytes', () => {
  it('measures the UTF-8 bytes of the persisted records', () => {
    const links = [link({ id: '1', tags: ['react'] })]
    const folders = [{ id: 'work', name: 'Work', parentId: null }]
    const expected = new TextEncoder().encode(JSON.stringify({ links, folders })).length
    expect(estimateMetadataBytes(links, folders)).toBe(expected)
  })

  it('grows with real content and counts UTF-8 correctly', () => {
    const base = estimateMetadataBytes([link({ title: 'abc' })], [])
    const longer = estimateMetadataBytes([link({ title: 'abc' + 'x'.repeat(10) })], [])
    expect(longer).toBe(base + 10)
    const ascii = estimateMetadataBytes([link({ title: 'aaaa' })], [])
    const utf8 = estimateMetadataBytes([link({ title: 'éééé' })], [])
    expect(utf8).toBe(ascii + 4)
  })

  it('is a real number for empty state, not a demo constant', () => {
    const empty = estimateMetadataBytes([], [])
    expect(empty).toBe(new TextEncoder().encode('{"links":[],"folders":[]}').length)
    expect(estimateMetadataBytes([link()], [])).toBeGreaterThan(empty)
  })
})

describe('formatBytes', () => {
  it('formats binary units the way the storage meter shows them', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB')
    expect(formatBytes(Math.round(1.5 * 1024 * 1024))).toBe('1.50 MB')
  })

  it('never fabricates a value for invalid input', () => {
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(NaN)).toBe('0 B')
    expect(formatBytes(Infinity)).toBe('0 B')
  })
})
