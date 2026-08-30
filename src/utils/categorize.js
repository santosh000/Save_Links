export const CATEGORIES = [
  'Instagram',
  'YouTube',
  'GitHub',
  'Facebook',
  'Reddit',
  'X/Twitter',
  'LinkedIn',
  'Amazon',
  'Other'
]

// anchored to hostname only — prevents false positives from query strings or fake subdomains
const DOMAIN_MAP = [
  { pattern: /(^|\.)instagram\.com$/i, category: 'Instagram' },
  { pattern: /(^|\.)youtube\.com$/i, category: 'YouTube' },
  { pattern: /(^|\.)youtu\.be$/i, category: 'YouTube' },
  { pattern: /(^|\.)github\.com$/i, category: 'GitHub' },
  { pattern: /(^|\.)gist\.github\.com$/i, category: 'GitHub' },
  { pattern: /(^|\.)facebook\.com$/i, category: 'Facebook' },
  { pattern: /(^|\.)fb\.com$/i, category: 'Facebook' },
  { pattern: /(^|\.)reddit\.com$/i, category: 'Reddit' },
  { pattern: /(^|\.)twitter\.com$/i, category: 'X/Twitter' },
  { pattern: /(^|\.)x\.com$/i, category: 'X/Twitter' },
  { pattern: /(^|\.)t\.co$/i, category: 'X/Twitter' },
  { pattern: /(^|\.)linkedin\.com$/i, category: 'LinkedIn' },
  { pattern: /(^|\.)amazon\.[a-z]{2,}(\.[a-z]{2,})?$/i, category: 'Amazon' }
]

export function categorizeUrl(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    for (const { pattern, category } of DOMAIN_MAP) {
      if (pattern.test(host)) return category
    }
    return 'Other'
  } catch {
    return 'Other'
  }
}

export function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function normalizeUrl(input) {
  let s = (input || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  return cleanQuery(s)
}

// Remove only well-known tracking parameters from the query portion.
// Operates on the raw query substring only, so the rest of the URL is never
// reconstructed or altered: scheme/host casing, trailing slash, ports,
// percent encoding, parameter spelling/values/order, and fragments keep
// their exact original representation.
function cleanQuery(url) {
  const hashAt = url.indexOf('#')
  const qAt = url.indexOf('?')
  // no query, or the only '?' sits inside the fragment (after '#')
  if (qAt === -1 || (hashAt !== -1 && qAt > hashAt)) return url
  const queryEnd = hashAt === -1 ? url.length : hashAt
  const kept = []
  for (const pair of url.slice(qAt + 1, queryEnd).split('&')) {
    if (pair === '') continue // empty segments are not parameters; never leave a dangling '?'
    const eq = pair.indexOf('=')
    const rawName = eq === -1 ? pair : pair.slice(0, eq)
    let name = ''
    try { name = decodeURIComponent(rawName) } catch { name = rawName }
    if (!isTrackingParam(name)) kept.push(pair)
  }
  const prefix = url.slice(0, qAt)
  const suffix = hashAt === -1 ? '' : url.slice(hashAt)
  if (kept.length === 0) return prefix + suffix
  return prefix + '?' + kept.join('&') + suffix
}

// Explicit denylist of well-known tracking identifiers. Unknown parameters
// and functional parameters (id, v, q, ref, page, sort, ...) are never
// touched. Names are matched case-insensitively; percent-encoded names are
// decoded first so e.g. %75tm_source is caught too.
function isTrackingParam(name) {
  const n = name.toLowerCase()
  if (n.startsWith('utm_')) return true
  switch (n) {
    case 'gclid': case 'gclsrc': case 'dclid':
    case 'fbclid': case 'msclkid': case 'zanpid':
    case 'mc_eid': case 'mc_cid':
    case '_openstat': case '_hsenc': case '_hsmi':
      return true
    default:
      return false
  }
}
