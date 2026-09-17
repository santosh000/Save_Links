import { test, expect } from '@playwright/test'
import { clearStorage, openView, saveLink } from './helpers.js'

// Mobile shell (approved architecture): top bar = branding · search · profile,
// bottom bar = exactly Links · Folders · Add · More. Tablet keeps the sidebar
// drawer, desktop is unchanged. The shell is CSS-conditional on one breakpoint,
// so these tests assert both the structure and the behaviour of that shell.
const MOBILE = { width: 390, height: 844 }
const TABLET = { width: 900, height: 1100 }
const DESKTOP = { width: 1280, height: 900 }

const bottomNav = (page) => page.getByRole('navigation', { name: 'Primary' })
const navItem = (page, name) => bottomNav(page).getByRole('button', { name, exact: true })
const moreMenu = (page) => page.locator('#more-menu')

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

  test('mobile top bar is branding, search and profile only', async ({ page }) => {
    await page.setViewportSize(MOBILE)

    await expect(page.locator('.mobile-brand')).toBeVisible()
    // Search is collapsed behind its affordance by default (Step 1A); the field
    // itself appears only while searching.
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible()
    await expect(page.getByLabel('Search links')).toBeHidden()
    await expect(page.locator('.identity-btn')).toBeVisible()

    // The drawer is not part of the mobile shell, and nothing else is stacked in.
    await expect(page.locator('#sidebar-toggle')).toBeHidden()
    await expect(page.locator('.sidebar-wrapper')).toBeHidden()
    await expect(page.locator('.sidebar-overlay')).toBeHidden()
    await expect(page.locator('#btn-fullscreen')).toBeHidden()
  })

  test('mobile header keeps profile at the far right and hides the duplicate toolbar actions', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    // One link so the toolbar controls exist (they render only with links).
    await saveLink(page, { url: 'https://example.com/step1', title: 'Step One Link' })

    const nav = await page.locator('.navbar-custom').boundingBox()
    const brand = await page.locator('.mobile-brand').boundingBox()
    const profile = await page.locator('.identity-btn').boundingBox()

    // Brand stays on the left, the existing profile control sits at the far
    // right of the header row (flex distribution, not fixed positioning).
    expect(brand.x).toBeLessThan(nav.x + nav.width / 2)
    expect(profile.x).toBeGreaterThan(nav.x + nav.width / 2)
    expect(profile.x + profile.width).toBeGreaterThan(nav.x + nav.width - 32)
    expect(profile.x).toBeGreaterThanOrEqual(brand.x + brand.width)

    // Brand · search affordance · profile form ONE compact app-bar row; the
    // search field itself stays collapsed behind the affordance (Step 1A).
    const search = await page.getByRole('button', { name: 'Search', exact: true }).boundingBox()
    const sameRow = (a, b) => Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) <= 4
    expect(sameRow(brand, search)).toBe(true)
    expect(sameRow(search, profile)).toBe(true)
    expect(search.x).toBeGreaterThanOrEqual(brand.x + brand.width)
    expect(search.x + search.width).toBeLessThanOrEqual(profile.x)
    await expect(page.locator('#main-search')).toBeHidden()

    // The Saved Links heading and its dynamic count form one compact row (title
    // at the start, count ending at the content edge) — the count stays reactive.
    const title = await page.locator('.page-title').boundingBox()
    const count = await page.locator('.page-subtitle').boundingBox()
    const header = await page.locator('.page-header').boundingBox()
    expect(sameRow(title, count)).toBe(true)
    expect(count.x).toBeGreaterThan(title.x + title.width)
    expect(Math.abs((header.x + header.width) - (count.x + count.width))).toBeLessThanOrEqual(1)
    await expect(page.locator('.page-subtitle')).toHaveText(/^\d+ of \d+ links shown$/)

    // The bottom bar's Add is the single mobile Add entry point: the panel's
    // duplicate "Save a link" and the Export control are hidden here.
    await expect(page.locator('.content-head .add-card')).toBeHidden()
    await expect(page.locator('.toolbar-export')).toBeHidden()
    await navItem(page, 'Add').click()
    await expect(page.locator('#add-form')).toBeVisible()
    await page.locator('.add-popover').getByRole('button', { name: 'Cancel', exact: true }).click()

    // Tablet and desktop keep both toolbar actions.
    await page.setViewportSize(TABLET)
    await expect(page.locator('.content-head .add-card')).toBeVisible()
    await expect(page.locator('.toolbar-export')).toBeVisible()

    await page.setViewportSize(DESKTOP)
    await expect(page.locator('.content-head .add-card')).toBeVisible()
    await expect(page.locator('.toolbar-export')).toBeVisible()
  })

  test('bottom bar carries exactly the four approved destinations', async ({ page }) => {
    await page.setViewportSize(MOBILE)

    const items = bottomNav(page).getByRole('button')
    await expect(items).toHaveCount(4)
    await expect(items).toHaveText([/^Links$/, /^Folders$/, /^Add$/, /^More$/])

    // Search, Settings and Profile are not destinations of the bar.
    await expect(bottomNav(page).getByRole('button', { name: /Search|Settings|Profile|Backup|About/ })).toHaveCount(0)
  })

  test('Links and Folders navigate through the shared view state', async ({ page }) => {
    await page.setViewportSize(MOBILE)

    await navItem(page, 'Links').click()
    await expect(page.locator('.page-title')).toHaveText('Saved links')
    await expect(page.locator('.bottom-nav-item[aria-current="page"]')).toHaveText('Links')

    await navItem(page, 'Folders').click()
    await expect(page.locator('.page-title')).toHaveText('Folders')
    await expect(page.locator('.bottom-nav-item[aria-current="page"]')).toHaveText('Folders')
    await expect(page.locator('.bottom-nav-item[aria-current="page"]')).toHaveCount(1)
  })

  test('Add opens the one shared add-link form', async ({ page }) => {
    await page.setViewportSize(MOBILE)

    // From another destination, Add is an action: it returns to Saved links
    // and opens the existing form (never a second form or a new view).
    await navItem(page, 'Folders').click()
    await navItem(page, 'Add').click()
    await expect(page.locator('.page-title')).toHaveText('Saved links')
    await expect(page.locator('#add-form')).toHaveCount(1)
    await expect(page.locator('#add-form')).toBeVisible()
    await expect(page.locator('#save-url')).toBeFocused()

    await page.locator('.add-popover').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.locator('#add-form')).toHaveCount(0)
  })

  test('More exposes the secondary destinations and closes cleanly', async ({ page }) => {
    await page.setViewportSize(MOBILE)

    await expect(moreMenu(page)).toHaveCount(0)
    await navItem(page, 'More').click()
    await expect(moreMenu(page)).toBeVisible()
    await expect(navItem(page, 'More')).toHaveAttribute('aria-expanded', 'true')
    await expect(moreMenu(page).getByRole('button')).toHaveText([/^Settings$/, /^Backup & restore$/, /^About$/])

    // Escape closes it
    await page.keyboard.press('Escape')
    await expect(moreMenu(page)).toHaveCount(0)
    await expect(navItem(page, 'More')).toHaveAttribute('aria-expanded', 'false')

    // An outside click closes it too
    await navItem(page, 'More').click()
    await expect(moreMenu(page)).toBeVisible()
    await page.locator('.page-title').click()
    await expect(moreMenu(page)).toHaveCount(0)

    // A destination navigates and closes the menu behind it
    await navItem(page, 'More').click()
    await moreMenu(page).getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.locator('.page-title')).toHaveText('Settings')
    await expect(moreMenu(page)).toHaveCount(0)
    await expect(navItem(page, 'More')).toHaveClass(/active/)

    // ...and the destinations it replaced are still reachable from the drawer's
    // equivalent entries (Backup & restore, About).
    await openView(page, 'backup')
    await expect(page.locator('.page-title')).toHaveText('Backup & restore')
    await openView(page, 'about')
    await expect(page.locator('.page-title')).toHaveText('About')
  })

  test('top-bar search stays global and filters on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await saveLink(page, { url: 'https://example.com/beta', title: 'Beta Link' })
    await expect(page.locator('.grid > .card')).toHaveCount(2)

    // The collapsed bar opens the existing field, which still drives the same
    // filtering pipeline (`searchQuery` → the existing link filters).
    await page.getByRole('button', { name: 'Search', exact: true }).click()
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

    // The fixed bar must not sit on top of the page content's end.
    await page.setViewportSize(MOBILE)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const bar = await page.locator('.bottom-nav').boundingBox()
    const footer = await page.locator('.footer').boundingBox()
    expect(footer.y + footer.height).toBeLessThanOrEqual(bar.y + 1)

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

    // Toolbar: the Add control and the control group share one toolbar line
    // wherever both are shown (the group wraps internally instead of dropping
    // below the Add), and the group stays right-aligned at tablet/desktop.
    for (const width of [800, 860, 900, 1280, 1440]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 900 })
      await saveLink(page, { url: `https://example.com/a${width}`, title: 'Alpha Link' })
      const head = await page.locator('.content-head').boundingBox()
      const add = await page.locator('.content-head .add-card').boundingBox()
      const controls = await page.locator('.toolbar-controls').boundingBox()
      const addCenter = add.y + add.height / 2
      const controlsRight = controls.x + controls.width
      const headRight = head.x + head.width
      const where = `toolbar @${width}`
      // same flex line, vertically centred against the group
      expect({ [where]: addCenter >= controls.y - 1 && addCenter <= controls.y + controls.height + 1 })
        .toEqual({ [where]: true })
      // group aligned to the inner right edge of the panel
      expect({ [where]: headRight - controlsRight >= 0 && headRight - controlsRight <= 20 })
        .toEqual({ [where]: true })
    }

    // Mobile: the control group is the only toolbar child, so it is balanced
    // inside the panel (equal insets) instead of being pushed to the right.
    for (const width of [390, 480, 768]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 900 })
      await saveLink(page, { url: `https://example.com/m${width}`, title: 'Alpha Link' })
      const head = await page.locator('.content-head').boundingBox()
      const controls = await page.locator('.toolbar-controls').boundingBox()
      const leftInset = Math.round(controls.x - head.x)
      const rightInset = Math.round(head.x + head.width - (controls.x + controls.width))
      const where = `mobile toolbar @${width}`
      expect({ [where]: Math.abs(leftInset - rightInset) <= 2 }).toEqual({ [where]: true })
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
      expect({ [where]: fits }).toEqual({ [where]: true })
    }
  })

  test('view-mode group stays one grouped control and shares the toolbar row on mobile', async ({ page }) => {
    const viewGroup = page.getByRole('group', { name: 'View mode' })

    // One group, three modes, existing semantics intact.
    await page.setViewportSize({ width: 390, height: 900 })
    await clearStorage(page)
    await saveLink(page, { url: 'https://example.com/view', title: 'View Mode Link' })
    await expect(viewGroup).toBeVisible()
    await expect(viewGroup.getByRole('button')).toHaveCount(3)
    await expect(viewGroup.getByRole('button', { name: 'Card' })).toHaveAttribute('aria-pressed', 'true')
    await expect(viewGroup.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false')

    // Mobile: the group hugs its three segments (a segmented control, not a
    // full-width bar), shares the toolbar row with the Sort & Filter trigger,
    // keeps the sort/filter controls outside its own container, and never
    // overflows.
    for (const width of [320, 390, 480, 640, 768]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(120)
      const box = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('.view-switch .view-btn')]
        const groupEl = document.querySelector('.view-switch')
        const left = Math.min(...btns.map((b) => b.getBoundingClientRect().left))
        const right = Math.max(...btns.map((b) => b.getBoundingClientRect().right))
        const group = groupEl.getBoundingClientRect()
        const bar = document.querySelector('.toolbar-controls').getBoundingClientRect()
        const trigger = document.querySelector('.sort-filter-toggle').getBoundingClientRect()
        return {
          segmentsInsideGroup: left >= group.left - 1 && right <= group.right + 1,
          hugsSegments: group.width < bar.width - 40,
          sameRowAsTrigger: Math.abs((group.y + group.height / 2) - (trigger.y + trigger.height / 2)) < 6,
          sortOutsideGroup: !groupEl.contains(document.querySelector('#filter-sort')),
          inside: left >= 0 && right <= window.innerWidth,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }
      })
      const where = `view group @${width}`
      expect({ [where]: box.segmentsInsideGroup }).toEqual({ [where]: true })
      expect({ [where]: box.hugsSegments }).toEqual({ [where]: true })
      expect({ [where]: box.sameRowAsTrigger }).toEqual({ [where]: true })
      expect({ [where]: box.sortOutsideGroup }).toEqual({ [where]: true })
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

    // Tablet/desktop: the group keeps its inline place next to the filters
    // (not the full-width mobile line) and the filters stay reachable.
    for (const width of [900, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(120)
      const inline = await page.evaluate(() => {
        const group = document.querySelector('.view-switch').getBoundingClientRect()
        const bar = document.querySelector('.toolbar-controls').getBoundingClientRect()
        const sort = document.querySelector('#filter-sort').closest('.asel').getBoundingClientRect()
        return { narrower: group.width < bar.width - 40, sameLine: Math.abs(group.y - sort.y) < 6, leftOfSort: group.right <= sort.left }
      })
      const where = `view group inline @${width}`
      expect({ [where]: inline.narrower && inline.sameLine && inline.leftOfSort }).toEqual({ [where]: true })
      // The secondary controls stay directly visible on desktop/tablet, and the
      // mobile disclosure trigger does not exist there.
      await expect(page.locator('.sort-filter-toggle')).toBeHidden()
      for (const name of ['Sort by', 'Filter by category', 'Filter by status']) {
        await expect(page.getByRole('combobox', { name })).toBeVisible()
      }
    }

    // No links: the toolbar controls do not render at all, so there is no group
    // to align (documented current behaviour).
    await clearStorage(page)
    await expect(page.locator('.toolbar-controls')).toHaveCount(0)
  })

  test('secondary sort/filter controls are progressively disclosed on mobile', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Sort & Filter', exact: true })
    const panel = page.locator('#sort-filter-panel')

    for (const width of [320, 375, 390, 430, 480, 640, 768]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 900 })
      await saveLink(page, { url: `https://example.com/a${width}`, title: 'Alpha Link', category: 'Other' })
      await saveLink(page, { url: `https://example.com/b${width}`, title: 'Beta Link', category: 'Other' })
      const where = `disclosure @${width}`

      // Collapsed: one trigger, the existing controls are not visible and not
      // duplicated (single instance each, hidden with the panel).
      await expect(trigger).toBeVisible()
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await expect(panel).toBeHidden()
      for (const id of ['#filter-sort', '#filter-category', '#filter-status']) {
        await expect(page.locator(id)).toHaveCount(1)
        await expect(page.locator(id)).toBeHidden()
      }

      // Expanded: the existing AppSelects are the controls that are revealed.
      await trigger.click()
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      await expect(panel).toBeVisible()
      for (const name of ['Sort by', 'Filter by category', 'Filter by status']) {
        await expect(page.getByRole('combobox', { name })).toBeVisible()
      }
      const box = await page.evaluate(() => {
        const b = document.querySelector('#sort-filter-panel').getBoundingClientRect()
        return {
          inside: b.left >= 0 && b.right <= window.innerWidth && b.top >= 0 && b.bottom <= window.innerHeight,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        }
      })
      expect({ [where]: box.inside }).toEqual({ [where]: true })
      expect({ [where]: box.overflow }).toEqual({ [where]: false })

      // The existing state/handlers/filter pipeline work through the disclosure.
      await page.locator('#filter-category').selectOption('Other')
      await page.waitForTimeout(220)
      await expect(page.locator('.grid > .card')).toHaveCount(2)
      await page.locator('#filter-status').selectOption('important')
      await page.waitForTimeout(220)
      await expect(page.locator('.grid > .card')).toHaveCount(0)
      // The trigger shows the active state derived from the existing state.
      await expect(trigger).toHaveClass(/active/)

      // Closing keeps the selected values, the applied filters and focus.
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      await expect(trigger).toBeFocused()
      await expect(page.locator('#filter-category')).toHaveValue('Other')
      await expect(page.locator('#filter-status')).toHaveValue('important')
      await expect(page.locator('.grid > .card')).toHaveCount(0)

      // Re-opening shows the same values still selected.
      await trigger.click()
      await expect(panel).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'Filter by status' })).toHaveText(/Important/)
      await page.locator('.page-title').click() // outside click closes (existing popover behaviour)
      await expect(panel).toBeHidden()
    }
  })

  test('the sort control inside the mobile disclosure still sorts the links', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await clearStorage(page)
    await saveLink(page, { url: 'https://example.com/first', title: 'Alpha Link' })
    await saveLink(page, { url: 'https://example.com/second', title: 'Zeta Link' })
    // Default sort is newest-first, so the most recently saved link leads.
    await expect(page.locator('.grid > .card').first()).toContainText('Zeta Link')

    await page.getByRole('button', { name: 'Sort & Filter', exact: true }).click()
    await page.locator('#filter-sort').selectOption('title-az')
    await page.waitForTimeout(220)
    await expect(page.locator('#filter-sort')).toHaveValue('title-az')
    // Sorting by title flips the order — the existing sort pipeline, unchanged.
    await expect(page.locator('.grid > .card').first()).toContainText('Alpha Link')
    await expect(page.locator('.grid > .card').nth(1)).toContainText('Zeta Link')
    await expect(page.getByRole('button', { name: 'Sort & Filter', exact: true })).toHaveClass(/active/)
  })

  test('tablet keeps the desktop structure and the drawer still closes', async ({ page }) => {
    await page.setViewportSize(TABLET)

    await expect(page.locator('.sidebar-toggle-btn')).toBeVisible()
    await expect(page.locator('.mobile-brand')).toBeHidden()
    await expect(page.locator('.bottom-nav')).toBeHidden()

    await page.locator('#sidebar-toggle').click()
    await expect(page.locator('.sidebar-wrapper')).toHaveClass(/show/)
    await page.locator('.sidebar-menu-link', { hasText: 'Folders' }).click()
    await expect(page.locator('.page-title')).toHaveText('Folders')
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/show/)
  })

  test('the shell switches to the mobile bar below the tablet breakpoint', async ({ page }) => {
    // One breakpoint for the shell: 768px, the width the phone layout already used.
    await page.setViewportSize({ width: 769, height: 900 })
    await expect(page.locator('.bottom-nav')).toBeHidden()
    await expect(page.locator('.sidebar-toggle-btn')).toBeVisible()
    await expect(page.locator('.mobile-brand')).toBeHidden()
    // Tablet keeps the always-visible field and none of the mobile affordance.
    await expect(page.getByLabel('Search links')).toBeVisible()
    await expect(page.locator('.navbar-search-toggle')).toBeHidden()

    await page.setViewportSize({ width: 768, height: 900 })
    await expect(page.locator('.bottom-nav')).toBeVisible()
    await expect(page.locator('.sidebar-toggle-btn')).toBeHidden()
    await expect(page.locator('.mobile-brand')).toBeVisible()
    await expect(page.locator('.navbar-search-toggle')).toBeVisible()
    await expect(page.getByLabel('Search links')).toBeHidden()
  })

  test('desktop is unchanged', async ({ page }) => {
    await page.setViewportSize(DESKTOP)

    await expect(page.locator('.sidebar-wrapper')).toBeVisible()
    await expect(page.locator('.sidebar-toggle-btn')).toBeHidden()
    await expect(page.locator('.mobile-brand')).toBeHidden()
    await expect(page.locator('.bottom-nav')).toBeHidden()
    // the desktop page header keeps its Add link
    await expect(page.locator('.btn-date-picker')).toBeVisible()

    await page.locator('.sidebar-menu-link', { hasText: 'Folders' }).click()
    await expect(page.locator('.page-title')).toHaveText('Folders')
  })

  test('bottom bar follows appearance and stays scheme-neutral', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await saveLink(page, { url: 'https://example.com/theme', title: 'Theme Link' })

    const readShell = () => page.evaluate(() => ({
      bar: getComputedStyle(document.querySelector('.bottom-nav')).backgroundColor,
      surface: getComputedStyle(document.querySelector('.links-panel')).backgroundColor,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      active: getComputedStyle(document.querySelector('.bottom-nav-item[aria-current="page"]')).color,
      inactive: getComputedStyle(document.querySelectorAll('.bottom-nav-item')[1]).color,
    }))

    // Light: the bar is the neutral card surface, inactive items are muted.
    await openView(page, 'settings')
    await page.getByLabel('Light theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light')
    await openView(page, 'links')
    const light = await readShell()
    expect(light.bar).toBe(light.surface)
    expect(light.active).not.toBe(light.inactive)

    // Dark: same token, dark value — not the scheme accent.
    await openView(page, 'settings')
    await page.getByLabel('Dark theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await openView(page, 'links')
    const dark = await readShell()
    expect(dark.bar).toBe(dark.surface)
    expect(dark.bar).not.toBe(light.bar)
    expect(dark.active).not.toBe(dark.inactive)

    // Every color scheme moves the accent only: the bar surface never changes.
    for (const [label, scheme] of [
      ['Ocean color scheme', 'ocean'],
      ['Forest color scheme', 'forest'],
      ['Lavender color scheme', 'lavender'],
      ['Amber color scheme', 'amber'],
    ]) {
      await openView(page, 'settings')
      await page.getByLabel(label).click()
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme', scheme)
      await openView(page, 'links')

      const shell = await readShell()
      expect(shell.bar).toBe(dark.bar)
      // The current destination takes the scheme accent (transition settles first).
      const accentRgb = `rgb(${toRgb(shell.accent).join(', ')})`
      await expect.poll(async () => (await readShell()).active).toBe(accentRgb)
      expect(shell.active).not.toBe(shell.inactive)
    }
  })
})
