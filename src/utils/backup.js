import { normalizeLink as normalizeCanonicalLink } from '../domain/link.js'
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
  // Canonical shape comes from src/domain/link.js (the single link normalizer
  // shared with useLinks and the IndexedDB adapter). Backup-specific policy on
  // top: drop records with no usable http(s) href, and clear folder ids that
  // don't exist in the imported folder set.
  const n = normalizeCanonicalLink(raw)
  if (!n || !n.normalizedUrl) return null
  if (validFolderIds && n.folderId && !validFolderIds.has(n.folderId)) n.folderId = null
  return n
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
