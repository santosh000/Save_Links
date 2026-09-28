// P5 — Link detail panel: rail (desktop), sheet (mobile/tablet), inspection and
// management actions, selection independence, bounded rendering at scale.
import { test, expect } from '@playwright/test'
import {
  clearStorage, openView, saveLink, visibleLinkRows, linkRowByTitle,
  createFolder, expectNoHorizontalScroll, ensureCardView,
} from './helpers.js'

const PAGE_SIZE = 10

// ---- seeding (same real IndexedDB path as the P0 large-collection spec) ----
function seedLinks(count, now = Date.now()) {
  const links = []
  for (let i = 0; i < count; i++) {
    const url = `https://example.com/seed-${String(i).padStart(4, '0')}`
    links.push({
      id: `seed-${String(i).padStart(4, '0')}`,
      originalUrl: url,
      normalizedUrl: url,
      url,
      domain: 'example.com',
      title: `Seed Link ${String(i).padStart(4, '0')}`,
      description: `Synthetic link ${i}.`,
      image: '',
      category: 'Other',
      tags: i % 3 === 0 ? ['seed'] : [],
      important: false,
      mustHave: false,
      favorite: false,
      pinned: false,
      type: 'article',
      folderId: null,
      status: null,
      createdAt: new Date(now - i * 7 * 60 * 60 * 1000).toISOString(),
      savedFrom: 'Unknown',
    })
  }
  return links
}

async function seedIndexedDB(page, records) {
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
      for (const row of rows) store.put(row)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('seed aborted'))
    })
    db.close()
  }, records)
}

async function countGridColumns(page, selector) {
  const boxes = []
  for (const item of await page.locator(selector).all()) {
    const box = await item.boundingBox()
    if (box) boxes.push(box)
  }
  if (boxes.length < 2) return 1
  const firstRow = boxes.filter((b) => Math.abs(b.y - boxes[0].y) < 10)
  return [...new Set(firstRow.map((b) => Math.round(b.x)))].length
}

function card(page, title) {
  return page.locator('.grid > .card').filter({ hasText: title }).first()
}
function row(page, title) {
  return page.locator('.row-list > .link-row').filter({ hasText: title }).first()
}
function detail(page) {
  return page.locator('.detail')
}
async function openDetailFromCard(page, title) {
  await card(page, title).locator('.desc').click()
  await expect(detail(page)).toBeVisible()
}
async function setViewMode(page, label) {
  const btn = page.locator('.view-btn').filter({ hasText: label })
  await btn.click()
  await expect(btn).toHaveClass(/active/)
}
async function saveTwoLinks(page) {
  await saveLink(page, { url: 'https://github.com/pmndrs/zustand', title: 'Alpha Guide', description: 'State management walkthrough.', tags: 'react, state' })
  await saveLink(page, { url: 'https://example.com/beta', title: 'Beta Link', description: 'Second link for switching.' })
  await ensureCardView(page) // P8: the library boots in Compact
}

// P8: >=1024 the detail column is structurally present, so "closed" means the
// honest placeholder state rather than an unmounted panel.
async function expectDetailClosed(page) {
  await expect(page.locator('.detail-empty-title')).toBeVisible()
  await expect(page.locator('.detail-title')).toHaveCount(0)
}

test.describe('Link detail panel — desktop rail', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('opens from a card and shows real link data (title, URL, badge, meta, tags, description)', async ({ page }) => {
    await saveTwoLinks(page)
    await openDetailFromCard(page, 'Alpha Guide')

    const panel = detail(page)
    await expect(panel).toHaveClass(/detail--rail/)
    await expect(panel.locator('.detail-title')).toHaveText('Alpha Guide')
    await expect(panel.locator('.detail-url')).toHaveText('https://github.com/pmndrs/zustand')
    await expect(panel.locator('.detail-url')).toHaveAttribute('href', 'https://github.com/pmndrs/zustand')
    await expect(panel.locator('.detail-badge')).toHaveText('Repo') // real P3 type detection
    const meta = panel.locator('.detail-meta')
    await expect(meta).toContainText('github.com')
    await expect(meta).toContainText('Repo')
    await expect(meta).toContainText('Unfiled')
    await expect(meta).toContainText(/\d{4}/) // real saved date
    await expect(panel.locator('.detail-tag')).toHaveCount(2)
    await expect(panel.locator('.detail-tag').first()).toHaveText('#react')
    await expect(panel.locator('.detail-desc')).toContainText('State management walkthrough.')
    await expect(panel.getByRole('link', { name: 'Open link' })).toHaveAttribute('href', 'https://github.com/pmndrs/zustand')
    // The desktop rail reserves its column on the shell wrapper.
    await expect(page.locator('.main-wrapper')).toHaveClass(/has-detail/)
  })

  test('opens from a row (body click) and from the More menu Details entry', async ({ page }) => {
    await saveTwoLinks(page)
    await setViewMode(page, 'List')

    // Row body click (the row padding, outside the anchor and the checkbox).
    const betaRow = row(page, 'Beta Link')
    await betaRow.click({ position: { x: 4, y: 4 } })
    await expect(detail(page).locator('.detail-title')).toHaveText('Beta Link')

    // Keyboard-accessible path: More actions -> Details.
    await page.keyboard.press('Escape')
    await expectDetailClosed(page)
    const alphaRow = row(page, 'Alpha Guide')
    await alphaRow.getByRole('button', { name: 'More actions' }).click()
    await page.locator('.more-menu').getByRole('button', { name: 'Details' }).click()
    await expect(detail(page).locator('.detail-title')).toHaveText('Alpha Guide')
  })

  test('close button and Escape return the rail to its placeholder state', async ({ page }) => {
    await saveTwoLinks(page)
    await openDetailFromCard(page, 'Alpha Guide')
    await detail(page).locator('.detail-close').click()
    await expectDetailClosed(page)
    await expect(page.locator('.main-wrapper')).not.toHaveClass(/has-detail/)

    await openDetailFromCard(page, 'Beta Link')
    await page.keyboard.press('Escape')
    await expectDetailClosed(page)
    expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(true)
  })

  test('inspecting another link updates the same panel without closing it', async ({ page }) => {
    await saveTwoLinks(page)
    await openDetailFromCard(page, 'Alpha Guide')
    await card(page, 'Beta Link').locator('.desc').click()
    await expect(detail(page)).toHaveCount(1)
    await expect(detail(page).locator('.detail-title')).toHaveText('Beta Link')
    await expect(detail(page).locator('.detail-url')).toHaveText('https://example.com/beta')
  })

  test('edit from the panel saves through the existing path and updates the card', async ({ page }) => {
    await saveTwoLinks(page)
    await openDetailFromCard(page, 'Alpha Guide')
    await detail(page).getByRole('button', { name: 'Edit link' }).click()
    const form = page.locator('.detail .edit-form')
    await expect(form).toBeVisible()
    const titleInput = form.locator('input').first()
    await titleInput.fill('Alpha Guide (edited)')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.sl-toast')).toContainText('Link updated')
    await expect(detail(page).locator('.detail-title')).toHaveText('Alpha Guide (edited)')
    await expect(card(page, 'Alpha Guide (edited)')).toBeVisible()
  })

  test('favorite, pin, important and must-have toggle from the panel and stay in sync with the item', async ({ page }) => {
    await saveTwoLinks(page)
    await openDetailFromCard(page, 'Alpha Guide')
    const panel = detail(page)
    const alphaCard = card(page, 'Alpha Guide')

    await panel.getByRole('button', { name: 'Toggle Favorite' }).click()
    await expect(panel.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(alphaCard.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')

    await panel.getByRole('button', { name: 'Toggle Pin' }).click()
    await expect(panel.getByRole('button', { name: 'Toggle Pin' })).toHaveAttribute('aria-pressed', 'true')
    await expect(alphaCard.getByRole('button', { name: 'Toggle Pin' })).toHaveAttribute('aria-pressed', 'true')

    await panel.getByRole('button', { name: 'Toggle Important' }).click()
    await expect(panel.getByRole('button', { name: 'Toggle Important' })).toHaveAttribute('aria-pressed', 'true')
    await panel.getByRole('button', { name: 'Toggle Must Have' }).click()
    await expect(panel.getByRole('button', { name: 'Toggle Must Have' })).toHaveAttribute('aria-pressed', 'true')

    // Toggling off keeps working.
    await panel.getByRole('button', { name: 'Toggle Favorite' }).click()
    await expect(panel.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('delete from the panel confirms, removes the link and returns the rail to placeholder', async ({ page }) => {
    await saveTwoLinks(page)
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await openDetailFromCard(page, 'Beta Link')
    await detail(page).getByRole('button', { name: 'Delete link' }).click()
    const dialog = page.locator('.dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Delete this link?')
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.locator('.sl-toast')).toContainText('Link deleted')
    await expectDetailClosed(page)
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Alpha Guide')
  })

  test('move from the panel assigns a folder and updates the meta path', async ({ page }) => {
    await saveTwoLinks(page)
    await openView(page, 'folders')
    await createFolder(page, 'Reading')
    await openView(page, 'links')
    await openDetailFromCard(page, 'Beta Link')
    await detail(page).getByRole('button', { name: 'Move to folder' }).click()
    await detail(page).locator('#detail-move-folder + .asel-trigger').click()
    await page.locator('.asel-menu').getByRole('option').filter({ hasText: 'Reading' }).click()
    await expect(page.locator('.sl-toast')).toContainText('Folder updated')
    await expect(detail(page).locator('.detail-meta')).toContainText('Reading')
  })

  test('copy writes the real URL to the clipboard; share control is present', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await saveTwoLinks(page)
    await openDetailFromCard(page, 'Beta Link')
    await detail(page).getByRole('button', { name: 'Copy link' }).click()
    await expect(page.locator('.sl-toast')).toContainText('Link copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://example.com/beta')
    await expect(detail(page).getByRole('button', { name: 'Share link' })).toBeVisible()
  })

  test('bulk selection stays independent from the inspected link', async ({ page }) => {
    await saveTwoLinks(page)
    await openDetailFromCard(page, 'Alpha Guide')

    // Checking another card selects it for bulk actions without changing the panel.
    await card(page, 'Beta Link').locator('.card-check input').check()
    await expect(page.locator('.bulk-bar')).toBeVisible()
    await expect(detail(page).locator('.detail-title')).toHaveText('Alpha Guide')

    // Checking the inspected link does not close/replace the panel either.
    await card(page, 'Alpha Guide').locator('.card-check input').check()
    await expect(page.locator('.bulk-bar')).toContainText('2 selected')
    await expect(detail(page).locator('.detail-title')).toHaveText('Alpha Guide')

    // Clearing the selection leaves the inspection state intact.
    await page.locator('.bulk-clear').click()
    await expect(page.locator('.bulk-bar')).toHaveCount(0)
    await expect(detail(page)).toBeVisible()
  })

  test('command palette layers over the panel: Escape closes the palette first, then the panel', async ({ page }) => {
    await saveTwoLinks(page)
    await openDetailFromCard(page, 'Alpha Guide')
    await page.keyboard.press('Control+k')
    await expect(page.locator('.command-palette')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.command-palette')).toHaveCount(0)
    await expect(detail(page)).toBeVisible() // palette Escape did not close the detail
    await page.locator('.detail-title').click()
    await page.keyboard.press('Escape')
    await expectDetailClosed(page)
  })

  test('desktop rail geometry: 360/380px column, capped 3-up grid, no overlap', async ({ page }) => {
    await saveTwoLinks(page)
    // A third link so the 3-column grid can actually be counted.
    await saveLink(page, { url: 'https://example.com/gamma', title: 'Gamma Link', description: 'Third card.' })
    await page.setViewportSize({ width: 1200, height: 900 })
    await openDetailFromCard(page, 'Alpha Guide')
    let box = await detail(page).boundingBox()
    expect(Math.round(box.width)).toBe(360)
    expect(await countGridColumns(page, '.grid > .card')).toBe(3) // P8: capped at 3
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 1440, height: 900 })
    await openDetailFromCard(page, 'Alpha Guide')
    box = await detail(page).boundingBox()
    expect(Math.round(box.width)).toBe(380)
    expect(await countGridColumns(page, '.grid > .card')).toBe(3)
    // .main-wrapper animates its reserved margin (transition: all), so poll
    // until the reflow settles before comparing edges.
    await expect.poll(async () => {
      const content = await page.locator('.links-panel').boundingBox()
      const rail = await detail(page).boundingBox()
      return content.x + content.width <= rail.x + 1
    }).toBe(true)
    const content = await page.locator('.links-panel').boundingBox()
    expect(content.x + content.width).toBeLessThanOrEqual(box.x + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
})

test.describe('Link detail panel — mobile / tablet sheet', () => {
  test('bottom sheet on mobile: backdrop, handle, close, drag-to-dismiss and no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await clearStorage(page)
    await saveLink(page, { url: 'https://example.com/mobile', title: 'Mobile Link', description: 'Sheet test.' })
    await ensureCardView(page) // P8: the library boots in Compact
    await card(page, 'Mobile Link').locator('.desc').click()

    const panel = detail(page)
    await expect(panel).toBeVisible()
    await expect(panel).toHaveClass(/detail--sheet/)
    await expect(panel).toHaveAttribute('role', 'dialog')
    await expect(panel).toHaveAttribute('aria-modal', 'true')
    await expect(page.locator('.detail-backdrop')).toBeVisible()
    await expect(page.locator('.sheet-handle')).toBeVisible()
    await expect(panel.locator('.detail-title')).toHaveText('Mobile Link')
    // The sheet owns focus (keyboard users land on the close control).
    await expect(panel.locator('.detail-close')).toBeFocused()
    await expectNoHorizontalScroll(page)

    // A short drag snaps back; a long drag dismisses (mockup >100px).
    const handle = page.locator('.sheet-handle')
    const hbox = await handle.boundingBox()
    const cx = hbox.x + hbox.width / 2
    await page.evaluate(({ cx, y }) => {
      const el = document.querySelector('.sheet-handle')
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: y, bubbles: true }))
      el.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: y + 50, bubbles: true }))
      el.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: y + 50, bubbles: true }))
    }, { cx, y: hbox.y + hbox.height / 2 })
    await expect(panel).toBeVisible()

    await page.evaluate(({ cx, y }) => {
      const el = document.querySelector('.sheet-handle')
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: y, bubbles: true }))
      el.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: y + 160, bubbles: true }))
      el.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: y + 160, bubbles: true }))
    }, { cx, y: hbox.y + hbox.height / 2 })
    await expect(detail(page)).toHaveCount(0)

    // Reopen and close through the button (touch target inside the sheet).
    await card(page, 'Mobile Link').locator('.desc').click()
    await detail(page).locator('.detail-close').click()
    await expect(detail(page)).toHaveCount(0)
    await expectNoHorizontalScroll(page)
  })

  test('centred sheet on tablet keeps the app chrome reachable and Escape closes it', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await clearStorage(page)
    await saveLink(page, { url: 'https://example.com/tablet', title: 'Tablet Link', description: 'Tablet sheet.' })
    await ensureCardView(page) // P8: the library boots in Compact
    await card(page, 'Tablet Link').locator('.desc').click()
    const panel = detail(page)
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    expect(box.width).toBeLessThanOrEqual(560)
    expect(Math.round(box.x + box.width / 2)).toBeGreaterThan(400) // roughly centred
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expectNoHorizontalScroll(page)
  })

  test('dark mode renders the sheet with real state intact', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await clearStorage(page)
    await openView(page, 'settings')
    await page.getByLabel('Dark theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await saveLink(page, { url: 'https://example.com/dark', title: 'Dark Link', description: 'Dark sheet.' })
    await ensureCardView(page) // P8: the library boots in Compact
    await card(page, 'Dark Link').locator('.desc').click()
    await expect(detail(page).locator('.detail-title')).toHaveText('Dark Link')
    await expect(detail(page).locator('.detail-badge')).toBeVisible()
    await expectNoHorizontalScroll(page)
  })
})

test.describe('Link detail panel — responsive overflow sweep', () => {
  test('no horizontal overflow with the detail surface open at every shell width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
    await saveLink(page, { url: 'https://example.com/sweep', title: 'Sweep Link', description: 'Overflow sweep.' })
    await ensureCardView(page) // P8: the library boots in Compact
    for (const width of [375, 390, 480, 640, 768, 820, 1024, 1200, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      // P8: >=1024 the rail is always present (placeholder); below it is a sheet.
      if (width >= 1024) await expectDetailClosed(page)
      else await expect(detail(page)).toHaveCount(0)
      await card(page, 'Sweep Link').locator('.desc').click()
      await expect(detail(page)).toBeVisible()
      await expect(detail(page).locator('.detail-title')).toHaveText('Sweep Link')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `overflow at ${width}`).toBe(true)
      await page.keyboard.press('Escape')
      if (width >= 1024) await expectDetailClosed(page)
      else await expect(detail(page)).toHaveCount(0)
    }
  })
})

test.describe('Link detail panel — large library', () => {
  test('1,000 links: DOM stays bounded and the panel renders exactly one record', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
    await seedIndexedDB(page, seedLinks(1000))
    await page.goto('/')
    await expect(visibleLinkRows(page).first()).toBeVisible()
    await ensureCardView(page) // P8: the library boots in Compact
    await expect(page.locator('.grid > .card')).toHaveCount(PAGE_SIZE)

    await page.locator('.grid > .card').first().locator('.desc').click()
    await expect(detail(page)).toBeVisible()
    await expect(page.locator('.detail')).toHaveCount(1)
    await expect(detail(page).locator('.detail-title')).toHaveText('Seed Link 0000')
    await expect(page.locator('.grid > .card')).toHaveCount(PAGE_SIZE)
    const pageItems = page.locator('.pagination .page-item')
    expect(await pageItems.count()).toBeLessThanOrEqual(12)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
})

test.describe('Link detail panel — console hygiene', () => {
  test('no console errors through the detail flows', async ({ page }) => {
    // Pre-existing noise this check deliberately excludes: the dev server has no
    // /api/me (404 at boot) and the app's intentional best-effort metadata fetch
    // is CORS-blocked in dev (src/utils/metadata.js, never throws). The detail
    // flow itself must add no errors, so the collector is reset after the saves.
    const errors = []
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
    page.on('pageerror', (err) => errors.push(String(err)))
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
    await saveTwoLinks(page)
    await page.waitForTimeout(700) // let the save-time metadata fetches settle
    errors.length = 0

    await openDetailFromCard(page, 'Alpha Guide')
    await detail(page).getByRole('button', { name: 'Toggle Pin' }).click()
    await detail(page).getByRole('button', { name: 'Toggle Favorite' }).click()
    await detail(page).getByRole('button', { name: 'Move to folder' }).click()
    await detail(page).locator('#detail-move-folder + .asel-trigger').click()
    await page.locator('.asel-menu').getByRole('option').first().click()
    await detail(page).locator('.detail-close').click()
    await expectDetailClosed(page)
    expect(errors).toEqual([])
  })
})
