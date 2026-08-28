import { describe, it, expect } from 'vitest'
import { normalizeUrl, getDomain, categorizeUrl } from './categorize.js'

describe('normalizeUrl', () => {
  it('adds https:// when scheme missing', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
    expect(normalizeUrl('example.com/page?q=1')).toBe('https://example.com/page?q=1')
  })

  it('keeps existing https', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
  })

  it('keeps existing http', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com')
  })

  it('handles case-insensitive scheme', () => {
    expect(normalizeUrl('HTTPS://example.com')).toBe('HTTPS://example.com')
    expect(normalizeUrl('HTTP://example.com')).toBe('HTTP://example.com')
  })

  it('trims whitespace', () => {
    expect(normalizeUrl('  example.com  ')).toBe('https://example.com')
    expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com')
  })

  it('returns empty for empty or whitespace', () => {
    expect(normalizeUrl('')).toBe('')
    expect(normalizeUrl('   ')).toBe('')
    expect(normalizeUrl(null)).toBe('')
    expect(normalizeUrl(undefined)).toBe('')
  })
})

describe('getDomain', () => {
  it('extracts hostname', () => {
    expect(getDomain('https://example.com/page')).toBe('example.com')
    expect(getDomain('https://sub.example.com/page')).toBe('sub.example.com')
  })

  it('strips www.', () => {
    expect(getDomain('https://www.example.com')).toBe('example.com')
    expect(getDomain('https://www.youtube.com/watch?v=1')).toBe('youtube.com')
  })

  it('preserves non-www subdomains', () => {
    expect(getDomain('https://m.example.com')).toBe('m.example.com')
    expect(getDomain('https://gist.github.com/123')).toBe('gist.github.com')
  })

  it('returns empty for invalid URL', () => {
    expect(getDomain('not a url')).toBe('')
    expect(getDomain('')).toBe('')
    expect(getDomain('example.com')).toBe('') // missing scheme, URL throws
  })

  it('handles port and trailing', () => {
    // getDomain uses URL.hostname which strips port
    expect(getDomain('https://www.example.com:8080/page')).toBe('example.com')
  })
})

describe('categorizeUrl', () => {
  it('returns Other for invalid URL', () => {
    expect(categorizeUrl('not a url')).toBe('Other')
    expect(categorizeUrl('')).toBe('Other')
    expect(categorizeUrl('example.com')).toBe('Other') // URL without scheme throws
  })

  // Regression cases required
  describe('regression: false-positive prevention → Other', () => {
    it('query param redirect x.com', () => {
      expect(categorizeUrl('https://example.com/?redirect=x.com')).toBe('Other')
    })
    it('x.commercial-site.com', () => {
      expect(categorizeUrl('https://x.commercial-site.com/page')).toBe('Other')
    })
    it('query q=t.co', () => {
      expect(categorizeUrl('https://example.com/?q=t.co')).toBe('Other')
    })
    it('amazon.com.example.com evil', () => {
      expect(categorizeUrl('https://amazon.com.example.com/evil')).toBe('Other')
    })
    it('notgithub.com', () => {
      expect(categorizeUrl('https://notgithub.com')).toBe('Other')
    })
  })

  describe('real domains categorize correctly', () => {
    it('x.com → X/Twitter', () => {
      expect(categorizeUrl('https://x.com/user')).toBe('X/Twitter')
      expect(categorizeUrl('https://www.x.com/user')).toBe('X/Twitter')
    })
    it('twitter.com → X/Twitter', () => {
      expect(categorizeUrl('https://twitter.com/user')).toBe('X/Twitter')
      expect(categorizeUrl('https://www.twitter.com/user')).toBe('X/Twitter')
    })
    it('t.co → X/Twitter', () => {
      expect(categorizeUrl('https://t.co/abc')).toBe('X/Twitter')
    })
    it('github.com → GitHub', () => {
      expect(categorizeUrl('https://github.com/user/repo')).toBe('GitHub')
      expect(categorizeUrl('https://www.github.com/user')).toBe('GitHub')
    })
    it('gist.github.com → GitHub', () => {
      expect(categorizeUrl('https://gist.github.com/123')).toBe('GitHub')
    })
    it('instagram.com → Instagram', () => {
      expect(categorizeUrl('https://instagram.com/p/123')).toBe('Instagram')
      expect(categorizeUrl('https://www.instagram.com/p/123')).toBe('Instagram')
    })
    it('youtube.com → YouTube', () => {
      expect(categorizeUrl('https://youtube.com/watch?v=1')).toBe('YouTube')
      expect(categorizeUrl('https://www.youtube.com/watch?v=1')).toBe('YouTube')
      expect(categorizeUrl('https://m.youtube.com/watch?v=1')).toBe('YouTube')
    })
    it('youtu.be → YouTube', () => {
      expect(categorizeUrl('https://youtu.be/abc')).toBe('YouTube')
      expect(categorizeUrl('https://www.youtu.be/abc')).toBe('YouTube')
    })
    it('amazon.com → Amazon', () => {
      expect(categorizeUrl('https://amazon.com/dp/123')).toBe('Amazon')
      expect(categorizeUrl('https://www.amazon.com/dp/123')).toBe('Amazon')
      expect(categorizeUrl('https://smile.amazon.com/dp/123')).toBe('Amazon')
    })
    it('amazon.co.uk → Amazon', () => {
      expect(categorizeUrl('https://amazon.co.uk/dp/123')).toBe('Amazon')
      expect(categorizeUrl('https://www.amazon.co.uk/dp/123')).toBe('Amazon')
    })
    it('facebook.com → Facebook', () => {
      expect(categorizeUrl('https://facebook.com/page')).toBe('Facebook')
    })
    it('fb.com → Facebook', () => {
      expect(categorizeUrl('https://fb.com/page')).toBe('Facebook')
    })
    it('reddit.com → Reddit', () => {
      expect(categorizeUrl('https://reddit.com/r/vue')).toBe('Reddit')
      expect(categorizeUrl('https://www.reddit.com/r/vue')).toBe('Reddit')
    })
    it('linkedin.com → LinkedIn', () => {
      expect(categorizeUrl('https://linkedin.com/in/user')).toBe('LinkedIn')
    })
    it('unknown → Other', () => {
      expect(categorizeUrl('https://example.com')).toBe('Other')
      expect(categorizeUrl('https://unknown-site.org')).toBe('Other')
    })
  })

  it('handles case-insensitive host', () => {
    expect(categorizeUrl('https://GITHUB.COM/user')).toBe('GitHub')
    expect(categorizeUrl('https://YOUTUBE.COM/watch')).toBe('YouTube')
  })
})
