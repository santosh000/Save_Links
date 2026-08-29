import { test, expect } from '@playwright/test'

// Real end-to-end migration: seed realistic v1.0.0 localStorage data BEFORE
// the first page load (addInitScript runs before the app's JS), then verify
// the app boots from migrated IndexedDB data, the marker is written, the
// original localStorage source is retained, and runtime CRUD survives reloads.
//
// NOTE: seeding must happen via addInitScript BEFORE the first goto — a first
// load with empty localStorage marks the migration 'complete' (fresh user), so
// seeding after that would never migrate.

async function clearStorage(page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
}

function seedLegacyData(links, folders, profile, appearance, colorScheme) {
  return async (page) => {
    // Runs BEFORE app JS on the next navigation. Seeds exactly once per test
    // (flag in sessionStorage survives reloads; localStorage is the data store
    // under test), and removes the migration marker so the seeded load is seen
    // as a genuine first run instead of being skipped as 'complete'.
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

test.describe('localStorage → IndexedDB migration', () => {
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
    await expect(page.locator('article.card', { hasText: 'Legacy Link' })).toBeVisible()
    await expect(page.locator('article.card', { hasText: 'Canonical Link' })).toBeVisible()
    await expect(page.locator('.folder-item', { hasText: 'Work' })).toBeVisible()
    await expect(page.getByText('Migrated User')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'lavender')

    // legacy status 'important' -> important flag; explicit booleans preserved
    const legacy = page.locator('article.card', { hasText: 'Legacy Link' })
    await expect(legacy.getByRole('button', { name: 'Toggle Important' })).toHaveAttribute('aria-pressed', 'true')
    await expect(legacy.getByRole('button', { name: 'Toggle Must Have' })).toHaveAttribute('aria-pressed', 'false')
    const canonical = page.locator('article.card', { hasText: 'Canonical Link' })
    await expect(canonical.getByRole('button', { name: 'Toggle Must Have' })).toHaveAttribute('aria-pressed', 'true')
    await expect(canonical.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')

    // marker state + original localStorage source retained as recovery source
    expect(await page.evaluate(() => localStorage.getItem('save_link:test:migration'))).toBe('complete')
    const retained = await page.evaluate(() => JSON.parse(localStorage.getItem('save_link:test:links')))
    expect(retained.length).toBe(2)

    // marker survives reload and data continues to come from IndexedDB
    await page.reload()
    await expect(page.locator('article.card', { hasText: 'Legacy Link' })).toBeVisible()
    await expect(page.locator('article.card', { hasText: 'Canonical Link' })).toBeVisible()
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
    await expect(page.locator('article.card', { hasText: 'Seeded Link' })).toBeVisible()

    // Add a new link through the app UI (compact form flow)
    await page.getByRole('button', { name: 'Save a link', exact: true }).click()
    await page.locator('#save-url').fill('https://example.com/new')
    await page.locator('#save-title').fill('New Link')
    await page.getByRole('button', { name: 'Save link' }).click()
    await expect(page.locator('article.card', { hasText: 'New Link' })).toBeVisible()

    // Edit it — scope by position, not text: once the edit form opens the
    // title lives in an input VALUE, which is not text content, so a
    // hasText filter would stop matching the card.
    const card = page.locator('article.card').first()
    await card.getByRole('button', { name: 'Edit link' }).click()
    await card.locator('.edit-form').locator('input').first().fill('Updated Link')
    await card.locator('.edit-form').getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('article.card', { hasText: 'Updated Link' })).toBeVisible()

    // Delete the migrated seeded link (confirm the dialog)
    page.once('dialog', async (dialog) => {
      await dialog.accept()
    })
    await page.locator('article.card', { hasText: 'Seeded Link' }).getByRole('button', { name: 'Delete link' }).click()
    await expect(page.locator('article.card', { hasText: 'Seeded Link' })).toHaveCount(0)

    // Reload -> the migrated seed was deleted, the runtime edit survived
    await page.reload()
    await expect(page.locator('article.card', { hasText: 'Updated Link' })).toBeVisible()
    await expect(page.locator('article.card', { hasText: 'Seeded Link' })).toHaveCount(0)
    await expect(page.locator('.stat-card', { hasText: 'Total saved' }).locator('.num')).toHaveText('1')
  })
})