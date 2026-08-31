import { test, expect } from '@playwright/test'

async function clearStorage(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    const dbs = await (indexedDB.databases ? indexedDB.databases() : Promise.resolve([]))
    await Promise.all(dbs.map((d) => new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(d.name)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })))
  })
  await page.reload()
}

// The Save Link form is a collapsed compact bar by default. Expand it whenever
// a test needs to interact with fields.
async function ensureSaveFormOpen(page) {
  const urlInput = page.locator('#save-url')
  if (!(await urlInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Save a link', exact: true }).click()
  }
}

async function saveLink(page, url, title) {
  await ensureSaveFormOpen(page)
  await page.locator('#save-url').fill(url)
  await page.locator('#save-title').fill(title)
  await page.getByRole('button', { name: 'Save link' }).click()
  await expect(page.getByText('Link saved')).toBeVisible({ timeout: 3000 }).catch(() => {})
}

// Read the titles of the visible cards in render order.
async function cardTitles(page) {
  return page.locator('article.card .title').allTextContents()
}

test.describe('Sorting', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('sort control exists and switches display order', async ({ page }) => {
    await page.goto('/')
    // sequential saves -> ascending createdAt: A, B, C (C newest)
    await saveLink(page, 'https://example.com/alpha', 'Alpha Link')
    await saveLink(page, 'https://example.com/beta', 'Beta Link')
    await saveLink(page, 'https://example.com/gamma', 'Gamma Link')
    await expect(page.locator('article.card')).toHaveCount(3)

    // default: newest first (Gamma, Beta, Alpha)
    expect(await cardTitles(page)).toEqual(['Gamma Link', 'Beta Link', 'Alpha Link'])

    const sortSelect = page.locator('#filter-sort')
    await expect(sortSelect).toBeVisible()
    await expect(sortSelect).toHaveValue('newest')

    // Oldest first -> Alpha, Beta, Gamma
    await sortSelect.selectOption('oldest')
    expect(await cardTitles(page)).toEqual(['Alpha Link', 'Beta Link', 'Gamma Link'])

    // Title A-Z -> Alpha, Beta, Gamma
    await sortSelect.selectOption('title-az')
    expect(await cardTitles(page)).toEqual(['Alpha Link', 'Beta Link', 'Gamma Link'])

    // Title Z-A -> Gamma, Beta, Alpha
    await sortSelect.selectOption('title-za')
    expect(await cardTitles(page)).toEqual(['Gamma Link', 'Beta Link', 'Alpha Link'])

    // Back to newest
    await sortSelect.selectOption('newest')
    expect(await cardTitles(page)).toEqual(['Gamma Link', 'Beta Link', 'Alpha Link'])
  })

  test('sorting works together with search', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, 'https://example.com/apple', 'Apple Pie')
    await saveLink(page, 'https://example.com/banana', 'Banana Split')
    await saveLink(page, 'https://example.com/apricot', 'Apricot Jam')

    await page.locator('#filter-search').fill('Apple')
    await expect(page.locator('article.card')).toHaveCount(1) // only Apple Pie
    expect(await cardTitles(page)).toEqual(['Apple Pie'])

    await page.locator('#filter-search').fill('')
    await expect(page.locator('article.card')).toHaveCount(3)

    await page.locator('#filter-sort').selectOption('title-az')
    expect(await cardTitles(page)).toEqual(['Apple Pie', 'Apricot Jam', 'Banana Split'])

    await page.locator('#filter-sort').selectOption('title-za')
    expect(await cardTitles(page)).toEqual(['Banana Split', 'Apricot Jam', 'Apple Pie'])
  })

  test('sorting works together with a folder', async ({ page }) => {
    await page.goto('/')
    // create a folder
    await page.getByLabel('New folder name').fill('Work')
    await page.getByRole('button', { name: 'Create folder', exact: true }).click()
    await expect(page.locator('.folder-item', { hasText: 'Work' })).toBeVisible()

    await saveLink(page, 'https://example.com/work-a', 'Work Alpha')
    await saveLink(page, 'https://example.com/work-b', 'Work Beta')
    await saveLink(page, 'https://example.com/personal-x', 'Personal X')

    // assign the two Work links to the Work folder via the card-level move control
    await page.locator('article.card', { hasText: 'Work Alpha' }).getByLabel('Move to folder').selectOption({ label: 'Work' })
    await page.locator('article.card', { hasText: 'Work Beta' }).getByLabel('Move to folder').selectOption({ label: 'Work' })
    await expect(page.locator('.folder-item', { hasText: 'Work' })).toContainText('2')

    // filter to the Work folder
    await page.getByLabel('Filter by folder').selectOption({ label: 'Work' })
    await expect(page.locator('article.card')).toHaveCount(2)

    await page.locator('#filter-sort').selectOption('title-az')
    expect(await cardTitles(page)).toEqual(['Work Alpha', 'Work Beta'])

    await page.locator('#filter-sort').selectOption('title-za')
    expect(await cardTitles(page)).toEqual(['Work Beta', 'Work Alpha'])
  })

  test('sorting works together with a status filter', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, 'https://example.com/imp-1', 'Imp First')
    await saveLink(page, 'https://example.com/imp-2', 'Imp Second')
    await saveLink(page, 'https://example.com/regular', 'Regular')

    // mark the two Imp links as Important
    await page.locator('article.card', { hasText: 'Imp First' }).getByRole('button', { name: 'Toggle Important' }).click()
    await page.locator('article.card', { hasText: 'Imp Second' }).getByRole('button', { name: 'Toggle Important' }).click()

    await page.locator('#filter-status').selectOption('important')
    await expect(page.locator('article.card')).toHaveCount(2)

    await page.locator('#filter-sort').selectOption('oldest')
    expect(await cardTitles(page)).toEqual(['Imp First', 'Imp Second'])
  })

  test('sorting responsive: control usable at 375px, 768px and desktop', async ({ page }) => {
    for (const width of [375, 768, 1280]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await saveLink(page, 'https://example.com/zebra', 'Zebra')
      await saveLink(page, 'https://example.com/apple', 'Apple')

      // The Filters & tools drawer holds the sort control on mobile/tablet.
      if (width < 1200) {
        await page.getByRole('button', { name: 'Toggle filters and tools' }).click()
      }

      const sortSelect = page.locator('#filter-sort')
      await expect(sortSelect).toBeVisible()
      expect(await sortSelect.getAttribute('aria-label')).toBe('Sort by')
      await sortSelect.selectOption('title-az')
      expect(await cardTitles(page)).toEqual(['Apple', 'Zebra'])
      await sortSelect.selectOption('title-za')
      expect(await cardTitles(page)).toEqual(['Zebra', 'Apple'])

      // no horizontal overflow
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      expect(overflow).toBe(false)
    }
  })
})
