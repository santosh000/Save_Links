import { test, expect } from '@playwright/test'
import { clearStorage, openView, createFolder, saveLink, seedLinks, linkRecord, visibleLinkRows, ensureCardView, readStoredLinks } from './helpers.js'

// Step 2C-1 contract: the Saved Link card leads with the title, keeps the URL
// on one visual line (fading its painted tail, never its value), and keeps the
// card body — domain, title, description and the footer (tags + date) — as the
// mockup's information hierarchy. Assertions are behavioural (computed style,
// DOM order, scroll extents), never pixel coordinates.

test.describe('Card information hierarchy (Step 2C-1)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('the card body follows the mockup hierarchy: domain, title, description, footer', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await ensureCardView(page) // P8: the library boots in Compact

    const card = page.locator('.grid > .card').first()
    await expect(card.locator('.title')).toHaveText('Alpha Link')
    await expect(card.locator('.card-domain')).toContainText('example.com')

    // P15.11 mockup order: domain → title → description → footer (tags + date).
    const order = await card.locator('.body > *').evaluateAll((els) => els.map((el) => el.className.split(' ')[0]))
    expect(order).toEqual(['card-domain', 'title', 'desc', 'card-foot'])
  })

  test('card footer keeps the real saved date (right-aligned) beside the tags only', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link', tags: 'react, css', category: 'GitHub' })
    await ensureCardView(page) // P8: the library boots in Compact

    const card = page.locator('.grid > .card').first()
    const foot = card.locator('.card-foot')
    await expect(foot).toBeVisible()
    // the saved date is still a real <time datetime> (one visible form per width)
    const times = foot.locator('time[datetime]')
    await expect(times.first()).toBeVisible()
    expect(await times.first().getAttribute('datetime')).toBeTruthy()
    // the real date is pushed to the footer's right edge (mockup margin-left:auto)
    const footBox = await foot.boundingBox()
    const dateBox = await card.locator('.card-date').boundingBox()
    expect(Math.abs((dateBox.x + dateBox.width) - (footBox.x + footBox.width))).toBeLessThanOrEqual(1)
    // tags live on the left of the footer; category/folder never appear in the card
    await expect(foot.locator('.tag').first()).toHaveText('#react')
    await expect(card).not.toContainText('GitHub')
    await expect(foot).not.toContainText('GitHub')
  })

  test('a long domain truncates on one visual line without overflowing the page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://alpha-beta-gamma-delta-epsilon-zeta-eta-theta.example.com/path', title: 'Long domain card' })
    await ensureCardView(page) // P8: the library boots in Compact

    const domain = page.locator('.grid > .card .card-domain-text').first()
    await expect(domain).toBeVisible()
    const m = await domain.evaluate((el) => ({
      overflow: getComputedStyle(el).textOverflow,
      clipped: el.scrollWidth > el.clientWidth + 1,
      text: el.textContent,
      title: el.getAttribute('title'),
    }))
    expect(m.overflow).toBe('ellipsis') // the tail is visually truncated
    expect(m.clipped).toBe(true)
    expect(m.text).toBe('alpha-beta-gamma-delta-epsilon-zeta-eta-theta.example.com') // full value preserved
    expect(m.title).toBe(m.text) // and exposed as the accessible title

    const noHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )
    expect(noHorizontalOverflow).toBe(true)
  })

  test('status toggles and all three views still work', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await ensureCardView(page) // P8: the library boots in Compact

    const card = page.locator('.grid > .card').first()
    const favorite = card.getByRole('button', { name: 'Toggle Favorite' })
    await expect(favorite).toHaveAttribute('aria-pressed', 'false')
    await favorite.click()
    await expect(favorite).toHaveAttribute('aria-pressed', 'true')
    // P15.10: Important is gone from the item surfaces; P15.11 puts the mockup
    // banner cluster (favourite + pin + item menu) on the banner itself.
    await expect(card.getByRole('button', { name: 'Toggle Important' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Toggle Must Have' })).toHaveCount(0)
    const cluster = card.locator('.thumb-wrap .banner-actions')
    await expect(cluster).toBeVisible()
    expect(await cluster.locator('button').count()).toBe(3)
    const pin = cluster.getByRole('button', { name: 'Toggle Pin' })
    await expect(pin).toBeVisible()
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    // the selection box lives on the banner too (mockup .card-check)
    await expect(card.locator('.thumb-wrap .card-check input')).toHaveCount(1)

    // Card / List / Compact all render the saved link (P15.3: the mockup
    // topbar view tabs are ordered compact -> list -> card; click by label).
    for (const [label, mode] of [['Compact', 'compact'], ['List', 'list'], ['Card', 'card']]) {
      await page.locator('.view-btn').filter({ hasText: label }).click()
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
    await page.locator('.navbar-custom').click({ position: { x: 4, y: 4 } })
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
    await ensureCardView(page) // P8: the library boots in Compact

    // create a folder to move the link into
    await createFolder(page, 'Reading')
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
    await expect(page.locator('.grid > .card .card-foot')).not.toContainText('GitHub')
    await expect(page.locator('.grid > .card .card-foot')).not.toContainText('Reading')
    await expect(page.locator('.grid > .card .card-domain')).not.toContainText('GitHub')

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
    await ensureCardView(page) // P8: the library boots in Compact

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
    await expect(page.locator('.page-title')).toHaveText('Links')
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

  test('Favorite and Pin stay direct card actions and still work', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await ensureCardView(page) // P8: the library boots in Compact
    const card = page.locator('.grid > .card').first()
    const favorite = card.getByRole('button', { name: 'Toggle Favorite' })
    await favorite.click()
    await expect(favorite).toHaveAttribute('aria-pressed', 'true')
    // P15.10: Important left the card surface; Pin replaced it as the second
    // permanent state toggle.
    const pin = card.getByRole('button', { name: 'Toggle Pin' })
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    // P15.11: the shared edit form opens from the item's own menu (the mockup
    // banner carries a quiet action cluster, not a permanent pencil)
    await card.getByRole('button', { name: 'More actions' }).click()
    await page.locator('.more-menu').getByRole('button', { name: 'Edit link' }).click()
    await expect(page.locator('.edit-popover')).toBeVisible()
  })
})

// P15.10 contract: the item surfaces carry Favorite + Pin only — Important and
// Must Have are gone from Card/List/Compact (they remain real persisted fields
// toggled from any UI surface anymore; they remain real persisted fields,
// asserted at the store level below).
test.describe('Item status surfaces (P15.10)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('Must Have and Important leave the item surfaces but keep their data', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    // The flags have no UI control; seed the real data field through the
    // legacy-storage migration path and assert the surfaces + the store.
    await seedLinks(page, [linkRecord({ id: 'alpha', url: 'https://example.com/alpha', title: 'Alpha Link', mustHave: true })])
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await ensureCardView(page)

    const card = page.locator('.grid > .card').first()
    await expect(card.getByRole('button', { name: 'Toggle Must Have' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Toggle Important' })).toHaveCount(0)

    // the same in List and Compact: no permanent Must Have/Important control
    for (const label of ['List', 'Compact']) {
      await page.locator('.view-btn').filter({ hasText: label }).click()
      const item = page.locator('.row-list > .link-row').first()
      await expect(item.getByRole('button', { name: 'Toggle Must Have' })).toHaveCount(0)
      await expect(item.getByRole('button', { name: 'Toggle Important' })).toHaveCount(0)
      await expect(item.getByRole('button', { name: 'Toggle Favorite' })).toBeVisible()
      await expect(item.getByRole('button', { name: 'Toggle Pin' })).toBeVisible()
    }
    await page.locator('.view-btn').filter({ hasText: 'Card' }).click()

    // the quick-action menu no longer carries the Must Have toggle either
    await card.getByRole('button', { name: 'More actions' }).click()
    const menu = page.locator('.more-menu').first()
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Toggle Must Have' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // …while the persisted field stays real data (the UI has no Important/
    // Must Have control and no status filter anymore; assert the store).
    const stored = await readStoredLinks(page)
    expect(stored.find((l) => l.title === 'Alpha Link')?.mustHave).toBe(true)
  })
})

