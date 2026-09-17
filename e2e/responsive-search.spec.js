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
  test(`${vp.name} (${vp.width}px): search filters the visible links; toolbar status filter`, async ({ page }) => {
    await seedLinks(page)
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.reload()

    const search = page.getByLabel('Search links')
    const searchToggle = page.locator('.navbar-search-toggle')
    const status = page.locator('#filter-status')
    const subtitle = page.locator('.page-subtitle')

    // The toolbar (sort/filter) sits behind its disclosure on the mobile shell.
    const revealToolbar = async () => {
      const disclosure = page
        .getByRole('button', { name: /sort\s*(&|and)?\s*filter/i })
        .or(page.locator('.toolbar-controls button[aria-expanded]'))
        .first()
      if (await disclosure.isVisible().catch(() => false)) {
        if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
      }
    }

    // 1. Search is reachable at this width: always visible on tablet/desktop,
    //    revealed by its current affordance on the mobile shell.
    if (!(await search.isVisible().catch(() => false))) {
      await expect(searchToggle).toHaveAttribute('aria-expanded', 'false')
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await expect(searchToggle).toHaveAttribute('aria-expanded', 'true')
    }
    await expect(search).toBeVisible()

    // 2. Search works and the subtitle updates (filtered count)
    await search.fill('Alpha')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Alpha Unique')
    await expect(subtitle).toContainText('1 of 2 links shown')

    await search.fill('Unique')
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expect(subtitle).toContainText('2 of 2 links shown')

    await search.fill('nonexistent123')
    await expect(visibleLinkRows(page)).toHaveCount(0)
    await expect(page.getByText('No results')).toBeVisible()
    await expect(subtitle).toContainText('0 of 2 links shown')

    await search.fill('')
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expect(subtitle).toContainText('2 of 2 links shown')

    // 3. The toolbar status filter narrows the visible links
    await linkRowByTitle(page, 'Alpha Unique').getByRole('button', { name: 'Toggle Favorite' }).click()
    await revealToolbar()
    await status.selectOption('favorite')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Alpha Unique')
    await expect(subtitle).toContainText('1 of 2 links shown')

    await status.selectOption('')
    await expect(visibleLinkRows(page)).toHaveCount(2)

    // 4. No horizontal overflow
    await expectNoHorizontalScroll(page)

    // 5. Search box fits the viewport and never overlaps the heading
    const box = await search.boundingBox()
    if (!box) return // collapsible shell: mobile field geometry is covered by mobile-search
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
