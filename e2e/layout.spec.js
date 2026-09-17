import { test, expect } from '@playwright/test'
import { clearStorage, openView, ensureAddLinkOpen, visibleLinkRows, expectNoHorizontalScroll } from './helpers.js'

// The identity/profile surface lives in the sidebar (a drawer below the desktop
// breakpoint), so reveal it before interacting with it.
async function openIdentity(page) {
  const identity = page.locator('.identity-btn')
  if (!(await identity.isVisible().catch(() => false))) {
    await page.locator('#sidebar-toggle').click()
    await expect(page.locator('.sidebar-wrapper')).toHaveClass(/\bshow\b/)
  }
  await expect(identity).toBeVisible()
  return identity
}

test.describe('Application layout', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('Desktop >=1200px: sidebar permanent, brand visible, saved link renders in the list', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')

    await expect(page.locator('.sidebar-brand')).toContainText('Save Links')
    for (const label of ['Saved links', 'Folders', 'Backup & restore', 'Settings', 'About']) {
      await expect(page.locator('.sidebar-menu-link', { hasText: label })).toBeVisible()
    }
    await expect(page.locator('.page-title')).toHaveText('Saved links')

    await ensureAddLinkOpen(page)
    await page.locator('#save-url').fill('https://example.com/layout-test')
    await page.getByRole('button', { name: 'Save link', exact: true }).click()
    await expect(page.getByText('Link saved')).toBeVisible()

    const rows = visibleLinkRows(page)
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('example.com')

    await expectNoHorizontalScroll(page)
  })

  test('Save Link: the form expands, saves a link, and collapses after the save', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')

    // Form initially collapsed
    await expect(page.locator('#save-url')).toHaveCount(0)
    await expect(page.locator('.add-toggle')).toHaveAttribute('aria-expanded', 'false')

    // Expand
    await page.locator('.add-toggle').click()
    await expect(page.locator('.add-toggle')).toHaveAttribute('aria-expanded', 'true')
    // Presence is the stable state during the popover enter transition; the
    // input's usability is proven by the fill below (actionability-checked).
    await expect(page.locator('#save-url')).toHaveCount(1)

    // Saving collapses the surface (current behaviour). The save is driven here
    // directly so this test does not depend on the shared helper's auto-detect
    // hint wait (the old .meta-hint element no longer exists).
    await page.locator('#save-url').fill('https://example.com/auto-collapse')
    await page.locator('#save-title').fill('Auto Collapse')
    await page.getByRole('button', { name: 'Save link', exact: true }).click()
    await expect(page.getByText('Link saved')).toBeVisible()
    await expect(page.locator('#save-url')).toHaveCount(0)
    await expect(page.locator('.add-toggle')).toHaveAttribute('aria-expanded', 'false')

    // The saved link renders
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Auto Collapse')
  })

  test('Sidebar navigation switches views and page titles update', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')

    await openView(page, 'folders')
    await expect(page.locator('.page-title')).toHaveText('Folders')
    await expect(page.locator('.folder-sidebar')).toBeVisible()

    await openView(page, 'backup')
    await expect(page.locator('.page-title')).toHaveText('Backup & restore')
    await expect(page.locator('.backup-card')).toBeVisible()

    await openView(page, 'settings')
    await expect(page.locator('.page-title')).toHaveText('Settings')
    await expect(page.locator('.settings-card')).toBeVisible()

    await openView(page, 'about')
    await expect(page.locator('.page-title')).toHaveText('About')
    await expect(page.locator('.about-card')).toBeVisible()

    await openView(page, 'links')
    await expect(page.locator('.page-title')).toHaveText('Saved links')
  })

  test('Tablet drawer (<1200px): sidebar off-canvas, hamburger toggles, no overflow', async ({ page }) => {
    // 820px is inside the drawer range: above the mobile shell (bottom-nav) and
    // below the permanent-sidebar breakpoint.
    await clearStorage(page)
    await page.setViewportSize({ width: 820, height: 800 })
    await page.goto('/')

    // Sidebar initially off-canvas
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/show/)
    await expect(page.locator('#sidebar-toggle')).toBeVisible()

    // Open the drawer
    await page.locator('#sidebar-toggle').click()
    await expect(page.locator('.sidebar-wrapper')).toHaveClass(/\bshow\b/)

    // Close it with the overlay
    await page.locator('.sidebar-overlay').click({ position: { x: 500, y: 100 } })
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/show/)

    // Reopen and pick a view: the drawer closes after the selection (current nav)
    await page.locator('#sidebar-toggle').click()
    await expect(page.locator('.sidebar-wrapper')).toHaveClass(/\bshow\b/)
    await openView(page, 'folders')
    await expect(page.locator('.page-title')).toHaveText('Folders')
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/show/)

    await expectNoHorizontalScroll(page)
  })

  test('No horizontal overflow at standard breakpoints', async ({ page }) => {
    for (const width of [1280, 1100, 768, 430, 375]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await expectNoHorizontalScroll(page)
    }
  })

  test('Profile surface: one coherent layer (Account / Edit profile, never stacked)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')

    await openIdentity(page)
    await page.locator('.identity-btn').click()
    await expect(page.locator('.account-panel')).toBeVisible()
    await expect(page.locator('.account-backdrop, .lp-backdrop')).toHaveCount(1)

    // Account -> Edit profile replaces the layer (never stacked)
    await page.locator('.local-profile-edit').click()
    await expect(page.locator('.lp-panel')).toBeVisible()
    await expect(page.locator('.account-panel')).toHaveCount(0)
    await expect(page.locator('.account-backdrop, .lp-backdrop')).toHaveCount(1)

    // Saving the profile keeps the identity surface updated
    await page.locator('#lp-name').fill('Layer Tester')
    await page.locator('#lp-bio').fill('Single layer bio')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.locator('.lp-panel')).toHaveCount(0)
    await expect(page.locator('.identity-name')).toContainText('Layer Tester')

    // Dismissal: reopening and closing via the backdrop clears the layer
    await page.locator('.identity-btn').click()
    await expect(page.locator('.account-panel')).toBeVisible()
    await page.locator('.account-backdrop').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.account-panel')).toHaveCount(0)

    // Mobile: the same single-layer flow works and stays inside the viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await openIdentity(page)
    await page.locator('.identity-btn').click()
    await expect(page.locator('.account-panel')).toBeVisible()
    await expect(page.locator('.account-backdrop, .lp-backdrop')).toHaveCount(1)
    const noHS = await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth)
    expect(noHS).toBe(true)
  })

  test('Profile surface stays inside the viewport at every width', async ({ page }) => {
    for (const width of [320, 375, 430, 768, 1024, 1280, 1440]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')

      await openIdentity(page)
      await page.locator('.identity-btn').click()
      const panel = page.locator('.account-panel')
      await expect(panel).toBeVisible()

      await expectNoHorizontalScroll(page)

      const box = await panel.boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1)

      await page.locator('.account-backdrop').click({ position: { x: 5, y: 5 } })
      await expect(panel).toHaveCount(0)
    }
  })
})
