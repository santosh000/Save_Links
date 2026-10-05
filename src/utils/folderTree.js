// Nested-folder helpers (P4). Pure functions over folder records — depth and
// path are always derived from `parentId` + names, never stored. All functions
// are cycle-safe so a pathological persisted tree can never hang the UI.

export const MAX_FOLDER_DEPTH = 4

function byId(folders) {
  const m = new Map()
  for (const f of folders) m.set(f.id, f)
  return m
}

// Parent used for rendering: a parentId that does not resolve is treated as a
// root (the persisted repair normalizes it to null on the next write).
function effectiveParent(ids, folder) {
  return folder.parentId && ids.has(folder.parentId) ? folder.parentId : null
}

// Children grouped by parentId (stored array order preserved).
export function childrenMap(folders) {
  const map = new Map()
  for (const f of folders) {
    const key = f.parentId ?? null
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(f)
  }
  return map
}

export function rootFolders(folders) {
  const ids = byId(folders)
  return folders.filter((f) => effectiveParent(ids, f) === null)
}

// 1-based depth: roots are depth 1. Unknown id -> 0. Cycle-safe.
export function folderDepth(folders, id) {
  const ids = byId(folders)
  let current = ids.get(id)
  if (!current) return 0
  let depth = 1
  const seen = new Set([id])
  while (current) {
    const parentId = effectiveParent(ids, current)
    if (!parentId || seen.has(parentId)) break
    seen.add(parentId)
    current = ids.get(parentId)
    if (current) depth++
  }
  return depth
}

// "Work / Engineering / Frontend" — derived, never stored. Cycle-safe.
export function folderPath(folders, id, separator = ' / ') {
  const ids = byId(folders)
  const names = []
  const seen = new Set()
  let current = ids.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(current.name)
    const parentId = effectiveParent(ids, current)
    current = parentId ? ids.get(parentId) : null
  }
  return names.join(separator)
}

// All descendants of id (excluding id itself). Cycle-safe.
export function descendantIds(folders, id) {
  const children = childrenMap(folders)
  const out = new Set()
  const stack = [...(children.get(id) || [])]
  while (stack.length) {
    const f = stack.pop()
    if (out.has(f.id)) continue
    out.add(f.id)
    for (const c of children.get(f.id) || []) stack.push(c)
  }
  return out
}

// Levels below id (0 = leaf). Cycle-safe.
export function subtreeHeight(folders, id) {
  const children = childrenMap(folders)
  const seen = new Set()
  function height(fid) {
    if (seen.has(fid)) return 0
    seen.add(fid)
    let h = 0
    for (const k of children.get(fid) || []) h = Math.max(h, 1 + height(k.id))
    return h
  }
  return height(id)
}

export function isDescendant(folders, id, candidateId) {
  return descendantIds(folders, id).has(candidateId)
}

// Validation for create (id = null) and move (id = folder being moved).
// Returns { ok: true, parentId } or { ok: false, reason }.
export function validateParent(folders, id, parentId) {
  if (parentId === null || parentId === undefined || parentId === '') {
    return { ok: true, parentId: null }
  }
  const ids = byId(folders)
  if (!ids.has(parentId)) return { ok: false, reason: 'Parent folder not found' }
  if (id) {
    if (parentId === id) return { ok: false, reason: 'A folder cannot contain itself' }
    if (descendantIds(folders, id).has(parentId)) {
      return { ok: false, reason: 'A folder cannot be moved into its own subfolder' }
    }
  }
  const parentDepth = folderDepth(folders, parentId)
  const addedDepth = id ? 1 + subtreeHeight(folders, id) : 1
  if (parentDepth + addedDepth > MAX_FOLDER_DEPTH) {
    return { ok: false, reason: `Maximum folder depth is ${MAX_FOLDER_DEPTH}` }
  }
  return { ok: true, parentId }
}

// Valid move destinations for id: [null, ...folderIds]. Excludes self and the
// folder's own descendants, and any destination that would exceed max depth.
export function validParentIds(folders, id) {
  const out = [null]
  const descendants = descendantIds(folders, id)
  for (const f of folders) {
    if (f.id === id || descendants.has(f.id)) continue
    if (validateParent(folders, id, f.id).ok) out.push(f.id)
  }
  return out
}

// Pre-order flatten with collapse support -> [{ folder, depth }].
export function flattenFolders(folders, { isExpanded = () => true } = {}) {
  const children = childrenMap(folders)
  const ids = byId(folders)
  // Structural pass: find the true roots, ignoring collapse (so a collapsed
  // folder's children are not later mistaken for unreachable orphans).
  const structurallySeen = new Set()
  const roots = []
  function walkStruct(folder) {
    if (structurallySeen.has(folder.id)) return
    structurallySeen.add(folder.id)
    for (const c of children.get(folder.id) || []) walkStruct(c)
  }
  for (const f of folders) {
    if (effectiveParent(ids, f) === null) { roots.push(f); walkStruct(f) }
  }
  // Safety net: anything structurally unreachable (pathological data) renders
  // as a root instead of disappearing.
  for (const f of folders) {
    if (!structurallySeen.has(f.id)) { roots.push(f); walkStruct(f) }
  }
  // Visible pass with collapse applied.
  const out = []
  const seen = new Set()
  function walkVisible(folder, depth) {
    if (seen.has(folder.id)) return
    seen.add(folder.id)
    out.push({ folder, depth })
    if (!isExpanded(folder)) return
    for (const c of children.get(folder.id) || []) walkVisible(c, depth + 1)
  }
  for (const f of roots) walkVisible(f, 1)
  return out
}

// Indented AppSelect options (NBSP prefixes keep indentation in the menu).
export function folderSelectOptions(folders, { excludeIds = null } = {}) {
  const opts = []
  for (const { folder, depth } of flattenFolders(folders)) {
    if (excludeIds && excludeIds.has(folder.id)) continue
    opts.push({ value: folder.id, label: '\u00A0\u00A0'.repeat(Math.max(0, depth - 1)) + folder.name })
  }
  return opts
}

// Persisted-tree repair: missing/invalid parents -> null, cycles broken, depth
// clamped to MAX_FOLDER_DEPTH. Preserves record order and every other field.
export function repairFolderTree(folders) {
  if (!Array.isArray(folders)) return []
  const ids = new Set(folders.map((f) => f.id))
  const parentOf = new Map()
  for (const f of folders) {
    const p = typeof f.parentId === 'string' && f.parentId ? f.parentId : null
    parentOf.set(f.id, p && ids.has(p) && p !== f.id ? p : null)
  }
  // Break cycles: re-root the folder that closes the loop.
  for (const f of folders) {
    const seen = new Set()
    let cur = f.id
    while (cur) {
      if (seen.has(cur)) { parentOf.set(f.id, null); break }
      seen.add(cur)
      cur = parentOf.get(cur) || null
    }
  }
  // Clamp depth iteratively (re-rooting a too-deep node can only shallow its
  // subtree, so this converges).
  let changed = true
  while (changed) {
    changed = false
    const children = new Map()
    for (const f of folders) {
      const p = parentOf.get(f.id)
      if (!children.has(p)) children.set(p, [])
      children.get(p).push(f.id)
    }
    const depth = new Map()
    const queue = (children.get(null) || []).map((id) => [id, 1])
    while (queue.length) {
      const [id, d] = queue.shift()
      if (depth.has(id)) continue
      depth.set(id, d)
      for (const c of children.get(id) || []) queue.push([c, d + 1])
    }
    for (const f of folders) {
      const d = depth.get(f.id)
      if ((!d || d > MAX_FOLDER_DEPTH) && parentOf.get(f.id) !== null) {
        parentOf.set(f.id, null)
        changed = true
      }
    }
  }
  return folders.map((f) => ({ ...f, parentId: parentOf.get(f.id) ?? null }))
}
