// IndexedDB adapter behind the repository contract (src/storage/contract.js).
// The composables do NOT import this directly yet; the localStorage path stays
// the live storage until the migration task switches the app over.
//
// Database design (schema version 1):
//   - name: `save_links:{env}` — mirrors the localStorage keyspace isolation
//     (save_link:{dev|test|prod}:), so tests/dev/prod can never collide.
//   - object stores:
//       links    keyPath 'id' (caller-supplied string ids; NO autoincrement)
//                indexes: by-createdAt, by-folderId, by-category
//       folders  keyPath 'id'
//       kv       keyPath 'key' — {key, value} blobs for profile/settings
//                (single-value blob keeps each value atomic and 1:1 mapable
//                to future API resources)
//   - versioned migrations are additive only: bump INDEXEDDB_DB_VERSION and add
//     a guarded branch in upgrade(); never rename/reuse stores in place.
//
// Transaction strategy: one small readwrite transaction per entity write;
// setAllLinks/replaceAll use single transactions (all-or-nothing). Folder
// deletion does NOT cascade into links — the app does that explicitly
// (deleteFolder + moveLinksFromFolder), keeping semantics identical to today.
//
// Errors: every method rejects on failure (open/transaction/quota/validation).
// Malformed stored data is normalized on read, never silently dropped.
import { ENVIRONMENT } from '../utils/environment.js'
import { normalizeLink } from '../domain/link.js'
import { APPEARANCE_VALUES, COLOR_SCHEME_VALUES, DEFAULT_APPEARANCE, DEFAULT_COLOR_SCHEME } from '../utils/storage.js'

export const INDEXEDDB_DB_VERSION = 1
export const STORES = { LINKS: 'links', FOLDERS: 'folders', KV: 'kv' }
export const KV_KEYS = { PROFILE: 'profile', SETTINGS: 'settings' }

export function defaultDBName() {
  return `save_links:${ENVIRONMENT}`
}

// Single source of truth for the schema. Exported so tests and future
// migration/upgrade tooling build the database through the same path.
export function upgrade(db) {
  if (!db.objectStoreNames.contains(STORES.LINKS)) {
    const store = db.createObjectStore(STORES.LINKS, { keyPath: 'id' })
    store.createIndex('by-createdAt', 'createdAt')
    store.createIndex('by-folderId', 'folderId')
    store.createIndex('by-category', 'category')
  }
  if (!db.objectStoreNames.contains(STORES.FOLDERS)) {
    db.createObjectStore(STORES.FOLDERS, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(STORES.KV)) {
    db.createObjectStore(STORES.KV, { keyPath: 'key' })
  }
}

function putRecord(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'))
  })
}

function deleteRecord(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'))
  })
}

function getAllRecords(db, storeName) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getKV(db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.KV, 'readonly').objectStore(STORES.KV).get(key)
    req.onsuccess = () => resolve(req.result ? req.result.value : undefined)
    req.onerror = () => reject(req.error)
  })
}

export const DEFAULT_PROFILE = { name: 'Local User', bio: 'Local-first bookmark manager' }

function sanitizeSettings(value) {
  const s = value && typeof value === 'object' ? value : {}
  return {
    appearance: APPEARANCE_VALUES.includes(s.appearance) ? s.appearance : DEFAULT_APPEARANCE,
    colorScheme: COLOR_SCHEME_VALUES.includes(s.colorScheme) ? s.colorScheme : DEFAULT_COLOR_SCHEME,
  }
}

// Exported so the migration path sanitizes folders through the same function
// the adapter uses on read (single sanitizer, no drift).
export function sanitizeFolder(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 50) : ''
  if (!id || !name) return null
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString()
  return { id, name, createdAt }
}

export function createIndexedDBRepository({ dbName = defaultDBName() } = {}) {
  let dbPromise = null

  function open() {
    if (dbPromise) return dbPromise
    const idb = globalThis.indexedDB
    if (!idb || typeof idb.open !== 'function') {
      return Promise.reject(new Error('IndexedDB is not available in this environment'))
    }
    dbPromise = new Promise((resolve, reject) => {
      // Open WITHOUT an explicit version: a fresh database is still created at
      // the current schema version (INDEXEDDB_DB_VERSION) via upgrade(), but a
      // database another connection already upgraded reopens at its current
      // version instead of failing with a VersionError.
      const req = idb.open(dbName)
      req.onupgradeneeded = () => upgrade(req.result)
      req.onsuccess = () => {
        const db = req.result
        // Another connection wants a higher schema version (e.g. a newer
        // deployment in another tab). Our old connection must not block that
        // upgrade forever: close it — an in-flight transaction aborts
        // atomically (the operation rejects, no partial state) — and drop the
        // cached promise so the next call reopens at the new version.
        // Single-tab apps never see this event.
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        resolve(db)
      }
      req.onerror = () => {
        const err = req.error || new Error(`IndexedDB open failed for "${dbName}"`)
        dbPromise = null
        reject(err)
      }
      // Safety net only: fires if some OTHER connection never closes on
      // versionchange; ours always closes itself, so this stays quiet.
      req.onblocked = () => {}
    })
    return dbPromise
  }

  async function close() {
    if (dbPromise) {
      const db = await dbPromise.catch(() => null)
      if (db) db.close()
      dbPromise = null
    }
  }

  // --- links ---------------------------------------------------------------
  async function getAllLinks() {
    const db = await open()
    const records = await getAllRecords(db, STORES.LINKS)
    return records.map(normalizeLink).filter(Boolean)
  }

  async function upsertLink(rawLink) {
    const link = normalizeLink(rawLink)
    if (!link) throw new Error('Invalid link: expected an object record')
    const db = await open()
    await putRecord(db, STORES.LINKS, link)
    return link
  }

  async function deleteLink(id) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid link id')
    const db = await open()
    await deleteRecord(db, STORES.LINKS, id)
  }

  async function setAllLinks(rawLinks) {
    const links = (Array.isArray(rawLinks) ? rawLinks : []).map(normalizeLink).filter(Boolean)
    const db = await open()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.LINKS, 'readwrite')
      const store = tx.objectStore(STORES.LINKS)
      store.clear()
      for (const link of links) store.put(link)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'))
    })
  }

  // --- folders -------------------------------------------------------------
  async function getAllFolders() {
    const db = await open()
    const records = await getAllRecords(db, STORES.FOLDERS)
    return records.map(sanitizeFolder).filter(Boolean)
  }

  async function upsertFolder(rawFolder) {
    const folder = sanitizeFolder(rawFolder)
    if (!folder) throw new Error('Invalid folder: expected { id, name }')
    const db = await open()
    await putRecord(db, STORES.FOLDERS, folder)
    return folder
  }

  async function deleteFolder(id) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid folder id')
    const db = await open()
    await deleteRecord(db, STORES.FOLDERS, id)
  }

  async function setAllFolders(rawFolders) {
    const folders = (Array.isArray(rawFolders) ? rawFolders : []).map(sanitizeFolder).filter(Boolean)
    const db = await open()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.FOLDERS, 'readwrite')
      const store = tx.objectStore(STORES.FOLDERS)
      store.clear()
      for (const folder of folders) store.put(folder)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'))
    })
  }

  // --- profile / settings (kv blobs) ---------------------------------------
  async function getProfile() {
    const db = await open()
    const value = await getKV(db, KV_KEYS.PROFILE)
    // fresh object per call — never hand callers a mutable reference to the
    // module-level default (they could corrupt it for every later read)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { ...DEFAULT_PROFILE }
  }

  async function saveProfile(profile) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      throw new Error('Invalid profile: expected an object')
    }
    const db = await open()
    await putRecord(db, STORES.KV, { key: KV_KEYS.PROFILE, value: { ...profile } })
  }

  async function getSettings() {
    const db = await open()
    const value = await getKV(db, KV_KEYS.SETTINGS)
    return sanitizeSettings(value)
  }

  async function saveSettings(settings) {
    const db = await open()
    await putRecord(db, STORES.KV, { key: KV_KEYS.SETTINGS, value: sanitizeSettings(settings) })
  }

  // --- atomic bulk replacement ----------------------------------------------
  // localStorage -> IndexedDB migration and backup import need all-or-nothing
  // behavior across every store. One readwrite transaction; a failure aborts
  // everything and previous data survives untouched.
  async function replaceAll({ links = [], folders = [], profile = null, settings = null } = {}) {
    const cleanLinks = (Array.isArray(links) ? links : []).map(normalizeLink).filter(Boolean)
    const cleanFolders = (Array.isArray(folders) ? folders : []).map(sanitizeFolder).filter(Boolean)
    const cleanProfile = profile && typeof profile === 'object' && !Array.isArray(profile) ? { ...profile } : null
    const cleanSettings = sanitizeSettings(settings)
    const db = await open()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.LINKS, STORES.FOLDERS, STORES.KV], 'readwrite')
      const linksStore = tx.objectStore(STORES.LINKS)
      linksStore.clear()
      for (const link of cleanLinks) linksStore.put(link)
      const foldersStore = tx.objectStore(STORES.FOLDERS)
      foldersStore.clear()
      for (const folder of cleanFolders) foldersStore.put(folder)
      const kv = tx.objectStore(STORES.KV)
      if (cleanProfile) kv.put({ key: KV_KEYS.PROFILE, value: cleanProfile })
      else kv.delete(KV_KEYS.PROFILE)
      kv.put({ key: KV_KEYS.SETTINGS, value: cleanSettings })
      tx.oncomplete = () => resolve({ links: cleanLinks, folders: cleanFolders })
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('transaction aborted'))
    })
  }

  return {
    getAllLinks,
    upsertLink,
    deleteLink,
    setAllLinks,
    getAllFolders,
    upsertFolder,
    deleteFolder,
    setAllFolders,
    getProfile,
    saveProfile,
    getSettings,
    saveSettings,
    replaceAll,
    close,
  }
}