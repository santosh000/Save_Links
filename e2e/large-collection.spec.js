import { test, expect } from '@playwright/test'
import { clearStorage, visibleLinkRows } from './helpers.js'

// P0 — Large-library baseline fixtures + measurements.
//
// Seeds real link records through the REAL boot path (localStorage -> migration
// -> IndexedDB), then records timing annotations for the large-collection
// interactions and asserts the bounded-rendering invariants. Timings are
// reported as annotations (not hard budgets) — P0 is measurement, not
// optimization. Storage write amplification (setAllLinks rewrite) is a known
// architectural issue and is intentionally NOT addressed here.

const PAGE_SIZE = 10

const SEED_TYPES = ['article', 'video', 'docs', 'repo']

function seedLinks(count, now = Date.now()) {
  const categories = ['GitHub', 'YouTube', 'Instagram', 'Other']
  const links = []
  for (let i = 0; i < count; i++) {
    const url = `https://example.com/seed-${String(i).padStart(4, '0')}`
    links.push({
      id: `seed-${String(i).padStart(4, '0')}`,
      originalUrl: url,
      normalizedUrl: url,
      url,
      domain: 'example.com',
      title: `Seed Link ${String(i).padStart(4, '0')}`,
      description: `Synthetic link ${i} for the large-collection baseline.`,
      image: '',
      category: categories[i % categories.length],
      tags: i % 3 === 0 ? ['seed', 'baseline'] : [],
      important: i % 7 === 0,
      mustHave: i % 11 === 0,
      favorite: i % 5 === 0,
      pinned: i % 10 === 0,
      type: SEED_TYPES[i % SEED_TYPES.length],
      folderId: null,
      status: null,
      createdAt: new Date(now - i * 7 * 60 * 60 * 1000).toISOString(), // every 7h, newest first
      savedFrom: 'Unknown',
    })
  }
  return links
}

// Seed through the REAL IndexedDB schema: the app has already created the v2
// database (clearStorage navigates and reloads), so we write records straight
// into the existing `links` store and reload — the same reads the app always
// does at boot, without depending on migration-marker semantics.
async function seedAndBoot(page, count) {
  await clearStorage(page)
  await seedIndexedDB(page, seedLinks(count))
}

async function seedIndexedDB(page, records) {
  await page.evaluate(async (rows) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('save_links:test')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('links', 'readwrite')
      const store = tx.objectStore('links')
      store.clear()
      for (const row of rows) store.put(row)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('seed aborted'))
    })
    db.close()
  }, records)
}

function annotation(testInfo, label, ms) {
  testInfo.annotations.push({ type: 'measure', description: `${label}: ${ms}ms` })
}

async function timed(testInfo, label, fn) {
  const t0 = Date.now()
  const result = await fn()
  annotation(testInfo, label, Date.now() - t0)
  return result
}

test.describe('Large-library baseline (500–1,000 links)', () => {
  test('1,000 links: bounded DOM, windowed pagination, real interactions', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedAndBoot(page, 1000)

    await timed(testInfo, 'boot + render (1000 links)', async () => {
      await page.goto('/')
      await expect(visibleLinkRows(page).first()).toBeVisible()
    })

    // Bounded rendering: only one page of items is in the DOM.
    await expect(visibleLinkRows(page)).toHaveCount(PAGE_SIZE)

    // Pagination window: page links are bounded (100 pages -> windowed, not 100 links).
    const pageItems = page.locator('.pagination .page-item')
    const itemCount = await pageItems.count()
    annotation(testInfo, 'pagination DOM items (1000 links)', itemCount)
    expect(itemCount).toBeLessThanOrEqual(12)

    // Real result context is driven by real data.
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1\u201310 of 1000 links$/)

    // Search runs against real records.
    await timed(testInfo, 'search (1000 links)', async () => {
      await page.getByLabel('Search links').fill('Seed Link 0500')
      await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1 of 1 links$/)
    })
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await page.getByLabel('Search links').fill('')
    await expect(visibleLinkRows(page)).toHaveCount(PAGE_SIZE)

    // Page switching keeps the DOM bounded and changes the rendered window.
    await timed(testInfo, 'page switch (1000 links)', async () => {
      await page.locator('.pagination .page-link[aria-label="Page 2"]').click()
      await expect(page.locator('.library-results-count')).toHaveText(/^Showing 11\u201320 of 1000 links$/)
    })
    await expect(visibleLinkRows(page)).toHaveCount(PAGE_SIZE)
    await page.locator('.pagination .page-link[aria-label="Previous page"]').click()

    // View switching stays bounded in every mode.
    await timed(testInfo, 'view switch compact (1000 links)', async () => {
      await page.locator('.view-btn').filter({ hasText: 'Compact' }).click()
      await expect(visibleLinkRows(page)).toHaveCount(PAGE_SIZE)
    })
    await page.locator('.view-btn').filter({ hasText: 'List' }).click()
    await expect(visibleLinkRows(page)).toHaveCount(PAGE_SIZE)
    await page.locator('.view-btn').filter({ hasText: 'Card' }).click()
    await expect(page.locator('.grid > .card')).toHaveCount(PAGE_SIZE)

    // Favorite toggle writes through the real path. At 1,000 links the
    // persistence is a full-store rewrite, so wait for the IndexedDB commit
    // before reloading — a reload mid-transaction aborts the write.
    await page.waitForTimeout(300) // let the view-switch mount animation settle
    const firstCard = page.locator('.grid > .card').first()
    const fav = firstCard.getByRole('button', { name: 'Toggle Favorite' })
    const before = await fav.getAttribute('aria-pressed')
    const expectedAfter = before === 'true' ? 'false' : 'true'
    const persistStart = Date.now()
    await fav.click()
    await expect(fav).toHaveAttribute('aria-pressed', expectedAfter)
    await expect.poll(async () => page.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const req = indexedDB.open('save_links:test')
        req.onsuccess = () => resolve(req.result)
      })
      const rec = await new Promise((resolve) => {
        const tx = db.transaction('links', 'readonly')
        const q = tx.objectStore('links').get('seed-0000')
        q.onsuccess = () => resolve(q.result)
      })
      db.close()
      return rec ? String(rec.favorite) : 'missing'
    }), { timeout: 15000 }).toBe(expectedAfter)
    annotation(testInfo, 'favorite persist to IndexedDB (1000 links)', Date.now() - persistStart)

    await page.reload()
    await expect(page.locator('.grid > .card').first().getByRole('button', { name: 'Toggle Favorite' }))
      .toHaveAttribute('aria-pressed', expectedAfter)

    // No horizontal overflow.
    const noOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    expect(noOverflow).toBe(true)
  })

  test('P3 type/pinned filters stay correct and bounded at 1,000 links', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedAndBoot(page, 1000)
    await page.goto('/')
    await expect(visibleLinkRows(page).first()).toBeVisible()

    // Type filter: 250 of 1,000 are 'video'
    await page.locator('#filter-type').selectOption('video')
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1–10 of 250 links$/)
    await expect(visibleLinkRows(page)).toHaveCount(PAGE_SIZE)
    await expect(page.locator('.filter-chip', { hasText: 'Type: Video' })).toBeVisible()

    // Compose with search: a single known video seed
    await page.getByLabel('Search links').fill('Seed Link 0001')
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1 of 1 links$/)
    await page.getByLabel('Search links').fill('')

    // Pinned-only (no type filter): 100 pinned
    await page.locator('.filter-chip', { hasText: 'Type: Video' }).getByRole('button', { name: 'Clear type filter' }).click()
    await page.locator('.pinned-toggle').click()
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1–10 of 100 links$/)

    // Compose type + pinned: pinned indices are multiples of 10, and every
    // other one is a 'docs' seed (i % 4 === 2) -> 50 of 1,000.
    await page.locator('#filter-type').selectOption('docs')
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1–10 of 50 links$/)
    await expect(visibleLinkRows(page)).toHaveCount(PAGE_SIZE)

    // Bulk pin selected visible links (all already pinned -> uniform unpin)
    await page.locator('.select-visible input').check()
    await expect(page.locator('.bulk-bar .bulk-count')).toHaveText('10 selected')
    await page.locator('.bulk-bar').getByRole('button', { name: 'Toggle pin for selected links' }).click()
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1–10 of 40 links$/)
    await expect(visibleLinkRows(page)).toHaveCount(PAGE_SIZE)
  })

  test('500 links: bounded DOM and correct result context', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedAndBoot(page, 500)

    await timed(testInfo, 'boot + render (500 links)', async () => {
      await page.goto('/')
      await expect(visibleLinkRows(page).first()).toBeVisible()
    })

    await expect(visibleLinkRows(page)).toHaveCount(PAGE_SIZE)
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1\u201310 of 500 links$/)

    const pageItems = await page.locator('.pagination .page-item').count()
    annotation(testInfo, 'pagination DOM items (500 links)', pageItems)
    expect(pageItems).toBeLessThanOrEqual(12)

    await timed(testInfo, 'search (500 links)', async () => {
      await page.getByLabel('Search links').fill('Seed Link 0499')
      await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1 of 1 links$/)
    })
  })

  test('group headers derive from createdAt in list/compact newest-first', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const links = [
      { title: 'Today A', createdAt: new Date(now - 60 * 60 * 1000).toISOString() },
      { title: 'Today B', createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() },
      { title: 'Yesterday A', createdAt: new Date(now - day + 60 * 60 * 1000).toISOString() },
      { title: 'Earlier A', createdAt: new Date(now - 30 * day).toISOString() },
    ].map((l, i) => {
      const url = `https://example.com/group-${i}`
      return {
        id: `group-${i}`, originalUrl: url, normalizedUrl: url, url, domain: 'example.com',
        title: l.title, description: '', image: '', category: 'Other', tags: [],
        important: false, mustHave: false, favorite: false, folderId: null,
        status: null, createdAt: l.createdAt, savedFrom: 'Unknown',
      }
    })
    await seedIndexedDB(page, links)
    await page.goto('/')
    await page.locator('.view-btn').filter({ hasText: 'List' }).click()

    const headers = page.locator('.row-list .group-h')
    await expect(headers).toHaveText(['Today', 'Yesterday', 'Earlier'])
  })
})
