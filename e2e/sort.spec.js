import { test, expect } from '@playwright/test'
import { clearStorage, ensureAddLinkOpen, saveLink, visibleLinkRows, linkRowByTitle, openView, createFolder } from './helpers.js'

// Read the titles of the visible rows in render order. Cards lead with their
// title (card hierarchy) and list/compact rows do the same.
async function rowTitles(page) {
  return page.locator('.grid > .card, .row-list > .link-row').evaluateAll((els) =>
    els.map((el) => ((el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '')),
  )
}

// The toolbar sits behind its disclosure on the mobile shell.
async function revealToolbar(page) {
  const disclosure = page
    .getByRole('button', { name: /sort\s*(&|and)?\s*filter/i })
    .or(page.locator('.toolbar-controls button[aria-expanded]'))
    .first()
  if (await disclosure.isVisible().catch(() => false)) {
    if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
  }
}

test.describe('Sorting', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('sort control exists and switches display order', async ({ page }) => {
    await page.goto('/')
    // sequential saves -> ascending createdAt: A, B, C (C newest)
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await saveLink(page, { url: 'https://example.com/beta', title: 'Beta Link' })
    await saveLink(page, { url: 'https://example.com/gamma', title: 'Gamma Link' })
    await expect(visibleLinkRows(page)).toHaveCount(3)

    // default: newest first (Gamma, Beta, Alpha)
    expect(await rowTitles(page)).toEqual(['Gamma Link', 'Beta Link', 'Alpha Link'])

    const sortSelect = page.locator('#filter-sort')
    await expect(sortSelect).toBeVisible()
    await expect(sortSelect).toHaveValue('newest')

    // Oldest first -> Alpha, Beta, Gamma
    await sortSelect.selectOption('oldest')
    expect(await rowTitles(page)).toEqual(['Alpha Link', 'Beta Link', 'Gamma Link'])

    // Title A-Z -> Alpha, Beta, Gamma
    await sortSelect.selectOption('title-az')
    expect(await rowTitles(page)).toEqual(['Alpha Link', 'Beta Link', 'Gamma Link'])

    // Title Z-A -> Gamma, Beta, Alpha
    await sortSelect.selectOption('title-za')
    expect(await rowTitles(page)).toEqual(['Gamma Link', 'Beta Link', 'Alpha Link'])

    // Back to newest
    await sortSelect.selectOption('newest')
    expect(await rowTitles(page)).toEqual(['Gamma Link', 'Beta Link', 'Alpha Link'])
  })

  test('sorting works together with search', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/apple', title: 'Apple Pie' })
    await saveLink(page, { url: 'https://example.com/banana', title: 'Banana Split' })
    await saveLink(page, { url: 'https://example.com/apricot', title: 'Apricot Jam' })

    await page.getByLabel('Search links').fill('Apple')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    expect(await rowTitles(page)).toEqual(['Apple Pie'])

    await page.getByLabel('Search links').fill('')
    await expect(visibleLinkRows(page)).toHaveCount(3)

    await page.locator('#filter-sort').selectOption('title-az')
    expect(await rowTitles(page)).toEqual(['Apple Pie', 'Apricot Jam', 'Banana Split'])

    await page.locator('#filter-sort').selectOption('title-za')
    expect(await rowTitles(page)).toEqual(['Banana Split', 'Apricot Jam', 'Apple Pie'])
  })

  test('sorting works together with a folder', async ({ page }) => {
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

    // filter to the Work folder (via Folders view)
    await openView(page, 'folders')
    await page.getByRole('button', { name: 'Show folder Work' }).click()

    await expect(visibleLinkRows(page)).toHaveCount(2)

    await revealToolbar(page)
    await page.locator('#filter-sort').selectOption('title-az')
    expect(await rowTitles(page)).toEqual(['Work Alpha', 'Work Beta'])

    await page.locator('#filter-sort').selectOption('title-za')
    expect(await rowTitles(page)).toEqual(['Work Beta', 'Work Alpha'])
  })

  test('sorting works together with a status filter', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/imp-1', title: 'Imp First' })
    await saveLink(page, { url: 'https://example.com/imp-2', title: 'Imp Second' })
    await saveLink(page, { url: 'https://example.com/regular', title: 'Regular' })

    // mark the two Imp links as Important with the permanent row control
    await linkRowByTitle(page, 'Imp First').getByRole('button', { name: 'Toggle Important' }).click()
    await linkRowByTitle(page, 'Imp Second').getByRole('button', { name: 'Toggle Important' }).click()

    await revealToolbar(page)
    await page.locator('#filter-status').selectOption('important')
    await expect(visibleLinkRows(page)).toHaveCount(2)

    await page.locator('#filter-sort').selectOption('oldest')
    expect(await rowTitles(page)).toEqual(['Imp First', 'Imp Second'])
  })

  test('sorting responsive: control usable at 375px, 768px and desktop', async ({ page }) => {
    for (const width of [375, 768, 1280]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await saveLink(page, { url: 'https://example.com/zebra', title: 'Zebra' })
      await saveLink(page, { url: 'https://example.com/apple', title: 'Apple' })

      await revealToolbar(page)
      const sortSelect = page.locator('#filter-sort')
      await expect(sortSelect).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'Sort by' })).toBeVisible()
      await sortSelect.selectOption('title-az')
      expect(await rowTitles(page)).toEqual(['Apple', 'Zebra'])
      await sortSelect.selectOption('title-za')
      expect(await rowTitles(page)).toEqual(['Zebra', 'Apple'])

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      expect(overflow).toBe(false)
    }
  })
})
