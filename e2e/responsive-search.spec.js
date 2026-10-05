import { test, expect } from '@playwright/test'
import { clearStorage, linkRowByTitle, saveLink, visibleLinkRows, expectNoHorizontalScroll } from './helpers.js'

async function seedLinks(page) {
  await clearStorage(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Unique' })
  await saveLink(page, { url: 'https://example.com/beta', title: 'Beta Unique' })
  await expect(visibleLinkRows(page)).toHaveCount(2)
}

const VIEWPORTS = [
  { name: 'Desktop', width: 1280, height: 800 },
  { name: 'Tablet', width: 768, height: 800 },
  { name: 'Mobile', width: 375, height: 667 },
]

for (const vp of VIEWPORTS) {
  test(`${vp.name} (${vp.width}px): search filters the visible links; the filter bar narrows too`, async ({ page }) => {
    await seedLinks(page)
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.reload()

    const search = page.getByLabel('Search links')
    // P15.10: the one truthful count lives in the results bar (the header no
    // longer repeats it, and the sort/filter disclosure is gone).
    const count = page.locator('.library-results-count')

    // 1. P15 Group 2: the field is inline and reachable at every width.
    await expect(search).toBeVisible()

    // 2. Search works and the result count stays truthful (matching of all)
    await search.fill('Alpha')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Alpha Unique')
    await expect(count).toHaveText('1 of 2 links')

    await search.fill('Unique')
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expect(count).toHaveText('2 links')

    await search.fill('nonexistent123')
    await expect(visibleLinkRows(page)).toHaveCount(0)
    await expect(page.getByText('No results')).toBeVisible()
    await expect(count).toHaveText('0 of 2 links')

    await search.fill('')
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expect(count).toHaveText('2 links')

    // 3. The filter bar's pinned toggle narrows the visible links
    await linkRowByTitle(page, 'Alpha Unique').getByRole('button', { name: 'Toggle Pin' }).click()
    await page.getByRole('button', { name: 'Show pinned links only' }).click()
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Alpha Unique')
    await expect(count).toHaveText('1 of 2 links')

    await page.getByRole('button', { name: 'Show pinned links only' }).click()
    await expect(visibleLinkRows(page)).toHaveCount(2)

    // 4. No horizontal overflow
    await expectNoHorizontalScroll(page)

    // 5. Search box fits the viewport and never overlaps the heading
    const box = await search.boundingBox()
    if (!box) return // defensive guard; inline geometry is covered by mobile-search
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
    const titleBox = await page.locator('.page-title').boundingBox()
    if (!titleBox) return // mobile shell: no page heading beside the field
    const overlap = !(
      box.x + box.width <= titleBox.x ||
      titleBox.x + titleBox.width <= box.x ||
      box.y + box.height <= titleBox.y ||
      titleBox.y + titleBox.height <= box.y
    )
    expect(overlap).toBe(false)
  })
}
