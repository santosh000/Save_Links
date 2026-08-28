// Storage abstraction — localStorage for now, swappable for backend later
import { ENVIRONMENT, getStorageKey } from './environment.js'

// Legacy keys (pre-isolation) — used only for DEV migration
const LEGACY_LINKS_KEY = 'save_link:links'
const LEGACY_PROFILE_KEY = 'save_link:profile'
const LEGACY_LAST_BACKUP_KEY = 'save_link:lastBackupAt'

function migrateLegacyIfNeeded() {
  if (ENVIRONMENT !== 'dev') return
  try {
    if (typeof localStorage === 'undefined') return
    const devLinksKey = getStorageKey('links')
    const devProfileKey = getStorageKey('profile')
    const devLastBackupKey = getStorageKey('lastBackupAt')

    // Only migrate if DEV keys do not exist and legacy exists — idempotent
    if (localStorage.getItem(devLinksKey) === null && localStorage.getItem(LEGACY_LINKS_KEY) !== null) {
      const val = localStorage.getItem(LEGACY_LINKS_KEY)
      // preserve legacy until successful
      localStorage.setItem(devLinksKey, val)
    }
    if (localStorage.getItem(devProfileKey) === null && localStorage.getItem(LEGACY_PROFILE_KEY) !== null) {
      localStorage.setItem(devProfileKey, localStorage.getItem(LEGACY_PROFILE_KEY))
    }
    if (localStorage.getItem(devLastBackupKey) === null && localStorage.getItem(LEGACY_LAST_BACKUP_KEY) !== null) {
      localStorage.setItem(devLastBackupKey, localStorage.getItem(LEGACY_LAST_BACKUP_KEY))
    }
  } catch (e) {
    console.warn('legacy migration failed', e)
  }
}

// Run once on module load (safe, idempotent)
try {
  migrateLegacyIfNeeded()
} catch {}

export function loadLinks() {
  try {
    // Ensure migration has run (covers cases where localStorage was not available at import)
    migrateLegacyIfNeeded()
    const raw = localStorage.getItem(getStorageKey('links'))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveLinks(links) {
  try {
    localStorage.setItem(getStorageKey('links'), JSON.stringify(links))
    return true
  } catch (e) {
    console.warn('saveLinks failed', e)
    return false
  }
}

export function loadProfile() {
  try {
    migrateLegacyIfNeeded()
    const raw = localStorage.getItem(getStorageKey('profile'))
    if (!raw) return { name: 'Local User', bio: 'Local-first bookmark manager' }
    return JSON.parse(raw)
  } catch {
    return { name: 'Local User', bio: 'Local-first bookmark manager' }
  }
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(getStorageKey('profile'), JSON.stringify(profile))
    return true
  } catch (e) {
    console.warn('saveProfile failed', e)
    return false
  }
}

export function loadFolders() {
  try {
    migrateLegacyIfNeeded()
    const raw = localStorage.getItem(getStorageKey('folders'))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveFolders(folders) {
  try {
    localStorage.setItem(getStorageKey('folders'), JSON.stringify(folders))
    return true
  } catch (e) {
    console.warn('saveFolders failed', e)
    return false
  }
}

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

export function loadAppearance() {
  try {
    migrateLegacyIfNeeded()
    const raw = localStorage.getItem(getStorageKey('appearance'))
    if (!raw) {
      // also check settings JSON fallback
      const sRaw = localStorage.getItem(getStorageKey('settings'))
      if (sRaw) {
        try {
          const s = JSON.parse(sRaw)
          if (s && typeof s.appearance === 'string' && APPEARANCE_VALUES.includes(s.appearance)) return s.appearance
        } catch {}
      }
      return DEFAULT_APPEARANCE
    }
    // stored as JSON string or plain string
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'string') return sanitizeAppearance(parsed)
    } catch {}
    return sanitizeAppearance(raw)
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function saveAppearance(val) {
  try {
    const v = sanitizeAppearance(val)
    localStorage.setItem(getStorageKey('appearance'), JSON.stringify(v))
    // also keep settings JSON in sync
    try {
      const sRaw = localStorage.getItem(getStorageKey('settings'))
      let s = {}
      if (sRaw) s = JSON.parse(sRaw) || {}
      s.appearance = v
      if (!s.colorScheme) s.colorScheme = loadColorScheme()
      localStorage.setItem(getStorageKey('settings'), JSON.stringify(s))
    } catch {}
    return true
  } catch (e) {
    console.warn('saveAppearance failed', e)
    return false
  }
}

export function loadColorScheme() {
  try {
    migrateLegacyIfNeeded()
    const raw = localStorage.getItem(getStorageKey('colorScheme'))
    if (!raw) {
      const sRaw = localStorage.getItem(getStorageKey('settings'))
      if (sRaw) {
        try {
          const s = JSON.parse(sRaw)
          if (s && typeof s.colorScheme === 'string' && COLOR_SCHEME_VALUES.includes(s.colorScheme)) return s.colorScheme
        } catch {}
      }
      return DEFAULT_COLOR_SCHEME
    }
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'string') return sanitizeColorScheme(parsed)
    } catch {}
    return sanitizeColorScheme(raw)
  } catch {
    return DEFAULT_COLOR_SCHEME
  }
}

export function saveColorScheme(val) {
  try {
    const v = sanitizeColorScheme(val)
    localStorage.setItem(getStorageKey('colorScheme'), JSON.stringify(v))
    try {
      const sRaw = localStorage.getItem(getStorageKey('settings'))
      let s = {}
      if (sRaw) s = JSON.parse(sRaw) || {}
      s.colorScheme = v
      if (!s.appearance) s.appearance = loadAppearance()
      localStorage.setItem(getStorageKey('settings'), JSON.stringify(s))
    } catch {}
    return true
  } catch (e) {
    console.warn('saveColorScheme failed', e)
    return false
  }
}

export function loadSettings() {
  try {
    const appearance = loadAppearance()
    const colorScheme = loadColorScheme()
    return { appearance, colorScheme }
  } catch {
    return { appearance: DEFAULT_APPEARANCE, colorScheme: DEFAULT_COLOR_SCHEME }
  }
}

export function saveSettings(settings) {
  try {
    const a = sanitizeAppearance(settings?.appearance)
    const c = sanitizeColorScheme(settings?.colorScheme)
    saveAppearance(a)
    saveColorScheme(c)
    localStorage.setItem(getStorageKey('settings'), JSON.stringify({ appearance: a, colorScheme: c }))
    return true
  } catch (e) {
    console.warn('saveSettings failed', e)
    return false
  }
}

// For future backend: export an interface
export const storage = { loadLinks, saveLinks, loadProfile, saveProfile, loadFolders, saveFolders, loadAppearance, saveAppearance, loadColorScheme, saveColorScheme, loadSettings, saveSettings }
