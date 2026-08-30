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

  describe('removes known tracking parameters', () => {
    it('utm_source', () => {
      expect(normalizeUrl('https://example.com/page?utm_source=x')).toBe('https://example.com/page')
    })
    it('utm_campaign', () => {
      expect(normalizeUrl('https://example.com/?utm_campaign=c')).toBe('https://example.com/')
    })
    it('utm_medium', () => {
      expect(normalizeUrl('https://example.com/page?utm_medium=email')).toBe('https://example.com/page')
    })
    it('utm_id', () => {
      expect(normalizeUrl('https://example.com/page?utm_id=9')).toBe('https://example.com/page')
    })
    it('utm_term', () => {
      expect(normalizeUrl('https://example.com/page?utm_term=t')).toBe('https://example.com/page')
    })
    it('utm_content', () => {
      expect(normalizeUrl('https://example.com/page?utm_content=x')).toBe('https://example.com/page')
    })
    it('arbitrary utm_*', () => {
      expect(normalizeUrl('https://example.com/page?utm_whatever=1&utm_custom=2')).toBe('https://example.com/page')
    })
    it.each(['gclid', 'gclsrc', 'dclid', 'fbclid', 'msclkid', 'zanpid', 'mc_eid', 'mc_cid', '_openstat', '_hsenc', '_hsmi'])('%s', (name) => {
      expect(normalizeUrl(`https://example.com/page?${name}=v`)).toBe('https://example.com/page')
    })
    it('removes multiple tracking parameters at once', () => {
      expect(normalizeUrl('https://example.com/page?utm_source=x&gclid=abc&fbclid=def&msclkid=ghi')).toBe('https://example.com/page')
    })
    it('is case-insensitive', () => {
      expect(normalizeUrl('https://example.com/?UTM_SOURCE=x')).toBe('https://example.com/')
      expect(normalizeUrl('https://example.com/?Utm_Source=x')).toBe('https://example.com/')
      expect(normalizeUrl('https://example.com/?GCLID=x')).toBe('https://example.com/')
      expect(normalizeUrl('https://example.com/?FbClId=x')).toBe('https://example.com/')
      expect(normalizeUrl('https://example.com/?MSCLKID=x')).toBe('https://example.com/')
      expect(normalizeUrl('https://example.com/?DCLID=x')).toBe('https://example.com/')
    })
    it('matches percent-encoded tracking names', () => {
      expect(normalizeUrl('https://example.com/page?%75tm_source=x')).toBe('https://example.com/page')
      expect(normalizeUrl('https://example.com/page?%67clid=x')).toBe('https://example.com/page')
    })
  })

  describe('preserves functional parameters', () => {
    it('keeps id / v / q / ref', () => {
      expect(normalizeUrl('https://example.com/product?id=123')).toBe('https://example.com/product?id=123')
      expect(normalizeUrl('https://example.com/product?id=456&ref=abc')).toBe('https://example.com/product?id=456&ref=abc')
      expect(normalizeUrl('https://example.com/watch?v=abc')).toBe('https://example.com/watch?v=abc')
      expect(normalizeUrl('https://example.com/search?q=hello+world')).toBe('https://example.com/search?q=hello+world')
    })
    it('keeps unknown parameters', () => {
      expect(normalizeUrl('https://example.com/page?foo=bar')).toBe('https://example.com/page?foo=bar')
      expect(normalizeUrl('https://example.com/product?id=123&page=2&sort=asc&filter=x&search=y')).toBe('https://example.com/product?id=123&page=2&sort=asc&filter=x&search=y')
    })
    it('keeps empty functional values and bare names', () => {
      expect(normalizeUrl('https://example.com/?v=')).toBe('https://example.com/?v=')
      expect(normalizeUrl('https://example.com/?q=')).toBe('https://example.com/?q=')
      expect(normalizeUrl('https://example.com/?flag')).toBe('https://example.com/?flag')
    })
  })

  describe('mixed queries', () => {
    it('strips tracking, keeps functional, preserves order', () => {
      expect(normalizeUrl('https://example.com/page?utm_source=x&id=5&fbclid=abc&ref=google')).toBe('https://example.com/page?id=5&ref=google')
    })
    it('tracking before functional', () => {
      expect(normalizeUrl('https://example.com/page?utm_source=x&id=5')).toBe('https://example.com/page?id=5')
    })
    it('tracking after functional', () => {
      expect(normalizeUrl('https://example.com/page?id=5&utm_source=x')).toBe('https://example.com/page?id=5')
    })
    it('repeated functional parameters', () => {
      expect(normalizeUrl('https://example.com/?id=1&id=2')).toBe('https://example.com/?id=1&id=2')
    })
    it('repeated tracking parameters', () => {
      expect(normalizeUrl('https://example.com/?utm_source=a&utm_source=b&id=1')).toBe('https://example.com/?id=1')
    })
  })

  describe('fragments', () => {
    it('preserves fragment without query', () => {
      expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page#section')
    })
    it('preserves fragment with functional query', () => {
      expect(normalizeUrl('https://example.com/page?id=5#section')).toBe('https://example.com/page?id=5#section')
    })
    it('all-tracking query collapses before fragment', () => {
      expect(normalizeUrl('https://example.com/page?utm_source=x#top')).toBe('https://example.com/page#top')
    })
    it('strips tracking and keeps functional before fragment', () => {
      expect(normalizeUrl('https://example.com/page?utm_source=x&id=5#top')).toBe('https://example.com/page?id=5#top')
    })
  })

  describe('query edge cases', () => {
    it('no query', () => {
      expect(normalizeUrl('https://example.com/page')).toBe('https://example.com/page')
    })
    it('empty query', () => {
      expect(normalizeUrl('https://example.com/page?')).toBe('https://example.com/page')
    })
    it('all parameters tracking', () => {
      expect(normalizeUrl('https://example.com/page?utm_source=x&fbclid=y')).toBe('https://example.com/page')
      expect(normalizeUrl('https://example.com/page?utm_source=x&')).toBe('https://example.com/page')
    })
    it('preserves percent-encoded values of kept parameters', () => {
      expect(normalizeUrl('https://example.com/?q=a%20b%2Fc')).toBe('https://example.com/?q=a%20b%2Fc')
      expect(normalizeUrl('https://example.com/?id=5&utm_source=x&q=a%20b')).toBe('https://example.com/?id=5&q=a%20b')
    })
    it("ignores '?' that belongs to the fragment", () => {
      expect(normalizeUrl('https://example.com/page#a?b=c')).toBe('https://example.com/page#a?b=c')
    })
    it('works without scheme', () => {
      expect(normalizeUrl('example.com/page?utm_source=x&id=5')).toBe('https://example.com/page?id=5')
    })
  })

  describe('idempotence', () => {
    it('cleaning a cleaned URL is a no-op', () => {
      for (const url of [
        'https://example.com/page?utm_source=x&id=5',
        'https://example.com/page?id=5#top',
        'https://example.com/?foo=bar&utm_campaign=c',
        'https://example.com/page',
      ]) {
        expect(normalizeUrl(normalizeUrl(url))).toBe(normalizeUrl(url))
      }
    })
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
