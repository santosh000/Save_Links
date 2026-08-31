import { describe, it, expect } from 'vitest'
import { normalizeLink, generateId } from './link.js'

describe('normalizeLink', () => {
  it('returns null for non-object input', () => {
    expect(normalizeLink(null)).toBeNull()
    expect(normalizeLink(undefined)).toBeNull()
    expect(normalizeLink('string')).toBeNull()
    expect(normalizeLink(123)).toBeNull()
    expect(normalizeLink([])).toBeNull()
  })

  it('preserves a fully canonical record unchanged (idempotent)', () => {
    const canonical = {
      id: 'abc123',
      originalUrl: 'example.com/page',
      normalizedUrl: 'https://example.com/page',
      url: 'https://example.com/page',
      domain: 'example.com',
      title: 'Title',
      description: 'Desc',
      image: 'https://example.com/img.jpg',
      category: 'Other',
      tags: ['a', 'b'],
      important: true,
      mustHave: false,
      favorite: true,
      folderId: 'f1',
      status: 'important',
      createdAt: '2024-01-01T00:00:00.000Z',
      savedFrom: 'Unknown',
    }
    const again = normalizeLink(canonical)
    expect(again).toEqual(canonical)
    // repeated calls stay identical (deterministic)
    expect(normalizeLink(again)).toEqual(canonical)
  })

  it('migrates legacy {url, status} shape to flags', () => {
    const l = normalizeLink({ id: '1', url: 'https://example.com/a', status: 'important', title: 'T' })
    expect(l.normalizedUrl).toBe('https://example.com/a')
    expect(l.url).toBe('https://example.com/a')
    expect(l.important).toBe(true)
    expect(l.mustHave).toBe(false)
    expect(l.favorite).toBe(false)
    expect(l.status).toBe('important')
  })

  it('drops scheme-less legacy URLs from the href but keeps display text', () => {
    const l = normalizeLink({ id: '1', url: 'example.com/a', status: 'important' })
    expect(l.normalizedUrl).toBe('') // not http(s) -> never an href
    expect(l.originalUrl).toBe('example.com/a')
    expect(l.important).toBe(true) // data not destroyed
  })

  it('maps legacy status must-have/must_have and both', () => {
    expect(normalizeLink({ url: 'https://x.com', status: 'must-have' }).mustHave).toBe(true)
    expect(normalizeLink({ url: 'https://x.com', status: 'must_have' }).mustHave).toBe(true)
    const both = normalizeLink({ url: 'https://x.com', status: 'both' })
    expect(both.important).toBe(true)
    expect(both.mustHave).toBe(true)
    expect(both.status).toBe('both')
  })

  it('explicit boolean flags win over legacy status', () => {
    const l = normalizeLink({ url: 'https://x.com', important: false, status: 'important' })
    expect(l.important).toBe(false)
    expect(l.status).toBeNull()
  })

  it('preserves existing id and createdAt, backfills missing', () => {
    const l = normalizeLink({
      originalUrl: 'https://x.com',
      id: 'keep-me',
      createdAt: '2020-05-05T00:00:00.000Z',
    })
    expect(l.id).toBe('keep-me')
    expect(l.createdAt).toBe('2020-05-05T00:00:00.000Z')
    const generated = normalizeLink({ originalUrl: 'https://x.com' })
    expect(typeof generated.id).toBe('string')
    expect(generated.id.length).toBeGreaterThan(0)
    expect(() => new Date(generated.createdAt).toISOString()).not.toThrow()
  })

  it('extracts http(s) URL from normalizedUrl, url, then originalUrl in order', () => {
    const l = normalizeLink({
      originalUrl: 'https://original.com',
      url: 'https://alias.com/a',
      normalizedUrl: 'https://canonical.com/b',
    })
    expect(l.normalizedUrl).toBe('https://canonical.com/b')
    expect(l.url).toBe('https://canonical.com/b')
    expect(l.originalUrl).toBe('https://original.com')
    const onlyOriginal = normalizeLink({ originalUrl: 'https://only.com' })
    expect(onlyOriginal.normalizedUrl).toBe('https://only.com')
  })

  it('rejects non-http(s) hrefs (javascript:/data:/ftp:) but keeps display text', () => {
    const js = normalizeLink({ url: 'javascript:alert(1)', originalUrl: 'javascript:alert(1)' })
    expect(js.normalizedUrl).toBe('')
    expect(js.originalUrl).toBe('javascript:alert(1)')
    const ftp = normalizeLink({ url: 'ftp://example.com/f' })
    expect(ftp.normalizedUrl).toBe('')
  })

  it('keeps scheme-less originalUrl as display text while href uses normalized', () => {
    const l = normalizeLink({ originalUrl: 'example.com', normalizedUrl: 'https://example.com' })
    expect(l.originalUrl).toBe('example.com')
    expect(l.normalizedUrl).toBe('https://example.com')
  })

  it('sanitizes tags (strings only, trimmed, empty removed)', () => {
    expect(normalizeLink({ originalUrl: 'https://x.com', tags: [' a ', '', 123, 'b', null, '  '] }).tags).toEqual(['a', 'b'])
    expect(normalizeLink({ originalUrl: 'https://x.com' }).tags).toEqual([])
    expect(normalizeLink({ originalUrl: 'https://x.com', tags: 'not-array' }).tags).toEqual([])
  })

  it('truncates title and description', () => {
    const l = normalizeLink({ originalUrl: 'https://x.com', title: 'a'.repeat(500), description: 'b'.repeat(600) })
    expect(l.title.length).toBe(200)
    expect(l.description.length).toBe(400)
  })

  it('derives domain and category when missing', () => {
    const l = normalizeLink({ originalUrl: 'https://www.github.com/user' })
    expect(l.domain).toBe('github.com')
    expect(l.category).toBe('GitHub')
  })

  it('preserves explicit domain and category', () => {
    const l = normalizeLink({ originalUrl: 'https://x.com', domain: 'custom.example', category: 'Other' })
    expect(l.domain).toBe('custom.example')
    expect(l.category).toBe('Other')
  })

  it('handles folderId (trimmed string or null)', () => {
    expect(normalizeLink({ originalUrl: 'https://x.com', folderId: ' f1 ' }).folderId).toBe('f1')
    expect(normalizeLink({ originalUrl: 'https://x.com', folderId: '' }).folderId).toBeNull()
    expect(normalizeLink({ originalUrl: 'https://x.com' }).folderId).toBeNull()
    expect(normalizeLink({ originalUrl: 'https://x.com', folderId: 123 }).folderId).toBeNull()
  })

  it('does not copy unknown/polluting fields', () => {
    const l = normalizeLink({ originalUrl: 'https://x.com', malicious: '<script>', __proto__: { polluted: true } })
    expect(l.malicious).toBeUndefined()
    expect(l.polluted).toBeUndefined()
  })

  it('never throws for object input, even deeply weird records', () => {
    const weird = { normalizedUrl: {}, url: null, tags: 'x', createdAt: 42, important: 'yes', folderId: {} }
    expect(() => normalizeLink(weird)).not.toThrow()
    const l = normalizeLink(weird)
    expect(l.normalizedUrl).toBe('')
    expect(l.important).toBe(false)
    expect(l.tags).toEqual([])
  })

  it('normalizes savedFrom (preserved string or Unknown), never assigns current device', () => {
    // present string preserved
    expect(normalizeLink({ originalUrl: 'https://x.com', savedFrom: 'Windows' }).savedFrom).toBe('Windows')
    // missing -> Unknown (no device assignment for old links)
    expect(normalizeLink({ originalUrl: 'https://x.com' }).savedFrom).toBe('Unknown')
    // malformed -> Unknown, and normalizer never throws
    expect(normalizeLink({ originalUrl: 'https://x.com', savedFrom: 42 }).savedFrom).toBe('Unknown')
    expect(normalizeLink({ originalUrl: 'https://x.com', savedFrom: { x: 1 } }).savedFrom).toBe('Unknown')
    expect(() => normalizeLink({ originalUrl: 'https://x.com', savedFrom: ['w'] })).not.toThrow()
  })
})

describe('generateId', () => {
  it('produces non-empty string ids', () => {
    expect(typeof generateId()).toBe('string')
    expect(generateId().length).toBeGreaterThan(4)
    expect(new Set([generateId(), generateId(), generateId()]).size).toBe(3)
  })
})