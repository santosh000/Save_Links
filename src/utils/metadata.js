import { getDomain } from './categorize.js'

/**
 * Try to fetch metadata for a URL. Gracefully fall back on failure.
 * In a local-first app without a backend, CORS will often block direct fetch.
 * We attempt fetch but never throw — fallback data is always returned.
 */
export async function fetchMetadata(rawUrl, externalSignal = null) {
  const url = rawUrl.trim()
  const domain = getDomain(url)
  const fallbackTitle = guessTitleFromUrl(url)

  // Fallback immediately if not http
  if (!/^https?:\/\//i.test(url)) {
    return { title: fallbackTitle, description: '', image: '', domain }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4500)
  let onExternalAbort = null
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      onExternalAbort = () => controller.abort()
      externalSignal.addEventListener('abort', onExternalAbort)
    }
  }
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit'
    })
    if (!res.ok) throw new Error('non-ok')
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('text/html')) throw new Error('not html')
    const html = await res.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')

    const ogTitle = doc.querySelector('meta[property="og:title"]')?.content
    const twitterTitle = doc.querySelector('meta[name="twitter:title"]')?.content
    const docTitle = doc.querySelector('title')?.textContent?.trim()
    const title = (ogTitle || twitterTitle || docTitle || fallbackTitle).trim().slice(0, 180)

    const ogDesc = doc.querySelector('meta[property="og:description"]')?.content
    const metaDesc = doc.querySelector('meta[name="description"]')?.content
    const twitterDesc = doc.querySelector('meta[name="twitter:description"]')?.content
    const description = (ogDesc || twitterDesc || metaDesc || '').trim().slice(0, 280)

    const ogImage = doc.querySelector('meta[property="og:image"]')?.content
    const twitterImage = doc.querySelector('meta[name="twitter:image"]')?.content
    const image = (ogImage || twitterImage || '').trim()

    return { title: title || fallbackTitle, description, image, domain }
  } catch {
    // Graceful fallback — do not surface error, just return minimal data
    return { title: fallbackTitle, description: '', image: '', domain }
  } finally {
    clearTimeout(timeout)
    if (externalSignal && onExternalAbort) {
      externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }
}

function guessTitleFromUrl(url) {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '').split('/').filter(Boolean).pop()
    if (path) {
      return decodeURIComponent(path.replace(/[-_]+/g, ' ')).replace(/\b\w/g, c => c.toUpperCase())
    }
    return u.hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 60)
  }
}

export function guessTitleSync(url) {
  return guessTitleFromUrl(url)
}
