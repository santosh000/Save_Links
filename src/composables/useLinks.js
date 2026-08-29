import { ref, computed, watch } from 'vue'
import { repository } from '../storage/repository.js'
import { bootState } from '../storage/migration.js'
import { categorizeUrl, getDomain, normalizeUrl } from '../utils/categorize.js'
import { normalizeLink } from '../domain/link.js'
import { fetchMetadata } from '../utils/metadata.js'

export const STATUSES = ['important', 'must-have']

export function useLinks() {
  // Initial state comes from the boot snapshot (filled by boot() in main.js
  // BEFORE Vue mounts from migrated IndexedDB data) — the app never starts
  // from an empty/IndexedDB state ahead of migration, and never reads
  // localStorage at runtime anymore.
  const links = ref(bootState.ready ? bootState.links : [])
  const storageError = ref('')

  // persist automatically — keep in-memory state on storage failure
  watch(links, (val) => {
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

  async function addLink(payload) {
    // payload: { originalUrl, url?, title, description, image, category, tags, important, mustHave, status (legacy), _prefetchedMeta, _prefetchedUrl }
    const rawInput = (payload.originalUrl ?? payload.url ?? '').trim()
    if (!rawInput) throw new Error('URL required')
    const normalized = normalizeUrl(rawInput)
    let parsed
    try { parsed = new URL(normalized) } catch { throw new Error('Invalid URL') }

    // reuse prefetched metadata if available and for same normalized URL (avoid double fetch)
    let meta = null
    const prefetchedUrl = payload._prefetchedUrl ? normalizeUrl(payload._prefetchedUrl) : null
    if (payload._prefetchedMeta && prefetchedUrl === normalized) {
      meta = payload._prefetchedMeta
    } else {
      meta = { title: '', description: '', image: '', domain: getDomain(normalized) }
      try {
        meta = await fetchMetadata(normalized)
      } catch {
        // fallback already handled inside fetchMetadata
      }
    }

    const inputTitle = (payload.title ?? '').trim()
    const inputDesc = (payload.description ?? '').trim()
    const inputImage = (payload.image ?? '').trim()

    const finalTitle = inputTitle || meta.title || parsed.hostname
    const finalCategory = payload.category || categorizeUrl(normalized)
    const finalDomain = meta.domain || getDomain(normalized)
    const finalDescription = inputDesc || meta.description || ''
    const finalImage = inputImage || meta.image || ''

    const important = !!payload.important || payload.status === 'important'
    const mustHave = !!payload.mustHave || payload.status === 'must-have'
    const favorite = !!payload.favorite
    const folderId = typeof payload.folderId === 'string' && payload.folderId.trim() ? payload.folderId.trim() : null

    const link = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      originalUrl: rawInput,
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
      createdAt: new Date().toISOString()
    }
    links.value.unshift(link)
    return link
  }

  function updateLink(id, patch) {
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

  function removeLink(id) {
    links.value = links.value.filter(l => l.id !== id)
  }

  function setLinks(newLinks) {
    // Replace all links (used by backup import) — keep in-memory state, persist via watch
    links.value = Array.isArray(newLinks) ? newLinks.map(normalizeLink).filter(Boolean) : []
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

  return {
    links,
    total,
    importantCount,
    mustHaveCount,
    favoriteCount,
    byCategory,
    storageError,
    addLink,
    updateLink,
    setStatus,
    toggleImportant,
    toggleMustHave,
    toggleFavorite,
    removeLink,
    setLinks,
    moveLinksFromFolder
  }
}
