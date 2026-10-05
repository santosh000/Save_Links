// P15.2 — sidebar derivation helpers for the mockup's Tags cloud, folder
// subtree counts and storage meter. Pure functions over the existing
// link/folder state: no new persistence, no fabricated numbers, and the stored
// records are never mutated.

// Unique tags across the library, most-used first (ties alphabetical) — the
// order the Tags cloud renders. Link.tags stays untouched.
export function collectTags(links) {
  const counts = new Map()
  for (const link of links) {
    for (const tag of link.tags || []) {
      if (typeof tag !== 'string' || !tag.trim()) continue
      counts.set(tag, (counts.get(tag) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([tag]) => tag)
}

// Mockup folder counts: a folder counts the links in itself AND in every
// descendant (the same subtree rule the folder filter uses). Links outside the
// tree (no folder, dangling folder id) are not attributed to any folder.
export function folderSubtreeCounts(folders, links) {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const counts = new Map(folders.map((f) => [f.id, 0]))
  for (const link of links) {
    const seen = new Set()
    let id = link.folderId
    while (id && byId.has(id) && !seen.has(id)) {
      seen.add(id)
      counts.set(id, counts.get(id) + 1)
      id = byId.get(id).parentId
    }
  }
  return counts
}

// Real metadata-size estimate for the storage meter: the UTF-8 bytes of the
// records SaveLink actually persists (links + folders). Never a demo number.
export function estimateMetadataBytes(links, folders) {
  const json = JSON.stringify({ links, folders })
  return new TextEncoder().encode(json).length
}

// Human-readable byte size for the storage meter (binary units, matching the
// mockup's "0.12 MB" shape). Pure presentation helper; no rounding games.
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
