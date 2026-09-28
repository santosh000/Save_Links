import { test, expect } from '@playwright/test'
import { clearStorage, createFolder, openEditFormFor, openView, saveLink, visibleLinkRows } from './helpers.js'

// P2 — bulk selection + bulk actions over the existing data model.
// Selection is presentation state in App.vue; these tests exercise the real
// handlers (updateLink/removeLink/handleSetFolder) and the bounded-rendering
// rules (select-all-visible only selects the current page).

const bulkBar = (page) => page.locator('.bulk-bar')
const selectAllBox = (page) => page.locator('.select-visible input')
const card = (page, title) => page.locator('.grid > .card').filter({ hasText: title }).first()
const cardCheck = (page, title) => card(page, title).getByRole('checkbox', { name: `Select ${title}` })

async function seedLinks(page, count) {
  // Ensure the app has created the v2 database before writing into it.
  await page.goto('/')
  await page.locator('.page-title').waitFor()
  const now = Date.now()
  const rows = []
  for (let i = 0; i < count; i++) {
    const url = `https://example.com/bulk-${String(i).padStart(4, '0')}`
    rows.push({
      id: `bulk-${String(i).padStart(4, '0')}`,
      originalUrl: url, normalizedUrl: url, url, domain: 'example.com',
      title: `Bulk Link ${String(i).padStart(4, '0')}`,
      description: '', image: '', category: 'Other', tags: [],
      important: false, mustHave: false, favorite: false, folderId: null,
      status: null, createdAt: new Date(now - i * 7 * 3600000).toISOString(), savedFrom: 'Unknown',
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
}

test.describe('Bulk selection and actions', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('selection: select, deselect, select-all-visible, clear, tri-state', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/a', title: 'Alpha' })
    await saveLink(page, { url: 'https://example.com/b', title: 'Beta' })
    await saveLink(page, { url: 'https://example.com/c', title: 'Gamma' })

    await expect(bulkBar(page)).toBeHidden()

    await cardCheck(page, 'Alpha').check()
    await expect(bulkBar(page)).toBeVisible()
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('1 selected')
    await expect(card(page, 'Alpha')).toHaveClass(/selected/)
    await expect(selectAllBox(page)).toHaveJSProperty('indeterminate', true)

    await cardCheck(page, 'Beta').check()
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('2 selected')
    await cardCheck(page, 'Beta').uncheck()
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('1 selected')

    await selectAllBox(page).check()
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('3 selected')
    await expect(selectAllBox(page)).toBeChecked()
    await expect(selectAllBox(page)).toHaveJSProperty('indeterminate', false)
    for (const title of ['Alpha', 'Beta', 'Gamma']) await expect(card(page, title)).toHaveClass(/selected/)

    await cardCheck(page, 'Alpha').uncheck()
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('2 selected')
    await expect(selectAllBox(page)).toHaveJSProperty('indeterminate', true)

    await bulkBar(page).getByRole('button', { name: 'Clear selection' }).click()
    await expect(bulkBar(page)).toBeHidden()
    await expect(selectAllBox(page)).not.toBeChecked()

    // Selection is presentation state only: nothing persisted.
    await page.reload()
    await expect(page.locator('.card.selected, .link-row.selected')).toHaveCount(0)
    await expect(visibleLinkRows(page)).toHaveCount(3)
  })

  test('select all visible is bounded to the current page and survives paging', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedLinks(page, 12)
    await page.goto('/')
    await expect(page.locator('.grid > .card')).toHaveCount(10)

    await selectAllBox(page).check()
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('10 selected')

    await page.locator('.pagination .page-link[aria-label="Page 2"]').click()
    await expect(page.locator('.grid > .card')).toHaveCount(2)
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('10 selected')
    // Page 2's links are not selected yet, so the visible-page control is not
    // indeterminate — it reflects the CURRENT page only.
    await expect(selectAllBox(page)).not.toBeChecked()
    await expect(selectAllBox(page)).toHaveJSProperty('indeterminate', false)

    await bulkBar(page).getByRole('button', { name: 'Select all visible links' }).click()
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('12 selected')
    await expect(selectAllBox(page)).toBeChecked()

    // Never renders the whole collection.
    await expect(page.locator('.grid > .card')).toHaveCount(2)
    await expect(visibleLinkRows(page)).toHaveCount(2)
  })

  test('bulk move assigns an existing folder and clears selection', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/a', title: 'Alpha' })
    await saveLink(page, { url: 'https://example.com/b', title: 'Beta' })
    await saveLink(page, { url: 'https://example.com/c', title: 'Gamma' })

    await openView(page, 'folders')
    await createFolder(page, 'Reading')
    await openView(page, 'links')

    await cardCheck(page, 'Alpha').check()
    await cardCheck(page, 'Beta').check()
    await page.locator('.bulk-bar .asel-trigger').click()
    await page.getByRole('option', { name: 'Reading' }).click()

    await expect(bulkBar(page)).toBeHidden() // selection cleared after the move
    await expect(page.getByText('Folder updated').first()).toBeVisible()

    const alpha = await openEditFormFor(page, 'Alpha')
    await expect(alpha.form.getByRole('combobox', { name: 'Edit folder' })).toContainText('Reading')
    await alpha.form.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.edit-form')).toHaveCount(0)

    const gamma = await openEditFormFor(page, 'Gamma')
    await expect(gamma.form.getByRole('combobox', { name: 'Edit folder' })).toContainText('Unfiled')
    await gamma.form.getByRole('button', { name: 'Cancel' }).click()
  })

  test('bulk favorite sets a uniform state and persists', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/a', title: 'Alpha' })
    await saveLink(page, { url: 'https://example.com/b', title: 'Beta' })

    await cardCheck(page, 'Alpha').check()
    await cardCheck(page, 'Beta').check()
    await bulkBar(page).getByRole('button', { name: 'Toggle favorite for selected links' }).click()

    await expect(card(page, 'Alpha').getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(card(page, 'Beta').getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Added to favorites').first()).toBeVisible()

    await page.reload()
    await expect(card(page, 'Alpha').getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(card(page, 'Beta').getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('bulk delete: confirmation, cancel keeps data, confirm removes only selected', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    for (const [t, u] of [['Alpha', 'a'], ['Beta', 'b'], ['Gamma', 'c'], ['Delta', 'd']]) {
      await saveLink(page, { url: `https://example.com/${u}`, title: t })
    }

    await cardCheck(page, 'Alpha').check()
    await cardCheck(page, 'Beta').check()
    await bulkBar(page).getByRole('button', { name: 'Delete selected links' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Delete 2 links?')
    await expect(dialog).toContainText('This cannot be undone.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(visibleLinkRows(page)).toHaveCount(4)
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('2 selected')

    await bulkBar(page).getByRole('button', { name: 'Delete selected links' }).click()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expect(page.getByText('2 links deleted').first()).toBeVisible()
    await expect(bulkBar(page)).toBeHidden()
    await expect(card(page, 'Alpha')).toHaveCount(0)
    await expect(card(page, 'Gamma')).toHaveCount(1)
    await expect(card(page, 'Delta')).toHaveCount(1)
  })

  test('bulk delete from the last page returns to a valid page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedLinks(page, 11)
    await page.goto('/')
    await expect(page.locator('.grid > .card')).toHaveCount(10)

    await page.locator('.pagination .page-link[aria-label="Page 2"]').click()
    await expect(page.locator('.grid > .card')).toHaveCount(1)

    await selectAllBox(page).check()
    await expect(bulkBar(page).locator('.bulk-count')).toHaveText('1 selected')
    await bulkBar(page).getByRole('button', { name: 'Delete selected links' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()

    // The empty page 2 no longer exists: the view returns to a full page 1.
    await expect(page.locator('.library-results-count')).toHaveText(/^Showing 1\u201310 of 10 links$/)
    await expect(page.locator('.grid > .card')).toHaveCount(10)
    await expect(bulkBar(page)).toBeHidden()
  })
})
