import { test, expect } from '@playwright/test'

// Responsive Search placement: the Search control must always belong to the
// "Saved links" header and must NEVER move into "Filters & tools"
// (the #side-col rail / utilities drawer) at any viewport.

async function seedLinks(page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  for (const [url, title] of [
    ['https://example.com/alpha', 'Alpha Unique'],
    ['https://example.com/beta', 'Beta Unique'],
  ]) {
    // the compact bar auto-collapses after each save; re-expand as needed
    const urlInput = page.locator('#save-url')
    if (!(await urlInput.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Save a link', exact: true }).click()
    }
    await page.locator('#save-url').fill(url)
    await page.locator('#save-title').fill(title)
    await page.getByRole('button', { name: 'Save link' }).click()
    await page.getByText('Link saved').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  }
  await expect(page.locator('article.card')).toHaveCount(2)
}

async function expectNoHorizontalScroll(page) {
  const noHS = await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth)
  expect(noHS).toBe(true)
}

const VIEWPORTS = [
  { name: 'Desktop', width: 1280, height: 800 },
  { name: 'Tablet', width: 768, height: 800 },
  { name: 'Mobile', width: 375, height: 667 },
]

for (const vp of VIEWPORTS) {
  test(`${vp.name} (${vp.width}px): search stays with "Saved links", not in Filters & tools`, async ({ page }) => {
    await seedLinks(page)
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.reload()

    const search = page.locator('#filter-search')
    const count = page.locator('.content-head .head-count')

    // 1. visible/accessible without opening any drawer
    await expect(search).toBeVisible()

    // 2. associated with the "Saved links" header
    await expect(page.locator('.content-head #filter-search')).toHaveCount(1)
    await expect(page.locator('h2', { hasText: 'Saved links' })).toBeVisible()

    // 3. NOT inside Filters & tools (#side-col rail / utilities drawer)
    await expect(page.locator('#side-col #filter-search')).toHaveCount(0)

    // 4. also verified while the utilities drawer is open (tablet/mobile)
    if (vp.width < 1200) {
      await page.getByRole('button', { name: 'Toggle filters and tools' }).click()
      await expect(page.getByRole('button', { name: 'Export Backup' })).toBeInViewport()
      await expect(page.locator('#side-col #filter-search')).toHaveCount(0)
      await expect(search).toBeVisible() // still visible next to "Saved links" with the drawer open
      await page.keyboard.press('Escape')
    }

    // 5. still performs its existing function
    await search.fill('Alpha')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Alpha Unique')
    if (vp.width < 640) await expect(count).toHaveText('1 link')
    await search.fill('nonexistent123')
    await expect(page.getByText('No results')).toBeVisible()
    if (vp.width < 640) await expect(count).toHaveText('0 links')
    await search.fill('')
    await expect(page.locator('article.card')).toHaveCount(2)
    if (vp.width < 640) await expect(count).toHaveText('2 links')

    // 6. no total/shown counter in the header
    await expect(page.locator('.content-head').getByText(/shown/)).toHaveCount(0)

    // 7. filtered count: hidden on desktop/tablet, right-aligned beside
    //    "Saved links" on mobile only, driven by the existing filteredLinks
    if (vp.width < 640) {
      await expect(count).toBeVisible()
      await expect(count).toHaveText('2 links') // filteredLinks.length after seeding
      const countBox = await count.boundingBox()
      const titleBox0 = await page.locator('.content-head h2').boundingBox()
      const headBox = await page.locator('.content-head').boundingBox()
      expect(Math.abs(countBox.y - titleBox0.y)).toBeLessThanOrEqual(4) // same row as the heading
      expect(countBox.x).toBeGreaterThanOrEqual(titleBox0.x + titleBox0.width) // after the heading
      expect(headBox.x + headBox.width - (countBox.x + countBox.width)).toBeLessThanOrEqual(4) // right-aligned
    } else {
      await expect(count).toBeHidden()
    }

    // 8. All status sits in the header, grouped with Search, default is "All status"
    const status = page.locator('#filter-status')
    await expect(page.locator('.content-head #filter-status')).toHaveCount(1)
    await expect(status).toBeVisible()
    await expect(status).toHaveValue('')
    const searchBox = await search.boundingBox()
    const statusBox = await status.boundingBox()
    if (vp.width < 640) {
      // stacked: All status on its own row below the full-width Search
      expect(statusBox.y).toBeGreaterThanOrEqual(searchBox.y + searchBox.height - 1)
      expect(statusBox.width).toBeGreaterThanOrEqual(150)
    } else {
      // same row as Search, immediately to its right (12px gap)
      const sameRow = statusBox.y < searchBox.y + searchBox.height && searchBox.y < statusBox.y + statusBox.height
      expect(sameRow).toBe(true)
      expect(statusBox.x).toBeGreaterThanOrEqual(searchBox.x + searchBox.width)
    }

    // 9. NOT inside Filters & tools (#side-col rail / utilities drawer)
    await expect(page.locator('#side-col #filter-status')).toHaveCount(0)

    // 10. status filtering still works and All status stays the default/all option
    await page.locator('article.card', { hasText: 'Alpha Unique' }).getByRole('button', { name: 'Toggle Important' }).click()
    await status.selectOption('important')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Alpha Unique')
    if (vp.width < 640) await expect(count).toHaveText('1 link')
    await status.selectOption('')
    await expect(page.locator('article.card')).toHaveCount(2)
    if (vp.width < 640) await expect(count).toHaveText('2 links')

    // 11. no "All categories" control was introduced in the header
    await expect(page.locator('.content-head option', { hasText: 'All categories' })).toHaveCount(0)

    // 12. no horizontal overflow
    await expectNoHorizontalScroll(page)

    // 13. no overlap/clipping: the search box fits inside the viewport and
    //     does not intersect the "Saved links" heading
    const box = await search.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
    const titleBox = await page.locator('.content-head h2').boundingBox()
    const overlap = !(
      box.x + box.width <= titleBox.x ||
      titleBox.x + titleBox.width <= box.x ||
      box.y + box.height <= titleBox.y ||
      titleBox.y + titleBox.height <= box.y
    )
    expect(overlap).toBe(false)
  })
}