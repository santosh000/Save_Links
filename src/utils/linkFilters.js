// P15.2 — pure link-filter predicates. One implementation shared by App.vue's
// filteredLinks computed and the unit tests, so the library pipeline (including
// the new tag / date-window / Recently-Added filters) has a single source of
// truth.
//
// Two kinds of filter state exist:
//   - destinations (folder, status, recently added): mutually exclusive;
//   - bar filters (category, type, pinned, tag, date window): combine.
// This module only evaluates one link against the current filter values; the
// destination exclusivity lives in the App.vue navigation handlers.

export function startOfLocalDay(t) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Whole local calendar days between an ISO timestamp and now (0 = today,
// 1 = yesterday, ...). Infinity for an unparsable timestamp. The same day math
// the group headers use, so "Recently Added" and the headers always agree.
export function calendarDaysSince(iso, now = Date.now()) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return Infinity
  return Math.round((startOfLocalDay(now) - startOfLocalDay(t)) / 86400000)
}

// Mockup "Recently Added" = Today + Yesterday.
export function isRecentlyAdded(link, now = Date.now()) {
  return calendarDaysSince(link.createdAt, now) <= 1
}

// Mockup "Last 30 days" window, inclusive of today. No window -> everything.
export function isWithinDays(link, days, now = Date.now()) {
  if (!days) return true
  return calendarDaysSince(link.createdAt, now) <= days
}

// P15.10 — local calendar date key ('YYYY-MM-DD') for the Date presets and the
// custom From/To range. Null for an unparsable timestamp.
export function localDateKey(t) {
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Monday-based start of the current local calendar week, as a date key.
export function startOfLocalWeekKey(now = Date.now()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localDateKey(d.getTime())
}

// The date surface: { preset: 'all'|'today'|'yesterday'|'week'|'older'|'custom',
// from?, to? }. `from`/`to` are inclusive local date keys, so both ends of a
// custom range are matched. A link whose createdAt cannot be parsed cannot be
// placed on the calendar, so every window excludes it (same rule as
// isWithinDays above) — and a future-dated link only ever matches 'all'.
export function matchesDateFilter(link, date, now = Date.now()) {
  if (!date || !date.preset || date.preset === 'all') return true
  if (date.preset === 'today') return calendarDaysSince(link.createdAt, now) === 0
  if (date.preset === 'yesterday') return calendarDaysSince(link.createdAt, now) === 1
  const key = localDateKey(link.createdAt)
  if (!key) return false
  if (date.preset === 'week') {
    const today = localDateKey(now)
    return key >= startOfLocalWeekKey(now) && key <= today
  }
  // "Older" is the complement of the same Monday-based week boundary: anything
  // saved before the start of the current local week (future keys sort after
  // the boundary, so they never match - same rule as the other windows).
  if (date.preset === 'older') return key < startOfLocalWeekKey(now)
  if (date.preset === 'custom') {
    if (date.from && key < date.from) return false
    if (date.to && key > date.to) return false
    return true
  }
  return true
}

// The single filter predicate used by the library. `filters` mirrors the
// App.vue refs; `query` is expected pre-trimmed and lowercased, and
// `folderIds`/`folderNameById` come from the existing folder computeds.
export function matchesLinkFilters(link, filters = {}) {
  const {
    query = '', category = '', status = '', type = '', pinned = false,
    tag = '', dateWithinDays = null, date = null, recent = false,
    folderId = '', folderIds = null, folderNameById = null, now,
  } = filters

  if (folderId) {
    if (folderId === '__unfiled') { if (link.folderId) return false }
    else if (!folderIds || !folderIds.has(link.folderId)) return false
  }
  if (category && link.category !== category) return false
  if (type && (link.type || 'other') !== type) return false
  if (pinned && !link.pinned) return false
  if (tag && !(link.tags || []).includes(tag)) return false
  if (recent && !isRecentlyAdded(link, now)) return false
  if (dateWithinDays && !isWithinDays(link, dateWithinDays, now)) return false
  if (date && !matchesDateFilter(link, date, now)) return false
  if (status) {
    if (status === 'none' && (link.important || link.mustHave)) return false
    if (status === 'important' && !link.important) return false
    if (status === 'must-have' && !link.mustHave) return false
    if (status === 'favorite' && !link.favorite) return false
    if (status === 'not-favorite' && link.favorite) return false
  }
  if (query) {
    const folderName = link.folderId ? ((folderNameById && folderNameById.get(link.folderId)) || '') : 'Unfiled'
    const hay = [link.title, link.normalizedUrl || link.url, link.originalUrl, link.domain, link.description, link.category, folderName, ...(link.tags || [])].join(' ').toLowerCase()
    if (!hay.includes(query)) return false
  }
  return true
}
