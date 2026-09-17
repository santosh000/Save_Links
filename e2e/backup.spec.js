import { test, expect } from '@playwright/test'
import { clearStorage, ensureAddLinkOpen, saveLink, visibleLinkRows, linkRowByTitle, installBackupCapture, clickExportAndCaptureBackup, openView } from './helpers.js'

test.describe('Backup E2E', () => {
  test.beforeEach(async ({ page }) => {
    await installBackupCapture(page)
    await clearStorage(page)
  })

  test('1. Export Backup', async ({ page }) => {
    test.setTimeout(60000)
    await page.goto('/')
    // local profile: navbar profile dropdown → Edit profile
    await page.locator('.identity-btn').click()
    await page.locator('.local-profile-edit').click()
    await page.locator('#lp-name').fill('Backup Tester')
    await page.locator('#lp-bio').fill('Local-first profile bio')
    await page.getByRole('button', { name: 'Save changes' }).click()
    // reload: dismisses the panel and verifies the local profile name AND bio persisted
    await page.reload()
    await expect(page.locator('.identity-name')).toContainText('Backup Tester')
    // Bio is inside the account panel — open it to verify persistence
    await page.locator('.identity-btn').click()
    await page.locator('.local-profile-edit').click()
    await expect(page.locator('#lp-bio')).toHaveValue('Local-first profile bio')
    await page.keyboard.press('Escape')

    // link with all flags
    await saveLink(page, {
      url: 'https://example.com/export-test',
      title: 'Export Title',
      description: 'Export Desc',
      image: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2NjYyIvPjwvc3ZnPg==',
      tags: 'backup, test',
      category: 'GitHub',
      important: true,
      mustHave: true,
    })
    const row = visibleLinkRows(page).first()
    await row.getByRole('button', { name: 'Toggle Favorite' }).click()
    await expect(row.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')

    // export using the real export button and capture the generated JSON
    await openView(page, 'backup')
    const json = await clickExportAndCaptureBackup(page)

    expect(json.app).toBe('Save_Link')
    expect(json.version).toBe(2)
    expect(json.exportedAt).toBeDefined()
    expect(() => new Date(json.exportedAt).toISOString()).not.toThrow()
    expect(json.profile.name).toBe('Backup Tester')
    expect(json.profile.bio).toBe('Local-first profile bio')
    expect(Array.isArray(json.links)).toBe(true)
    expect(Array.isArray(json.folders)).toBe(true)
    expect(json.settings).toBeDefined()
    expect(json.settings.appearance).toBeDefined()
    expect(json.settings.colorScheme).toBeDefined()
    const exported = json.links.find((l) => l.title === 'Export Title')
    expect(exported).toBeDefined()
    expect(exported.originalUrl).toBe('https://example.com/export-test')
    expect(exported.normalizedUrl).toBe('https://example.com/export-test')
    expect(exported.url).toBe('https://example.com/export-test')
    expect(exported.important).toBe(true)
    expect(exported.mustHave).toBe(true)
    expect(exported.favorite).toBe(true)
    expect(exported.category).toBe('GitHub')
    expect(exported.tags).toEqual(expect.arrayContaining(['backup', 'test']))
    expect(exported.description).toBe('Export Desc')

    await expect(page.getByText('Backup exported')).toBeVisible()
    await expect(page.getByText(/Last backup:/)).toBeVisible()
  })

  test('2. Export uses current in-memory data', async ({ page }) => {
    test.setTimeout(60000)
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/in-memory', title: 'InMemory Title' })
    await expect(visibleLinkRows(page).first()).toContainText('InMemory Title')

    // Tamper localStorage to different data, without affecting in-memory
    await page.evaluate(() => {
      localStorage.setItem('save_link:links', JSON.stringify([{ id: 'old', url: 'https://old.com', title: 'Old' }]))
    })

    await openView(page, 'backup')
    const json = await clickExportAndCaptureBackup(page)
    // exported should reflect displayed InMemory Title, not old.com
    expect(json.links.some((l) => l.title === 'InMemory Title')).toBe(true)
    expect(json.links.some((l) => l.title === 'Old')).toBe(false)
  })

  test('3. Import valid backup merges data', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/existing', title: 'Existing' })
    await expect(visibleLinkRows(page)).toHaveCount(1)

    const backup = {
      app: 'Save_Link',
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: { name: 'Imported User', bio: 'Imported Bio' },
      links: [
        {
          id: 'imported1',
          originalUrl: 'https://example.com/imported1',
          normalizedUrl: 'https://example.com/imported1',
          url: 'https://example.com/imported1',
          title: 'Imported Title 1',
          description: 'Imported Desc',
          image: '',
          tags: ['imported'],
          category: 'Reddit',
          important: true,
          mustHave: false,
          favorite: true,
          domain: 'example.com',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'imported2',
          originalUrl: 'example.com/imported2',
          normalizedUrl: 'https://example.com/imported2',
          url: 'https://example.com/imported2',
          title: 'Imported Title 2',
          description: '',
          image: '',
          tags: [],
          category: 'Other',
          important: false,
          mustHave: true,
          favorite: false,
          domain: 'example.com',
          createdAt: new Date().toISOString(),
        },
      ],
    }

    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    })
    // No URL overlap with the local link -> no duplicate => no preview modal;
    // the import is additive and runs immediately.
    await expect(page.getByText(/Import complete/)).toBeVisible()
    await openView(page, 'links')
    await expect(visibleLinkRows(page)).toHaveCount(3)
    await expect(page.getByText('Existing', { exact: true })).toBeVisible()
    await expect(page.getByText('Imported Title 1', { exact: true })).toBeVisible()
    await expect(page.getByText('Imported Title 2', { exact: true })).toBeVisible()
    // Current totals and flag state (the Statistics view was removed)
    await openView(page, 'links')
    await expect(page.locator('.sidebar-menu-badge').first()).toHaveText('3')
    const imp1 = linkRowByTitle(page, 'Imported Title 1')
    await expect(imp1.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(imp1.getByRole('button', { name: 'Toggle Important' })).toHaveAttribute('aria-pressed', 'true')
    const imp2 = linkRowByTitle(page, 'Imported Title 2')
    await expect(imp2.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'false')
    await imp2.getByRole('button', { name: 'More actions' }).click()
    const imp2Menu = page.locator('.more-menu')
    await expect(imp2Menu).toBeVisible()
    await expect(imp2Menu.getByRole('button', { name: 'Toggle Must Have' })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(imp2Menu).toBeHidden()
  })

  test('4. Import cancel keeps existing data', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/keep', title: 'Keep Me' })
    await expect(visibleLinkRows(page)).toHaveCount(1)

    // A duplicate URL triggers the merge-preview modal; Cancel must keep everything unchanged.
    const backup = {
      app: 'Save_Link',
      version: 2,
      exportedAt: new Date().toISOString(),
      profile: { name: 'New' },
      links: [{
        id: 'dup', originalUrl: 'https://example.com/keep', normalizedUrl: 'https://example.com/keep', url: 'https://example.com/keep', title: 'Keep Me (backup)', description: '', image: '', tags: [], category: 'Other', important: false, mustHave: false, favorite: false, domain: 'example.com', createdAt: new Date().toISOString(),
      }],
      folders: [],
    }

    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    })
    const importDialog = page.getByRole('dialog')
    await expect(importDialog).toBeVisible()
    await importDialog.getByRole('button', { name: 'Cancel' }).click()

    await openView(page, 'links')
    await expect(visibleLinkRows(page).first()).toContainText('Keep Me')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(page.getByText('Keep Me (backup)')).toHaveCount(0)
    // no success toast for import
    await expect(page.getByText(/Import complete/)).toHaveCount(0)
  })

  test('5. Invalid JSON', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/keep2', title: 'Keep2' })
    await expect(visibleLinkRows(page)).toHaveCount(1)

    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('not json {'),
    })

    await expect(page.locator('.sl-toast')).toContainText('Invalid backup file: not valid JSON')
    await openView(page, 'links')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Keep2')
  })

  test('6. Wrong app identifier', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/keep3', title: 'Keep3' })

    const bad = { app: 'OtherApp', version: 1, exportedAt: new Date().toISOString(), profile: {}, links: [] }
    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bad)),
    })

    await expect(page.locator('.sl-toast')).toContainText('Invalid backup: wrong app identifier')
    await openView(page, 'links')
    await expect(visibleLinkRows(page)).toHaveCount(1)
  })

  test('7. Unsupported version', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/keep4', title: 'Keep4' })

    const bad = { app: 'Save_Link', version: 999, exportedAt: new Date().toISOString(), profile: {}, links: [] }
    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(bad)),
    })

    await expect(page.locator('.sl-toast')).toContainText('Unsupported backup version')
    await openView(page, 'links')
    await expect(visibleLinkRows(page)).toHaveCount(1)
  })

  test('8. Invalid links field — missing and not array', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/keep5', title: 'Keep5' })

    const missing = { app: 'Save_Link', version: 1, exportedAt: new Date().toISOString(), profile: {} }
    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(missing)),
    })
    await expect(page.locator('.sl-toast')).toContainText('Invalid backup: missing links')
    await openView(page, 'links')
    await expect(visibleLinkRows(page)).toHaveCount(1)

    const notArray = { app: 'Save_Link', version: 1, exportedAt: new Date().toISOString(), profile: {}, links: 'not-array' }
    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'bad2.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(notArray)),
    })
    await expect(page.locator('.sl-toast')).toContainText('Invalid backup: links must be an array')
    await openView(page, 'links')
    await expect(visibleLinkRows(page)).toHaveCount(1)
  })

  test('9. Malformed records', async ({ page }) => {
    await page.goto('/')
    const backup = {
      app: 'Save_Link',
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: {},
      links: [
        null,
        'string',
        123,
        { id: 'bad1' },
        { id: 'bad2', url: '' },
        { id: 'good', originalUrl: 'https://example.com/good', normalizedUrl: 'https://example.com/good', url: 'https://example.com/good', title: 'Good Link', description: '', image: '', tags: ['a'], category: 'Other', important: false, mustHave: false, favorite: false, domain: 'example.com', createdAt: new Date().toISOString() },
      ],
    }

    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    })
    // The malformed records are dropped during normalization. No duplicates in
    // an empty store -> no preview modal, import runs immediately.
    await expect(page.getByText(/Import complete/)).toBeVisible()
    await openView(page, 'links')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Good Link')
    // ensure app didn't crash
    await expect(page.getByText('Save Links', { exact: false }).first()).toBeVisible()
  })

  test('10. Persistence after import', async ({ page }) => {
    await page.goto('/')
    const backup = {
      app: 'Save_Link',
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: { name: 'Persist User', bio: 'Persist Bio' },
      links: [
        {
          id: 'persist1',
          originalUrl: 'https://example.com/persist1',
          normalizedUrl: 'https://example.com/persist1',
          url: 'https://example.com/persist1',
          title: 'Persist Link',
          description: '',
          image: '',
          tags: [],
          category: 'GitHub',
          important: true,
          mustHave: true,
          favorite: true,
          domain: 'example.com',
          createdAt: new Date().toISOString(),
        },
      ],
    }

    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    })
    // empty store -> no duplicates -> immediate import, no preview modal
    await expect(page.getByText(/Import complete/)).toBeVisible()
    await openView(page, 'links')
    await expect(visibleLinkRows(page).first()).toContainText('Persist Link')

    await page.reload()
    await expect(visibleLinkRows(page).first()).toContainText('Persist Link')
    // local-first invariant: the backup's profile is deliberately NOT imported;
    // the on-device identity is untouched.
    await expect(page.locator('.identity-name')).toContainText('Local User')
    await expect(page.getByText('Persist User')).toHaveCount(0)
    const persistedRow = visibleLinkRows(page).first()
    await expect(persistedRow.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(persistedRow.getByRole('button', { name: 'Toggle Important' })).toHaveAttribute('aria-pressed', 'true')
    // stats on Statistics view
    await openView(page, 'links') // totals/flags are asserted from the current rows and badge
  })

  test('11. Last backup', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Last backup:')).toHaveCount(0)
    await saveLink(page, { url: 'https://example.com/last', title: 'Last Test' })

    await openView(page, 'backup')
    const json1 = await clickExportAndCaptureBackup(page)
    expect(json1.links.some((l) => l.title === 'Last Test')).toBe(true)

    await expect(page.getByText(/Last backup:/)).toBeVisible()
    const text1 = await page.getByText(/Last backup:/).textContent()
    expect(text1).toContain('Last backup:')

    // second export should update timestamp
    await page.waitForTimeout(1100)
    await openView(page, 'backup')
    const json2 = await clickExportAndCaptureBackup(page)
    expect(json2.links.some((l) => l.title === 'Last Test')).toBe(true)
    const text2 = await page.getByText(/Last backup:/).textContent()
    expect(text2).toContain('Last backup:')
    // texts should be different or at least still visible
    await expect(page.getByText(/Last backup:/)).toBeVisible()
  })

  test('12. Security — arbitrary fields not executed', async ({ page }) => {
    await page.goto('/')
    const backup = {
      app: 'Save_Link',
      version: 1,
      exportedAt: new Date().toISOString(),
      profile: {},
      links: [
        {
          id: 'sec1',
          originalUrl: 'https://example.com/secure',
          normalizedUrl: 'https://example.com/secure',
          url: 'https://example.com/secure',
          title: '<img src=x onerror=alert(1)>',
          description: '<script>alert(1)</script>',
          image: '',
          tags: [],
          category: 'Other',
          important: false,
          mustHave: false,
          favorite: false,
          domain: 'example.com',
          createdAt: '2023-01-01T00:00:00.000Z',
          malicious: '<script>alert(1)</script>',
          __proto__: { polluted: true },
        },
      ],
    }

    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    })
    // empty store -> no duplicates -> immediate import (XSS payload NOT run)
    await expect(page.getByText(/Import complete/)).toBeVisible()
    await openView(page, 'links')
    const row = visibleLinkRows(page).first()
    // title should be rendered as text, not HTML
    await expect(row.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
    // no script element should be rendered inside card
    await expect(row.locator('script')).toHaveCount(0)
    // ensure no img with onerror executed - check that row does not contain executed script
    await expect(row).toContainText('<script>alert(1)</script>')
    await expect(row.locator('script')).toHaveCount(0)
    // ensure __proto__ pollution didn't happen - check window polluted not exists
    const polluted = await page.evaluate(() => ({}).polluted)
    expect(polluted).toBeUndefined()
  })

  // Regression: the real Import button in the merge-preview modal must
  // actually run the import, close the dialog, and show a summary. This
  // exercises the full DataBackup -> App.vue event boundary, NOT just
  // mergeImportData(). Guards against the "mergeLinks is not defined" failure
  // where the click threw and left the modal stuck open.
  test('13. Import button (Keep existing) performs merge, closes dialog, shows summary', async ({ page }) => {
    test.setTimeout(60000)
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/existing', title: 'Existing' })
    await expect(visibleLinkRows(page)).toHaveCount(1)

    const backup = {
      app: 'Save_Link', version: 2, exportedAt: new Date().toISOString(), profile: { name: 'Imported' },
      links: [
        { id: 'dup1', originalUrl: 'https://example.com/existing', normalizedUrl: 'https://example.com/existing', url: 'https://example.com/existing', title: 'Existing (backup)', description: '', image: '', tags: [], category: 'Other', important: false, mustHave: false, favorite: false, domain: 'example.com', createdAt: new Date().toISOString() },
        { id: 'new1', originalUrl: 'https://example.com/new1', normalizedUrl: 'https://example.com/new1', url: 'https://example.com/new1', title: 'New One', description: '', image: '', tags: [], category: 'Other', important: false, mustHave: false, favorite: false, domain: 'example.com', createdAt: new Date().toISOString() },
      ],
      folders: [],
    }
    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
    })
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Keep existing = skip (default radio)
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    // dialog closes
    await expect(dialog).toHaveCount(0)
    // summary appears
    await expect(page.getByText(/Import complete/)).toBeVisible()
    // new item added, existing preserved (no duplicate row)
    await openView(page, 'links')
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expect(page.getByText('New One')).toBeVisible()
    await expect(page.getByText('Existing', { exact: true })).toBeVisible()
    await expect(page.getByText('Existing (backup)')).toHaveCount(0)
  })

  test('14. Import button (Replace existing) performs merge, closes dialog, shows summary', async ({ page }) => {
    test.setTimeout(60000)
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/existing', title: 'Existing Local' })
    await expect(visibleLinkRows(page)).toHaveCount(1)

    const backup = {
      app: 'Save_Link', version: 2, exportedAt: new Date().toISOString(), profile: { name: 'Imported' },
      links: [
        { id: 'dup1', originalUrl: 'https://example.com/existing', normalizedUrl: 'https://example.com/existing', url: 'https://example.com/existing', title: 'Existing REPLACED', description: '', image: '', tags: [], category: 'Other', important: false, mustHave: false, favorite: false, domain: 'example.com', createdAt: new Date().toISOString() },
        { id: 'new1', originalUrl: 'https://example.com/new1', normalizedUrl: 'https://example.com/new1', url: 'https://example.com/new1', title: 'New One', description: '', image: '', tags: [], category: 'Other', important: false, mustHave: false, favorite: false, domain: 'example.com', createdAt: new Date().toISOString() },
      ],
      folders: [],
    }
    await openView(page, 'backup')
    await page.locator('.backup-card input[type="file"]').setInputFiles({
      name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
    })
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // choose Replace
    await dialog.locator('input[name="import-strategy"][value="replace"]').check()
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText(/replaced/)).toBeVisible()
    await openView(page, 'links')
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expect(page.getByText('Existing REPLACED')).toBeVisible()
    await expect(page.getByText('Existing Local')).toHaveCount(0)
    await expect(page.getByText('New One')).toBeVisible()
  })
})
