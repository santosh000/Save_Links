import { test, expect } from '@playwright/test'

// Folder rename edit mode must never crush the name input. The input keeps a
// usable width at every viewport; Save/Cancel wrap to their own row instead of
// squeezing beside it. No overlapping, no horizontal overflow, no wrapping.

const LONG_NAME = 'youtube-documentation-videos-archive-2026'

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

async function openNavDrawerIfNarrow(page, width) {
  if (width < 1200) {
    await page.getByRole('button', { name: 'Toggle folders navigation' }).click()
    await expect(page.getByRole('button', { name: 'All links' })).toBeInViewport()
  }
}

const VIEWPORTS = [
  { name: 'Desktop', width: 1280, height: 800 },
  { name: 'Tablet', width: 768, height: 800 },
  { name: 'Mobile', width: 375, height: 667 },
]

for (const vp of VIEWPORTS) {
  test(`${vp.name} (${vp.width}px): folder rename input stays usable, buttons never crush it`, async ({ page }) => {
    await clearStorage(page)
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/')
    await openNavDrawerIfNarrow(page, vp.width)

    await page.getByLabel('New folder name').fill(LONG_NAME)
    await page.getByRole('button', { name: 'Create folder', exact: true }).click()
    await expect(page.locator('.folder-item', { hasText: LONG_NAME })).toBeVisible()

    await page.getByRole('button', { name: `Rename folder ${LONG_NAME}` }).click()

    const input = page.getByLabel(`Rename folder ${LONG_NAME}`)
    await expect(input).toBeVisible()
    await input.fill(LONG_NAME)

    const ib = await input.boundingBox()
    expect(ib.width).toBeGreaterThanOrEqual(100) // usable input, never a sliver
    expect(ib.height).toBeLessThanOrEqual(40) // single line, no character wrapping

    const save = page.getByRole('button', { name: 'Save folder name' })
    const cancel = page.getByRole('button', { name: 'Cancel rename' })
    for (const btn of [save, cancel]) {
      await expect(btn).toBeVisible()
      const bb = await btn.boundingBox()
      expect(bb.height).toBeGreaterThanOrEqual(26) // touch target stays usable
      const overlap = !(
        bb.x + bb.width <= ib.x || ib.x + ib.width <= bb.x ||
        bb.y + bb.height <= ib.y || ib.y + ib.height <= bb.y
      )
      expect(overlap).toBe(false) // buttons never overlap the input
    }

    // no horizontal overflow — page and (on narrow screens) the nav drawer
    const noPageH = await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth)
    expect(noPageH).toBe(true)
    if (vp.width < 1200) {
      const noDrawerH = await page.locator('#nav-col').evaluate((el) => el.scrollWidth <= el.clientWidth)
      expect(noDrawerH).toBe(true)
    }

    // Cancel exits edit mode and restores the normal row
    await cancel.click()
    await expect(page.getByRole('button', { name: `Rename folder ${LONG_NAME}` })).toBeVisible()
  })
}