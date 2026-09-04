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
      links.value = await repository.getAllLinks()
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
    updateLink(id, {
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
      // Create pending mutation for sync (if authenticated)
      const accountId = session.getState().user?.id
      if (accountId) {
        await repository.addPendingMutation(
          'update',
          updated.id,
          'link',
          updated,
          accountId,
          updated.revision
        )
      }
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
      await repository.addPendingMutation(
        'update',
        merged.id,
        'link',
        merged,
        accountId,
        merged.revision
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
        await repository.addPendingMutation(
          'delete',
          id,
          'link',
          { id },
          accountId,
          link.revision
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
  function mergeLinks(importedLinks, strategy = 'skip') {
    const existing = links.value
    const existingByUrl = new Map()
    for (const l of existing) {
      if (l.normalizedUrl) existingByUrl.set(l.normalizedUrl, l)
    }

    const newLinks = []
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
          }
        }
      } else {
        const newLink = { ...imported, id: imported.id || generateId() }
        merged.push(newLink)
        newLinks.push(newLink)
      }
    }

    links.value = merged
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
