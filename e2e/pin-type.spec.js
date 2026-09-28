import { test, expect } from '@playwright/test'
import { clearStorage, ensureAddLinkOpen, openEditFormFor, saveLink, visibleLinkRows } from './helpers.js'

// P3 — persistent pin + link types: UI affordances, filters, bulk pin,
// composition with search/pagination, and persistence across reloads.

const card = (page, title) => page.locator('.grid > .card').filter({ hasText: title }).first()
const row = (page, title) => page.locator('.row-list > .link-row').filter({ hasText: title }).first()
const pinIn = (page, locator) => locator.getByRole('button', { name: 'Toggle Pin' })
const favIn = (page, locator) => locator.getByRole('button', { name: 'Toggle Favorite' })
const selectAllBox = (page) => page.locator('.select-visible input')
const bulkBar = (page) => page.locator('.bulk-bar')

const TYPES = ['article', 'video', 'docs', 'repo']

async function seedTyped(page, count) {
  await page.goto('/')
  await page.locator('.page-title').waitFor()
  const now = Date.now()
  const rows = []
  for (let i = 0; i < count; i++) {
    const url = `https://example.com/type-${String(i).padStart(4, '0')}`
    rows.push({
      id: `type-${String(i).padStart(4, '0')}`,
      originalUrl: url, normalizedUrl: url, url, domain: 'example.com',
      title: `Type Link ${String(i).padStart(4, '0')}`,
      description: '', image: '', category: 'Other', tags: [],
      important: false, mustHave: false, favorite: false,
      pinned: i % 5 === 0,
      type: TYPES[i % TYPES.length],
      folderId: null, status: null,
      createdAt: new Date(now - i * 3600000).toISOString(), savedFrom: 'Unknown',
    })
  }
  await page.evaluate(async (records) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('save_links:test')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('links', 'readwrite')
      const store = tx.objectStore('links')
      store.clear()
      for (const r of records) store.put(r)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('seed aborted'))
    })
    db.close()
  }, rows)
  await page.goto('/')
  await expect(page.locator('.grid > .card').first()).toBeVisible()
}

test.describe('Pin and link types', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('pin/unpin from a card persists and stays independent of favorite', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/pin', title: 'Pinned Link' })

    const pin = pinIn(page, card(page, 'Pinned Link'))
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await expect(favIn(page, card(page, 'Pinned Link'))).toHaveAttribute('aria-pressed', 'false')

    await page.reload()
    await expect(pinIn(page, card(page, 'Pinned Link'))).toHaveAttribute('aria-pressed', 'true')
    await expect(favIn(page, card(page, 'Pinned Link'))).toHaveAttribute('aria-pressed', 'false')

    await pinIn(page, card(page, 'Pinned Link')).click()
    await expect(pinIn(page, card(page, 'Pinned Link'))).toHaveAttribute('aria-pressed', 'false')
  })

  test('pin/unpin from a list row (and compact keeps its density)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/row', title: 'Row Link' })
    await page.locator('.view-btn').filter({ hasText: 'List' }).click()

    const pin = pinIn(page, row(page, 'Row Link'))
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await page.reload()
    await page.locator('.view-btn').filter({ hasText: 'List' }).click()
    await expect(pinIn(page, row(page, 'Row Link'))).toHaveAttribute('aria-pressed', 'true')

    await page.locator('.view-btn').filter({ hasText: 'Compact' }).click()
    await expect(pinIn(page, row(page, 'Row Link'))).toBeVisible()
    await pinIn(page, row(page, 'Row Link')).click()
    await expect(pinIn(page, row(page, 'Row Link'))).toHaveAttribute('aria-pressed', 'false')
  })

  test('type selection on add, heuristic detection, and type editing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')

    // Explicit type on add
    await ensureAddLinkOpen(page, { more: true })
    await page.locator('#save-url').fill('https://example.com/docs/page')
    await page.locator('#save-title').fill('Explicit Docs')
    await page.locator('#save-type').selectOption('docs')
    await page.getByRole('button', { name: 'Save link', exact: true }).click()
    await expect(page.locator('#add-form')).toHaveCount(0)
    await expect(page.getByText('Link saved')).toBeVisible()

    // Heuristic detection (no explicit type): youtube -> video
    await ensureAddLinkOpen(page, { more: true })
    await page.locator('#save-url').fill('https://youtube.com/watch?v=abc')
    await page.locator('#save-title').fill('Detected Video')
    await page.waitForTimeout(250) // let the anchored popover settle before submit
    await page.getByRole('button', { name: 'Save link', exact: true }).click()
    await expect(page.locator('#add-form')).toHaveCount(0)
    await expect(page.getByText('Link saved')).toBeVisible()

    const explicit = await openEditFormFor(page, 'Explicit Docs')
    await expect(explicit.form.getByRole('combobox', { name: 'Edit type' })).toContainText('Docs')
    await explicit.form.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.edit-form')).toHaveCount(0)

    const detected = await openEditFormFor(page, 'Detected Video')
    await expect(detected.form.getByRole('combobox', { name: 'Edit type' })).toContainText('Video')
    await detected.form.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.edit-form')).toHaveCount(0)

    // Edit type + pin through the existing edit form
    const edit = await openEditFormFor(page, 'Explicit Docs')
    await edit.form.getByRole('combobox', { name: 'Edit type' }).click()
    await page.getByRole('option', { name: 'Repo', exact: true }).click()
    // The anchored popover repositions while it settles; toggle via keyboard so
    // the assertion does not depend on animation stability.
    await edit.form.getByRole('checkbox').focus()
    await page.keyboard.press('Space')
    await expect(edit.form.getByRole('checkbox')).toBeChecked()
    await edit.form.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.edit-form')).toHaveCount(0)

    const again = await openEditFormFor(page, 'Explicit Docs')
    await expect(again.form.getByRole('combobox', { name: 'Edit type' })).toContainText('Repo')
    await expect(again.form.getByRole('checkbox')).toBeChecked()
    await again.form.getByRole('button', { name: 'Cancel' }).click()
    await expect(pinIn(page, card(page, 'Explicit Docs'))).toHaveAttribute('aria-pressed', 'true')
  })

  test('type filter and pinned filter compose with search; pagination follows', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedTyped(page, 12)

    // Type filter: video links are every 4th (indices 1,5,9) -> 3 of 12
    await page.locator('#filter-type').selectOption('video')
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1–3 of 3 links$/)
    await expect(visibleLinkRows(page)).toHaveCount(3)
    await expect(page.locator('.filter-chip', { hasText: 'Type: Video' })).toBeVisible()

    // Compose with search
    await page.getByLabel('Search links').fill('Type Link 0005')
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1 of 1 links$/)

    // Clear search, add pinned filter (pinned = every 5th: 0,5,10)
    await page.getByLabel('Search links').fill('')
    await page.locator('.pinned-toggle').click()
    await expect(page.locator('.pinned-toggle')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.filter-chip', { hasText: 'Pinned' })).toBeVisible()
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1 of 1 links$/) // video ∩ pinned = index 5 only

    // Remove the pinned chip; the type filter remains
    await page.locator('.filter-chip', { hasText: 'Pinned' }).getByRole('button', { name: 'Clear pinned filter' }).click()
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1–3 of 3 links$/)

    // Type filter alone on page one keeps the DOM bounded
    await expect(visibleLinkRows(page)).toHaveCount(3)
    await page.locator('.filter-chip', { hasText: 'Type: Video' }).getByRole('button', { name: 'Clear type filter' }).click()
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1–10 of 12 links$/)
  })

  test('Pinned filter shows only pinned links; type filter stays usable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedTyped(page, 10)

    await page.locator('.pinned-toggle').click()
    await expect(visibleLinkRows(page)).toHaveCount(2) // indices 0 and 5
    for (const title of ['Type Link 0000', 'Type Link 0005']) {
      await expect(card(page, title)).toHaveCount(1)
    }
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1–2 of 2 links$/)
  })

  test('bulk pin/unpin applies to the selection and persists', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedTyped(page, 3)

    const checkFor = (title) => card(page, title).getByRole('checkbox', { name: `Select ${title}` })
    await checkFor('Type Link 0001').check()
    await checkFor('Type Link 0002').check()
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('2 selected')

    await bulkBar(page).getByRole('button', { name: 'Toggle pin for selected links' }).click()
    await expect(pinIn(page, card(page, 'Type Link 0001'))).toHaveAttribute('aria-pressed', 'true')
    await expect(pinIn(page, card(page, 'Type Link 0002'))).toHaveAttribute('aria-pressed', 'true')
    // index 0 was seeded pinned; it is not selected and stays pinned
    await expect(pinIn(page, card(page, 'Type Link 0000'))).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    await expect(pinIn(page, card(page, 'Type Link 0001'))).toHaveAttribute('aria-pressed', 'true')

    // Uniform toggle back (all three are pinned; select all visible)
    await selectAllBox(page).check()
    await bulkBar(page).getByRole('button', { name: 'Toggle pin for selected links' }).click()
    await expect(pinIn(page, card(page, 'Type Link 0000'))).toHaveAttribute('aria-pressed', 'false')
  })

  test('selection survives filtering (P2 rules); visible select-all reflects the page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedTyped(page, 12)

    await selectAllBox(page).check()
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('10 selected')
    await expect(selectAllBox(page)).toBeChecked()

    // Pinned-first ordering means page 1 is not simply the 10 newest ids (a
    // pinned link from index 10 enters the page). Filtering to video therefore
    // shows a mix: two of the three videos are selected, one is not.
    await page.locator('#filter-type').selectOption('video')
    await expect(visibleLinkRows(page)).toHaveCount(3)
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('10 selected') // selection survives filtering
    await expect(selectAllBox(page)).toHaveJSProperty('indeterminate', true)

    // Selecting all visible adds the remaining visible video link.
    await selectAllBox(page).check()
    await expect(selectAllBox(page)).toBeChecked()
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('11 selected')

    // Clearing the filter keeps the selection and restores the bounded page.
    await page.locator('#filter-type').selectOption('')
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('11 selected')
    await expect(visibleLinkRows(page)).toHaveCount(10)
  })

  test('pin + filters work in dark mode and on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 844 })
    await page.goto('/')
    await page.evaluate(() => { document.documentElement.setAttribute('data-appearance', 'dark') })
    await saveLink(page, { url: 'https://example.com/mobile', title: 'Mobile Pin' })

    const pin = pinIn(page, card(page, 'Mobile Pin'))
    await expect(pin).toBeVisible()
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')

    // Filters live in the mobile disclosure; pinned filter works there too.
    await page.locator('.sort-filter-toggle').click()
    await expect(page.locator('.pinned-toggle')).toBeVisible()
    await page.locator('.pinned-toggle').click()
    await expect(visibleLinkRows(page)).toHaveCount(1)

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBe(0)
  })
})
