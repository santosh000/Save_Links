import { describe, it, expect } from 'vitest'
import {
  MAX_FOLDER_DEPTH,
  childrenMap,
  rootFolders,
  folderDepth,
  folderPath,
  descendantIds,
  subtreeHeight,
  isDescendant,
  validateParent,
  validParentIds,
  flattenFolders,
  folderSelectOptions,
  repairFolderTree,
} from './folderTree.js'

// Tree used across the tests:
// Work
//   Engineering
//     Frontend
//     Backend
//   Design
// Personal
//   Finance
function sample() {
  return [
    { id: 'work', name: 'Work', parentId: null },
    { id: 'eng', name: 'Engineering', parentId: 'work' },
    { id: 'frontend', name: 'Frontend', parentId: 'eng' },
    { id: 'backend', name: 'Backend', parentId: 'eng' },
    { id: 'design', name: 'Design', parentId: 'work' },
    { id: 'personal', name: 'Personal', parentId: null },
    { id: 'finance', name: 'Finance', parentId: 'personal' },
  ]
}

describe('folderTree helpers', () => {
  it('computes 1-based depth and treats unknown/orphaned ids safely', () => {
    const folders = sample()
    expect(folderDepth(folders, 'work')).toBe(1)
    expect(folderDepth(folders, 'eng')).toBe(2)
    expect(folderDepth(folders, 'frontend')).toBe(3)
    expect(folderDepth(folders, 'missing')).toBe(0)
    // dangling parentId renders as a root
    const orphan = [...folders, { id: 'x', name: 'X', parentId: 'nope' }]
    expect(folderDepth(orphan, 'x')).toBe(1)
  })

  it('does not hang on a persisted cycle', () => {
    const folders = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ]
    expect(folderDepth(folders, 'a')).toBeGreaterThan(0)
    expect(folderDepth(folders, 'a')).toBeLessThanOrEqual(2)
  })

  it('derives the folder path from parentId + names', () => {
    const folders = sample()
    expect(folderPath(folders, 'frontend')).toBe('Work / Engineering / Frontend')
    expect(folderPath(folders, 'work')).toBe('Work')
    expect(folderPath(folders, 'missing')).toBe('')
  })

  it('lists descendants and subtree height', () => {
    const folders = sample()
    expect([...descendantIds(folders, 'work')].sort()).toEqual(['backend', 'design', 'eng', 'frontend'])
    expect([...descendantIds(folders, 'eng')].sort()).toEqual(['backend', 'frontend'])
    expect([...descendantIds(folders, 'frontend')]).toEqual([])
    expect(subtreeHeight(folders, 'work')).toBe(2)
    expect(subtreeHeight(folders, 'eng')).toBe(1)
    expect(subtreeHeight(folders, 'frontend')).toBe(0)
    expect(isDescendant(folders, 'work', 'frontend')).toBe(true)
    expect(isDescendant(folders, 'eng', 'design')).toBe(false)
  })

  it('validates parents for create and move (self, descendant, max depth)', () => {
    const folders = sample()
    expect(validateParent(folders, null, null)).toEqual({ ok: true, parentId: null })
    expect(validateParent(folders, null, 'work')).toEqual({ ok: true, parentId: 'work' })
    expect(validateParent(folders, null, 'nope')).toEqual({ ok: false, reason: 'Parent folder not found' })
    expect(validateParent(folders, 'work', 'work')).toEqual({ ok: false, reason: 'A folder cannot contain itself' })
    expect(validateParent(folders, 'work', 'frontend')).toEqual({ ok: false, reason: 'A folder cannot be moved into its own subfolder' })
    // depth: frontend(3) + 1 = 4 is allowed; a child under it would be 4+1 = 5
    expect(validateParent(folders, null, 'frontend').ok).toBe(true)
    const withLevel4 = [...folders, { id: 'vue', name: 'Vue', parentId: 'frontend' }]
    expect(validateParent(withLevel4, null, 'vue')).toEqual({ ok: false, reason: `Maximum folder depth is ${MAX_FOLDER_DEPTH}` })
    // moving Work (height 2) under Finance (depth 3) -> 3+1+2 = 6
    expect(validateParent(folders, 'work', 'finance')).toEqual({ ok: false, reason: `Maximum folder depth is ${MAX_FOLDER_DEPTH}` })
  })

  it('exposes only valid move destinations', () => {
    const folders = sample()
    const valid = validParentIds(folders, 'eng')
    expect(valid).toContain(null)
    expect(valid).toContain('personal') // depth 1 + (1 + height 1) = 3
    expect(valid).toContain('design') // depth 2 + (1 + height 1) = 4
    expect(valid).not.toContain('eng')
    expect(valid).not.toContain('frontend')
    expect(valid).not.toContain('backend')
  })

  it('flattens in pre-order and honours collapse', () => {
    const folders = sample()
    const all = flattenFolders(folders).map((r) => [r.folder.id, r.depth])
    expect(all).toEqual([
      ['work', 1], ['eng', 2], ['frontend', 3], ['backend', 3], ['design', 2],
      ['personal', 1], ['finance', 2],
    ])
    const collapsed = flattenFolders(folders, { isExpanded: (f) => f.id !== 'work' }).map((r) => r.folder.id)
    expect(collapsed).toEqual(['work', 'personal', 'finance'])
  })

  it('builds indented select options with NBSP prefixes', () => {
    const folders = sample()
    const opts = folderSelectOptions(folders)
    expect(opts.find((o) => o.value === 'work').label).toBe('Work')
    expect(opts.find((o) => o.value === 'eng').label).toBe('\u00A0\u00A0Engineering')
    expect(opts.find((o) => o.value === 'frontend').label).toBe('\u00A0\u00A0\u00A0\u00A0Frontend')
    const filtered = folderSelectOptions(folders, { excludeIds: new Set(['work', 'eng', 'frontend', 'backend', 'design']) })
    expect(filtered.map((o) => o.value)).toEqual(['personal', 'finance'])
  })

  it('repairs dangling parents, cycles and over-depth chains', () => {
    const repaired = repairFolderTree([
      { id: 'a', name: 'A', parentId: 'ghost', extra: 1 },
      { id: 'b', name: 'B', parentId: 'c' },
      { id: 'c', name: 'C', parentId: 'b' },
      { id: 'd1', name: 'D1', parentId: null },
      { id: 'd2', name: 'D2', parentId: 'd1' },
      { id: 'd3', name: 'D3', parentId: 'd2' },
      { id: 'd4', name: 'D4', parentId: 'd3' },
      { id: 'd5', name: 'D5', parentId: 'd4' },
    ])
    const byId = new Map(repaired.map((f) => [f.id, f]))
    expect(byId.get('a').parentId).toBe(null) // dangling -> root
    expect(byId.get('a').extra).toBe(1) // other fields preserved
    // cycle broken: at least one side becomes a root, neither points at a cycle
    expect([byId.get('b').parentId, byId.get('c').parentId].includes(null)).toBe(true)
    // depth clamped at MAX: d5 (depth 5) is re-rooted
    expect(byId.get('d1').parentId).toBe(null)
    expect(byId.get('d2').parentId).toBe('d1')
    expect(byId.get('d3').parentId).toBe('d2')
    expect(byId.get('d4').parentId).toBe('d3')
    expect(byId.get('d5').parentId).toBe(null)
    // order preserved
    expect(repaired.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd1', 'd2', 'd3', 'd4', 'd5'])
  })

  it('children map and roots ignore orphaned parents', () => {
    const folders = [...sample(), { id: 'orphan', name: 'Orphan', parentId: 'missing-parent' }]
    const roots = rootFolders(folders).map((f) => f.id)
    expect(roots).toContain('work')
    expect(roots).toContain('personal')
    expect(roots).toContain('orphan')
    expect((childrenMap(folders).get('work') || []).map((f) => f.id)).toEqual(['eng', 'design'])
  })
})
