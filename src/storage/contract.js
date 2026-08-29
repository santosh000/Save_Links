// Repository contract for Save_Links persistence.
//
// The application/domain layer depends on THIS interface, not on IndexedDB
// (or any future adapter). Conceptually:
//
//   Application (composables)
//       ↓
//   Repository contract        <- this file
//       ↓
//   IndexedDB adapter          (src/storage/indexeddb.js — current)
//   Cloud/Save_Links API       (future)
//   SQLite (desktop/mobile)    (future)
//
// The interface is derived from the ACTUAL application requirements (the
// current localStorage functions in src/utils/storage.js and their callers in
// useLinks/useFolders/useProfile/useSettings/backup.js). Nothing speculative:
// every method below maps to a current or explicitly planned use.
//
// Conventions for every method:
// - All methods are async and return Promises.
// - Validation/normalization failures REJECT with an Error (never silently drop).
// - Storage failures (open/transaction/quota) reject with the underlying error.
// - Links are normalized through src/domain/link.js normalizeLink on write AND
//   read (malformed stored records are normalized, not dropped).
// - Records keep caller-supplied string ids; createdAt is preserved.
//
// @typedef {Object} Link
// @property {string} id
// @property {string} originalUrl
// @property {string} normalizedUrl
// @property {string} url
// @property {string} domain
// @property {string} title
// @property {string} description
// @property {string} image
// @property {string} category
// @property {string[]} tags
// @property {boolean} important
// @property {boolean} mustHave
// @property {boolean} favorite
// @property {string|null} folderId
// @property {string|null} status
// @property {string} createdAt
//
// @typedef {Object} Folder
// @property {string} id
// @property {string} name
// @property {string} createdAt
//
// @typedef {Object} Settings
// @property {'light'|'dark'|'system'} appearance
// @property {'ocean'|'forest'|'lavender'|'amber'} colorScheme

/**
 * Repository interface (documented, not enforced at runtime).
 *
 * Links — per-record CRUD is the sync-friendly unit of work; collection
 * reads/writes exist for boot hydration and imports.
 *
 *   getAllLinks(): Promise<Link[]>                 readonly tx; [] if empty
 *   upsertLink(rawLink): Promise<Link>             one readwrite tx (links store);
 *                                                  normalizes rawLink, throws on
 *                                                  non-object input, returns the
 *                                                  canonical record
 *   deleteLink(id): Promise<void>                  one readwrite tx (links store); rejects
 *                                                  on empty/non-string id
 *   setAllLinks(rawLinks): Promise<void>           one readwrite tx (links store): clears +
 *                                                  rewrites the whole collection (import)
 *
 * Folders — app-level cascade (deleteFolder + moveLinksFromFolder) stays in the
 * application layer; the adapter does NOT touch links when a folder is deleted.
 *
 *   getAllFolders(): Promise<Folder[]>             readonly tx; [] if empty
 *   upsertFolder(rawFolder): Promise<Folder>       one readwrite tx (folders store);
 *                                                  sanitizes, throws on invalid folder
 *   deleteFolder(id): Promise<void>                one readwrite tx (folders store)
 *   setAllFolders(rawFolders): Promise<void>       one readwrite tx (folders store): clears +
 *                                                  rewrites the whole collection
 *
 * Profile / settings — single kv blobs (one write = one tx, atomic per value).
 *
 *   getProfile(): Promise<Object>                  stored profile, else default
 *                                                  { name: 'Local User', bio: 'Local-first bookmark manager' }
 *   saveProfile(profile): Promise<void>            throws unless a plain object
 *   getSettings(): Promise<Settings>               sanitized; defaults system/ocean when absent
 *   saveSettings(settings): Promise<void>          sanitizes to valid values
 *
 * Atomic bulk replacement — AUTHORITATIVE and all-or-nothing: it replaces
 * EVERY store this repository owns (links, folders, and the kv profile/settings
 * blobs) with exactly the provided state, in one readwrite transaction; a
 * failure aborts everything and previous data survives untouched. Used by the
 * localStorage→IndexedDB migration and backup import. Do NOT use it for
 * partial updates.
 *
 *   replaceAll({ links, folders, profile, settings }): Promise<{links, folders}>
 *     — callers MUST intentionally provide the COMPLETE replacement state:
 *       anything omitted (or passed as []/null) is removed — omitted
 *       links/folders are cleared, an omitted profile is deleted; settings are
 *       always (re)written, sanitized. Calling replaceAll() with no arguments
 *       wipes every store it owns.
 *
 * Backup import must NOT call this blindly: backup records need backup-specific
 * import policy applied first (skip-no-href records, validFolderIds
 * re-mapping, legacy status/flag normalization — see src/utils/backup.js
 * normalizeBackupData). Only the fully policy-applied state may be handed to
 * replaceAll.
 *
 * Lifecycle:
 *   close(): Promise<void> — closes the underlying connection (idempotent);
 *                            used by tests to prove reopen-persistence
 */