import { test, expect } from '@playwright/test'
import { clearStorage, openView, saveLink, visibleLinkRows, linkRowByTitle, createFolder } from './helpers.js'

// Read the titles of the visible rows in render order. Cards lead with their
// title (card hierarchy) and list/compact rows do the same.
async function rowTitles(page) {
  return page.locator('.grid > .card, .row-list > .link-row').evaluateAll((els) =>
    els.map((el) => ((el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '')),
  )
}

// P15.10: the user-facing sort control is gone (mockup contract). The library
// keeps its deterministic pinned-first / newest-first display order, so these
// tests now pin that behaviour and its composition with the real filters.
test.describe('Display order (P15.10: newest-first, no sort UI)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('the library renders newest first and offers no sort control', async ({ page }) => {
    await page.goto('/')
    // sequential saves -> ascending createdAt: A, B, C (C newest)
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await saveLink(page, { url: 'https://example.com/beta', title: 'Beta Link' })
    await saveLink(page, { url: 'https://example.com/gamma', title: 'Gamma Link' })
    await expect(visibleLinkRows(page)).toHaveCount(3)

    // deterministic newest first (Gamma, Beta, Alpha)
    expect(await rowTitles(page)).toEqual(['Gamma Link', 'Beta Link', 'Alpha Link'])

    // no sort control remains anywhere in the library surface
    await expect(page.locator('#filter-sort')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /sort\s*(&|and)?\s*filter/i })).toHaveCount(0)
  })

  test('order is stable together with search', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/apple', title: 'Apple Pie' })
    await saveLink(page, { url: 'https://example.com/banana', title: 'Banana Split' })
    await saveLink(page, { url: 'https://example.com/apricot', title: 'Apricot Jam' })

    await page.getByLabel('Search links').fill('Apple')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    expect(await rowTitles(page)).toEqual(['Apple Pie'])

    await page.getByLabel('Search links').fill('')
    await expect(visibleLinkRows(page)).toHaveCount(3)
    expect(await rowTitles(page)).toEqual(['Apricot Jam', 'Banana Split', 'Apple Pie'])
  })

  test('order is stable together with a folder filter', async ({ page }) => {
    await page.goto('/')
    // create a folder via Folders view
    await openView(page, 'folders')
    await createFolder(page, 'Work')
    await openView(page, 'links')

    await saveLink(page, { url: 'https://example.com/work-a', title: 'Work Alpha' })
    await saveLink(page, { url: 'https://example.com/work-b', title: 'Work Beta' })
    await saveLink(page, { url: 'https://example.com/personal-x', title: 'Personal X' })

    // assign the two Work links to the Work folder through the current
    // More-actions menu (the AppSelect native value carrier is the stable hook)
    for (const title of ['Work Alpha', 'Work Beta']) {
      await linkRowByTitle(page, title).getByRole('button', { name: 'More actions' }).click()
      const menu = page.locator('.more-menu')
      await expect(menu).toBeVisible()
      await menu.locator('.more-field', { hasText: 'Folder' }).locator('select').selectOption({ label: 'Work' })
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    }

    // filter to the Work folder from the sidebar tree
    await openView(page, 'folders')
    await page.locator('[data-testid="sidebar-folder-row"]', { hasText: 'Work' }).click()

    await expect(visibleLinkRows(page)).toHaveCount(2)
    expect(await rowTitles(page)).toEqual(['Work Beta', 'Work Alpha'])
  })

  test('order is stable together with a filter', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/imp-1', title: 'Imp First' })
    await saveLink(page, { url: 'https://example.com/imp-2', title: 'Imp Second' })
    await saveLink(page, { url: 'https://example.com/regular', title: 'Regular' })

    // mark the two Imp links with the permanent row pin control
    await linkRowByTitle(page, 'Imp First').getByRole('button', { name: 'Toggle Pin' }).click()
    await linkRowByTitle(page, 'Imp Second').getByRole('button', { name: 'Toggle Pin' }).click()

    await page.getByRole('button', { name: 'Show pinned links only' }).click()
    await expect(visibleLinkRows(page)).toHaveCount(2)
    expect(await rowTitles(page)).toEqual(['Imp Second', 'Imp First'])
  })

  test('pinned links surface first at 375px, 768px and desktop', async ({ page }) => {
    for (const width of [375, 768, 1280]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await saveLink(page, { url: 'https://example.com/zebra', title: 'Zebra' })
      await saveLink(page, { url: 'https://example.com/apple', title: 'Apple' })

      // pin the older link: it must jump above the newer one
      await linkRowByTitle(page, 'Zebra').getByRole('button', { name: 'Toggle Pin' }).click()
      expect(await rowTitles(page)).toEqual(['Zebra', 'Apple'])

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      expect(overflow).toBe(false)
    }
  })
})
