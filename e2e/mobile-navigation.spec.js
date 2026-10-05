import { test, expect } from '@playwright/test'
import { clearStorage, openView, selectColorScheme, saveLink, ensureCardView } from './helpers.js'

// P8 shell (mockup parity): below 1024 the topbar is a single row and the bottom
// bar (All · Favorites · Tags · More) + floating Add action own the bottom
// edge; the sidebar is a drawer and the detail is a sheet. At >=1024 the shell
// is the mockup's three-column grid. The library boots in Compact.
const MOBILE = { width: 390, height: 844 }
const TABLET = { width: 900, height: 1100 }
const DESKTOP = { width: 1280, height: 900 }

const bottomNav = (page) => page.getByRole('navigation', { name: 'Primary' })
const navItem = (page, name) => bottomNav(page).getByRole('button', { name, exact: true })

function toRgb(v) {
  const hex = v.trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (hex) return hex.slice(1).map((h) => parseInt(h, 16))
  const parts = v.match(/\d+(?:\.\d+)?/g)
  if (!parts || parts.length < 3) throw new Error(`unparseable color: ${v}`)
  return parts.slice(0, 3).map(Number)
}

test.describe('Mobile & tablet navigation shell', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('mobile top bar is search and profile only (brand lives in the drawer)', async ({ page }) => {
    await page.setViewportSize(MOBILE)

    // P15 Group 2 (mockup): below 768 the topbar brand steps aside - the drawer
    // header still carries it - and the search field is inline.
    await expect(page.locator('.mobile-brand')).toBeHidden()
    await expect(page.locator('.sidebar-head .sidebar-brand')).toHaveCount(1)
    await expect(page.getByLabel('Search links')).toBeVisible()
    await expect(page.locator('.navbar-search-toggle')).toHaveCount(0)
    await expect(page.locator('.identity-btn')).toBeVisible()

    // The drawer is present but off-canvas (opened by the bottom bar's More);
    // no topbar toggle and no fullscreen utility are stacked into this row.
    await expect(page.locator('#sidebar-toggle')).toBeHidden()
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/\bshow\b/)
    await expect(page.locator('.sidebar-overlay')).toBeHidden()
    await expect(page.locator('#btn-fullscreen')).toBeHidden()
  })

  test('mobile header keeps profile at the far right and hides the duplicate toolbar actions', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    // One link so the toolbar controls exist (they render only with links).
    await saveLink(page, { url: 'https://example.com/step1', title: 'Step One Link' })

    const nav = await page.locator('.navbar-custom').boundingBox()
    const search = await page.getByLabel('Search links').boundingBox()
    const views = await page.locator('.view-switch').boundingBox()
    const profile = await page.locator('.identity-btn').boundingBox()

    // P15 Group 2: the brand is hidden below 768; the inline field holds the
    // row's free space and the profile sits at the far right (flex, not fixed).
    await expect(page.locator('.mobile-brand')).toBeHidden()
    expect(search.x).toBeGreaterThanOrEqual(nav.x)
    expect(profile.x).toBeGreaterThan(nav.x + nav.width / 2)
    expect(profile.x + profile.width).toBeGreaterThan(nav.x + nav.width - 32)

    // Inline search · views · profile on ONE compact app-bar row (P15 Group 2:
    // the topbar brand is hidden below 768 and the field never collapses).
    const sameRow = (a, b) => Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) <= 4
    expect(sameRow(search, views)).toBe(true)
    expect(sameRow(views, profile)).toBe(true)
    expect(search.x + search.width).toBeLessThanOrEqual(views.x)
    expect(views.x + views.width).toBeLessThanOrEqual(profile.x)
    await expect(page.locator('#main-search')).toBeVisible()

    // The Saved Links view title is visually suppressed (kept as the accessible
    // heading); the one truthful result count lives inside the results bar and
    // must never overflow it.
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expect(page.locator('.page-subtitle')).toHaveCount(0)
    await expect(page.locator('.library-results-count')).toHaveText(/^\d+ links?$/)
    const results = await page.locator('.library-results').boundingBox()
    const count = await page.locator('.library-results-count').boundingBox()
    expect(count.x).toBeGreaterThanOrEqual(results.x)
    expect(count.x + count.width).toBeLessThanOrEqual(results.x + results.width + 1)

    // Below the desktop grid the FAB is the single Add entry point: the panel's
    // duplicate "Add link" is hidden and the library has no Export control.
    await expect(page.locator('.content-head .add-card')).toBeHidden()
    await expect(page.locator('.toolbar-export')).toHaveCount(0)
    await page.locator('.fab').click()
    await expect(page.locator('#add-form')).toBeVisible()
    await page.locator('#add-form').getByRole('button', { name: 'Cancel', exact: true }).click()

    // Tablet (still below the desktop grid): the same single FAB entry point.
    await page.setViewportSize(TABLET)
    await expect(page.locator('.fab')).toBeVisible()
    await expect(page.locator('.content-head .add-card')).toBeHidden()
    await expect(page.locator('.toolbar-export')).toHaveCount(0)

    // Desktop grid: the toolbar Add returns (Export lives in Backup & restore).
    await page.setViewportSize(DESKTOP)
    await expect(page.locator('.fab')).toBeHidden()
    await expect(page.locator('.content-head .add-card')).toBeVisible()
    await expect(page.locator('.toolbar-export')).toHaveCount(0)
  })

  test('bottom bar carries the four approved destinations (no Folders)', async ({ page }) => {
    await page.setViewportSize(MOBILE)

    const items = bottomNav(page).getByRole('button')
    // P15.12: the new mockup adds Tags as a first-class mobile destination.
    await expect(items).toHaveCount(4)
    await expect(items).toHaveText([/^All$/, /^Favorites$/, /^Tags$/, /^More$/])
    // The standalone Folders page is gone; the tree lives in the More drawer.
    await expect(bottomNav(page).getByRole('button', { name: 'Folders', exact: true })).toHaveCount(0)

    // Add is the floating action, never a duplicate bar item; and Search,
    // Settings and Profile are not destinations of the bar.
    await expect(bottomNav(page).getByRole('button', { name: 'Add', exact: true })).toHaveCount(0)
    await expect(page.locator('.fab')).toBeVisible()
    await expect(bottomNav(page).getByRole('button', { name: /Search|Settings|Profile|Backup|About/ })).toHaveCount(0)
  })

  test('All and Favorites navigate through the shared filter state', async ({ page }) => {
    await page.setViewportSize(MOBILE)

    await navItem(page, 'All').click()
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expect(page.locator('.bottom-nav-item[aria-current="page"]')).toHaveText('All')

    await navItem(page, 'Favorites').click()
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expect(page.locator('.bottom-nav-item[aria-current="page"]')).toHaveText('Favorites')
    await expect(page.locator('.bottom-nav-item[aria-current="page"]')).toHaveCount(1)
  })

  test('Add opens the one shared add-link form', async ({ page }) => {
    await page.setViewportSize(MOBILE)

    // From another destination, the FAB is an action: it returns to Saved links
    // and opens the existing form (never a second form or a new view).
    await navItem(page, 'Favorites').click()
    await page.locator('.fab').click()
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expect(page.locator('#add-form')).toHaveCount(1)
    await expect(page.locator('#add-form')).toBeVisible()
    await expect(page.locator('#save-url')).toBeFocused()

    await page.locator('#add-form').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('#add-form')).toHaveCount(0)
  })

  test('More opens the navigation drawer with the real secondary destinations', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    const drawer = page.locator('.sidebar-wrapper')

    await expect(drawer).not.toHaveClass(/\bshow\b/)
    await navItem(page, 'More').click()
    await expect(drawer).toHaveClass(/\bshow\b/)
    await expect(navItem(page, 'More')).toHaveAttribute('aria-expanded', 'true')
    await expect(drawer.locator('.sidebar-menu-link').filter({ hasText: 'Settings' })).toBeVisible()
    // Tools left the sidebar: Backup & restore / About are Settings sections,
    // not drawer rows.
    await expect(drawer.locator('.sidebar-menu-link').filter({ hasText: 'Backup & restore' })).toHaveCount(0)
    await expect(drawer.locator('.sidebar-menu-link').filter({ hasText: 'About' })).toHaveCount(0)

    // The overlay (outside the drawer) closes it.
    await page.locator('.sidebar-overlay').click({ position: { x: 360, y: 120 } })
    await expect(drawer).not.toHaveClass(/\bshow\b/)
    await expect(navItem(page, 'More')).toHaveAttribute('aria-expanded', 'false')

    // The drawer's own close control closes it.
    await navItem(page, 'More').click()
    await expect(drawer).toHaveClass(/\bshow\b/)
    await drawer.getByRole('button', { name: 'Close navigation' }).click()
    await expect(drawer).not.toHaveClass(/\bshow\b/)

    // A destination navigates and closes the drawer behind it.
    await navItem(page, 'More').click()
    await drawer.locator('.sidebar-menu-link').filter({ hasText: 'Settings' }).click()
    // P15.12: Settings opens the shared modal over the current page (no page).
    const settingsDialog = page.getByRole('dialog')
    await expect(settingsDialog).toBeVisible()
    await expect(settingsDialog.locator('.dialog-title')).toHaveText('Settings')
    await expect(drawer).not.toHaveClass(/\bshow\b/)
    await page.keyboard.press('Escape')
    await expect(settingsDialog).toHaveCount(0)

    await openView(page, 'backup')
    // Backup & restore is the Settings modal's Data section now.
    await expect(page.getByRole('dialog').locator('.dialog-title')).toHaveText('Settings')
    await expect(page.getByRole('dialog').locator('.settings-nav-item.active')).toHaveText('Data')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await openView(page, 'about')
    // About is the same modal framework, opened straight to its section.
    await expect(page.getByRole('dialog').locator('.dialog-title')).toHaveText('About')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('top-bar search stays global and filters on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await saveLink(page, { url: 'https://example.com/beta', title: 'Beta Link' })
    await ensureCardView(page) // P8: the library boots in Compact
    await expect(page.locator('.grid > .card')).toHaveCount(2)

    // P15 Group 2: the inline field drives the same filtering pipeline
    // (`searchQuery` - the existing link filters).
    await page.getByLabel('Search links').click()
    await expect(page.getByLabel('Search links')).toBeFocused()
    await page.getByLabel('Search links').fill('alpha')
    await expect(page.locator('.grid > .card')).toHaveCount(1)
    await expect(page.locator('.grid > .card')).toContainText('Alpha Link')

    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    await expect(page.locator('.grid > .card')).toHaveCount(2)
  })

  test('no horizontal overflow and the bar never covers the end of the page', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    for (const [url, title] of [
      ['https://example.com/first', 'First Link'],
      ['https://example.com/second', 'Second Link'],
      ['https://example.com/third', 'Third Link'],
    ]) {
      await saveLink(page, { url, title })
    }

    const overflowAt = []
    for (const width of [320, 375, 390, 430, 480]) {
      await page.setViewportSize({ width, height: 800 })
      const fits = await page.evaluate(() => {
        const html = document.documentElement
        return html.scrollWidth <= html.clientWidth
      })
      if (!fits) overflowAt.push(width)
      await expect(bottomNav(page)).toBeVisible()
    }
    expect(overflowAt).toEqual([])

    // The fixed bar must not sit on top of the page content's end. The last
    // visible content element (the panel's pagination footer) stands in as the
    // page's end at this width.
    await page.setViewportSize(MOBILE)
    // P8/P15: the window no longer scrolls — the Links list (.links-content) is
    // the scroller, and the pagination footer is a fixed band below it.
    await page.evaluate(() => { const el = document.querySelector('.links-content'); el.scrollTop = el.scrollHeight })
    const bar = await page.locator('.bottom-nav').boundingBox()
    const lastContent = await page.locator('.table-footer-control').boundingBox()
    expect(lastContent.y + lastContent.height).toBeLessThanOrEqual(bar.y + 1)

    // ...and neither does a toast (it clears the bar instead of covering it).
    await saveLink(page, { url: 'https://example.com/toast', title: 'Toast Link' })
    const toast = await page.locator('.sl-toast').boundingBox()
    expect(toast.y + toast.height).toBeLessThanOrEqual(bar.y + 1)
  })

  test('responsive header and toolbar alignment follow the layout system', async ({ page }) => {
    // Header: the account/utility controls keep the right-hand position the
    // desktop grid gives them — including in the wrapped-flex band below the
    // desktop breakpoint, where nothing may pack them next to the drawer toggle.
    for (const width of [800, 900, 1024, 1280, 1440]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 900 })
      const nav = await page.locator('.navbar-custom').boundingBox()
      const profile = await page.locator('.identity-btn').boundingBox()
      const where = `profile @${width}`
      expect({ [where]: profile.x > nav.x + nav.width / 2 }).toEqual({ [where]: true })
      expect({ [where]: nav.x + nav.width - (profile.x + profile.width) <= 48 }).toEqual({ [where]: true })
    }

    // Toolbar: at >=1200 the Add control and the filters share one Library
    // Controls band (same flex line, filters aligned to the inner right edge).
    // Below 1200 the Add is hidden and the FAB owns it.
    for (const width of [800, 860, 900]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 900 })
      await saveLink(page, { url: `https://example.com/a${width}`, title: 'Alpha Link' })
      const where = `toolbar @${width}`
      await expect(page.locator('.content-head')).toBeHidden()
      await expect(page.locator('.fab')).toBeVisible()
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
      expect({ [where]: fits }).toEqual({ [where]: true })
    }
    for (const width of [1200, 1280, 1440]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 900 })
      await saveLink(page, { url: `https://example.com/a${width}`, title: 'Alpha Link' })
      const region = await page.locator('.library-controls').boundingBox()
      const add = await page.locator('.content-head .add-card').boundingBox()
      const filters = await page.locator('.filterbar').boundingBox()
      const regionRight = region.x + region.width
      const filtersRight = filters.x + filters.width
      const where = `toolbar @${width}`
      // both controls live in the same region and never overflow it
      expect({ [where]: add.x >= region.x - 1 && filtersRight <= regionRight + 1 }).toEqual({ [where]: true })
      // At the wider desktop columns Add and the filters share one flex line,
      // filters right-aligned.
      if (width >= 1280) {
        const addCenter = add.y + add.height / 2
        const filtersCenter = filters.y + filters.height / 2
        expect({ [where]: Math.abs(addCenter - filtersCenter) <= 6 }).toEqual({ [where]: true })
        expect({ [where]: regionRight - filtersRight >= 0 && regionRight - filtersRight <= 20 })
          .toEqual({ [where]: true })
      }
    }

    // Mobile: the empty Links toolbar band is removed; the filter bar is the
    // workspace top and the page never overflows.
    for (const width of [390, 480, 768]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 900 })
      await saveLink(page, { url: `https://example.com/m${width}`, title: 'Alpha Link' })
      const where = `mobile toolbar @${width}`
      await expect(page.locator('.content-head')).toBeHidden()
      await expect(page.locator('.filterbar')).toBeVisible()
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
      expect({ [where]: fits }).toEqual({ [where]: true })
    }
  })

  test('view-mode group lives in the topbar as one grouped control (mockup)', async ({ page }) => {
    const viewGroup = page.getByRole('group', { name: 'View mode' })

    // P15.3 re-baseline: the mockup moves the view switcher from the content
    // toolbar into the topbar. One group, three modes, existing aria-pressed
    // semantics; Compact is the boot default. The toolbar no longer carries it.
    await page.setViewportSize({ width: 390, height: 900 })
    await clearStorage(page)
    await saveLink(page, { url: 'https://example.com/view', title: 'View Mode Link' })
    await expect(page.locator('.navbar-custom .view-switch')).toBeVisible()
    await expect(page.locator('.library-controls .view-switch')).toHaveCount(0)
    await expect(viewGroup.getByRole('button')).toHaveCount(3)
    await expect(viewGroup.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')
    await expect(viewGroup.getByRole('button', { name: 'Card' })).toHaveAttribute('aria-pressed', 'false')

    // The active mode uses the approved NEUTRAL fill (muted surface + heading
    // text), not an accent tint.
    const styles = await page.evaluate(() => {
      const el = document.querySelector('.view-btn.active')
      const probe = document.createElement('div')
      probe.style.background = 'var(--muted-bg)'
      probe.style.color = 'var(--text-h)'
      document.body.appendChild(probe)
      const p = getComputedStyle(probe)
      const out = { bg: getComputedStyle(el).backgroundColor, mutedBg: p.backgroundColor, color: getComputedStyle(el).color, textH: p.color }
      probe.remove()
      return out
    })
    expect(styles.bg).toBe(styles.mutedBg)
    expect(styles.color).toBe(styles.textH)

    // Every shell width: the group stays inside the topbar row, the segments stay
    // inside the group, and the topbar never overflows horizontally.
    for (const width of [320, 390, 480, 640, 768, 900, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(120)
      const box = await page.evaluate(() => {
        const nav = document.querySelector('.navbar-custom').getBoundingClientRect()
        const btns = [...document.querySelectorAll('.view-switch .view-btn')]
        const group = document.querySelector('.view-switch').getBoundingClientRect()
        const left = Math.min(...btns.map((b) => b.getBoundingClientRect().left))
        const right = Math.max(...btns.map((b) => b.getBoundingClientRect().right))
        return {
          inTopbar: group.top >= nav.top - 1 && group.bottom <= nav.bottom + 1,
          segmentsInsideGroup: left >= group.left - 1 && right <= group.right + 1,
          inside: left >= 0 && right <= window.innerWidth,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }
      })
      const where = `view group @${width}`
      expect({ [where]: box.inTopbar }).toEqual({ [where]: true })
      expect({ [where]: box.segmentsInsideGroup }).toEqual({ [where]: true })
      expect({ [where]: box.inside }).toEqual({ [where]: true })
      expect({ [where]: box.overflow }).toEqual({ [where]: false })
    }

    // Every mode stays an individually usable button and the state round-trips.
    await viewGroup.getByRole('button', { name: 'List' }).click()
    await expect(viewGroup.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    await expect(viewGroup.getByRole('button', { name: 'Card' })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.view-btn.active')).toHaveCount(1)

    await viewGroup.getByRole('button', { name: 'Compact' }).click()
    await expect(viewGroup.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.view-btn.active')).toHaveCount(1)

    await viewGroup.getByRole('button', { name: 'Card' }).click()
    await expect(viewGroup.getByRole('button', { name: 'Card' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.view-btn.active')).toHaveCount(1)

    // No links: the topbar keeps the switcher (mockup shell), while the content
    // toolbar still renders nothing to align (documented current behaviour).
    await clearStorage(page)
    await expect(page.locator('.navbar-custom .view-switch')).toBeVisible()
    await expect(page.locator('.library-controls .filterbar')).toHaveCount(0)
  })

  test('the filter bar stays usable on every mobile width', async ({ page }) => {
    // P15.10: the sort/filter disclosure is gone with the sort UI. The filter
    // bar is one horizontally scrollable chip row at every width, and the real
    // filter pipeline still works from it.
    for (const width of [320, 375, 390, 430, 480, 640, 768]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 900 })
      await saveLink(page, { url: `https://example.com/a${width}`, title: 'Alpha Link', category: 'Other' })
      await saveLink(page, { url: `https://example.com/b${width}`, title: 'Beta Link', category: 'Other' })
      await ensureCardView(page) // P8: the library boots in Compact
      const where = `filter bar @${width}`

      // No sort control and no disclosure trigger anywhere.
      await expect(page.locator('#filter-sort')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /sort\s*(&|and)?\s*filter/i })).toHaveCount(0)

      // The bar is present with the real dimension chips.
      await expect(page.locator('.filterbar')).toBeVisible()
      for (const name of ['Filter by date', 'Filter by category', 'Filter by type']) {
        await expect(page.getByRole('combobox', { name })).toBeVisible()
      }
      const box = await page.evaluate(() => {
        const el = document.querySelector('.filterbar')
        const b = el.getBoundingClientRect()
        return {
          inside: b.left >= 0 && b.right <= window.innerWidth,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        }
      })
      expect({ [where]: box.inside }).toEqual({ [where]: true })
      expect({ [where]: box.overflow }).toEqual({ [where]: false })

      // The existing filter pipeline works from the bar.
      await page.locator('#filter-category').selectOption('Other')
      await expect(page.locator('.grid > .card')).toHaveCount(2)
      await page.locator('#filter-type').selectOption('video')
      await expect(page.locator('.grid > .card')).toHaveCount(0)
      // active state is exposed on the chip itself
      await expect(page.locator('#filter-type')).toHaveValue('video')

      // Clearing restores the full list.
      await page.locator('#filter-type').selectOption('')
      await page.locator('#filter-category').selectOption('')
      await expect(page.locator('.grid > .card')).toHaveCount(2)
    }
  })

  test('the mobile library keeps its deterministic newest-first order', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await clearStorage(page)
    await saveLink(page, { url: 'https://example.com/first', title: 'Alpha Link' })
    await saveLink(page, { url: 'https://example.com/second', title: 'Zeta Link' })
    await ensureCardView(page) // P8: the library boots in Compact
    // P15.10: the sort control is gone; newest-first is the one display order.
    await expect(page.locator('.grid > .card').first()).toContainText('Zeta Link')
    await expect(page.locator('#filter-sort')).toHaveCount(0)

    // The real filters still work from the mobile filter bar.
    await page.locator('#filter-type').selectOption('video')
    await expect(page.locator('.grid > .card')).toHaveCount(0)
    await page.locator('#filter-type').selectOption('')
    await expect(page.locator('.grid > .card')).toHaveCount(2)
    await expect(page.locator('.grid > .card').first()).toContainText('Zeta Link')
    await expect(page.locator('.grid > .card').nth(1)).toContainText('Alpha Link')
  })

  test('tablet keeps the drawer + bar band and the drawer still closes', async ({ page }) => {
    await page.setViewportSize(TABLET)

    // P8: 768-1023 is still the drawer band, with the topbar brand, the bottom
    // bar and the floating Add action.
    await expect(page.locator('.sidebar-toggle-btn')).toBeVisible()
    await expect(page.locator('.mobile-brand')).toBeVisible()
    await expect(page.locator('.bottom-nav')).toBeVisible()
    await expect(page.locator('.fab')).toBeVisible()

    await page.locator('#sidebar-toggle').click()
    await expect(page.locator('.sidebar-wrapper')).toHaveClass(/show/)
    // A Library destination still navigates and closes the drawer (the
    // standalone Tools rows were removed from the drawer).
    await page.locator('.sidebar-menu-link', { hasText: 'All Links' }).click()
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/show/)
  })

  test('the shell switches to the desktop grid at 1200px', async ({ page }) => {
    // P8 breakpoint: >=1200 is the mockup's static three-column grid.
    await page.setViewportSize({ width: 1200, height: 900 })
    await expect(page.locator('.bottom-nav')).toBeHidden()
    await expect(page.locator('.fab')).toBeHidden()
    await expect(page.locator('.sidebar-toggle-btn')).toBeHidden()
    await expect(page.locator('.sidebar-wrapper')).toBeVisible()
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/\bshow\b/) // static, not a drawer
    await expect(page.locator('.mobile-brand')).toBeVisible()
    await expect(page.getByLabel('Search links')).toBeVisible()
    await expect(page.locator('.content-head .add-toggle')).toBeVisible()

    // 1199 is still the tablet drawer band (1024 included).
    await page.setViewportSize({ width: 1199, height: 900 })
    await expect(page.locator('.bottom-nav')).toBeVisible()
    await expect(page.locator('.fab')).toBeVisible()
    await expect(page.locator('.sidebar-toggle-btn')).toBeVisible()
    await expect(page.locator('.mobile-brand')).toBeVisible()
    await expect(page.getByLabel('Search links')).toBeVisible()

    await page.setViewportSize({ width: 1024, height: 900 })
    await expect(page.locator('.bottom-nav')).toBeVisible()
    await expect(page.locator('.sidebar-toggle-btn')).toBeVisible()
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/\bshow\b/) // off-canvas
  })

  test('desktop is the static grid shell', async ({ page }) => {
    await page.setViewportSize(DESKTOP)

    await expect(page.locator('.sidebar-wrapper')).toBeVisible()
    await expect(page.locator('.sidebar-toggle-btn')).toBeHidden()
    await expect(page.locator('.mobile-brand')).toBeVisible() // topbar brand (mockup)
    await expect(page.locator('.bottom-nav')).toBeHidden()
    await expect(page.locator('.fab')).toBeHidden()
    // the detail rail is structurally present before any selection (mockup)
    await expect(page.locator('.detail')).toBeVisible()
    await expect(page.locator('.detail-empty-title')).toHaveText('No link selected')
    // the desktop page header keeps its Add link
    await expect(page.locator('.content-head .add-toggle')).toBeVisible()

    // The folder surface is the sidebar tree itself (no Folders destination).
    await openView(page, 'folders')
    await expect(page.locator('[data-testid="sidebar-folder-new"]')).toBeVisible()
  })

  test('bottom bar follows appearance and stays scheme-neutral', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await saveLink(page, { url: 'https://example.com/theme', title: 'Theme Link' })

    const readShell = () => page.evaluate(() => {
      // The library workspace is chrome-free now, so resolve the neutral card
      // token directly for the bar-vs-surface comparison.
      const probe = document.createElement('div')
      probe.style.backgroundColor = 'var(--card)'
      document.body.appendChild(probe)
      const cardSurface = getComputedStyle(probe).backgroundColor
      probe.remove()
      return {
        bar: getComputedStyle(document.querySelector('.bottom-nav')).backgroundColor,
        surface: cardSurface,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        active: getComputedStyle(document.querySelector('.bottom-nav-item[aria-current="page"]')).color,
        inactive: getComputedStyle(document.querySelectorAll('.bottom-nav-item')[1]).color,
      }
    })

    // Light: the bar is the neutral card surface, inactive items are muted.
    await openView(page, 'settings')
    await page.getByLabel('Light theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light')
    await page.keyboard.press('Escape') // P15.12: close the Settings modal
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await openView(page, 'links')
    await page.waitForTimeout(250) // item colors animate (150ms) between active states
    const light = await readShell()
    expect(light.bar).toBe(light.surface)
    expect(light.active).not.toBe(light.inactive)

    // Dark: same token, dark value — not the scheme accent.
    await openView(page, 'settings')
    await page.getByLabel('Dark theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await page.keyboard.press('Escape') // P15.12: close the Settings modal
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await openView(page, 'links')
    await page.waitForTimeout(250) // item colors animate (150ms) between active states
    const dark = await readShell()
    expect(dark.bar).toBe(dark.surface)
    expect(dark.bar).not.toBe(light.bar)
    expect(dark.active).not.toBe(dark.inactive)

    // Every color scheme moves the accent only: the bar surface never changes.
    for (const [label, scheme] of [
      ['Ocean', 'ocean'],
      ['Forest', 'forest'],
      ['Lavender', 'lavender'],
      ['Warm Amber', 'amber'],
    ]) {
      await openView(page, 'settings')
      await selectColorScheme(page, label)
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme', scheme)
      await openView(page, 'links')

      const shell = await readShell()
      expect(shell.bar).toBe(dark.bar)
      // The current destination takes the scheme accent (transition settles first).
      const accentRgb = `rgb(${toRgb(shell.accent).join(', ')})`
      await expect.poll(async () => (await readShell()).active).toBe(accentRgb)
      const settled = await readShell()
      expect(settled.active).not.toBe(settled.inactive)
    }
  })
})
