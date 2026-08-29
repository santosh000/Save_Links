// Canonical link record — single source of truth for the link shape.
// Used by the composables (useLinks), backup import/export (backup.js),
// and the IndexedDB adapter. Before this module existed, useLinks.migrateLink
// and backup.js:normalizeLink had subtly divergent rules (URL extraction order,
// id fallback, tag sanitizing). This is the one normalizer they all delegate to.
//
// Canonical shape:
// {
//   id: string,               // preserved when present, else generated
//   originalUrl: string,      // display-only text; NEVER becomes an href
//   normalizedUrl: string,    // http(s)-bound href ('' if no usable URL)
//   url: string,              // legacy alias of normalizedUrl (backward compat)
//   domain: string,
//   title: string,            // <=200 chars
//   description: string,      // <=400 chars
//   image: string,
//   category: string,         // from CATEGORIES or derived
//   tags: string[],           // trimmed, non-empty strings
//   important: boolean,
//   mustHave: boolean,
//   favorite: boolean,
//   folderId: string|null,
//   status: string|null,      // legacy derived flag: 'important'|'must-have'|'both'|null
//   createdAt: string,        // ISO; preserved when present, else backfilled
// }
//
// Deterministic and idempotent: a canonical record in produces an identical
// record out (ids/createdAt are preserved, never regenerated). It never
// throws for object input and never copies unknown fields (safe against
// polluted/crafted records). Non-object input returns null so callers can
// decide whether to skip (backup) or filter (composable load).
import { categorizeUrl, getDomain } from '../utils/categorize.js'

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// The href-bound URL must be http(s) — the app only ever creates those; this
// also rejects javascript:/data:/etc. from crafted storage or backups.
// originalUrl may stay scheme-less because it is display text only.
function httpUrl(x) {
  return typeof x === 'string' && /^https?:\/\//i.test(x.trim()) ? x.trim() : ''
}

function str(v) {
  return typeof v === 'string' ? v : ''
}

export function normalizeLink(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null

  const normalized = httpUrl(raw.normalizedUrl) || httpUrl(raw.url) || httpUrl(raw.originalUrl)
  // display text: originalUrl wins, then legacy url field, then the normalized href
  const original = (str(raw.originalUrl).trim() || str(raw.url).trim() || normalized).slice(0, 2000)

  // Legacy flags: explicit booleans win, else derived from the pre-1.0 single
  // status field ('important' | 'must-have' | 'must_have' | 'both').
  let important = false
  let mustHave = false
  if (typeof raw.important === 'boolean') important = raw.important
  else if (raw.status === 'important' || raw.status === 'both') important = true
  if (typeof raw.mustHave === 'boolean') mustHave = raw.mustHave
  else if (raw.status === 'must-have' || raw.status === 'must_have' || raw.status === 'both') mustHave = true
  const favorite = typeof raw.favorite === 'boolean' ? raw.favorite : false

  return {
    id: str(raw.id).trim() || generateId(),
    originalUrl: original,
    normalizedUrl: normalized,
    url: normalized, // legacy alias, kept in sync for backward compat
    domain: str(raw.domain).trim() || (normalized ? getDomain(normalized) : ''),
    title: str(raw.title).slice(0, 200),
    description: str(raw.description).slice(0, 400),
    image: str(raw.image).trim(),
    category: str(raw.category) || categorizeUrl(normalized) || 'Other',
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
      : [],
    important,
    mustHave,
    favorite,
    folderId: str(raw.folderId).trim() || null,
    status: important && mustHave ? 'both' : important ? 'important' : mustHave ? 'must-have' : null, // legacy compat, derived
    createdAt: str(raw.createdAt) || new Date().toISOString(),
  }
}