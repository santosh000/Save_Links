import { getDomain, categorizeUrl } from './categorize.js'
import { getStorageKey } from './environment.js'

export const BACKUP_APP = 'Save_Link'
export const BACKUP_VERSION = 2
export const BACKUP_VERSION_MIN = 1

export const APPEARANCE_VALUES = ['light', 'dark', 'system']
export const COLOR_SCHEME_VALUES = ['ocean', 'forest', 'lavender', 'amber']
export const DEFAULT_APPEARANCE = 'system'
export const DEFAULT_COLOR_SCHEME = 'ocean'

function sanitizeAppearance(v) {
  return APPEARANCE_VALUES.includes(v) ? v : DEFAULT_APPEARANCE
}
function sanitizeColorScheme(v) {
  return COLOR_SCHEME_VALUES.includes(v) ? v : DEFAULT_COLOR_SCHEME
}

function sanitizeFolder(raw) {
  if (typeof raw !== 'object' || raw === null) return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 100) : null
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 50) : ''
  if (!id || !name) return null
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  return { id, name, createdAt }
}

function sanitizeFolders(arr) {
  if (!Array.isArray(arr)) return []
  const seen = new Set()
  const out = []
  for (const raw of arr) {
    const f = sanitizeFolder(raw)
    if (!f) continue
    if (seen.has(f.id)) continue
    seen.add(f.id)
    out.push(f)
  }
  return out
}

export function createBackupPayload({ links, profile, folders, appearance, colorScheme, settings }) {
  // Export current in-memory state, not raw localStorage
  // Deep copy to avoid leaking reactivity and ensure JSON serializable
  const safeLinks = Array.isArray(links)
    ? links.map((l) => ({
        id: l.id,
        originalUrl: l.originalUrl,
        normalizedUrl: l.normalizedUrl,
        url: l.url ?? l.normalizedUrl,
        title: l.title,
        description: l.description,
        image: l.image,
        tags: Array.isArray(l.tags) ? [...l.tags] : [],
        category: l.category,
        important: !!l.important,
        mustHave: !!l.mustHave,
        favorite: !!l.favorite,
        folderId: typeof l.folderId === 'string' && l.folderId ? l.folderId : null,
        domain: l.domain,
        createdAt: l.createdAt,
      }))
    : []

  const safeProfile = profile && typeof profile === 'object' ? { ...profile } : {}
  const safeFolders = sanitizeFolders(folders || [])
  // allow settings object or direct appearance/colorScheme
  let appAppearance = DEFAULT_APPEARANCE
  let appColorScheme = DEFAULT_COLOR_SCHEME
  if (settings && typeof settings === 'object') {
    appAppearance = sanitizeAppearance(settings.appearance)
    appColorScheme = sanitizeColorScheme(settings.colorScheme)
  }
  if (appearance) appAppearance = sanitizeAppearance(appearance)
  if (colorScheme) appColorScheme = sanitizeColorScheme(colorScheme)

  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profile: safeProfile,
    settings: { appearance: appAppearance, colorScheme: appColorScheme },
    folders: safeFolders,
    links: safeLinks,
  }
}

export function parseBackupText(text) {
  try {
    const data = JSON.parse(text)
    return { data, error: null }
  } catch {
    return { data: null, error: 'Invalid backup file: not valid JSON' }
  }
}

export function validateBackupPayload(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, error: 'Invalid backup file: not valid JSON' }
  }
  if (data.app !== BACKUP_APP) {
    return { valid: false, error: 'Invalid backup: wrong app identifier' }
  }
  if (typeof data.version !== 'number' || data.version < BACKUP_VERSION_MIN || data.version > BACKUP_VERSION) {
    return { valid: false, error: 'Unsupported backup version' }
  }
  if (!('links' in data)) {
    return { valid: false, error: 'Invalid backup: missing links' }
  }
  if (!Array.isArray(data.links)) {
    return { valid: false, error: 'Invalid backup: links must be an array' }
  }
  return { valid: true, error: null }
}

function normalizeLink(raw, validFolderIds = null) {
  if (typeof raw !== 'object' || raw === null) return null
  // Only trust known fields, do not execute arbitrary code
  // The href-bound URL must be http(s) — the app only ever creates those; this also
  // rejects javascript:/data:/etc. from crafted backups. originalUrl may stay
  // scheme-less because it is display text only and never becomes an href.
  const httpUrl = (x) => (typeof x === 'string' && /^https?:\/\//i.test(x.trim())) ? x.trim() : ''
  const normalized = httpUrl(raw.normalizedUrl) || httpUrl(raw.url) || httpUrl(raw.originalUrl) || ''
  const original = typeof raw.originalUrl === 'string' && raw.originalUrl.trim() ? raw.originalUrl.trim().slice(0, 2000) : normalized
  // skip records with no usable http(s) URL
  if (!normalized) return null

  const id = typeof raw.id === 'string' && raw.id ? raw.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const title = typeof raw.title === 'string' ? raw.title.slice(0, 200) : ''
  const description = typeof raw.description === 'string' ? raw.description.slice(0, 400) : ''
  const image = typeof raw.image === 'string' ? raw.image.trim() : ''
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean) : []
  const category = typeof raw.category === 'string' && raw.category ? raw.category : categorizeUrl(normalized || original) || 'Other'
  const important = !!raw.important
  const mustHave = !!raw.mustHave
  const favorite = !!raw.favorite
  const domain = typeof raw.domain === 'string' && raw.domain ? raw.domain : getDomain(normalized || original) || ''
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString()
  let folderId = null
  if (typeof raw.folderId === 'string' && raw.folderId.trim()) {
    const fid = raw.folderId.trim()
    if (!validFolderIds || validFolderIds.has(fid)) folderId = fid
    else folderId = null
  }

  // url compatibility field
  const url = normalized || original

  return {
    id,
    originalUrl: original,
    normalizedUrl: normalized || original,
    url,
    title,
    description,
    image,
    tags,
    category,
    important,
    mustHave,
    favorite,
    folderId,
    domain,
    status: important && mustHave ? 'both' : important ? 'important' : mustHave ? 'must-have' : null,
    createdAt,
  }
}

export function normalizeBackupData(data) {
  // Assumes data already validated (app/version/links array)
  const profile = data.profile && typeof data.profile === 'object' && !Array.isArray(data.profile) ? { ...data.profile } : {}
  // folders: v1 has none -> default [], sanitize
  const folders = sanitizeFolders(data.folders || [])
  const validFolderIds = new Set(folders.map(f => f.id))
  // settings: v1 defaults to system/ocean, v2 uses data.settings
  let appearance = DEFAULT_APPEARANCE
  let colorScheme = DEFAULT_COLOR_SCHEME
  if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
    if (typeof data.settings.appearance === 'string') appearance = sanitizeAppearance(data.settings.appearance)
    if (typeof data.settings.colorScheme === 'string') colorScheme = sanitizeColorScheme(data.settings.colorScheme)
  } else {
    // check top-level appearance/colorScheme for flexibility
    if (typeof data.appearance === 'string') appearance = sanitizeAppearance(data.appearance)
    if (typeof data.colorScheme === 'string') colorScheme = sanitizeColorScheme(data.colorScheme)
  }
  const settings = { appearance, colorScheme }
  // Preserve at least name/bio if present, but copy all profile fields shallowly
  const links = []
  for (const raw of data.links) {
    const n = normalizeLink(raw, validFolderIds)
    if (n) links.push(n)
  }
  return { profile, links, folders, settings, appearance, colorScheme }
}

export function getLastBackupAt() {
  try {
    return localStorage.getItem(getStorageKey('lastBackupAt'))
  } catch {
    return null
  }
}

export function setLastBackupAt(isoString) {
  try {
    localStorage.setItem(getStorageKey('lastBackupAt'), isoString)
    return true
  } catch {
    return false
  }
}
