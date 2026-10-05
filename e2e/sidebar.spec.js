import { test, expect } from '@playwright/test'
import { clearStorage, createFolder, linkRowByTitle, openView, saveLink, visibleLinkRows } from './helpers.js'

// Assign a saved link to a folder through the current More-actions menu (the
// AppSelect native value carrier is the stable hook, as in the sort spec).
async function assignFolder(page, title, folderName) {
  await linkRowByTitle(page, title).getByRole('button', { name: 'More actions' }).click()
  const menu = page.locator('.more-menu')
  await expect(menu).toBeVisible()
  await menu.locator('.more-field', { hasText: 'Folder' }).locator('select').selectOption({ label: folderName })
  // The app confirms the assignment itself, so the helper returns only when it settled
  await expect(page.getByText('Folder updated')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
}

test.describe('Folders (sidebar tree) + sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('the sidebar tree lists folders with real subtree counts', async ({ page }) => {
    await openView(page, 'folders')
    await createFolder(page, 'Work')
    await createFolder(page, 'Personal')

    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/w', title: 'Work Link' })
    await saveLink(page, { url: 'https://example.com/p', title: 'Personal Link' })
    await saveLink(page, { url: 'https://example.com/u', title: 'Unfiled Link' })
    await assignFolder(page, 'Work Link', 'Work')
    await assignFolder(page, 'Personal Link', 'Personal')

    await openView(page, 'folders')
    await expect(page.locator('.sidebar-folder-node', { hasText: 'Work' }).locator('.sidebar-folder-count')).toHaveText('1')
    await expect(page.locator('.sidebar-folder-node', { hasText: 'Personal' }).locator('.sidebar-folder-count')).toHaveText('1')

    await expect(page.locator('.sidebar-menu-link', { hasText: 'Links' }).locator('.sidebar-menu-badge')).toContainText('3')
  })

  test('the old Folders destination is gone; modal sections still open', async ({ page }) => {
    await page.goto('/')

    // The standalone Folders page was removed. The folder surface is the tree,
    // and nothing navigates away from the library to a "Folders" view.
    await expect(page.locator('.page-title')).toHaveText('Links')
    await openView(page, 'folders')
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expect(page.locator('[data-testid="sidebar-folder-tree"]')).toBeAttached()
    await expect(page.locator('[data-testid="sidebar-folder-new"]')).toBeVisible()

    // The command palette no longer offers the old destination.
    await page.keyboard.press('Control+k')
    const paletteInput = page.locator('.command-palette input')
    await expect(paletteInput).toBeVisible()
    await paletteInput.fill('folders')
    await expect(page.locator('.command-palette').getByText('Show folders')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('.command-palette')).toHaveCount(0)

    // P15.12: settings/about are modal sections (no page title / active nav row).
    for (const [view, label] of [['settings', 'Settings'], ['about', 'About']]) {
      await openView(page, view)
      await expect(page.getByRole('dialog').locator('.dialog-title')).toHaveText(label)
      await expect(page.locator('.page-title')).toHaveText('Links') // the library stays underneath
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }

    // Backup & restore is the Settings modal's Data section now.
    await openView(page, 'backup')
    await expect(page.getByRole('dialog').locator('.dialog-title')).toHaveText('Settings')
    await expect(page.getByRole('dialog').locator('.settings-nav-item.active')).toHaveText('Data')
    await expect(page.locator('.page-title')).toHaveText('Links') // the library stays underneath
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('assigning a folder from a row updates tree counts and persists', async ({ page }) => {
    await openView(page, 'folders')
    await createFolder(page, 'Projects')
    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/todo', title: 'TODO Link' })
    await expect(page.locator('.sidebar-folder-node', { hasText: 'Projects' })).toBeVisible()

    // Assign through the current More-actions menu
    await assignFolder(page, 'TODO Link', 'Projects')
    await expect(page.locator('.sidebar-folder-node', { hasText: 'Projects' }).locator('.sidebar-folder-count')).toHaveText('1')

    // Move back to Unfiled
    await assignFolder(page, 'TODO Link', 'Unfiled')
    await expect(page.locator('.sidebar-folder-node', { hasText: 'Projects' }).locator('.sidebar-folder-count')).toHaveText('0')

    // Persists after reload
    await assignFolder(page, 'TODO Link', 'Projects')
    await page.reload()
    await expect(page.locator('.sidebar-folder-node', { hasText: 'Projects' }).locator('.sidebar-folder-count')).toHaveText('1')
  })

  test('Mobile: the drawer tree is reachable and folder selection filters links', async ({ page }) => {
    // Create folder & link at desktop width, then verify the mobile shell path
    await page.goto('/')
    await openView(page, 'folders')
    await createFolder(page, 'Mobile')
    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/m1', title: 'Mobile Link' })
    await saveLink(page, { url: 'https://example.com/m2', title: 'Plain Link' })
    await assignFolder(page, 'Mobile Link', 'Mobile')

    await page.setViewportSize({ width: 375, height: 667 })
    await page.reload()

    // The tree lives in the More drawer below the desktop grid.
    await openView(page, 'folders')
    await expect(page.locator('[data-testid="sidebar-folder-tree"]')).toBeVisible()
    const mobileRow = page.locator('[data-testid="sidebar-folder-row"]').filter({ hasText: 'Mobile' })
    await expect(mobileRow).toBeVisible()

    // Selecting the folder lands on Links filtered to it and closes the drawer
    await mobileRow.click()
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Mobile Link')
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/\bshow\b/)

    // Back at desktop width the permanent sidebar is visible again
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('.sidebar-menu-link', { hasText: 'Links' })).toBeInViewport()
  })
})
