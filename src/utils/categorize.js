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
  return s
}
