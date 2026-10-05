// P15.10 — the filter bar is one horizontally scrollable chip row at every
// width (mockup .filterbar): real filter dimensions, the pinned toggle, the
// contextual clearable chips and the truthful result count below it.
import { test, expect } from '@playwright/test'
import { clearStorage, saveLink, visibleLinkRows, expectNoHorizontalScroll } from './helpers.js'

async function seed(page, count = 3) {
  for (let i = 0; i < count; i++) {
    await saveLink(page, { url: `https://example.com/p10-${i}`, title: `P10 Link ${i}` })
  }
}

const metrics = (page) => page.evaluate(() => {
  const head = document.querySelector('.content-head')
  const visibleHead = [...head.children].filter((c) => c.getBoundingClientRect().width > 0)
  const rows = new Set(visibleHead.map((c) => Math.round(c.getBoundingClientRect().top))).size
  const bar = document.querySelector('.filterbar')
  const r = bar.getBoundingClientRect()
  return {
    rows,
    barBox: { left: Math.round(r.left), right: Math.round(r.right) },
    clientW: Math.round(bar.clientWidth),
    scrollW: Math.round(bar.scrollWidth),
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
})

test.describe('P15.10 — filter bar', () => {
  test('one toolbar row + one scrollable chip row at >=1200; no page overflow (light + dark)', async ({ page }) => {
    // The Library Controls toolbar band is a desktop-grid (>=1200) contract;
    // below 1200 the filter bar is the workspace top and the FAB owns Add.
    for (const width of [1200, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await clearStorage(page)
      await seed(page)
      for (const dark of [false, true]) {
        await page.evaluate((d) => {
          if (d) document.documentElement.setAttribute('data-appearance', 'dark')
          else document.documentElement.removeAttribute('data-appearance')
        }, dark)
        await page.waitForTimeout(80)
        const m = await metrics(page)
        const where = `@${width}${dark ? ' dark' : ''}`
        expect(m.rows, `${where} toolbar rows`).toBe(1)
        expect(m.overflowX, `${where} page overflow`).toBe(false)
        // the chip row never compresses its chips; it scrolls when needed
        expect(m.scrollW, `${where} never compressed`).toBeGreaterThanOrEqual(m.clientW)
      }
      await page.evaluate(() => document.documentElement.removeAttribute('data-appearance'))
    }
    await expectNoHorizontalScroll(page)
  })

  test('every chip is reachable and the real filter pipeline works', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await clearStorage(page)
    await seed(page)

    // Scroll the chip row to its far end and reach the last control.
    await page.evaluate(() => { const c = document.querySelector('.filterbar'); c.scrollLeft = c.scrollWidth })
    const { barBox } = await metrics(page)
    const last = page.locator('.filterbar .chip').last()
    const lastBox = await last.boundingBox()
    expect(lastBox.x).toBeLessThanOrEqual(barBox.right + 1)

    // the dimension chips are all present and usable
    for (const name of ['Filter by date', 'Filter by category', 'Filter by type']) {
      await expect(page.getByRole('combobox', { name })).toBeAttached()
    }
    await page.locator('#filter-type').selectOption('video')
    await expect(visibleLinkRows(page)).toHaveCount(0)
    await page.locator('#filter-type').selectOption('')
    await expect(visibleLinkRows(page)).toHaveCount(3)

    // the pinned toggle is a real chip with the shared language
    const pinned = page.getByRole('button', { name: 'Show pinned links only' })
    await pinned.click()
    await expect(pinned).toHaveAttribute('aria-pressed', 'true')
    await expect(visibleLinkRows(page)).toHaveCount(0)
    await pinned.click()
    await expect(visibleLinkRows(page)).toHaveCount(3)
  })

  test('the chip row scrolls on mobile and no disclosure is needed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await clearStorage(page)
    await seed(page)

    // No sort control / disclosure trigger remains.
    await expect(page.locator('#filter-sort')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /sort\s*(&|and)?\s*filter/i })).toHaveCount(0)

    const m = await metrics(page)
    expect(m.scrollW).toBeGreaterThan(m.clientW) // the row scrolls
    await page.locator('#filter-type').selectOption('video')
    await expect(visibleLinkRows(page)).toHaveCount(0)
    await page.locator('#filter-type').selectOption('')
    await expect(visibleLinkRows(page)).toHaveCount(3)
    await expectNoHorizontalScroll(page)
  })
})
