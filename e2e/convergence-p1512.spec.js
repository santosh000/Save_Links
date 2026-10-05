// P15.12 — UI/UX convergence: one Add entry point, toolbar hierarchy,
// select-all + clear-all-filters, star/pin states, Settings/About modal
// architecture, theme selector, mobile Tags destination, folder editing.
import { test, expect } from '@playwright/test'
import { clearStorage, ensureCardView, expectNoHorizontalScroll, saveLink, visibleLinkRows, openView } from './helpers.js'

const dialog = (page) => page.getByRole('dialog')

async function seed(page, count = 3) {
  for (let i = 0; i < count; i++) {
    await saveLink(page, { url: `https://example.com/p1512-${i}`, title: `P1512 Link ${i}` })
  }
}

test.describe('P15.12 — header, toolbar, results', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('one Add entry point: the toolbar action, never the page header', async ({ page }) => {
    await page.goto('/')
    await seed(page)
    await expect(page.locator('.page-header-add')).toHaveCount(0)
    await expect(page.locator('.page-header .btn')).toHaveCount(0)
    await expect(page.locator('.content-head .add-toggle')).toBeVisible()
    // Export left the main library toolbar (it stays available in Backup &
    // restore / Settings).
    await expect(page.locator('.toolbar-export')).toHaveCount(0)

    // below the desktop grid the FAB is the single entry point
    await page.setViewportSize({ width: 375, height: 800 })
    await expect(page.locator('.fab')).toBeVisible()
    await expect(page.locator('.content-head .add-toggle')).toBeHidden()
    await expectNoHorizontalScroll(page)
  })

  test('library controls are one band and the results row is lightweight metadata', async ({ page }) => {
    await page.goto('/')
    await seed(page)
    const band = (sel) => page.locator(sel).evaluate((el) => {
      const cs = getComputedStyle(el)
      return { borderBottom: cs.borderBottomWidth, bg: cs.backgroundColor }
    })
    // One hairline for the whole Library Controls region (Add + filters).
    expect(await band('.library-controls')).toMatchObject({ borderBottom: '1px' })
    expect(await band('.content-head')).toMatchObject({ borderBottom: '0px' })
    expect(await band('.filterbar')).toMatchObject({ borderBottom: '0px' })
    // The results row and the date-group labels are list metadata, not bands.
    expect(await band('.library-results')).toMatchObject({ borderBottom: '0px', bg: 'rgba(0, 0, 0, 0)' })
    expect(await band('.group-h')).toMatchObject({ borderBottom: '0px' })
  })

  test('result count + Select all describe the real visible page', async ({ page }) => {
    await page.goto('/')
    await seed(page, 12)
    const count = page.locator('.library-results-count')
    await expect(count).toHaveText(/^Showing 1–10 of 12 links$/)
    await page.locator('.pagination .page-link[aria-label="Page 2"]').click()
    await expect(count).toHaveText(/^Showing 11–12 of 12 links$/)
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await page.locator('.pagination .page-link[aria-label="Page 1"]').click()

    // Select all selects the rendered collection page (existing bulk model)
    await expect(page.locator('.select-visible-label')).toHaveText('Select all')
    await page.locator('.select-visible').click()
    await expect(page.locator('.bulk-bar .bulk-count')).toHaveText('10 selected')
    await page.locator('.bulk-bar').getByRole('button', { name: 'Clear selection' }).click()
    await expect(page.locator('.bulk-bar')).toHaveCount(0)
  })

  test('Clear all filters clears every filter dimension but keeps search', async ({ page }) => {
    await page.goto('/')
    await seed(page, 4)
    const clearAll = page.getByRole('button', { name: 'Clear all filters' })
    await expect(clearAll).toHaveCount(0) // hidden with nothing to clear

    await page.locator('#filter-type').selectOption('video')
    await page.getByRole('button', { name: 'Show pinned links only' }).click()
    await page.getByLabel('Search links').fill('P1512')
    await expect(clearAll).toBeVisible()

    await clearAll.click()
    await expect(page.locator('#filter-type')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Show pinned links only' })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByLabel('Search links')).toHaveValue('P1512') // search is not a filter chip
    await expect(clearAll).toHaveCount(0)
    await expect(page.locator('.library-results-count')).toHaveText('4 links')
    await page.getByLabel('Search links').fill('')
  })
})

test.describe('P15.12 — favorite/pin states', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('the star is a clean outline when off and amber when on, with no filled pill behind it', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/p1512-state', title: 'State Link' })
    await ensureCardView(page)
    const card = page.locator('.grid > .card').first()
    const star = card.getByRole('button', { name: 'Toggle Favorite' })
    const pin = card.getByRole('button', { name: 'Toggle Pin' })

    // resting: outline glyph on the control's own surface (never tinted)
    await expect(star).not.toHaveClass(/\bon\b/)
    expect(await star.evaluate((el) => getComputedStyle(el.querySelector('svg')).fill)).toBe('none')
    expect(await star.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)') // banner surface

    await star.click()
    await expect(star).toHaveClass(/\bon\b/)
    const favorite = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--favorite)'
      document.body.appendChild(probe)
      const out = getComputedStyle(probe).color
      probe.remove()
      return out
    })
    await expect(star).toHaveCSS('color', favorite)
    expect(await star.evaluate((el) => getComputedStyle(el.querySelector('svg')).fill)).not.toBe('none')
    await expect(star).not.toHaveCSS('background-color', favorite) // never a filled amber block

    // pin: outline → accent fill, no filled pill
    expect(await pin.evaluate((el) => getComputedStyle(el.querySelector('svg')).fill)).toBe('none')
    await pin.click()
    await expect(pin).toHaveClass(/\bon\b/)
    const accent = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--accent)'
      document.body.appendChild(probe)
      const out = getComputedStyle(probe).color
      probe.remove()
      return out
    })
    await expect(pin).toHaveCSS('color', accent)
    expect(await pin.evaluate((el) => getComputedStyle(el.querySelector('svg')).fill)).not.toBe('none')
    await expect(pin).not.toHaveCSS('background-color', accent)
  })
})

test.describe('P15.12 — settings/about modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('Settings opens over the library; sections and Escape/close behaviour work', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/p1512-settings', title: 'Settings Link' })
    await openView(page, 'settings')
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).locator('.dialog-title')).toHaveText('Settings')
    // the underlying library page is intact (no navigation happened)
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(page.locator('.settings-card')).toBeVisible()

    // focus lands in the modal (no action buttons -> the close control)
    await expect(dialog(page).locator('.dialog-close')).toBeFocused()

    // real sections only, with their real content
    await dialog(page).getByRole('button', { name: 'Profile' }).click()
    await expect(dialog(page).locator('.profile-id')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Data' }).click()
    await expect(page.locator('.backup-card')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'About' }).click()
    await expect(page.locator('.about-card')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'General' }).click()
    await expect(page.locator('.settings-card')).toBeVisible()

    // Escape closes and focus returns to the invoking nav item
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.locator('.sidebar-menu-link', { hasText: 'Settings' })).toBeFocused()
    // the library is still there, untouched
    await expect(visibleLinkRows(page)).toHaveCount(1)
  })

  test('About opens the same modal straight to its section', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/p1512-about', title: 'About Link' })
    await openView(page, 'about')
    await expect(dialog(page).locator('.dialog-title')).toHaveText('About')
    await expect(page.locator('.about-card')).toBeVisible()
    await expect(page.locator('.page-title')).toHaveText('Links')
    // the section nav is the same framework
    await dialog(page).getByRole('button', { name: 'General' }).click()
    await expect(page.locator('.settings-card')).toBeVisible()
    await page.locator('.dialog-backdrop').click({ position: { x: 10, y: 10 } })
    await expect(dialog(page)).toHaveCount(0)
  })
})

test.describe('P15.12 — theme + mobile tags + folders', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('the theme control is a compact light/dark switch with no dropdown', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')

    // The old Light/System/Dark menu is completely gone.
    await expect(page.locator('.theme-menu')).toHaveCount(0)
    await expect(page.locator('.theme-opt')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Change theme' })).toHaveCount(0)

    const sw = page.locator('.theme-switch')
    await expect(sw).toBeVisible()
    await expect(sw).toHaveAttribute('role', 'switch')
    // Starts from the resolved System default (light in the test browser).
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light')
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect(sw).toHaveAttribute('aria-label', 'Switch to dark mode')

    // Compact token-neutral pill: 1px track border, 18px thumb.
    const track = sw.locator('.theme-switch-track')
    const thumb = sw.locator('.theme-switch-thumb')
    await expect(track).toHaveCSS('border-top-width', '1px')
    const before = await thumb.boundingBox()
    expect(Math.round(before.width)).toBe(18)

    await sw.click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(sw).toHaveAttribute('aria-label', 'Switch to light mode')
    // The thumb slides over ~200ms; poll until it reaches the dark position.
    await expect.poll(async () => Math.round((await thumb.boundingBox()).x)).toBeGreaterThan(before.x + 10)

    // Persists across reload through the existing settings blob.
    await page.reload()
    await expect(page.locator('.theme-switch')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')

    // Keyboard activation toggles back to light.
    await page.locator('.theme-switch').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light')
    await expect(page.locator('.theme-switch')).toHaveAttribute('aria-checked', 'false')
  })

  test('mobile Tags destination filters through the real tag model', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/p1512-tag-a', title: 'Tag A', tags: 'alpha' })
    await saveLink(page, { url: 'https://example.com/p1512-tag-b', title: 'Tag B', tags: 'beta' })

    const nav = page.getByRole('navigation', { name: 'Primary' })
    await nav.getByRole('button', { name: 'Tags', exact: true }).click()
    await expect(dialog(page).locator('.dialog-title')).toHaveText('Tags')
    const cloud = page.locator('[data-testid="tags-dialog-cloud"]')
    await expect(cloud.getByRole('button', { name: '#alpha' })).toBeVisible()
    await cloud.getByRole('button', { name: '#alpha' }).click()
    await expect(dialog(page)).toHaveCount(0) // selects and closes
    await expect(page.locator('.filter-chip', { hasText: '#alpha' })).toBeVisible()
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Tag A')
    await page.locator('.filter-chip', { hasText: '#alpha' }).getByRole('button', { name: 'Clear tag filter' }).click()
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expectNoHorizontalScroll(page)
  })

  test('sidebar folder editing uses the mockup create/rename/delete interactions', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/p1512-folder', title: 'Folder Link' })

    // P15 folder pass: the section + tools exist even with zero folders, so the
    // first folder can be created from the sidebar (create -> inline rename).
    await page.locator('[data-testid="sidebar-folder-new"]').click()
    const createInput = page.getByLabel('Rename sidebar folder New Folder')
    await expect(createInput).toBeFocused()
    await expect(page.getByText('Type a name, press Enter')).toBeVisible()
    await createInput.fill('P1512 Folder')
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="sidebar-folder-row"]', { hasText: 'P1512 Folder' })).toBeVisible()
    await expect(page.getByText('Folder renamed')).toBeVisible()

    // rename via double-click; Escape cancels, blur commits
    const rowLoc = () => page.locator('[data-testid="sidebar-folder-row"]', { hasText: 'P1512 Folder' })
    await rowLoc().dblclick()
    await page.getByLabel('Rename sidebar folder P1512 Folder').fill('Discarded')
    await page.keyboard.press('Escape')
    await expect(rowLoc()).toBeVisible()

    await rowLoc().dblclick()
    const renameInput = page.getByLabel('Rename sidebar folder P1512 Folder')
    await renameInput.fill('P1512 Renamed')
    await renameInput.blur()
    await expect(page.locator('[data-testid="sidebar-folder-row"]', { hasText: 'P1512 Renamed' })).toBeVisible()

    // delete confirms inside the menu (mockup), never through a dialog
    await page.getByRole('button', { name: 'Folder options for P1512 Renamed' }).click()
    await page.getByRole('menu', { name: 'Folder options' }).getByRole('menuitem', { name: 'Delete sidebar folder P1512 Renamed' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Confirm delete sidebar folder P1512 Renamed' }).click()
    await expect(page.locator('[data-testid="sidebar-folder-row"]', { hasText: 'P1512 Renamed' })).toHaveCount(0)
    await expect(page.getByText('Folder deleted')).toBeVisible()
  })

  test('no horizontal overflow at the required widths (light + dark)', async ({ page }) => {
    for (const width of [320, 375, 390, 430, 560, 768, 1024, 1280]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await saveLink(page, { url: `https://example.com/p1512-w${width}`, title: `P1512 ${width}` })
      await openView(page, 'settings')
      await expect(dialog(page)).toBeVisible()
      await expectNoHorizontalScroll(page)
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toHaveCount(0)
      await expectNoHorizontalScroll(page)
      await page.evaluate(() => document.documentElement.setAttribute('data-appearance', 'dark'))
      await page.waitForTimeout(60)
      await expectNoHorizontalScroll(page)
    }
  })
})
