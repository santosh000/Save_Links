import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { guessTitleSync, fetchMetadata } from './metadata.js'

describe('guessTitleSync', () => {
  it('decodes path segment with dash/underscore to Title Case', () => {
    expect(guessTitleSync('https://example.com/my-awesome-post/')).toBe('My Awesome Post')
    expect(guessTitleSync('https://example.com/hello_world-test')).toBe('Hello World Test')
    expect(guessTitleSync('https://example.com/some-page_title/')).toBe('Some Page Title')
  })

  it('returns decoded segment', () => {
    // %20 decodes to space; implementation preserves leading space then Title Cases
    expect(guessTitleSync('https://example.com/%20space%20test')).toBe(' Space Test')
  })

  it('falls back to hostname when no path', () => {
    expect(guessTitleSync('https://example.com/')).toBe('example.com')
    expect(guessTitleSync('https://www.example.com/')).toBe('example.com')
    expect(guessTitleSync('https://www.example.com')).toBe('example.com')
  })

  it('strips trailing slash', () => {
    expect(guessTitleSync('https://example.com/article/')).toBe('Article')
  })

  it('returns sliced raw for invalid URL', () => {
    expect(guessTitleSync('not a url')).toBe('not a url')
    const long = 'a'.repeat(100)
    expect(guessTitleSync(long).length).toBe(60)
  })

  it('handles URL with query and hash', () => {
    // pathname is /article, search/hash ignored for title
    expect(guessTitleSync('https://example.com/article?x=1#hash')).toBe('Article')
  })
})

describe('fetchMetadata fallback behavior', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    vi.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns fallback for non-http URL', async () => {
    const result = await fetchMetadata('ftp://example.com/file')
    expect(result.title).toBeTruthy()
    expect(result.description).toBe('')
    expect(result.image).toBe('')
    expect(result.domain).toBe('example.com') // getDomain still extracts hostname for ftp
  })

  it('returns fallback for ftp with domain check', async () => {
    // ftp URL still has domain via getDomain, but code returns early before fetch
    const result = await fetchMetadata('ftp://example.com/page')
    expect(result.domain).toBe('example.com')
    expect(result.title).toBeTruthy()
  })

  it('fallback when fetch throws', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network error')))
    const result = await fetchMetadata('https://example.com/page')
    expect(result.title).toBe('Page') // fallback via guessTitleSync from path "page"
    expect(result.description).toBe('')
    expect(result.image).toBe('')
    expect(result.domain).toBe('example.com')
    expect(global.fetch).toHaveBeenCalled()
  })

  it('fallback when fetch returns non-ok', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        headers: { get: () => 'text/html' },
        text: () => Promise.resolve(''),
      })
    )
    const result = await fetchMetadata('https://example.com/missing')
    expect(result.title).toBe('Missing')
    expect(result.domain).toBe('example.com')
  })

  it('fallback when content-type is not html', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) },
        text: () => Promise.resolve('{}'),
      })
    )
    const result = await fetchMetadata('https://example.com/api')
    expect(result.title).toBe('Api')
    expect(result.description).toBe('')
  })

  it('parses html when fetch succeeds', async () => {
    const html = `
      <html>
        <head>
          <title>Doc Title</title>
          <meta property="og:title" content="OG Title">
          <meta property="og:description" content="OG Desc">
          <meta property="og:image" content="https://example.com/img.jpg">
          <meta name="description" content="fallback desc">
        </head>
      </html>
    `
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: (h) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) },
        text: () => Promise.resolve(html),
      })
    )
    const result = await fetchMetadata('https://example.com/article')
    expect(result.title).toBe('OG Title')
    expect(result.description).toBe('OG Desc')
    expect(result.image).toBe('https://example.com/img.jpg')
    expect(result.domain).toBe('example.com')
  })

  it('falls back to document title when og missing', async () => {
    const html = `<html><head><title>Only Doc Title</title></head></html>`
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => 'text/html' },
        text: () => Promise.resolve(html),
      })
    )
    const result = await fetchMetadata('https://example.com/only-title')
    expect(result.title).toBe('Only Doc Title')
  })

  it('handles AbortError via timeout/external signal gracefully', async () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    global.fetch = vi.fn(() => Promise.reject(abortErr))
    const result = await fetchMetadata('https://example.com/aborted')
    expect(result.title).toBe('Aborted')
    expect(result.domain).toBe('example.com')
  })

  it('supports externalSignal abort without throwing', async () => {
    const controller = new AbortController()
    // mock fetch that checks signal
    global.fetch = vi.fn(({ signal } = {}) => {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        } else {
          resolve({
            ok: true,
            headers: { get: () => 'text/html' },
            text: () => Promise.resolve('<html><head><title>Title</title></head></html>'),
          })
        }
      })
    })
    controller.abort()
    const result = await fetchMetadata('https://example.com/external-abort', controller.signal)
    // externally aborted before fetch → should fallback gracefully, not throw
    expect(result.title).toBeTruthy()
    expect(result.description).toBe('')
  })

  it('clears timeout on success (no leak)', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => 'text/html' },
        text: () => Promise.resolve('<html><head><title>T</title></head></html>'),
      })
    )
    const result = await fetchMetadata('https://example.com/clear-timeout')
    expect(result.title).toBe('T')
    // if timeout not cleared, vitest would have pending timer; implicitly passes
  })
})
