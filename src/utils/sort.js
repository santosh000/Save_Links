// Pure, deterministic link sorting. Display-order only — never mutates the
// input array or any link record; the caller must spread before sorting.
//
// The current data model has no reliable updatedAt field, so "Recently
// updated" is deliberately not offered — createdAt is the only trustworthy
// timestamp we have.

export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title-az', label: 'Title A–Z' },
  { value: 'title-za', label: 'Title Z–A' }
]

export const DEFAULT_SORT = 'newest'

export const SORT_VALUES = SORT_OPTIONS.map(o => o.value)

// Compare two links by parsed createdAt; missing/invalid dates sort last.
function byCreatedAtAsc(a, b) {
  const at = (l) => {
    const t = Date.parse(l.createdAt)
    return Number.isNaN(t) ? -1 : t
  }
  return at(a) - at(b)
}

// Case-insensitive title comparison; empty/missing titles sort last. On ties,
// fall back to createdAt (oldest first), then id — deterministic for
// same-createdAt records.
function byTitleAsc(a, b) {
  const t = (l) => (l.title ?? '').trim().toLowerCase()
  const x = t(a)
  const y = t(b)
  if (x && y) {
    const c = x.localeCompare(y)
    if (c !== 0) return c
  } else if (x || y) {
    return x ? -1 : 1 // titled first, empty/missing last
  }
  return byCreatedAtAsc(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

const COMPARATORS = {
  newest: (a, b) => byCreatedAtAsc(b, a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  oldest: (a, b) => byCreatedAtAsc(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  'title-az': (a, b) => byTitleAsc(a, b),
  'title-za': (a, b) => byTitleAsc(b, a)
}

// Returns a NEW sorted array. `links` is never modified; each element is a
// reference to the original record (so link fields are untouched). Unknown
// sort values fall back to the default (newest first) for safety.
export function sortLinks(links, sortBy) {
  if (!Array.isArray(links)) return []
  const key = SORT_VALUES.includes(sortBy) ? sortBy : DEFAULT_SORT
  return [...links].sort(COMPARATORS[key])
}
