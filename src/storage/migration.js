// Safe localStorage -> IndexedDB migration and application boot.
//
// This module owns the ONLY plausible moment to read the runtime state from
// the v1.0.0 localStorage: application startup, BEFORE Vue mounts. After boot
// the app reads and writes exclusively through the repository (IndexedDB); the
// localStorage user data is kept forever as a recovery source and is never
// modified or deleted.
//
// Guarantees:
// - SOURCE RETENTION: original localStorage user data is never cleared or
//   renamed; only the migration marker key (save_link:{env}:migration) is
//   written there.
// - ATOMIC: the migrated state lands in IndexedDB through one replaceAll()
//   transaction (all-or-nothing).
// - IDEMPOTENT / NO DUPLICATES: existing ids and createdAt are preserved, so
//   re-running the migration replaces identical records instead of
//   duplicating.
// - RETRYABLE / RECOVERABLE: a failure or crash leaves the marker at
//   'in-progress' (never trusted as success); the next boot re-runs the
//   migration. A failed 'complete' write self-heals via 'in-progress'.
//
// Marker states (distinct; "IndexedDB has data" is NEVER used as a marker):
//   pending      — no migration started (or key absent)
//   in-progress  — attempt started, NOT verified, NOT trusted
//   complete     — write + read-back verification succeeded
//
// Policies:
// - No localStorage user data (fresh install, or the browser cleared it while
//   IndexedDB kept the migrated copy) -> nothing to migrate; the IndexedDB
//   state is adopted as-is and the marker becomes 'complete'.
// - 'in-progress' -> interrupted attempt: retry. replaceAll is atomic, so
//   IndexedDB holds either the pre-migration state or the fully-migrated
//   state; both re-run cleanly (ids are stable, so no duplicates).
// - 'pending' while BOTH stores hold data -> ambiguous conflict (migration was
//   never started, yet IndexedDB is non-empty): NOTHING is overwritten or
//   deleted; a MigrationConflictError is thrown so the situation can be
//   reconciled by the user. Every retry fails identically (fail conservatively).
// - Malformed / unreadable localStorage degrades exactly like the v1.0.0 app
//   (the storage.js loaders return []/defaults); recoverable records are
//   normalized through the canonical src/domain/link.js normalizeLink.
// - Links whose folderId points at a missing folder get folderId = null (the
//   app's own semantics after folder deletion); links are never dropped for an
//   invalid folder reference.
import { getStorageKey } from '../utils/environment.js'
import { loadLinks, loadFolders, loadProfile, loadAppearance, loadColorScheme } from '../utils/storage.js'
import { normalizeLink } from '../domain/link.js'
import { sanitizeFolder, DEFAULT_PROFILE } from './indexeddb.js'

export const MIGRATION_STATE = Object.freeze({
  PENDING: 'pending',
  IN_PROGRESS: 'in-progress',
  COMPLETE: 'complete',
})

// In-memory snapshot filled by boot() BEFORE Vue mounts. Composables read
// their initial state from here synchronously, so the app never renders an
// empty/IndexedDB state ahead of migration and never shows data disappearing.
export const bootState = {
  ready: false,
  links: [],
  folders: [],
  profile: null,
  settings: null,
}

export class MigrationConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MigrationConflictError'
  }
}

// The keys a v1.0.0 profile could have written. 'links' is how the conflict
// policy distinguishes "user has data in localStorage" from "fresh install".
const USER_KEYS = ['links', 'folders', 'profile', 'appearance', 'colorScheme', 'settings']

function readMigrationState() {
  try {
    return localStorage.getItem(getStorageKey('migration')) || MIGRATION_STATE.PENDING
  } catch {
    return MIGRATION_STATE.PENDING
  }
}

function writeMigrationState(state) {
  try {
    localStorage.setItem(getStorageKey('migration'), state)
  } catch (e) {
    throw new Error(`Failed to write migration state: ${e ? e.message : state}`)
  }
}

function hasLocalStorageUserData() {
  return USER_KEYS.some((name) => {
    try {
      return localStorage.getItem(getStorageKey(name)) !== null
    } catch {
      return false
    }
  })
}

function readSourceData() {
  return {
    rawLinks: loadLinks(),
    rawFolders: loadFolders(),
    // No stored profile -> null -> replaceAll deletes the profile blob and
    // getProfile() returns its default (preserves the current no-profile
    // behavior). Callers get a FRESH default object per read (see adapter).
    profile: (() => {
      try {
        return localStorage.getItem(getStorageKey('profile')) === null ? null : loadProfile()
      } catch {
        return null
      }
    })(),
    settings: { appearance: loadAppearance(), colorScheme: loadColorScheme() },
  }
}

function buildMigratedState({ rawLinks, rawFolders, profile, settings }) {
  const folders = rawFolders.map(sanitizeFolder).filter(Boolean)
  const validFolderIds = new Set(folders.map((f) => f.id))
  const links = rawLinks
    .map((raw) => {
      const normalized = normalizeLink(raw)
      if (!normalized) return null
      if (normalized.folderId && !validFolderIds.has(normalized.folderId)) normalized.folderId = null
      return normalized
    })
    .filter(Boolean)
  return { links, folders, profile, settings }
}

// Read-back verification BEFORE the marker is allowed to become 'complete':
// a crash between write and marker leaves 'in-progress', and the next boot
// re-runs the migration — so marking 'complete' means the data was actually
// read back and matches, not just "the write resolved".
async function verifyMigration(repo, written) {
  const [links, folders, profile, settings] = await Promise.all([
    repo.getAllLinks(),
    repo.getAllFolders(),
    repo.getProfile(),
    repo.getSettings(),
  ])
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  const writtenById = new Map(written.links.map((l) => [l.id, l]))
  const readById = new Map(links.map((l) => [l.id, l]))
  if (writtenById.size !== readById.size) throw new Error('Migration verification failed: link count mismatch')
  for (const [id, record] of writtenById) {
    const back = readById.get(id)
    if (!back || !same(back, record)) throw new Error(`Migration verification failed: link "${id}" does not match`)
  }

  const writtenFoldersById = new Map(written.folders.map((f) => [f.id, f]))
  const readFoldersById = new Map(folders.map((f) => [f.id, f]))
  if (writtenFoldersById.size !== readFoldersById.size) throw new Error('Migration verification failed: folder count mismatch')
  for (const [id, record] of writtenFoldersById) {
    const back = readFoldersById.get(id)
    if (!back || !same(back, record)) throw new Error(`Migration verification failed: folder "${id}" does not match`)
  }

  // written profile === null means "use the repository default"
  const expectedProfile = written.profile || DEFAULT_PROFILE
  if (!same(profile, expectedProfile)) throw new Error('Migration verification failed: profile does not match')
  if (!same(settings, written.settings)) throw new Error('Migration verification failed: settings do not match')
}

// Returns { migrated, state }. Throws MigrationConflictError for the
// both-stores case and rethrows storage errors (marker left 'in-progress',
// localStorage untouched — recovery guidance below).
export async function migrateIfNeeded(repo) {
  const state = readMigrationState()
  if (state === MIGRATION_STATE.COMPLETE) return { migrated: false, state }

  if (!hasLocalStorageUserData()) {
    // Fresh user — or the browser cleared localStorage while IndexedDB kept
    // the migrated copy. Either way IndexedDB is authoritative; do NOT
    // overwrite it with nothing. Mark complete and adopt it as-is.
    writeMigrationState(MIGRATION_STATE.COMPLETE)
    return { migrated: false, state: MIGRATION_STATE.COMPLETE }
  }

  const [existingLinks, existingFolders] = await Promise.all([repo.getAllLinks(), repo.getAllFolders()])
  if (state === MIGRATION_STATE.PENDING && (existingLinks.length > 0 || existingFolders.length > 0)) {
    throw new MigrationConflictError(
      'Save Links found data in BOTH localStorage and IndexedDB with no migration in progress. ' +
        'Neither store was modified. Export a backup, then clear one store, and reload.'
    )
  }

  writeMigrationState(MIGRATION_STATE.IN_PROGRESS)
  try {
    const written = buildMigratedState(readSourceData())
    await repo.replaceAll(written)
    await verifyMigration(repo, written)
    writeMigrationState(MIGRATION_STATE.COMPLETE)
    return { migrated: true, state: MIGRATION_STATE.COMPLETE }
  } catch (err) {
    // Marker stays 'in-progress' — never trusted as success; the next boot
    // retries. localStorage is untouched.
    throw err
  }
}

export async function loadSnapshot(repo) {
  const [links, folders, profile, settings] = await Promise.all([
    repo.getAllLinks(),
    repo.getAllFolders(),
    repo.getProfile(),
    repo.getSettings(),
  ])
  return { links, folders, profile, settings }
}

// Full startup sequence: migrate if necessary (never render an empty
// IndexedDB state first), hydrate the in-memory snapshot, THEN mount. Called
// by main.js before createApp().mount().
export async function boot(repo) {
  await migrateIfNeeded(repo)
  const snapshot = await loadSnapshot(repo)
  bootState.links = snapshot.links
  bootState.folders = snapshot.folders
  bootState.profile = snapshot.profile
  bootState.settings = snapshot.settings
  bootState.ready = true
  return bootState
}