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

test.describe('Folders view + sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('Folders view lists folders with counts and the sidebar badge shows the total', async ({ page }) => {
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
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' }).locator('.folder-count')).toHaveText('1')
    await expect(page.locator('.folder-item', { hasText: 'Work' }).locator('.folder-count')).toHaveText('1')
    await expect(page.locator('.folder-item', { hasText: 'Personal' }).locator('.folder-count')).toHaveText('1')

    await expect(page.locator('.sidebar-menu-link', { hasText: 'Saved links' }).locator('.sidebar-menu-badge')).toContainText('3')
    await expect(page.locator('.sidebar-menu-link', { hasText: 'Folders' }).locator('.sidebar-menu-badge')).toContainText('2')
  })

  test('View navigation marks the current sidebar item and updates the page title', async ({ page }) => {
    await page.goto('/')
    for (const [view, label] of [['folders', 'Folders'], ['backup', 'Backup & restore'], ['settings', 'Settings'], ['about', 'About'], ['links', 'Saved links']]) {
      await openView(page, view)
      await expect(page.locator('.page-title')).toHaveText(label)
      await expect(page.locator('.sidebar-menu-link.active', { hasText: label })).toBeVisible()
    }
  })

  test('Assigning a folder from a row updates counts and persists', async ({ page }) => {
    await openView(page, 'folders')
    await createFolder(page, 'Projects')
    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/todo', title: 'TODO Link' })
    await expect(page.locator('.sidebar-menu-link', { hasText: 'Folders' }).locator('.sidebar-menu-badge')).toContainText('1')

    // Assign through the current More-actions menu
    await assignFolder(page, 'TODO Link', 'Projects')
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'Projects' }).locator('.folder-count')).toHaveText('1')
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' }).locator('.folder-count')).toHaveText('0')

    // Move back to Unfiled
    await openView(page, 'links')
    await assignFolder(page, 'TODO Link', 'Unfiled')
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' }).locator('.folder-count')).toHaveText('1')

    // Persists after reload
    await openView(page, 'links')
    await assignFolder(page, 'TODO Link', 'Projects')
    await page.reload()
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'Projects' }).locator('.folder-count')).toHaveText('1')
  })

  test('Mobile: folders view is reachable and folder selection filters links', async ({ page }) => {
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

    // The Folders view is reachable through the current mobile navigation
    await openView(page, 'folders')
    await expect(page.locator('.page-title')).toHaveText('Folders')
    await expect(page.locator('.folder-item', { hasText: 'Mobile' })).toBeVisible()

    // Selecting the folder lands on Saved links filtered to it
    await page.locator('.folder-item .folder-row', { hasText: 'Mobile' }).click()
    await expect(page.locator('.page-title')).toHaveText('Saved links')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Mobile Link')

    // Back at desktop width the permanent sidebar is visible again
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('.sidebar-menu-link', { hasText: 'Saved links' })).toBeInViewport()
  })
})
