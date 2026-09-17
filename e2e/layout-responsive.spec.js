import { test, expect } from '@playwright/test'
import { clearStorage, saveLink } from './helpers.js'

const WIDTHS = [1440, 1280, 1200, 1100, 1024, 900, 768, 640, 480, 430, 390, 375, 320]

async function setupLinks(page) {
  await clearStorage(page)
  for (let i = 0; i < 8; i++) {
    await saveLink(page, {
      url: `https://example.com/link-${i}`,
      title: `Sample Link ${i}`,
      description: 'A short description for this saved link.',
      tags: 'demo, test',
      category: i % 2 === 0 ? 'Other' : 'GitHub',
      expectToast: false,
    })
  }
}

async function setViewMode(page, mode) {
  const labels = { card: 'Card', list: 'List', compact: 'Compact' }
  const btn = page.locator('.view-btn').filter({ hasText: labels[mode] })
  await btn.click()
  await expect(btn).toHaveClass(/active/)
}

async function countGridColumns(page, selector) {
  const items = await page.locator(selector).all()
  if (items.length < 2) return 1
  const boxes = []
  for (const item of items) {
    const box = await item.boundingBox()
    if (box) boxes.push(box)
  }
  if (boxes.length < 2) return 1
  // Items in the same row share approximately the same y.
  // Count distinct x positions in the first row.
  const firstRowY = boxes[0].y
  const firstRow = boxes.filter(b => Math.abs(b.y - firstRowY) < 10)
  const xs = [...new Set(firstRow.map(b => Math.round(b.x)))]
  return xs.length
}

async function hasHorizontalOverflow(page) {
  return page.evaluate(() => {
    const html = document.documentElement
    return html.scrollWidth > html.clientWidth
  })
}

async function cardControlsInsideCard(page) {
  const cards = await page.locator('.grid > .card').all()
  for (const card of cards.slice(0, 3)) {
    const cardBox = await card.boundingBox()
    const actions = await card.locator('.actions').all()
    for (const action of actions) {
      const box = await action.boundingBox()
      if (!box || !cardBox) return false
      if (box.right > cardBox.right + 1 || box.left < cardBox.left - 1) return false
    }
  }
  return true
}

test.describe('Link view responsive layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('Card view columns at breakpoints', async ({ page }) => {
    await setupLinks(page)
    await setViewMode(page, 'card')

    const expected = {
      1440: 4, 1280: 4, 1200: 3, 1100: 2, 1024: 2, 900: 2, 768: 2,
      640: 1, 480: 1, 430: 1, 390: 1, 375: 1, 320: 1,
    }

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(150)
      const cols = await countGridColumns(page, '.grid > .card')
      expect(cols, `Card columns at ${width}px`).toBe(expected[width])
      expect(await hasHorizontalOverflow(page), `horizontal overflow at ${width}px`).toBe(false)
      expect(await cardControlsInsideCard(page), `card controls overflow at ${width}px`).toBe(true)
    }
  })

  test('List view columns at breakpoints', async ({ page }) => {
    await setupLinks(page)
    await setViewMode(page, 'list')

    const expected = {
      1440: 2, 1280: 2, 1200: 2, 1100: 2, 1024: 1, 900: 1, 768: 1,
      640: 1, 480: 1, 430: 1, 390: 1, 375: 1, 320: 1,
    }

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(150)
      const cols = await countGridColumns(page, '.row-list > .link-row')
      expect(cols, `List columns at ${width}px`).toBe(expected[width])
      expect(await hasHorizontalOverflow(page), `horizontal overflow at ${width}px`).toBe(false)
    }
  })

  test('Compact view columns at breakpoints', async ({ page }) => {
    await setupLinks(page)
    await setViewMode(page, 'compact')

    const expected = {
      1440: 2, 1280: 2, 1200: 2, 1100: 2, 1024: 1, 900: 1, 768: 1,
      640: 1, 480: 1, 430: 1, 390: 1, 375: 1, 320: 1,
    }

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(150)
      const cols = await countGridColumns(page, '.row-list > .link-row')
      expect(cols, `Compact columns at ${width}px`).toBe(expected[width])
      expect(await hasHorizontalOverflow(page), `horizontal overflow at ${width}px`).toBe(false)
    }
  })

  test('Toolbar wraps without viewport overflow at mobile widths', async ({ page }) => {
    await setupLinks(page)
    for (const width of [390, 375, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(150)
      expect(await hasHorizontalOverflow(page), `toolbar overflow at ${width}px`).toBe(false)
      const toolbar = page.locator('.content-head')
      await expect(toolbar).toBeVisible()
    }
  })
})
