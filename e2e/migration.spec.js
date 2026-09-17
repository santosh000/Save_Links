import { test, expect } from '@playwright/test'
import { linkRowByTitle, openEditFormFor, openView, visibleLinkRows } from './helpers.js'

async function clearStorage(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    sessionStorage.clear()
    const dbs = await (indexedDB.databases ? indexedDB.databases() : Promise.resolve([]))
    await Promise.all(dbs.map((d) => new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(d.name)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })))
  })
}

function seedLegacyData(links, folders, profile, appearance, colorScheme) {
  return async (page) => {
    await page.addInitScript((data) => {
      if (sessionStorage.getItem('migration.spec.seeded')) return
      sessionStorage.setItem('migration.spec.seeded', '1')
      localStorage.removeItem('save_link:test:migration')
      localStorage.setItem('save_link:test:links', JSON.stringify(data.links))
      localStorage.setItem('save_link:test:folders', JSON.stringify(data.folders))
      localStorage.setItem('save_link:test:profile', JSON.stringify(data.profile))
      localStorage.setItem('save_link:test:appearance', JSON.stringify(data.appearance))
      localStorage.setItem('save_link:test:colorScheme', JSON.stringify(data.colorScheme))
    }, { links, folders, profile, appearance, colorScheme })
  }
}

test.describe('localStorage -> IndexedDB migration', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('migrates realistic local storage data on first load; marker written; source retained; reload persists', async ({ page }) => {
    await seedLegacyData(
      [
        { id: 'm1', url: 'https://example.com/legacy', status: 'important', title: 'Legacy Link', createdAt: '2023-01-01T00:00:00.000Z' },
        {
          id: 'm2', originalUrl: 'example.com/canonical', normalizedUrl: 'https://example.com/canonical', url: 'https://example.com/canonical',
          title: 'Canonical Link', domain: 'example.com', category: 'Other', tags: ['a'], important: false, mustHave: true, favorite: true,
          createdAt: '2023-02-02T00:00:00.000Z',
        },
      ],
      [{ id: 'wf', name: 'Work', createdAt: '2023-01-01T00:00:00.000Z' }],
      { name: 'Migrated User', bio: 'Recovered from localStorage' },
      'dark',
      'lavender'
    )(page)

    await page.goto('/')

    // migrated links, folders, profile and settings all render from IndexedDB
    await expect(linkRowByTitle(page, 'Legacy Link')).toBeVisible()
    await expect(linkRowByTitle(page, 'Canonical Link')).toBeVisible()
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'Work' })).toBeVisible()
    await expect(page.locator('.identity-name')).toContainText('Migrated User')
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'lavender')

    // legacy status 'important' -> important flag; explicit booleans preserved.
    // Flags are permanent row/card controls now (Important/Favorite direct, Must
    // Have in the More-actions menu), so their state is asserted there.
    await openView(page, 'links')
    const legacy = linkRowByTitle(page, 'Legacy Link')
    await expect(legacy.getByRole('button', { name: 'Toggle Important' })).toHaveAttribute('aria-pressed', 'true')
    await expect(legacy.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'false')
    await legacy.getByRole('button', { name: 'More actions' }).click()
    await expect(page.locator('.more-menu').getByRole('button', { name: 'Toggle Must Have' })).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Escape')

    const canonical = linkRowByTitle(page, 'Canonical Link')
    await expect(canonical.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(canonical.getByRole('button', { name: 'Toggle Important' })).toHaveAttribute('aria-pressed', 'false')
    await canonical.getByRole('button', { name: 'More actions' }).click()
    await expect(page.locator('.more-menu').getByRole('button', { name: 'Toggle Must Have' })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')

    // marker state + original localStorage source retained as recovery source
    expect(await page.evaluate(() => localStorage.getItem('save_link:test:migration'))).toBe('complete')
    const retained = await page.evaluate(() => JSON.parse(localStorage.getItem('save_link:test:links')))
    expect(retained.length).toBe(2)

    // marker survives reload and data continues to come from IndexedDB
    await page.reload()
    await expect(linkRowByTitle(page, 'Legacy Link')).toBeVisible()
    await expect(linkRowByTitle(page, 'Canonical Link')).toBeVisible()
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'Work' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    expect(await page.evaluate(() => localStorage.getItem('save_link:test:migration'))).toBe('complete')
  })

  test('runtime CRUD after migration persists through IndexedDB', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('migration.spec.seeded')) return
      sessionStorage.setItem('migration.spec.seeded', '1')
      localStorage.removeItem('save_link:test:migration')
      localStorage.setItem('save_link:test:links', JSON.stringify([
        {
          id: 'seed1', originalUrl: 'https://example.com/seed', normalizedUrl: 'https://example.com/seed', url: 'https://example.com/seed',
          title: 'Seeded Link', domain: 'example.com', category: 'Other', tags: [], important: false, mustHave: false, favorite: false,
          createdAt: '2023-01-01T00:00:00.000Z',
        },
      ]))
    })

    await page.goto('/')
    await expect(linkRowByTitle(page, 'Seeded Link')).toBeVisible()

    // Add a new link through the app UI (current Add form)
    const { ensureAddLinkOpen } = await import('./helpers.js')
    await ensureAddLinkOpen(page)
    await page.locator('#save-url').fill('https://example.com/new')
    await page.locator('#save-title').fill('New Link')
    await page.getByRole('button', { name: 'Save link' }).click()
    await expect(linkRowByTitle(page, 'New Link')).toBeVisible()

    // Edit the migrated link through the current anchored edit form
    const { form } = await openEditFormFor(page, 'Seeded Link')
    await form.getByLabel('Title').fill('Updated Link')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(linkRowByTitle(page, 'Updated Link')).toBeVisible()

    // Delete the runtime-added link through the More-actions menu + dialog
    const runtime = linkRowByTitle(page, 'New Link')
    await runtime.getByRole('button', { name: 'More actions' }).click()
    await page.locator('.more-menu').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(linkRowByTitle(page, 'New Link')).toHaveCount(0)

    // Reload -> the deletion and the runtime edit both survived (IndexedDB)
    await page.reload()
    await expect(linkRowByTitle(page, 'Updated Link')).toBeVisible()
    await expect(linkRowByTitle(page, 'New Link')).toHaveCount(0)
    // Totals live in the sidebar count badge now (Statistics view was removed)
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(page.locator('.sidebar-menu-badge').first()).toHaveText('1')
  })
})
