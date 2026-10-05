// P15.10 — item surfaces (Card/List/Compact), the chip filter bar with the
// Date presets + custom range, the truthful result count, the Settings panel
// surface and the shared overlay/backdrop tokens.
import { test, expect } from '@playwright/test'
import {
  clearStorage, createFolder, ensureCardView, expectNoHorizontalScroll, linkRowByTitle,
  openView, saveLink, selectColorScheme, visibleLinkRows,
} from './helpers.js'

const row = (page, title) => page.locator('.row-list > .link-row').filter({ hasText: title }).first()
const card = (page, title) => page.locator('.grid > .card').filter({ hasText: title }).first()
const dstr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Seed links at known local days-ago offsets (Today/Yesterday/…) via the real
// on-device database, so the Date presets and the custom range are testable.
async function seedDated(page) {
  await page.goto('/')
  await page.locator('.page-title').waitFor()
  const now = new Date()
  const iso = (daysAgo, hour = 12) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, 0, 0).toISOString()
  const records = [
    ['Today', iso(0)],
    ['Yesterday', iso(1)],
    ['Two Days', iso(2)],
    ['Ten Days', iso(9)],
    ['Old Link', iso(120)],
  ].map(([title, createdAt], i) => ({
    id: `p1510-${i}`,
    originalUrl: `https://example.com/p1510-${i}`, normalizedUrl: `https://example.com/p1510-${i}`,
    url: `https://example.com/p1510-${i}`, domain: 'example.com',
    title, description: '', image: '', category: 'Other', tags: [],
    important: false, mustHave: false, favorite: false, pinned: false,
    type: 'article', folderId: null, status: null, createdAt, savedFrom: 'Unknown',
  }))
  await page.evaluate(async (rows) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('save_links:test')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('links', 'readwrite')
      const store = tx.objectStore('links')
      store.clear()
      for (const r of rows) store.put(r)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('seed aborted'))
    })
    db.close()
  }, records)
  await page.goto('/')
  await ensureCardView(page)
  await expect(page.locator('.grid > .card').first()).toBeVisible()
}

test.describe('P15.10 — item surfaces open the detail panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('Card/List/Compact bodies open the detail panel and never navigate away', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/item-click', title: 'Item Click' })
    let popup = false
    page.on('popup', () => { popup = true })

    // Compact (default): the row body is not an external link any more
    const compactRow = row(page, 'Item Click')
    await expect(compactRow.locator('a.row-main')).toHaveCount(0)
    await compactRow.locator('.row-main').click()
    await expect(page.locator('.detail-title')).toHaveText('Item Click')
    await page.keyboard.press('Escape')
    await expect(page.locator('.detail-title')).toHaveCount(0)

    // List
    await page.locator('.view-btn').filter({ hasText: 'List' }).click()
    const listRow = row(page, 'Item Click')
    await expect(listRow.locator('a')).toHaveCount(0)
    await listRow.locator('.row-main').click()
    await expect(page.locator('.detail-title')).toHaveText('Item Click')
    await page.keyboard.press('Escape')
    await expect(page.locator('.detail-title')).toHaveCount(0)

    // Card: the body opens the panel; the domain line is the stable click target
    await page.locator('.view-btn').filter({ hasText: 'Card' }).click()
    const theCard = card(page, 'Item Click')
    await expect(theCard.locator('a')).toHaveCount(0)
    expect(await theCard.locator('.card-domain').evaluate((el) => el.tagName)).toBe('SPAN')
    await theCard.locator('.card-domain').click()
    await expect(page.locator('.detail-title')).toHaveText('Item Click')

    expect(popup).toBe(false)
    expect(page.url()).toContain('localhost:5173')
  })

  test('explicit ⋮ actions never open the detail panel', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/item-menu', title: 'Item Menu' })
    await expect(page.locator('.detail-title')).toHaveCount(0) // nothing selected

    await row(page, 'Item Menu').getByRole('button', { name: 'More actions' }).click()
    await expect(page.locator('.more-menu')).toBeVisible()
    await expect(page.locator('.detail-title')).toHaveCount(0) // menu did not open the panel

    // an explicit menu action performs only that action
    await page.locator('.more-menu').getByRole('button', { name: 'Copy link' }).click()
    await expect(page.locator('.sl-toast')).toContainText('Link copied')
    await expect(page.locator('.detail-title')).toHaveCount(0)

    // the pin toggle is an explicit action too
    await row(page, 'Item Menu').getByRole('button', { name: 'Toggle Pin' }).click()
    await expect(page.locator('.detail-title')).toHaveCount(0)
  })
})

test.describe('P15.10 — item status + removed controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('Pin/Pin-off and Favorite have obvious, non-colour-only states', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/states', title: 'States' })
    await ensureCardView(page)
    const theCard = card(page, 'States')
    const pin = theCard.getByRole('button', { name: 'Toggle Pin' })
    const star = theCard.getByRole('button', { name: 'Toggle Favorite' })
    const hasOn = (locator) => locator.evaluate((el) => el.classList.contains('on'))

    // off
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    expect(await hasOn(pin)).toBe(false)
    // on: accent state + a filled glyph (not colour alone). The colour lands
    // through the control's transition, so assert it with the retrying matcher.
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    expect(await hasOn(pin)).toBe(true)
    const accent = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--accent)'
      document.body.appendChild(probe)
      const out = getComputedStyle(probe).color
      probe.remove()
      return out
    })
    await expect(pin).toHaveCSS('color', accent) // no longer the resting muted
    expect(await pin.evaluate((el) => getComputedStyle(el.querySelector('svg')).fill)).not.toBe('none')
    // the star uses the mockup's amber and is filled when on
    await star.click()
    await expect(star).toHaveAttribute('aria-pressed', 'true')
    const starFill = await star.evaluate((el) => getComputedStyle(el.querySelector('svg')).fill)
    expect(starFill).not.toBe('none')
    // toggle back off: the state is unmistakable in both directions
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    expect(await hasOn(pin)).toBe(false)
  })

  test('Important/Must Have/Export controls left the item surfaces in all three views', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/removed', title: 'Removed Controls' })
    for (const label of ['Compact', 'List', 'Card']) {
      await page.locator('.view-btn').filter({ hasText: label }).click()
      const item = label === 'Card' ? card(page, 'Removed Controls') : row(page, 'Removed Controls')
      await expect(item).toBeVisible()
      for (const gone of ['Toggle Important', 'Toggle Must Have']) {
        await expect(item.getByRole('button', { name: gone }), `${label}/${gone}`).toHaveCount(0)
      }
      await expect(item.getByRole('button', { name: 'Export links' })).toHaveCount(0)
      // the menu no longer carries Must Have either
      await item.getByRole('button', { name: 'More actions' }).click()
      await expect(page.locator('.more-menu').getByRole('button', { name: 'Toggle Must Have' })).toHaveCount(0)
      await page.keyboard.press('Escape')
    }
  })
})

test.describe('P15.10 — filter bar + date filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('Date presets filter by the real local calendar', async ({ page }) => {
    await seedDated(page)
    const dateChip = page.locator('#filter-date')
    const titles = async () => rowTitles(page)

    // All time (default): everything
    await expect(dateChip).toHaveValue('all')
    expect(await titles()).toHaveLength(5)

    await dateChip.selectOption('today')
    expect(await titles()).toEqual(['Today'])
    await expect(page.locator('.library-results-count')).toHaveText('1 of 5 links')

    await dateChip.selectOption('yesterday')
    expect(await titles()).toEqual(['Yesterday'])

    // This week: computed from the same Monday-based local week rule
    await dateChip.selectOption('week')
    const now = new Date()
    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
    const expectedWeek = [['Today', 0], ['Yesterday', 1], ['Two Days', 2], ['Ten Days', 9], ['Old Link', 120]]
      .filter(([, days]) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days) >= weekStart)
      .map(([t]) => t)
    expect(await titles()).toEqual(expectedWeek)

    await dateChip.selectOption('all')
    expect(await titles()).toHaveLength(5)
  })

  test('Custom From/To applies inclusively; Cancel leaves the filter unchanged', async ({ page }) => {
    await seedDated(page)
    const dateChip = page.locator('#filter-date')

    const openCustom = async () => {
      await page.locator('#filter-date').locator('xpath=following-sibling::button').click()
      // The Custom… option is always the last date option (its label shows the
      // active range once a custom filter is applied).
      await page.getByRole('option').last().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.locator('.dialog-title')).toHaveText('Custom date range')
      return dialog
    }

    // From = two days ago, To = yesterday (inclusive of both ends)
    const now = new Date()
    const twoAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2)
    const oneAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    let dialog = await openCustom()
    await dialog.getByLabel('From').fill(dstr(twoAgo))
    await dialog.getByLabel('To').fill(dstr(oneAgo))
    await dialog.getByRole('button', { name: 'Apply' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(dateChip).toHaveValue('custom')
    await expect(page.locator('.library-results-count')).toHaveText('2 of 5 links')
    expect(await rowTitles(page)).toEqual(['Yesterday', 'Two Days'])

    // The chip shows the range it applies
    await expect(page.locator('#filter-date').locator('xpath=following-sibling::button')).toContainText('–')

    // Cancel leaves the active custom range untouched
    dialog = await openCustom()
    await dialog.getByLabel('From').fill(dstr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 120)))
    await dialog.getByLabel('To').fill(dstr(now))
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.library-results-count')).toHaveText('2 of 5 links')
    expect(await rowTitles(page)).toEqual(['Yesterday', 'Two Days'])

    // Clearing through the chip menu restores the full list
    await dateChip.selectOption('all')
    expect(await rowTitles(page)).toHaveLength(5)
  })

  async function rowTitles(page) {
    // P15.11: the card body leads with its domain line, so read the title
    // element explicitly instead of the first text line.
    return page.locator('.grid > .card .title, .row-list > .link-row .row-title').evaluateAll((els) =>
      els.map((el) => (el.textContent || '').trim()))
  }
})

test.describe('P15.10 — truthful result count', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('single page, filtered and paginated counts are all truthful', async ({ page }) => {
    await seedDated(page)
    const count = page.locator('.library-results-count')

    // one page, no filter -> plain count, no pagination language
    await expect(count).toHaveText('5 links')
    // one page, filtered -> matching of all (the mockup's "X of Y")
    await page.locator('#filter-type').selectOption('video')
    await expect(count).toHaveText('0 of 5 links')
    await page.locator('#filter-type').selectOption('')
    await expect(count).toHaveText('5 links')

    // several pages -> the real visible window of the matching set
    for (let i = 5; i < 12; i++) {
      await saveLink(page, { url: `https://example.com/extra-${i}`, title: `Extra ${i}` })
    }
    await expect(count).toHaveText(/^Showing 1–10 of 12 links$/)
    await page.locator('.pagination .page-link[aria-label="Page 2"]').click()
    await expect(count).toHaveText(/^Showing 11–12 of 12 links$/)
    // filtered + paginated: still the matching window
    await page.locator('#filter-type').selectOption('video')
    await expect(count).toHaveText('0 of 12 links')
  })
})

test.describe('P15.10 — Settings panel + overlays + responsive', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('Settings is the shared wide modal on desktop and a sheet on mobile, with every capability', async ({ page }) => {
    // P15.12: Settings is a modal section (no separate page, library stays underneath).
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/settings-under', title: 'Settings Under' })
    await openView(page, 'settings')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const desktop = await dialog.evaluate((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const vw = window.innerWidth
      return {
        radius: cs.borderTopLeftRadius,
        shadow: cs.boxShadow !== 'none',
        maxWidth: cs.maxWidth,
        centered: Math.abs((r.x + r.width / 2) - vw / 2) <= 2,
      }
    })
    // Exact-reference modal geometry (P15.10 narrow-screen shell): 24px radius,
    // 900px wide — the earlier 16px/760px values are superseded.
    expect(desktop.radius).toBe('24px')
    expect(desktop.shadow).toBe(true)
    expect(desktop.maxWidth).toBe('900px') // the wide settings panel
    expect(desktop.centered).toBe(true)
    // the section nav + the general pane are inside the one modal
    await expect(dialog.getByRole('button', { name: 'General' })).toBeVisible()
    await expect(page.locator('.settings-card')).toBeVisible()

    // P15.x: the shell owns one fixed geometry — switching sections must not
    // resize, reposition or recreate the outer modal.
    const shellRect = () => dialog.evaluate((el) => {
      const b = el.getBoundingClientRect()
      return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]
    })
    await page.waitForTimeout(400) // let the modal enter transition settle
    const shellBefore = await shellRect()
    for (const name of ['Profile', 'Data', 'About', 'General']) {
      await dialog.getByRole('button', { name }).click()
      await expect.poll(shellRect).toEqual(shellBefore)
      await expect(dialog).toBeVisible()
    }

    // capabilities intact: theme + schemes, real persistence
    await expect(page.getByLabel('Light theme')).toBeVisible()
    await expect(page.getByLabel('Warm Amber color scheme')).toBeVisible()
    await page.getByLabel('Dark theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await selectColorScheme(page, 'Ocean')
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'ocean')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'ocean')

    // the library stayed in place underneath; the modal reopens over it
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await openView(page, 'settings')

    // mobile: the same modal becomes a full-width sheet, no overflow
    await page.setViewportSize({ width: 375, height: 800 })
    await expect(dialog).toBeVisible()
    const mobile = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), vw: window.innerWidth, radius: getComputedStyle(el).borderTopLeftRadius }
    })
    expect(mobile.w).toBeLessThanOrEqual(mobile.vw)
    expect(mobile.radius).toBe('24px') // exact-reference sheet radius
    await expectNoHorizontalScroll(page)
  })

  test('every overlay shares one backdrop token and blur treatment', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    const overlay = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.setProperty('background', 'var(--overlay)')
      document.body.appendChild(probe)
      const out = getComputedStyle(probe).backgroundColor
      probe.remove()
      return out
    })
    const backdropStyle = async (selector) => page.locator(selector).evaluate((el) => {
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, filter: cs.backdropFilter || cs.webkitBackdropFilter }
    })

    // AppDialog
    await saveLink(page, { url: 'https://example.com/overlay', title: 'Overlay' })
    await saveLink(page, { url: 'https://example.com/overlay?utm_source=x', title: 'Overlay 2', expectToast: false })
    await expect(page.getByRole('dialog')).toBeVisible()
    const dialog = await backdropStyle('.dialog-backdrop')
    expect(dialog.bg).toBe(overlay)
    expect(dialog.filter).toContain('blur(2px)')
    await page.keyboard.press('Escape')

    // Command palette
    await page.keyboard.press('Control+k')
    const palette = await backdropStyle('.command-overlay')
    expect(palette.bg).toBe(overlay)
    expect(palette.filter).toContain('blur(2px)')
    await page.keyboard.press('Escape')
  })

  test('the library surface holds at 320/375/768/1024/1280 without overflow', async ({ page }) => {
    for (const width of [320, 375, 768, 1024, 1280]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await saveLink(page, { url: `https://example.com/resp-${width}`, title: `Resp ${width}`, description: 'A description that is long enough to wrap across the surface without ever producing horizontal overflow.' })
      await expect(page.locator('.filterbar')).toBeVisible()
      await expect(page.locator('.library-results-count')).toBeVisible()
      if (width < 1024) {
        await expect(page.getByRole('button', { name: 'Toggle Pin' }).first()).toBeVisible()
      }
      await expectNoHorizontalScroll(page)
    }
  })

  test('the sidebar tree is the folder surface (no separate Folders page)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await createFolder(page, 'Audit Folder')
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expect(page.locator('[data-testid="sidebar-folder-row"]', { hasText: 'Audit Folder' })).toBeVisible()
  })
})
