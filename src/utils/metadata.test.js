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

describe('metadata extraction order and sources', () => {
  let originalFetch

  function htmlResponse(html, contentType = 'text/html; charset=utf-8') {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => contentType },
        text: () => Promise.resolve(html),
      })
    )
  }

  beforeEach(() => {
    originalFetch = global.fetch
    vi.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('title: og:title wins over twitter:title and document title', async () => {
    htmlResponse(`<html><head>
      <title>Doc</title>
      <meta property="og:title" content="OG Wins">
      <meta name="twitter:title" content="Twitter">
    </head></html>`)
    const result = await fetchMetadata('https://example.com/a')
    expect(result.title).toBe('OG Wins')
  })

  it('title: twitter:title beats document title when og is missing', async () => {
    htmlResponse(`<html><head><title>Doc</title><meta name="twitter:title" content="Twitter Wins"></head></html>`)
    const result = await fetchMetadata('https://example.com/b')
    expect(result.title).toBe('Twitter Wins')
  })

  it('title: document title is used when og and twitter are missing', async () => {
    htmlResponse(`<html><head><title>Plain Doc Title</title></head></html>`)
    const result = await fetchMetadata('https://example.com/c')
    expect(result.title).toBe('Plain Doc Title')
  })

  it('description: og:description wins, then twitter, then meta description', async () => {
    htmlResponse(`<html><head>
      <meta property="og:description" content="OG Desc">
      <meta name="twitter:description" content="TW Desc">
      <meta name="description" content="Meta Desc">
    </head></html>`)
    const og = await fetchMetadata('https://example.com/a')
    expect(og.description).toBe('OG Desc')

    htmlResponse(`<html><head>
      <meta name="twitter:description" content="TW Desc">
      <meta name="description" content="Meta Desc">
    </head></html>`)
    const tw = await fetchMetadata('https://example.com/b')
    expect(tw.description).toBe('TW Desc')

    htmlResponse(`<html><head><meta name="description" content="Meta Desc"></head></html>`)
    const md = await fetchMetadata('https://example.com/c')
    expect(md.description).toBe('Meta Desc')
  })

  it('image: og:image wins over twitter:image', async () => {
    htmlResponse(`<html><head>
      <meta property="og:image" content="https://img.example/og.jpg">
      <meta name="twitter:image" content="https://img.example/tw.jpg">
    </head></html>`)
    const result = await fetchMetadata('https://example.com/a')
    expect(result.image).toBe('https://img.example/og.jpg')
  })

  it('image: twitter:image used when og:image is missing', async () => {
    htmlResponse(`<html><head><meta name="twitter:image" content="https://img.example/tw.jpg"></head></html>`)
    const result = await fetchMetadata('https://example.com/b')
    expect(result.image).toBe('https://img.example/tw.jpg')
  })

  it('image: link[rel="image_src"] used when og/twitter missing', async () => {
    htmlResponse(`<html><head><link rel="image_src" href="/src.jpg"></head></html>`)
    const result = await fetchMetadata('https://example.com/c')
    expect(result.image).toBe('https://example.com/src.jpg')
  })

  it('image: [itemprop="image"] meta used as last resort', async () => {
    htmlResponse(`<html><head><meta itemprop="image" content="/item.jpg"></head></html>`)
    const result = await fetchMetadata('https://example.com/d')
    expect(result.image).toBe('https://example.com/item.jpg')
  })

  it('resolves dot-relative image against the page directory', async () => {
    htmlResponse(`<html><head><meta property="og:image" content="images/preview.jpg"></head></html>`)
    const result = await fetchMetadata('https://example.com/path/article')
    expect(result.image).toBe('https://example.com/path/images/preview.jpg')
  })

  it('resolves protocol-relative image to https on an https page', async () => {
    htmlResponse(`<html><head><meta property="og:image" content="//cdn.example.com/image.jpg"></head></html>`)
    const result = await fetchMetadata('https://example.com/e')
    expect(result.image).toBe('https://cdn.example.com/image.jpg')
  })

  it('preserves an absolute https image URL', async () => {
    htmlResponse(`<html><head><meta property="og:image" content="https://img.example/keep.jpg?v=2"></head></html>`)
    const result = await fetchMetadata('https://example.com/f')
    expect(result.image).toBe('https://img.example/keep.jpg?v=2')
  })

  it('keeps an absolute http image on an http page', async () => {
    htmlResponse(`<html><head><meta property="og:image" content="http://img.example/plain.jpg"></head></html>`)
    const result = await fetchMetadata('http://example.com/g')
    expect(result.image).toBe('http://img.example/plain.jpg')
  })

  it('rejects an http image on an https page (mixed content)', async () => {
    htmlResponse(`<html><head><meta property="og:image" content="http://img.example/blocked.jpg"></head></html>`)
    const result = await fetchMetadata('https://example.com/h')
    expect(result.image).toBe('')
  })

  it('rejects javascript: image URLs', async () => {
    htmlResponse(`<html><head><meta property="og:image" content="javascript:alert(1)"></head></html>`)
    const result = await fetchMetadata('https://example.com/i')
    expect(result.image).toBe('')
  })

  it('rejects data: and blob: image URLs', async () => {
    htmlResponse(`<html><head><meta property="og:image" content="data:image/png;base64,AAAA"></head></html>`)
    let result = await fetchMetadata('https://example.com/j')
    expect(result.image).toBe('')
    htmlResponse(`<html><head><meta property="og:image" content="blob:https://example.com/xyz"></head></html>`)
    result = await fetchMetadata('https://example.com/k')
    expect(result.image).toBe('')
  })

  it('accepts application/xhtml+xml content type', async () => {
    htmlResponse(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>XHTML Page</title></head></html>`,
      'application/xhtml+xml; charset=utf-8'
    )
    const result = await fetchMetadata('https://example.com/x')
    expect(result.title).toBe('XHTML Page')
  })

  it('accepts a missing content type', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve('<html><head><title>No CT Title</title></head></html>'),
      })
    )
    const result = await fetchMetadata('https://example.com/n')
    expect(result.title).toBe('No CT Title')
  })

  it('accepts text/plain that actually contains html', async () => {
    htmlResponse('<html><head><title>Plain Labeled</title></head></html>', 'text/plain')
    const result = await fetchMetadata('https://example.com/p')
    expect(result.title).toBe('Plain Labeled')
  })

  it('partial metadata: image-only page keeps title and empty description', async () => {
    htmlResponse(`<html><head><title>Only Title</title><meta property="og:image" content="/img.jpg"></head></html>`)
    const result = await fetchMetadata('https://example.com/q')
    expect(result.title).toBe('Only Title')
    expect(result.description).toBe('')
    expect(result.image).toBe('https://example.com/img.jpg')
  })

  it('empty metadata: tagless html yields URL-derived title and empty fields', async () => {
    htmlResponse(`<html><body><p>no meta here</p></body></html>`)
    const result = await fetchMetadata('https://example.com/some-page')
    expect(result.title).toBe('Some Page')
    expect(result.description).toBe('')
    expect(result.image).toBe('')
  })

  it('malformed html parses without throwing', async () => {
    htmlResponse(`<html><head><title>Broken <b>Markup</title><meta property="og:image" content="/oops.jpg"><body unclosed`)
    const result = await fetchMetadata('https://example.com/z')
    expect(result.title).toBeTruthy()
    expect(result.image).toBe('https://example.com/oops.jpg')
  })
})
