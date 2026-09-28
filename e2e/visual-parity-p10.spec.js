// P10 — Option D: at >=1024 the filter toolbar is one horizontally scrollable
// row (mockup filterbar behaviour). Covers the single-row contract, the scroll
// reachability of the off-screen controls, the real filter pipeline and the
// untouched <=768 disclosure.
import { test, expect } from '@playwright/test'
import { clearStorage, saveLink, visibleLinkRows, expectNoHorizontalScroll } from './helpers.js'

async function seed(page, count = 3) {
  for (let i = 0; i < count; i++) {
    await saveLink(page, { url: `https://example.com/p10-${i}`, title: `P10 Link ${i}` })
  }
}

const toolbarMetrics = (page) => page.evaluate(() => {
  const head = document.querySelector('.content-head')
  const visible = [...head.children].filter((c) => c.getBoundingClientRect().width > 0)
  const rows = new Set(visible.map((c) => Math.round(c.getBoundingClientRect().top))).size
  const controls = document.querySelector('.toolbar-controls')
  const r = controls.getBoundingClientRect()
  return {
    rows,
    headH: Math.round(head.getBoundingClientRect().height),
    clientW: Math.round(controls.clientWidth),
    scrollW: Math.round(controls.scrollWidth),
    box: { left: Math.round(r.left), right: Math.round(r.right) },
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
})

test.describe('P10 — desktop filter toolbar', () => {
  test('single row at >=1024; scrolls at 1024/1100; no page overflow (light + dark)', async ({ page }) => {
    for (const width of [1024, 1100, 1200, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await clearStorage(page)
      await seed(page)
      for (const dark of [false, true]) {
        await page.evaluate((d) => {
          if (d) document.documentElement.setAttribute('data-appearance', 'dark')
          else document.documentElement.removeAttribute('data-appearance')
        }, dark)
        await page.waitForTimeout(80)
        const m = await toolbarMetrics(page)
        const where = `@${width}${dark ? ' dark' : ''}`
        expect(m.rows, `${where} toolbar rows`).toBe(1)
        expect(m.overflowX, `${where} page overflow`).toBe(false)
        // P10: the row scrolls whenever the controls exceed the available
        // width (1024/1100 by a wide margin; nearly all visible at 1440).
        expect(m.scrollW, `${where} never compressed`).toBeGreaterThanOrEqual(m.clientW)
        if (width <= 1100) expect(m.scrollW, `${where} scrollable`).toBeGreaterThan(m.clientW)
        if (width === 1440) expect(m.scrollW - m.clientW, `${where} nearly all visible`).toBeLessThanOrEqual(80)
      }
      await page.evaluate(() => document.documentElement.removeAttribute('data-appearance'))
    }
    await expectNoHorizontalScroll(page)
  })

  test('off-screen controls are reachable by focus/scroll and the real filter pipeline works', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await clearStorage(page)
    await seed(page)

    // one real favorite so the status filter has a target
    await visibleLinkRows(page).first().getByRole('button', { name: 'Toggle Favorite' }).click()

    // The last control starts off-screen; focusing it scrolls it into view.
    const exportBtn = page.locator('.toolbar-export')
    const { box } = await toolbarMetrics(page)
    const before = await exportBtn.boundingBox()
    expect(before.x + before.width, 'export starts off-screen @1024').toBeGreaterThan(box.right)
    await exportBtn.focus()
    const after = await exportBtn.boundingBox()
    expect(after.x, 'focused control scrolled into view').toBeGreaterThanOrEqual(box.left - 1)
    expect(after.x + after.width).toBeLessThanOrEqual(box.right + 1)

    // Scrolling the row by hand reaches the far end as well.
    await page.evaluate(() => { const c = document.querySelector('.toolbar-controls'); c.scrollLeft = c.scrollWidth })
    const pinned = page.locator('.pinned-toggle')
    const pinnedBox = await pinned.boundingBox()
    expect(pinnedBox.x + pinnedBox.width).toBeLessThanOrEqual(box.right + 1)

    // Real filters still run through the scrollable toolbar.
    await page.locator('#filter-status').selectOption('favorite')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await page.locator('#filter-status').selectOption('')
    await expect(visibleLinkRows(page)).toHaveCount(3)
  })

  test('the <=768 filter disclosure is untouched', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await clearStorage(page)
    await seed(page)

    const trigger = page.getByRole('button', { name: 'Sort & Filter', exact: true })
    const panel = page.locator('#sort-filter-panel')
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(panel).toBeHidden()

    await trigger.click()
    await expect(panel).toBeVisible()
    // the real sort control inside the disclosure still drives the list
    await page.locator('#filter-sort').selectOption('title-az')
    await expect(visibleLinkRows(page).first()).toContainText('P10 Link 0')
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(trigger).toBeFocused()
    await expectNoHorizontalScroll(page)
  })
})
