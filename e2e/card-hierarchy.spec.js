import { test, expect } from '@playwright/test'
import { clearStorage, openView, saveLink } from './helpers.js'

// Step 2C-1 contract: the Saved Link card leads with the title, keeps the URL
// on one visual line (fading its painted tail, never its value), and keeps the
// metadata line — category, folder, domain, saved date and provenance — as
// quiet supporting text. Assertions are behavioural (computed style, DOM order,
// scroll extents), never pixel coordinates.
const LONG_URL =
  'https://example.com/a/really/long/path/that/keeps/going/into/segments/with/query-params?utm_source=newsletter&utm_campaign=launch&ref=homepage'

test.describe('Card information hierarchy (Step 2C-1)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('title leads the card; URL and quiet metadata follow it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })

    const card = page.locator('.grid > .card').first()
    await expect(card.locator('.title')).toHaveText('Alpha Link')

    const order = await card.locator('.body > *').evaluateAll((els) => els.map((el) => el.className.split(' ')[0]))
    expect(order.indexOf('title')).toBeLessThan(order.indexOf('url-row'))
    expect(order.indexOf('url-row')).toBeLessThan(order.indexOf('meta'))
    expect(order.indexOf('meta')).toBeLessThan(order.indexOf('actions'))
  })

  test('metadata line keeps the saved date and provenance, not category/folder/domain', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })

    const meta = page.locator('.grid > .card .meta').first()
    await expect(meta).toBeVisible()
    // the saved date is still a real <time datetime> (one visible form per width)
    const times = meta.locator('time[datetime]')
    await expect(times.first()).toBeVisible()
    expect(await times.first().getAttribute('datetime')).toBeTruthy()
    // provenance renders from the existing savedFrom value (hidden only when Unknown)
    expect((await meta.innerText()).trim().length).toBeGreaterThan(0)
    // category / folder / domain are no longer permanent metadata (they moved to
    // the quick-action menu / the URL itself)
    expect(await meta.locator('.meta-item').count()).toBeLessThanOrEqual(2)
  })

  test('a long URL stays on one visual line without overflowing the page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: LONG_URL, title: 'Long URL card' })

    const url = page.locator('.grid > .card .url').first()
    await expect(url).toBeVisible()
    const m = await url.evaluate((el) => {
      const cs = getComputedStyle(el)
      const line = el.closest('.url-line')
      const lineCs = getComputedStyle(line)
      return {
        whiteSpace: cs.whiteSpace,
        height: Math.round(el.getBoundingClientRect().height),
        lineHeight: parseFloat(cs.lineHeight) || 0,
        text: el.textContent,
        title: el.getAttribute('title'),
        clipped: line.scrollWidth > line.clientWidth + 1,
        masked: lineCs.webkitMaskImage !== 'none' && lineCs.webkitMaskImage !== '',
      }
    })
    expect(m.whiteSpace).toBe('nowrap') // never wraps to a second line
    expect(m.height).toBeLessThan(m.lineHeight * 2) // one visual line
    expect(m.clipped).toBe(true) // the tail is visually truncated
    expect(m.masked).toBe(true) // by the mask fade, not a painted colour
    expect(m.text).toBe(LONG_URL) // the full value is preserved in the DOM
    expect(m.title).toBe(LONG_URL) // and exposed as the accessible title

    const noHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )
    expect(noHorizontalOverflow).toBe(true)
  })

  test('status toggles and all three views still work', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })

    const card = page.locator('.grid > .card').first()
    const favorite = card.getByRole('button', { name: 'Toggle Favorite' })
    await expect(favorite).toHaveAttribute('aria-pressed', 'false')
    await favorite.click()
    await expect(favorite).toHaveAttribute('aria-pressed', 'true')
    const important = card.getByRole('button', { name: 'Toggle Important' })
    await important.click()
    await expect(important).toHaveAttribute('aria-pressed', 'true')
    // Step 2C-3: Must Have is no longer a permanent card control (it moved into
    // the quick-action menu); the permanent status area is Important + Favorite.
    await expect(card.getByRole('button', { name: 'Toggle Must Have' })).toHaveCount(0)
    expect(await card.locator('.status-group button').count()).toBe(2)

    // Card / List / Compact all render the saved link
    for (const [index, mode] of [['0', 'card'], ['1', 'list'], ['2', 'compact']]) {
      await page.locator('.view-btn').nth(Number(index)).click()
      const item = mode === 'card' ? '.grid > .card' : '.row-list > .link-row'
      await expect(page.locator(item)).toHaveCount(1)
      await expect(page.locator(item).first()).toContainText('Alpha Link')
    }
  })
})

// Step 2C-2 contract: one compact contextual menu per item, anchored with the
// existing popover infrastructure, reusing the existing App.vue handlers for
// category/folder (App.updateLink), delete (the existing confirmation dialog)
// and the shared toast for copy/share feedback. Behaviour only — no pixels.
test.describe('Card quick-action menu (Step 2C-2)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  const openMenu = async (page) => {
    const trigger = page.getByRole('button', { name: 'More actions' }).first()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.click()
    const menu = page.locator('.more-menu').first()
    await expect(menu).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    // aria-controls points at the menu that actually opened
    const controls = await trigger.getAttribute('aria-controls')
    await expect(page.locator(`#${controls}`)).toBeVisible()
    return { trigger, menu }
  }

  test('opens and closes with the trigger, Escape and outside click', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })

    const { trigger, menu } = await openMenu(page)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await openMenu(page)
    await page.locator('.page-title').click()
    await expect(menu).toBeHidden()

    // keyboard: the trigger is reachable and opens the menu
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    // and the rows inside are focusable
    await expect(menu.getByRole('button', { name: 'Copy link' })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Open' })).toBeVisible()
  })

  test('copy link writes to the clipboard and reports through the existing toast', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    const { menu } = await openMenu(page)
    await menu.getByRole('button', { name: 'Copy link' }).click()
    await expect(menu).toBeHidden() // immediate action closes the menu
    await expect(page.locator('.sl-toast')).toContainText('Link copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://example.com/alpha')
  })

  test('category and folder change contextually and persist after the menu closes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })

    // create a folder to move the link into
    await openView(page, 'folders')
    await page.getByLabel('New folder name').fill('Reading')
    await page.getByRole('button', { name: 'Create folder', exact: true }).click()
    await expect(page.locator('.folder-item', { hasText: 'Reading' })).toBeVisible()
    await openView(page, 'links')

    // category
    let { menu } = await openMenu(page)
    await menu.getByRole('combobox', { name: 'Change category' }).click()
    await page.getByRole('option', { name: 'GitHub' }).click()
    await expect(page.locator('.sl-toast')).toContainText('Link updated')
    await expect(page.locator('.more-menu')).toHaveCount(0)

    // folder
    ;({ menu } = await openMenu(page))
    await menu.getByRole('combobox', { name: 'Move to folder' }).click()
    await page.getByRole('option', { name: 'Reading' }).click()
    await expect(page.locator('.sl-toast')).toContainText('Folder updated')
    await expect(page.locator('.more-menu')).toHaveCount(0)

    // persisted: reopening the menu shows the applied values, and neither value
    // is part of the permanent card metadata
    ;({ menu } = await openMenu(page))
    await expect(menu.getByRole('combobox', { name: 'Change category' })).toContainText('GitHub')
    await expect(menu.getByRole('combobox', { name: 'Move to folder' })).toContainText('Reading')
    await expect(page.locator('.grid > .card .meta')).not.toContainText('GitHub')
    await expect(page.locator('.grid > .card .meta')).not.toContainText('Reading')

    // survives a reload (the same persisted record)
    await page.reload()
    await expect(page.locator('.grid > .card').first()).toContainText('Alpha Link')
    ;({ menu } = await openMenu(page))
    await expect(menu.getByRole('combobox', { name: 'Change category' })).toContainText('GitHub')
    await expect(menu.getByRole('combobox', { name: 'Move to folder' })).toContainText('Reading')
  })

  test('delete keeps the existing confirmation dialog and can be cancelled', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })

    let { menu } = await openMenu(page)
    await menu.getByRole('button', { name: 'Delete' }).click()
    await expect(menu).toBeHidden()
    await expect(page.getByRole('dialog')).toContainText('Delete this link?')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.grid > .card')).toHaveCount(1)

    // confirming removes it through the existing handler
    ;({ menu } = await openMenu(page))
    await menu.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.locator('.grid > .card')).toHaveCount(0)
    await expect(page.locator('.sl-toast')).toContainText('Link deleted')
  })

  test('the menu works in Card, List and Compact without horizontal overflow', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await expect(page.locator('.grid > .card, .row-list > .link-row').first()).toBeVisible()
    for (const width of [320, 375, 390, 430, 480, 640, 768, 820, 900, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(200)
      // if the shell started collapsed at this width, make sure we are on Links
      for (const [index, mode] of [['0', 'card'], ['1', 'list'], ['2', 'compact']]) {
        const switcher = page.locator('.view-btn')
        if (await switcher.count() === 0) break
        const viewBtn = switcher.nth(Number(index))
        await expect(viewBtn).toBeVisible()
        await viewBtn.click()
        await expect(viewBtn, `view mode ${mode} at ${width}px`).toHaveAttribute('aria-pressed', 'true')
        const { menu } = await openMenu(page)
        const box = await menu.boundingBox()
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1)
        await expect(menu.getByRole('combobox', { name: 'Move to folder' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.locator('.more-menu')).toHaveCount(0)
      }
      const noHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      )
      expect(noHorizontalOverflow, `width ${width}`).toBe(true)
    }
  })

  test('share uses the native share sheet when the environment provides it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.addInitScript(() => {
      window.__shared = []
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (data) => { window.__shared.push(data); return Promise.resolve() },
      })
    })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })

    const { menu } = await openMenu(page)
    await menu.getByRole('button', { name: 'Share' }).click()
    await expect(menu).toBeHidden()
    const shared = await page.evaluate(() => window.__shared)
    expect(shared).toHaveLength(1)
    expect(shared[0].url).toBe('https://example.com/alpha')
    expect(shared[0].title).toBe('Alpha Link')
    // the native path does not also report a copy
    await expect(page.locator('.sl-toast')).toHaveCount(0)
    // and it never navigates away from the current view
    await expect(page.locator('.page-title')).toHaveText('Saved links')
  })

  test('share falls back to copying the link when the environment has no share sheet', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })

    const { menu } = await openMenu(page)
    await menu.getByRole('button', { name: 'Share' }).click()
    await expect(menu).toBeHidden()
    await expect(page.locator('.sl-toast')).toContainText('Link copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://example.com/alpha')
  })

  test('Important and Favorite stay direct card actions and still work', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    const card = page.locator('.grid > .card').first()
    const favorite = card.getByRole('button', { name: 'Toggle Favorite' })
    await favorite.click()
    await expect(favorite).toHaveAttribute('aria-pressed', 'true')
    const important = card.getByRole('button', { name: 'Toggle Important' })
    await important.click()
    await expect(important).toHaveAttribute('aria-pressed', 'true')
    // Edit stays on the card (the deliberate exception) and opens the shared form
    await card.getByRole('button', { name: 'Edit link' }).click()
    await expect(page.locator('.edit-popover')).toBeVisible()
  })
})

// Step 2C-3 contract: Must Have is no longer permanent card chrome — it toggles
// in context from the existing quick-action menu, while the persisted field,
// the existing status filter and the sync/storage layer stay untouched.
test.describe('Must Have in the quick-action menu (Step 2C-3)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('toggles from the menu without leaving the card, and drives the existing status filter', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })

    const card = page.locator('.grid > .card').first()
    await expect(card.getByRole('button', { name: 'Toggle Must Have' })).toHaveCount(0)

    // the same in List and Compact: no permanent Must Have control
    for (const index of [1, 2]) {
      await page.locator('.view-btn').nth(index).click()
      const item = page.locator('.row-list > .link-row').first()
      await expect(item.getByRole('button', { name: 'Toggle Must Have' })).toHaveCount(0)
      await expect(item.getByRole('button', { name: 'Toggle Favorite' })).toBeVisible()
    }
    await page.locator('.view-btn').nth(0).click()

    // reachable from the menu, toggles in place and keeps the menu open
    await card.getByRole('button', { name: 'More actions' }).click()
    const menu = page.locator('.more-menu').first()
    const mustHave = menu.getByRole('button', { name: 'Toggle Must Have' })
    await expect(mustHave).toBeVisible()
    await expect(mustHave).toHaveAttribute('aria-pressed', 'false')
    await mustHave.click()
    await expect(mustHave).toHaveAttribute('aria-pressed', 'true')
    await expect(menu).toBeVisible()
    // the active state is not colour-only: the icon takes the filled treatment
    const fill = await mustHave.locator('svg').evaluate((el) => getComputedStyle(el).fill)
    expect(fill).not.toBe('none')
    await page.keyboard.press('Escape')

    // the existing status filter still resolves it as Must Have (data intact)
    await page.locator('#filter-status').selectOption('must-have')
    await expect(page.locator('.grid > .card')).toHaveCount(1)
    await page.locator('#filter-status').selectOption('')

    // the toggle writes the same persisted field: a reload keeps it…
    await page.reload()
    await expect(page.locator('.grid > .card').first()).toContainText('Alpha Link')
    await page.getByRole('button', { name: 'More actions' }).first().click()
    const afterReload = page.locator('.more-menu').getByRole('button', { name: 'Toggle Must Have' })
    await expect(afterReload).toHaveAttribute('aria-pressed', 'true')

    // …and turning it off there removes it from the Must Have filter again
    await afterReload.click()
    await expect(afterReload).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Escape')
    await page.locator('#filter-status').selectOption('must-have')
    await expect(page.locator('.grid > .card')).toHaveCount(0)
  })
})

