// P15.4 — mockup Library navigation in the sidebar: exact section/items, real
// counts, destination exclusivity, item contract and the drawer close.
// Folders (P15.5) / Tags / storage (P15.6) are asserted as deferred.
import { test, expect } from '@playwright/test'
import { clearStorage, openView, createFolder, saveLink, visibleLinkRows } from './helpers.js'

const libraryItem = (page, label) => page.locator('.sidebar-menu-link').filter({ hasText: label })
const librarySection = (page) =>
  page.locator('.sidebar-menu-section').filter({ has: page.locator('.sidebar-menu-title', { hasText: 'Library' }) })

const cssVar = (page, name) =>
  page.evaluate((n) => {
    const probe = document.createElement('div')
    probe.style.background = `var(${n})`
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).backgroundColor
    probe.remove()
    return value
  }, name)

test.describe('P15.4 — sidebar Library', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('Library carries exactly the mockup items with registry icons', async ({ page }) => {
    const section = librarySection(page)
    await expect(section.locator('.sidebar-menu-title')).toHaveText('Library')
    const labels = await section.locator('.sidebar-menu-link span:first-of-type').allTextContents()
    expect(labels).toEqual(['All Links', 'Favorites', 'Recently Added'])

    // Unread / Broken are excluded by contract.
    await expect(page.locator('.sidebar-menu-link', { hasText: 'Unread' })).toHaveCount(0)
    await expect(page.locator('.sidebar-menu-link', { hasText: 'Broken' })).toHaveCount(0)

    // Every rebuilt Library icon is the shared registry component at 15px.
    const icons = await section.locator('.sidebar-menu-link svg').evaluateAll((els) =>
      els.map((el) => ({ cls: el.getAttribute('class') || '', w: Math.round(el.getBoundingClientRect().width) }))
    )
    expect(icons).toHaveLength(3)
    for (const icon of icons) {
      expect(icon.cls).toContain('ic')
      expect(icon.w).toBe(15)
    }

    // No leftover inline SVG recipe in the rebuilt surface (head + Library +
    // the bottom Settings footer); the deferred folder tree is out of scope.
    const stray = await page.evaluate(() => {
      const titles = [...document.querySelectorAll('.sidebar-menu-section')]
      const scoped = [
        document.querySelector('.sidebar-head'),
        ...titles.filter((s) => s.querySelector('.sidebar-menu-title')?.textContent.trim() === 'Library'),
        document.querySelector('.sidebar-settings'),
      ]
      return scoped.flatMap((el) => (el ? [...el.querySelectorAll('svg')].filter((s) => !s.classList.contains('ic')) : [])).length
    })
    expect(stray).toBe(0)

    // Tags + storage are owned by P15.6 (see sidebar-tags-storage.spec.js);
    // this spec only guards the P15.4 Library surface.
  })

  test('item contract: 44px / 10px / weight 400-500 / accent-soft active / count pill', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/lib-1', title: 'Library One' })
    const all = libraryItem(page, 'All Links')
    const fav = libraryItem(page, 'Favorites')

    await expect(all).toHaveCSS('min-height', '44px')
    await expect(all).toHaveCSS('padding-left', '10px')
    await expect(all).toHaveCSS('padding-top', '10px')
    await expect(all).toHaveCSS('gap', '10px')
    await expect(all).toHaveCSS('border-radius', '8px')
    await expect(all).toHaveCSS('font-size', '14px')
    await expect(all).toHaveCSS('font-weight', '500') // active
    await expect(fav).toHaveCSS('font-weight', '400') // inactive

    // Active row: accent-soft block + accent text (the mockup active recipe).
    const active = await all.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
    expect(active.bg).toBe(await cssVar(page, '--accent-soft'))
    expect(active.color).toBe(await cssVar(page, '--accent'))

    // Count pill: 11px; the active one is strong-filled with on-strong text.
    const badge = all.locator('.sidebar-menu-badge')
    await expect(badge).toHaveCSS('font-size', '11px')
    const badgeColors = await badge.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
    expect(badgeColors.bg).toBe(await cssVar(page, '--accent-strong'))
    expect(badgeColors.color).toBe(await cssVar(page, '--accent-text-on-strong'))

    // Hover on an inactive row takes the mockup surface-2 tone.
    await fav.hover()
    await page.waitForTimeout(220)
    expect(await fav.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await cssVar(page, '--sidebar-hover-bg'))
  })

  test('All Links / Favorites / Recently Added bind to real state and counts', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/a', title: 'Alpha' })
    await saveLink(page, { url: 'https://example.com/b', title: 'Beta' })
    await page.locator('.row-list > .link-row', { hasText: 'Alpha' }).getByRole('button', { name: 'Toggle Favorite' }).click()

    await expect(libraryItem(page, 'All Links').locator('.sidebar-menu-badge')).toHaveText('2')
    await expect(libraryItem(page, 'Favorites').locator('.sidebar-menu-badge')).toHaveText('1')
    // Real Recently-Added count: both links were created today.
    await expect(libraryItem(page, 'Recently Added').locator('.sidebar-menu-badge')).toHaveText('2')

    // Favorites destination (existing showFavorites/favoriteCount state).
    await libraryItem(page, 'Favorites').click()
    await expect(libraryItem(page, 'Favorites')).toHaveAttribute('aria-current', 'page')
    await expect(libraryItem(page, 'All Links')).not.toHaveAttribute('aria-current', 'page')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Alpha')

    // Recently Added destination (P15.2 predicate: today + yesterday).
    await libraryItem(page, 'Recently Added').click()
    await expect(libraryItem(page, 'Recently Added')).toHaveAttribute('aria-current', 'page')
    await expect(libraryItem(page, 'Favorites')).not.toHaveAttribute('aria-current', 'page')
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expect(page.locator('.filter-chip', { hasText: 'Recently added' })).toBeVisible()

    // All Links clears the destination filter and restores the collection.
    await libraryItem(page, 'All Links').click()
    await expect(libraryItem(page, 'All Links')).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.filter-chip', { hasText: 'Recently added' })).toHaveCount(0)
    await expect(visibleLinkRows(page)).toHaveCount(2)

    // Folder selection clears the Recently-Added destination (P15.2 semantics).
    await createFolder(page, 'Work')
    await openView(page, 'links')
    await libraryItem(page, 'Recently Added').click()
    await expect(libraryItem(page, 'Recently Added')).toHaveAttribute('aria-current', 'page')
    await page.locator('[data-testid="sidebar-folder-row"]', { hasText: 'Work' }).click()
    await expect(libraryItem(page, 'Recently Added')).not.toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.filter-chip', { hasText: 'Folder: Work' })).toBeVisible()
  })

  test('mobile drawer: a Library item navigates, closes the drawer and keeps the mockup width', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/m', title: 'Mobile Link' })
    await page.locator('.row-list > .link-row', { hasText: 'Mobile Link' }).getByRole('button', { name: 'Toggle Favorite' }).click()

    await page.setViewportSize({ width: 390, height: 900 })
    await page.reload()
    const drawer = page.locator('.sidebar-wrapper')
    const more = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'More', exact: true })

    await more.click()
    await expect(drawer).toHaveClass(/\bshow\b/)
    expect(await drawer.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(300)
    await libraryItem(page, 'Favorites').click()
    await expect(drawer).not.toHaveClass(/\bshow\b/)
    await expect(visibleLinkRows(page)).toHaveCount(1)
  })

  test('folder tree stays deferred and the Library has no duplicate navigation', async ({ page }) => {
    await createFolder(page, 'Work')
    await expect(page.locator('[data-testid="sidebar-folder-tree"]')).toBeVisible()

    const labels = await page.locator('.sidebar-menu-link span:first-of-type').allTextContents()
    expect(labels.filter((l) => l === 'All Links')).toHaveLength(1)
    expect(labels).not.toContain('Links')
    // Tools left the sidebar: no standalone Folders / Backup & restore / About
    // rows remain, and Settings is the one app-level item (bottom footer).
    expect(labels).not.toContain('Folders')
    expect(labels).not.toContain('Backup & restore')
    expect(labels).not.toContain('About')
    expect(labels.filter((l) => l === 'Settings')).toHaveLength(1)
  })
})
