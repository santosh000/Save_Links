import { test, expect } from '@playwright/test'

async function clearStorage(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    // links live in IndexedDB (localStorage is only the v1 recovery source);
    // without this, a "clear" silently keeps the previous data
    const dbs = await (indexedDB.databases ? indexedDB.databases() : Promise.resolve([]))
    await Promise.all(dbs.map((d) => new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(d.name)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })))
  })
  await page.reload()
}

async function ensureSaveFormOpen(page) {
  const urlInput = page.locator('#save-url')
  if (!(await urlInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Save a link', exact: true }).click()
  }
}

async function saveLink(page, { url, title, folder } = {}) {
  await ensureSaveFormOpen(page)
  await page.locator('#save-url').fill(url)
  if (title) await page.locator('#save-title').fill(title)
  if (folder) await page.getByLabel('Select folder').selectOption({ label: folder })
  await page.getByRole('button', { name: 'Save link' }).click()
  await expect(page.getByText('Link saved')).toBeVisible({ timeout: 3000 }).catch(() => {})
}

async function expectNoHorizontalScroll(page) {
  const noHS = await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth)
  expect(noHS).toBe(true)
}

test.describe('Layout redesign', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('Desktop ≥1200px: three areas, saved links near top, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    // drawer toggles are hidden — columns are permanent
    await expect(page.getByRole('button', { name: 'Toggle folders navigation' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Toggle filters and tools' })).toBeHidden()
    // left area: folders + appearance
    await expect(page.getByRole('button', { name: 'All links' })).toBeInViewport()
    await expect(page.getByLabel('Ocean color scheme')).toBeInViewport()
    // right area: backup, search, stats
    await expect(page.getByRole('button', { name: 'Export Backup' })).toBeInViewport()
    await expect(page.getByLabel('Search links')).toBeInViewport()
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeInViewport()
    // center: compact save bar sits above the links, not a big form
    const toggle = page.getByRole('button', { name: 'Save a link', exact: true })
    await expect(toggle).toBeInViewport()
    await expect(page.locator('#save-url')).toHaveCount(0)

    await saveLink(page, { url: 'https://example.com/near-top', title: 'Near Top' })
    const card = page.locator('article.card').first()
    await expect(card).toBeVisible()
    const box = await card.boundingBox()
    expect(box.y).toBeLessThan(500)
    await expectNoHorizontalScroll(page)
  })

  test('Save Link: compact bar expands, collapses after save', async ({ page }) => {
    await page.goto('/')
    const toggle = page.getByRole('button', { name: 'Save a link', exact: true })
    await expect(toggle).toBeVisible()
    await expect(page.locator('#save-url')).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('#save-url')).toBeVisible()
    await expect(page.getByText('More options')).toBeVisible()

    await saveLink(page, { url: 'https://example.com/auto-collapse', title: 'Auto Collapse' })
    // form auto-collapses after a successful save; the link is visible
    await expect(page.locator('#save-url')).toHaveCount(0)
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Auto Collapse')
  })

  test('Favorites nav entry filters favorites and resets via All links', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/f1', title: 'Fav One' })
    await saveLink(page, { url: 'https://example.com/f2', title: 'Plain Two' })
    await page.locator('article.card', { hasText: 'Fav One' }).getByRole('button', { name: 'Toggle Favorite' }).click()

    await expect(page.getByRole('button', { name: 'Show favorites' })).toContainText('1')
    await page.getByRole('button', { name: 'Show favorites' }).click()
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Fav One')
    await expect(page.getByRole('button', { name: 'Show favorites' })).toHaveClass(/active/)

    await page.getByRole('button', { name: 'All links' }).click()
    await expect(page.locator('article.card')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Show favorites' })).not.toHaveClass(/active/)
  })

  test('Tablet 768/820/1024: drawers, Escape closes, no overflow', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/tablet', title: 'Tablet Card' })
    for (const width of [1024, 820, 768]) {
      await page.setViewportSize({ width, height: 800 })
      await page.reload()
      await expect(page.locator('article.card').first()).toBeVisible()

      // drawers closed/off-screen; toggles visible
      await expect(page.locator('#nav-col')).not.toBeInViewport()
      await expect(page.locator('#side-col')).not.toBeInViewport()
      const navToggle = page.getByRole('button', { name: 'Toggle folders navigation' })
      const utilToggle = page.getByRole('button', { name: 'Toggle filters and tools' })
      await expect(navToggle).toBeVisible()
      await expect(utilToggle).toBeVisible()

      // nav drawer opens and Escape closes it
      await navToggle.click()
      await expect(page.getByRole('button', { name: 'All links' })).toBeInViewport()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'All links' })).not.toBeInViewport()

      // utilities drawer holds backup, filters and stats (search lives in the Saved links header)
      await utilToggle.click()
      await expect(page.getByRole('button', { name: 'Export Backup' })).toBeInViewport()
      await expect(page.locator('#side-col #filter-search')).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Statistics' })).toBeInViewport()
      await page.keyboard.press('Escape')

      await expectNoHorizontalScroll(page)
    }
  })

  test('Mobile 375/430: header profile, drawers, near-top cards, aligned create controls', async ({ page }) => {
    for (const width of [375, 430]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 667 })
      await page.goto('/')
      // profile lives in the header and stays editable
      await expect(page.locator('.profile')).toBeInViewport()
      await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
      // topbar toggles present
      await expect(page.getByRole('button', { name: 'Toggle folders navigation' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Toggle filters and tools' })).toBeVisible()

      // save a link — cards land right under the compact save bar
      await saveLink(page, { url: 'https://example.com/mobile', title: 'Mobile Card' })
      const card = page.locator('article.card').first()
      await expect(card).toBeVisible()
      const box = await card.boundingBox()
      expect(box.y).toBeLessThan(450)

      // nav drawer: folders + appearance settings
      await page.getByRole('button', { name: 'Toggle folders navigation' }).click()
      await expect(page.getByRole('button', { name: 'All links' })).toBeInViewport()
      await expect(page.getByLabel('Dark theme')).toBeInViewport()
      // folder create input and Create button are equal height
      const inputBox = await page.locator('#new-folder-input').boundingBox()
      const createBtnBox = await page.getByRole('button', { name: 'Create folder', exact: true }).boundingBox()
      expect(Math.abs(inputBox.height - createBtnBox.height)).toBeLessThanOrEqual(2)
      await page.keyboard.press('Escape')

      // utilities drawer: Data & Backup, filters, stats (search lives in the Saved links header)
      await page.getByRole('button', { name: 'Toggle filters and tools' }).click()
      await expect(page.getByRole('button', { name: 'Export Backup' })).toBeInViewport()
      await expect(page.locator('#side-col #filter-search')).toHaveCount(0)
      await expect(page.getByLabel('Filter by category')).toBeInViewport()
      await expect(page.getByRole('heading', { name: 'Statistics' })).toBeInViewport()
      await page.keyboard.press('Escape')

      await expectNoHorizontalScroll(page)
    }
  })
})