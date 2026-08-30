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
    // Accept HTML/XHTML, text/* and missing Content-Type (common server
    // misconfigs); reject only clearly non-HTML payloads. DOMParser is
    // tolerant, so a mislabeled response still parses instead of failing.
    if (!looksHtml(res.headers.get('content-type'))) throw new Error('not html')
    const html = await res.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')

    const ogTitle = doc.querySelector('meta[property="og:title"]')?.content
    const twitterTitle = doc.querySelector('meta[name="twitter:title"]')?.content
    const docTitle = doc.querySelector('title')?.textContent?.trim()
    const title = (ogTitle || twitterTitle || docTitle || fallbackTitle).trim().slice(0, 180)

    const ogDesc = doc.querySelector('meta[property="og:description"]')?.content
    const twitterDesc = doc.querySelector('meta[name="twitter:description"]')?.content
    const metaDesc = doc.querySelector('meta[name="description"]')?.content
    const description = (ogDesc || twitterDesc || metaDesc || '').trim().slice(0, 280)

    const image = resolveImage(pickImage(doc), url)

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

// Image precedence: og:image → twitter:image → link[rel="image_src"] →
// [itemprop="image"] (schema.org microdata). Returns the raw reference —
// resolveImage() turns it into a usable absolute URL afterwards.
function pickImage(doc) {
  const og = doc.querySelector('meta[property="og:image"]')?.content
  const tw = doc.querySelector('meta[name="twitter:image"]')?.content
  const linkSrc = doc.querySelector('link[rel="image_src"]')?.getAttribute('href')
  const item = doc.querySelector('[itemprop="image"]')
  const itemImg = item ? (item.content ?? item.getAttribute('href')) : ''
  return (og || tw || linkSrc || itemImg || '').trim()
}

// Resolve an image reference against the page URL. Only http(s) survives;
// relative and protocol-relative references resolve against the page. An http
// image on an https page is dropped — the browser would block it as mixed
// content. javascript:/data:/blob:/etc. are rejected outright.
function resolveImage(src, pageUrl) {
  const raw = (src || '').trim()
  if (!raw) return ''
  let abs
  try {
    abs = new URL(raw, pageUrl)
  } catch {
    return ''
  }
  if (abs.protocol === 'https:') return abs.href
  if (abs.protocol === 'http:') {
    try {
      return new URL(pageUrl).protocol === 'https:' ? '' : abs.href
    } catch {
      return ''
    }
  }
  return ''
}

function looksHtml(contentType) {
  const t = (contentType || '').split(';')[0].trim().toLowerCase()
  // missing Content-Type, text/* and any html/xml-family type may carry
  // markup; only known binary/structured payloads (json, images, ...) are
  // rejected outright.
  return !t || t.startsWith('text/') || t.includes('html') || t.includes('xml')
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
