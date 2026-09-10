import { ref, computed, watch, onScopeDispose, getCurrentScope } from 'vue'
import { repository } from '../storage/repository.js'
import { bootState } from '../storage/migration.js'
import { onDataChanged } from '../storage/dataChanges.js'
import { categorizeUrl, getDomain, normalizeUrl } from '../utils/categorize.js'
import { normalizeLink, generateId } from '../domain/link.js'
import { fetchMetadata, guessTitleSync } from '../utils/metadata.js'
import { detectPlatform } from '../utils/device.js'
import { session } from '../auth/session.js'
import { syncNow } from './useSync.js'

// Internal flag to prevent watch from overwriting remote pull data
let isReloadingFromRemote = false

export const STATUSES = ['important', 'must-have']

// Thrown by addLink() when a link with the same cleaned normalizedUrl is
// already saved. Carries the existing link so the UI can offer
// replace / add-another / cancel.
export class DuplicateLinkError extends Error {
  constructor(existing) {
    super('Link already saved')
    this.name = 'DuplicateLinkError'
    this.existing = existing
  }
}

// True when the submission carries prefetched metadata for the SAME
// normalized URL — reuse it and skip the background enrichment fetch.
function hasValidPrefetch(payload, normalized) {
  const prefetchedUrl = payload._prefetchedUrl ? normalizeUrl(payload._prefetchedUrl) : null
  return !!payload._prefetchedMeta && prefetchedUrl === normalized
}

// Shared derivation for addLink() and replaceLink(): normalize -> validate ->
// best-known metadata (prefetched only — NEVER fetched here) -> link fields.
// Returns everything a new link needs EXCEPT id and createdAt (replace reuses
// the existing ones). Saving must never wait for a network request, so this
// is synchronous; missing metadata falls back immediately and the caller
// starts background enrichment for what is still unknown.
function buildLinkSpec(payload, normalized) {
  let parsed
  try { parsed = new URL(normalized) } catch { throw new Error('Invalid URL') }

  // reuse prefetched metadata if available and for same normalized URL (avoid double fetch)
  const meta = hasValidPrefetch(payload, normalized) ? payload._prefetchedMeta : null

  const inputTitle = (payload.title ?? '').trim()
  const inputDesc = (payload.description ?? '').trim()
  const inputImage = (payload.image ?? '').trim()

  const finalTitle = inputTitle || (meta && meta.title) || guessTitleSync(normalized) || parsed.hostname
  const finalCategory = payload.category || categorizeUrl(normalized)
  const finalDomain = (meta && meta.domain) || getDomain(normalized)
  const finalDescription = inputDesc || (meta && meta.description) || ''
  const finalImage = inputImage || (meta && meta.image) || ''

  const important = !!payload.important || payload.status === 'important'
  const mustHave = !!payload.mustHave || payload.status === 'must-have'
  const favorite = !!payload.favorite
  const folderId = typeof payload.folderId === 'string' && payload.folderId.trim() ? payload.folderId.trim() : null

  return {
    originalUrl: (payload.originalUrl ?? payload.url ?? '').trim(),
    normalizedUrl: normalized,
    url: normalized,
    domain: finalDomain,
    title: finalTitle.slice(0, 200),
    description: finalDescription.slice(0, 400),
    image: finalImage.trim(),
    category: finalCategory,
    tags: Array.isArray(payload.tags) ? payload.tags.map(t => t.trim()).filter(Boolean) : [],
    important,
    mustHave,
    favorite,
    folderId,
    status: important && mustHave ? 'both' : important ? 'important' : mustHave ? 'must-have' : null,
    // v2 sync field — new objects start at revision 0 (server-authoritative
    // once server ACK lands; never incremented locally)
    revision: 0
  }
}

// Queue outbox mutations for records added/replaced by a backup import, then
// fire ONE syncNow once every mutation is queued (never one sync per record).
// Follows the exact claim rules already established by addLink/updateLink:
//   - new records   -> create, base_revision 0, owned by the current account
//   - replaced      -> update, base claimed from the store-acknowledged record
//                      (a stale in-memory base would 409 + rebase churn), store
//                      ownership/kept_local preserved
//   - payloads      -> JSON round-trip deep-unwrap (reactive tags arrays are
//                      proxies that IndexedDB's structured clone rejects)
//   - anonymous     -> no account, no outbox: imports stay local-only (same as
//                      the pre-Bug-2 behavior)
async function queueImportedMutations(newRecords, replacedRecords, objectType) {
  const accountId = session.getState().user?.id
  if (!accountId) return
  for (const record of newRecords) {
    // Brand the record itself before the deep watch persists it — addLink does
    // the same, so the store copy (and every later push/pull compare) sees the
    // imported record as owned, never as anonymous again.
    record.revision = 0
    record.account_id = accountId
    // New objects claim at base 0; the server owns the record from its ACK on.
    await repository.addPendingMutation(
      'create',
      record.id,
      objectType,
      JSON.parse(JSON.stringify({ ...record, revision: 0, account_id: accountId })),
      accountId,
      0
    ).catch(err => console.warn('Failed to queue import mutation:', err))
  }
  if (replacedRecords.length) {
    const storeRecords = objectType === 'link' ? await repository.getAllLinks() : await repository.getAllFolders()
    for (const record of replacedRecords) {
      const storeCopy = storeRecords.find(r => r.id === record.id)
      const baseRevision = storeCopy ? storeCopy.revision : record.revision
      const payload = JSON.parse(JSON.stringify(storeCopy
        ? { ...record, revision: baseRevision, account_id: storeCopy.account_id, kept_local: storeCopy.kept_local }
        : record))
      await repository.addPendingMutation(
        'update',
        record.id,
        objectType,
        payload,
        accountId,
        baseRevision
      ).catch(err => console.warn('Failed to queue import mutation:', err))
    }
  }
  if (newRecords.length || replacedRecords.length) {
    // Automatic push for authenticated users — same fire-and-forget as addLink.
    syncNow().catch(err => console.warn('Auto-sync failed:', err))
  }
}

export function useLinks() {
  // Initial state comes from the boot snapshot (filled by boot() in main.js
  // BEFORE Vue mounts from migrated IndexedDB data) — the app never starts
  // from an empty/IndexedDB state ahead of migration, and never reads
  // localStorage at runtime anymore.
  const links = ref(bootState.ready ? bootState.links : [])
  const storageError = ref('')

  // Reload the reactive list when authoritative data changes in IndexedDB from
  // OUTSIDE this composable (a cloud pull/reconcile writes through the
  // repository directly). Reading back through the single repository keeps one
  // source of truth; updating the same refs local CRUD uses makes pulled links
  // appear without a page refresh.
  const unsubscribeDataChanged = onDataChanged(async () => {
    try {
      isReloadingFromRemote = true
      // Reload reconciliation (see src/sync/link-arrival.test.js): the store
      // snapshot alone can race a local save/delete landing while this async
      // read is in flight — its persistence write is swallowed by the watch
      // guard below, so the record survives in this ref and the mutation
      // queue but never reaches a store read taken before it. Preserve
      // ref-only records that have a pending create/update but are absent
      // from the snapshot, and drop snapshot records that have a pending
      // delete — never clobber a just-saved link, never resurrect a locally
      // deleted one. Pending mutations are read twice because a delete
      // queued during the snapshot read can commit after the first read.
      const snapshot = await repository.getAllLinks()
      const pending1 = await repository.getPendingMutations()
      const pending2 = await repository.getPendingMutations()
      const accountId = session.getState().user?.id
      const keptKeys = new Set()
      const deletedKeys = new Set()
      for (const m of [...pending1, ...pending2]) {
        if (m.object_type !== 'link') continue
        // Account-scoping: the outbox can hold leftover pending mutations from
        // a previous account on this browser. Only the CURRENT account's
        // mutations may protect (create/update) or drop (delete) records here;
        // a foreign mutation with a colliding object id must never alter this
        // account's reconciliation. (Anonymous: no account — legacy behavior.)
        if (accountId && m.account_id !== accountId) continue
        const key = `link:${m.object_id}`
        if (m.operation === 'delete') deletedKeys.add(key)
        else keptKeys.add(key)
      }
      const keptLocal = links.value.filter(
        (l) => keptKeys.has(`link:${l.id}`) && !snapshot.some((s) => s.id === l.id)
      )
      const fresh = snapshot.filter((s) => !deletedKeys.has(`link:${s.id}`))
      const merged = keptLocal.length ? [...keptLocal, ...fresh] : fresh
      links.value = merged
      // Persist explicitly: the watch is suppressed while this flag is up, so
      // a merged (kept/dropped) set would otherwise never reach storage.
      if (keptLocal.length || merged.length !== snapshot.length) {
        await repository.setAllLinks(merged)
      }
    } catch (err) {
      console.warn('reload links from storage failed', err)
    } finally {
      isReloadingFromRemote = false
    }
  })
  // Release the subscription when this composable's scope is torn down, so a
  // remount/HMR cannot leave a stale listener holding the old ref. Only bind to
  // a scope when one is active (component setup / effectScope); standalone
  // invocations have no scope to dispose.
  if (getCurrentScope()) onScopeDispose(unsubscribeDataChanged)

  // persist automatically — keep in-memory state on storage failure
  watch(links, (val) => {
    if (isReloadingFromRemote) return
    repository.setAllLinks(val)
      .then(() => {
        if (storageError.value) storageError.value = ''
      })
      .catch((err) => {
        console.warn('setAllLinks failed', err)
        storageError.value = 'Storage full — changes not saved. Delete some links or clear browser data.'
      })
  }, { deep: true })

  const total = computed(() => links.value.length)
  const importantCount = computed(() => links.value.filter(l => l.important).length)
  const mustHaveCount = computed(() => links.value.filter(l => l.mustHave).length)
  const favoriteCount = computed(() => links.value.filter(l => l.favorite).length)

  const byCategory = computed(() => {
    const map = {}
    for (const l of links.value) {
      map[l.category] = (map[l.category] || 0) + 1
    }
    return map
  })

  async function addLink(payload, options = {}) {
    // payload: { originalUrl, url?, title, description, image, category, tags, important, mustHave, status (legacy), folderId, _prefetchedMeta, _prefetchedUrl }
    // options: { allowDuplicate } — bypass the duplicate rejection (used by "Add another")
    const rawInput = (payload.originalUrl ?? payload.url ?? '').trim()
    if (!rawInput) throw new Error('URL required')
    const normalized = normalizeUrl(rawInput)
    try { new URL(normalized) } catch { throw new Error('Invalid URL') }

    // duplicate detection AFTER normalization/validation but BEFORE any
    // metadata work — the save and the duplicate UX never wait on a fetch
    const existing = links.value.find(l => l.normalizedUrl === normalized)
    if (existing && !options.allowDuplicate) throw new DuplicateLinkError(existing)

    const spec = buildLinkSpec(payload, normalized)
    const link = { id: generateId(), createdAt: new Date().toISOString(), savedFrom: detectPlatform(), ...spec }
    links.value.unshift(link)

    // Create pending mutation for sync (if authenticated)
    const accountId = session.getState().user?.id
    if (accountId) {
      await repository.addPendingMutation(
        'create',
        link.id,
        'link',
        link,
        accountId,
        link.revision // base_revision = 0 for new objects
      )
      // Automatic push for authenticated users
      syncNow().catch(err => console.warn('Auto-sync failed:', err))
    }

    enrichMetadata(link.id, normalized, payload)
    return link
  }

  // Replace an existing record with a fresh submission's URL/metadata.
  // Preserves id, createdAt and user-managed fields (folderId, tags,
  // important, mustHave, favorite); updates originalUrl, normalizedUrl, url,
  // domain, category, title, description, image. Reuses updateLink() so alias
  // synchronization and validation behave exactly as everywhere else.
  async function replaceLink(id, payload) {
    if (!links.value.some(l => l.id === id)) return null
    const rawInput = (payload.originalUrl ?? payload.url ?? '').trim()
    if (!rawInput) throw new Error('URL required')
    const normalized = normalizeUrl(rawInput)
    try { new URL(normalized) } catch { throw new Error('Invalid URL') }
    const spec = buildLinkSpec(payload, normalized)
    // updateLink() is the single queue path: it claims the store-acknowledged
    // revision and the store's owned identity and deep-unwraps the payload
    // (see updateLink). Previously replaceLink ALSO queued a second update from
    // the reactive ref — a stale base_revision (re-409 + rebase churn) and a
    // reactive payload (DataCloneError -> unhandled rejection) — re-introducing
    // the exact post-merge divergence bug C guarded against. One mutation only.
    await updateLink(id, {
      originalUrl: spec.originalUrl,
      normalizedUrl: spec.normalizedUrl,
      url: spec.url,
      domain: spec.domain,
      category: spec.category,
      title: spec.title,
      description: spec.description,
      image: spec.image
    })
    const updated = links.value.find(l => l.id === id) || null
    if (updated) {
      enrichMetadata(updated.id, normalized, payload)
    }
    return updated
  }

  // Background metadata enrichment: runs only when the submission had NO valid
  // prefetch (the prefetch flow already got its one fetch — never duplicate
  // it, even if the prefetch was partial). The record is already saved with
  // fallback values; when metadata lands it fills only fields still holding
  // fallback/empty values, so user-typed data is never clobbered. Failures
  // leave the fallback record untouched and are swallowed silently.
  function enrichMetadata(linkId, normalized, payload) {
    if (hasValidPrefetch(payload, normalized)) return
    fetchMetadata(normalized)
      .then((meta) => {
        const cur = links.value.find(l => l.id === linkId)
        if (!cur) return // link was deleted while fetching
        const patch = {}
        // only swap a URL-derived fallback title for a real one
        if (meta.title && meta.title !== cur.title && cur.title === guessTitleSync(cur.normalizedUrl || cur.url)) {
          patch.title = meta.title
        }
        if (meta.description && !cur.description) patch.description = meta.description
        if (meta.image && !cur.image) patch.image = meta.image
        if (meta.domain && cur.domain !== meta.domain) patch.domain = meta.domain
        if (Object.keys(patch).length) updateLink(cur.id, patch)
      })
      .catch(() => {}) // enrichment is best-effort; never surface or interrupt
  }

  async function updateLink(id, patch) {
    const idx = links.value.findIndex(l => l.id === id)
    if (idx === -1) return
    const merged = { ...links.value[idx], ...patch }
    if ('favorite' in patch) {
      merged.favorite = !!patch.favorite
    }
    if ('folderId' in patch) {
      const fid = patch.folderId
      merged.folderId = typeof fid === 'string' && fid.trim() ? fid.trim() : null
    }
    // keep status/flags in sync if patch contains important/mustHave or status
    if ('important' in patch || 'mustHave' in patch) {
      const imp = 'important' in patch ? !!patch.important : merged.important
      const mh = 'mustHave' in patch ? !!patch.mustHave : merged.mustHave
      merged.important = imp
      merged.mustHave = mh
      merged.status = imp && mh ? 'both' : imp ? 'important' : mh ? 'must-have' : null
    } else if ('status' in patch) {
      // legacy single status patch — map to flags for backward compat
      const s = patch.status
      merged.important = s === 'important' || s === 'both'
      merged.mustHave = s === 'must-have' || s === 'both'
      merged.status = s
    }
    // keep url/normalizedUrl alias synced
    if (patch.normalizedUrl) merged.url = patch.normalizedUrl
    if (patch.url && !patch.normalizedUrl) merged.normalizedUrl = patch.url
    links.value.splice(idx, 1, merged)

    // Create pending mutation for sync (if authenticated)
    const accountId = session.getState().user?.id
    if (accountId) {
      // The reactive copy can lag the authoritative store: a merge or a
      // push-accepted response updates revisions/ownership in IndexedDB only,
      // never back into this ref. Claim the mutation on the store-acknowledged
      // revision (a stale in-memory base forces a 409 conflict + rebase every
      // time) and carry the store's owned identity (account_id/kept_local), so
      // an update never strips the account attribution from the payload.
      const storeCopy = (await repository.getAllLinks()).find(l => l.id === merged.id)
      const baseRevision = storeCopy ? storeCopy.revision : merged.revision
      // Deep-unwrap before queueing: a shallow spread of the reactive record
      // keeps nested arrays (tags) as reactive proxies, which IndexedDB's
      // structured clone rejects with a DataCloneError — the mutation would
      // silently never be queued. JSON round-trip mirrors the Keep Local path
      // in App.vue.
      const payload = JSON.parse(JSON.stringify(storeCopy
        ? { ...merged, revision: baseRevision, account_id: storeCopy.account_id, kept_local: storeCopy.kept_local }
        : merged))
      await repository.addPendingMutation(
        'update',
        merged.id,
        'link',
        payload,
        accountId,
        baseRevision
      ).catch(err => console.warn('Failed to queue mutation:', err))
      // Automatic push for authenticated users
      syncNow().catch(err => console.warn('Auto-sync failed:', err))
    }
  }

  function toggleImportant(id) {
    const l = links.value.find(x => x.id === id)
    if (!l) return
    updateLink(id, { important: !l.important })
  }

  function toggleMustHave(id) {
    const l = links.value.find(x => x.id === id)
    if (!l) return
    updateLink(id, { mustHave: !l.mustHave })
  }

  function toggleFavorite(id) {
    const l = links.value.find(x => x.id === id)
    if (!l) return
    updateLink(id, { favorite: !l.favorite })
  }

  // legacy single-status toggle kept for compat but now delegates to independent flags
  function setStatus(id, status) {
    const l = links.value.find(x => x.id === id)
    if (!l) return
    if (status === 'important') toggleImportant(id)
    else if (status === 'must-have') toggleMustHave(id)
  }

  async function removeLink(id) {
    const link = links.value.find(l => l.id === id)
    links.value = links.value.filter(l => l.id !== id)

    // Create pending mutation for sync (if authenticated)
    if (link) {
      const accountId = session.getState().user?.id
      if (accountId) {
        // Base the delete claim on the store-acknowledged revision, not the
        // reactive copy: after a merge the ref still shows the pre-merge
        // revision while IndexedDB holds the server-acknowledged one. A stale
        // base turns every post-merge delete into a 409 conflict + rebase
        // cycle — an extra sync round that feeds the re-drain loop.
        const storeCopy = (await repository.getAllLinks()).find(l => l.id === id)
        const baseRevision = storeCopy ? storeCopy.revision : link.revision
        await repository.addPendingMutation(
          'delete',
          id,
          'link',
          { id },
          accountId,
          baseRevision
        ).catch(err => console.warn('Failed to queue mutation:', err))
        // Automatic push for authenticated users
        syncNow().catch(err => console.warn('Auto-sync failed:', err))
      }
    }
  }

  function setLinks(newLinks) {
    // Replace all links (used by backup import with replace strategy) — keep in-memory state, persist via watch
    links.value = Array.isArray(newLinks) ? newLinks.map(normalizeLink).filter(Boolean) : []
  }

  // Merge imported links with existing links using the given strategy
  // strategy: 'skip' (default) - keep existing, ignore imported duplicates
  // strategy: 'replace' - replace existing duplicates with imported versions (preserving id/createdAt/user fields)
  // Async because an authenticated import also queues the outbox mutations for
  // the added/replaced records (and fires ONE syncNow) before resolving; the
  // returned counts object is unchanged.
  async function mergeLinks(importedLinks, strategy = 'skip') {
    const existing = links.value
    const existingByUrl = new Map()
    for (const l of existing) {
      if (l.normalizedUrl) existingByUrl.set(l.normalizedUrl, l)
    }

    const newLinks = []
    const replacedLinks = []
    const merged = [...existing]

    for (const imported of importedLinks) {
      if (!imported.normalizedUrl) continue
      const existingLink = existingByUrl.get(imported.normalizedUrl)
      if (existingLink) {
        if (strategy === 'replace') {
          const idx = merged.findIndex(l => l.id === existingLink.id)
          if (idx !== -1) {
            const preserved = {
              id: existingLink.id,
              createdAt: existingLink.createdAt,
              folderId: existingLink.folderId,
              tags: existingLink.tags,
              important: existingLink.important,
              mustHave: existingLink.mustHave,
              favorite: existingLink.favorite,
              revision: existingLink.revision,
              account_id: existingLink.account_id,
            }
            merged[idx] = { ...imported, ...preserved }
            replacedLinks.push(merged[idx])
          }
        }
      } else {
        // Genuinely-new imported record: assign a FRESH id — never reuse the
        // backup's native id (Bug 15). A backup id can already exist on the
        // server as a tombstone; a create at that id is correctly rejected and
        // the next pull then deletes the imported record. With a fresh id the
        // create can always land and sync to every device.
        const newLink = { ...imported, id: generateId() }
        merged.push(newLink)
        newLinks.push(newLink)
      }
    }

    links.value = merged
    await queueImportedMutations(newLinks, replacedLinks, 'link')
    return { newCount: newLinks.length, replacedCount: strategy === 'replace' ? (importedLinks.length - newLinks.length) : 0 }
  }

  function moveLinksFromFolder(folderId) {
    let changed = false
    links.value = links.value.map(l => {
      if (l.folderId === folderId) {
        changed = true
        return { ...l, folderId: null }
      }
      return l
    })
    return changed
  }

  // Count links that are local/anonymous (no account_id or account_id is null/empty)
  // Exclude links that have been explicitly marked as "kept_local" after a Keep Local choice
  function getAnonymousLinksCount() {
    return links.value.filter(l => !l.account_id && !l.kept_local).length
  }

  // Get all anonymous links for sync conversion
  // Exclude links that have been explicitly marked as kept_local
  function getAnonymousLinks() {
    return links.value.filter(l => !l.account_id && !l.kept_local)
  }

  return {
    links,
    total,
    importantCount,
    mustHaveCount,
    favoriteCount,
    byCategory,
    storageError,
    addLink,
    replaceLink,
    updateLink,
    setStatus,
    toggleImportant,
    toggleMustHave,
    toggleFavorite,
    removeLink,
    setLinks,
    mergeLinks,
    moveLinksFromFolder,
    getAnonymousLinksCount,
    getAnonymousLinks
  }
}
