// P15.11 — Card/List/Compact exact mockup alignment: banner controls, card body
// order, row geometry/metadata, compact density, responsive grid spacing, and
// the click/interaction contract.
import { test, expect } from '@playwright/test'
import { clearStorage, ensureCardView, expectNoHorizontalScroll, saveLink, visibleLinkRows } from './helpers.js'

const row = (page) => page.locator('.row-list > .link-row').first()
const card = (page) => page.locator('.grid > .card').first()

async function seedLink(page, overrides = {}) {
  await page.goto('/')
  await saveLink(page, {
    url: 'https://example.com/item-open',
    title: 'Item Open',
    description: 'A real description that spans enough words to exercise the two-line clamp on the card surface.',
    tags: 'react, css, design, systems',
    ...overrides,
  })
}

test.describe('P15.11 — card structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('banner carries the selection box and the action cluster; body follows the mockup order', async ({ page }) => {
    await seedLink(page)
    await ensureCardView(page)
    await page.waitForTimeout(300) // let the card's rise-in animation settle
    const theCard = card(page)

    // banner: selection box top-left + favourite/pin/menu cluster top-right
    const banner = theCard.locator('.thumb-wrap')
    await expect(banner).toBeVisible()
    await expect(banner.locator('.card-check input')).toHaveCount(1)
    await expect(banner.locator('.banner-actions')).toBeVisible()
    expect(await banner.locator('.banner-actions button').count()).toBe(3)
    const checkBox = await banner.locator('.card-check').boundingBox()
    const cardBox = await theCard.boundingBox()
    // 8px from the banner edge (the card's 1px border sits outside it)
    expect(Math.round(checkBox.x - cardBox.x)).toBe(9)
    expect(Math.round(checkBox.y - cardBox.y)).toBe(9)
    const starBox = await banner.getByRole('button', { name: 'Toggle Favorite' }).boundingBox()
    expect(Math.round(starBox.width)).toBe(30)
    expect(Math.round(starBox.height)).toBe(30)

    // body order + real content
    const order = await theCard.locator('.body > *').evaluateAll((els) => els.map((el) => el.className.split(' ')[0]))
    expect(order).toEqual(['card-domain', 'title', 'desc', 'card-foot'])
    await expect(theCard.locator('.card-domain-text')).toHaveText('example.com')
    await expect(theCard.locator('.title')).toHaveText('Item Open')
    await expect(theCard.locator('.desc')).toContainText('A real description')

    // footer: tags left, real saved date right
    const foot = theCard.locator('.card-foot')
    await expect(foot.locator('.tag').first()).toHaveText('#react')
    const footBox = await foot.boundingBox()
    const dateBox = await theCard.locator('.card-date').boundingBox()
    expect(Math.abs((dateBox.x + dateBox.width) - (footBox.x + footBox.width))).toBeLessThanOrEqual(1)
    expect(await foot.locator('time[datetime]').first().getAttribute('datetime')).toBeTruthy()

    // banner glyph geometry (mockup 40px above 560 with a light stroke)
    const glyph = await banner.locator('.thumb-glyph').evaluate((el) => ({
      w: Math.round(el.getBoundingClientRect().width),
      stroke: getComputedStyle(el).strokeWidth,
      opacity: getComputedStyle(el).opacity,
    }))
    expect(glyph.w).toBe(40)
    expect(glyph.stroke).toBe('1.5px')
    expect(Number(glyph.opacity)).toBeCloseTo(0.85, 2)
  })

  test('uniform card heights with and without a description; responsive grid spacing', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/with-desc', title: 'With Desc', description: 'A description long enough to fill both clamped lines on the card surface.' })
    await saveLink(page, { url: 'https://example.com/without-desc', title: 'Without Desc' })
    await saveLink(page, { url: 'https://example.com/second-no-desc', title: 'Second No Desc' })
    await ensureCardView(page)

    const heights = await page.locator('.grid > .card').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)))
    expect(new Set(heights).size).toBe(1)

    // mockup spacing steps: gap 12/14, padding 12/14/16 + bottom breathing room
    const gridAt = (w) => page.setViewportSize({ width: w, height: 900 }).then(() => page.locator('.grid').evaluate((el) => {
      const cs = getComputedStyle(el)
      return { gap: cs.gap, padTop: cs.paddingTop, padLeft: cs.paddingLeft, padBottom: cs.paddingBottom }
    }))
    await page.setViewportSize({ width: 320, height: 900 })
    expect(await gridAt(320)).toEqual({ gap: '12px', padTop: '12px', padLeft: '12px', padBottom: '80px' })
    expect(await gridAt(560)).toEqual({ gap: '14px', padTop: '14px', padLeft: '14px', padBottom: '80px' })
    expect(await gridAt(1024)).toEqual({ gap: '14px', padTop: '16px', padLeft: '16px', padBottom: '40px' })
    // the list reserves the same breathing room
    await page.locator('.view-btn').filter({ hasText: 'List' }).click()
    expect(await page.locator('.row-list').evaluate((el) => getComputedStyle(el).paddingBottom)).toBe('40px')
    await page.setViewportSize({ width: 375, height: 900 })
    expect(await page.locator('.row-list').evaluate((el) => getComputedStyle(el).paddingBottom)).toBe('80px')
  })
})

test.describe('P15.11 — list/compact row geometry', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('row metadata is domain · date + at most two tags, with no separator or dark hover', async ({ page }) => {
    await seedLink(page)
    // the meta line is the List presentation (compact shows the domain column)
    await page.locator('.view-btn').filter({ hasText: 'List' }).click()
    const theRow = row(page)

    const meta = theRow.locator('.row-meta')
    await expect(meta.locator('.row-domain')).toHaveText('example.com')
    await expect(meta.locator('.row-dot')).toHaveText('·')
    await expect(meta.locator('time[datetime]')).toHaveCount(1)
    // exactly two of the four real tags are surfaced on the row
    await expect(meta.locator('.row-tag')).toHaveCount(2)
    await expect(meta.locator('.row-tag').first()).toHaveText('#react')

    // no per-row separator (mockup)
    expect(await theRow.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('0px')
    // hover lifts to the surface colour, never the darker inset tint
    const surface = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.background = 'var(--card)'
      document.body.appendChild(probe)
      const out = getComputedStyle(probe).backgroundColor
      probe.remove()
      return out
    })
    await theRow.hover()
    await expect(theRow).toHaveCSS('background-color', surface)
  })

  test('compact keeps the 24px favicon and the same action recipe', async ({ page }) => {
    await seedLink(page)
    await page.waitForTimeout(300) // let the row's entry settle
    const compact = row(page) // the library boots in Compact
    expect(await compact.evaluate((el) => el.classList.contains('compact'))).toBe(true)
    expect(await compact.locator('.row-favicon').evaluate((el) => getComputedStyle(el).width)).toBe('24px')
    // compact renders the domain column instead of the meta line
    await expect(compact.locator('.row-meta')).toHaveCount(0)
    await expect(compact.locator('.row-domain-inline')).toBeVisible()
    // same quiet action recipe as List (no tiny compact-only buttons)
    for (const name of ['Toggle Favorite', 'Toggle Pin', 'More actions']) {
      const box = await compact.getByRole('button', { name }).boundingBox()
      expect(Math.round(box.width), name).toBe(26)
      expect(Math.round(box.height), name).toBe(26)
    }
  })
})

test.describe('P15.11 — click/interaction contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('controls act without opening the detail; the body opens it; Open opens the site', async ({ page }) => {
    await seedLink(page)
    await ensureCardView(page)
    const theCard = card(page)

    // favourite + checkbox are explicit controls
    await theCard.getByRole('button', { name: 'Toggle Favorite' }).click()
    await expect(theCard.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.detail-title')).toHaveCount(0)
    const check = theCard.locator('.card-check input')
    await check.check()
    await expect(check).toBeChecked()
    await expect(page.locator('.detail-title')).toHaveCount(0)
    await check.uncheck()

    // keyboard focus stays visible on the painted box (focus-visible needs a
    // real keyboard entry, so step away and back)
    await check.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(check).toBeFocused()
    expect(await theCard.locator('.card-check .item-check-box').evaluate((el) => getComputedStyle(el).outlineWidth)).toBe('2px')

    // ⋮ actions never open the detail; Open opens the external URL
    await theCard.getByRole('button', { name: 'More actions' }).click()
    await expect(page.locator('.detail-title')).toHaveCount(0)
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.locator('.more-menu').getByRole('link', { name: 'Open' }).click(),
    ])
    expect(popup.url()).toContain('example.com/item-open')
    await popup.close()
    await expect(page.locator('.detail-title')).toHaveCount(0)

    // the card body opens the detail panel
    await theCard.locator('.card-domain').click()
    await expect(page.locator('.detail-title')).toHaveText('Item Open')
    await page.keyboard.press('Escape')
    await expect(page.locator('.detail-title')).toHaveCount(0)

    // the same contract in List/Compact
    for (const label of ['List', 'Compact']) {
      await page.locator('.view-btn').filter({ hasText: label }).click()
      const theRow = row(page)
      await theRow.getByRole('button', { name: 'Toggle Pin' }).click()
      await expect(page.locator('.detail-title')).toHaveCount(0)
      await theRow.getByRole('button', { name: 'More actions' }).click()
      await expect(page.locator('.detail-title')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await theRow.locator('.row-main').click()
      await expect(page.locator('.detail-title')).toHaveText('Item Open')
      await page.keyboard.press('Escape')
      await expect(page.locator('.detail-title')).toHaveCount(0)
    }
  })

  test('the library holds at 320/375/560/768/1024/1280 without overflow', async ({ page }) => {
    for (const width of [320, 375, 560, 768, 1024, 1280]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await saveLink(page, { url: `https://example.com/p1511-${width}`, title: `P1511 ${width}`, description: 'A description that is long enough to wrap without ever causing horizontal overflow on the surface.' })
      await expect(visibleLinkRows(page).first()).toBeVisible()
      await expectNoHorizontalScroll(page)
      await ensureCardView(page)
      const glyph = await page.locator('.grid > .card .thumb-glyph').first().evaluate((el) => Math.round(el.getBoundingClientRect().width))
      expect(glyph, `glyph @${width}`).toBe(width >= 560 ? 40 : 34)
      await expectNoHorizontalScroll(page)
    }
  })
})
