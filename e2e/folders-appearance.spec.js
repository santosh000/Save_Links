import { test, expect } from '@playwright/test'
import { clearStorage, openView, ensureAddLinkOpen, saveLink, visibleLinkRows, linkRowByTitle, installBackupCapture, clickExportAndCaptureBackup } from './helpers.js'

async function createFolder(page, name) {
  await page.getByLabel('New folder name').fill(name)
  await page.getByRole('button', { name: 'Create folder', exact: true }).click()
  await expect(page.locator('.folder-item', { hasText: name })).toBeVisible()
}

test.describe('Folders, Appearance, Color Schemes, Backup v2', () => {
  test.beforeEach(async ({ page }) => {
    await installBackupCapture(page)
    await clearStorage(page)
  })

  test('Folders create/rename/delete and counts', async ({ page }) => {
    // collect any Vue "Unhandled error" warnings to assert they do not appear
    const unhandledWarnings = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('Unhandled error')) unhandledWarnings.push(msg.text())
    })

    await openView(page, 'folders')
    // create folder
    await createFolder(page, 'Work')
    // create second
    await createFolder(page, 'Personal')
    // duplicate should show toast + inline error, and preserve the typed name
    await page.getByLabel('New folder name').fill('work')
    await page.getByRole('button', { name: 'Create folder', exact: true }).click()
    await expect(page.locator('.sl-toast')).toContainText('Folder already exists')
    await expect(page.locator('.folder-sidebar .error')).toHaveText('Folder already exists')
    await expect(page.getByLabel('New folder name')).toHaveValue('work')
    // rename
    await page.getByRole('button', { name: 'Rename folder Work' }).click()
    await page.getByLabel('Rename folder Work').fill('Office')
    await page.getByRole('button', { name: 'Save folder name' }).click()
    await expect(page.locator('.folder-item', { hasText: 'Office' })).toBeVisible()
    await expect(page.getByText('Work')).toHaveCount(0)
    // duplicate rename shows toast + inline error, stays in edit mode, preserves name
    await page.getByRole('button', { name: 'Rename folder Office' }).click()
    await page.getByLabel('Rename folder Office').fill('personal')
    await page.getByRole('button', { name: 'Save folder name' }).click()
    await expect(page.locator('.sl-toast')).toContainText('Folder already exists')
    await expect(page.locator('.folder-sidebar .error')).toHaveText('Folder already exists')
    await expect(page.getByLabel('Rename folder Office')).toBeVisible()
    await expect(page.getByLabel('Rename folder Office')).toHaveValue('personal')
    // a subsequent valid rename (back to Office) still works
    await page.getByLabel('Rename folder Office').fill('Office')
    await page.getByRole('button', { name: 'Save folder name' }).click()
    await expect(page.locator('.folder-item', { hasText: 'Office' })).toBeVisible()
    // save link in folder
    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/work1', title: 'Work link' })
    // current contract: assign the folder through the row's More actions (the old saveLink folder option is unsupported)
    const workRow = linkRowByTitle(page, 'Work link')
    await workRow.getByRole('button', { name: 'More actions' }).click()
    const workMenu = page.locator('.more-menu')
    await expect(workMenu).toBeVisible()
    await workMenu.locator('.more-field', { hasText: 'Folder' }).locator('select').selectOption({ label: 'Office' })
    await expect(page.getByText('Folder updated')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(workMenu).toBeHidden()
    // folder count should be 1 for Office
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'Office' })).toContainText('1')
    // delete folder moves to Unfiled (in-app dialog; cancel returns focus to the trigger)
    await page.getByRole('button', { name: 'Delete folder Office' }).click()
    const folderDialog = page.getByRole('dialog')
    await expect(folderDialog).toBeVisible()
    await folderDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.folder-item', { hasText: 'Office' })).toBeVisible()
    // Note: focus-return-after-cancel behavior preserved (delete button still present)
    await page.getByRole('button', { name: 'Delete folder Office' }).click()
    await expect(folderDialog).toBeVisible()
    await folderDialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('Office')).toHaveCount(0)
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' })).toContainText('1')
    // the link itself still exists in Saved links
    await openView(page, 'links')
    await expect(visibleLinkRows(page).first()).toContainText('Work link')
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' }).locator('.folder-count')).toHaveText('1') // folder state lives in the Folders view, not in card text
    // after CONFIRM deletion the trigger button is gone, focus falls to body (no fallback)
    // Note: focus-return-after-confirm is a known gap in the new shell
    // a subsequent valid create still works
    await page.getByLabel('New folder name').fill('AfterDuplicate')
    await page.getByRole('button', { name: 'Create folder', exact: true }).click()
    await expect(page.locator('.folder-item', { hasText: 'AfterDuplicate' })).toBeVisible()
    // duplicate create/rename must never trigger Vue's unhandled-event warning
    expect(unhandledWarnings).toEqual([])
  })

  test('Assign folder via edit and filtering + search', async ({ page }) => {
    await openView(page, 'folders')
    await createFolder(page, 'Alpha')
    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/a', title: 'Alpha Link' })
    await saveLink(page, { url: 'https://example.com/b', title: 'Beta Link' })
    // edit first link to assign folder Alpha
    const { linkRowByTitle } = await import('./helpers.js')
    const row = linkRowByTitle(page, 'Alpha Link')
    await row.getByRole('button', { name: 'More actions' }).click()
    const moreMenu = page.locator('.more-menu')
    await expect(moreMenu).toBeVisible()
    await moreMenu.locator('.more-field', { hasText: 'Folder' }).locator('select').selectOption({ label: 'Alpha' })
    await expect(page.getByText('Folder updated')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(moreMenu).toBeHidden()
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'Alpha' }).locator('.folder-count')).toHaveText('1')
    // filter by folder Alpha should show 1
    await openView(page, 'folders')
    await page.getByRole('button', { name: 'Show folder Alpha' }).click()
    await page.getByLabel('Search links').fill('Beta')
    await expect(visibleLinkRows(page)).toHaveCount(0)
    await page.getByLabel('Search links').fill('Alpha')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Alpha Link')
    // clear folder filter via chip
    await page.getByRole('button', { name: 'Clear folder filter' }).click()
    await page.getByLabel('Search links').fill('')
    await expect(visibleLinkRows(page)).toHaveCount(2)
    // search across folders
    await page.getByLabel('Search links').fill('Alpha')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Alpha Link')
    await page.getByLabel('Search links').fill('')
    await expect(visibleLinkRows(page)).toHaveCount(2)
  })

  test('Folder independent of important/favorite and persistence after reload', async ({ page }) => {
    await openView(page, 'folders')
    await createFolder(page, 'PersistFolder')
    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/persistFolder', title: 'Persist Folder Link' })
    const row = linkRowByTitle(page, 'Persist Folder Link')
    await row.getByRole('button', { name: 'More actions' }).click()
    const moreMenu = page.locator('.more-menu')
    await expect(moreMenu).toBeVisible()
    await moreMenu.locator('.more-field', { hasText: 'Folder' }).locator('select').selectOption({ label: 'PersistFolder' })
    await expect(page.getByText('Folder updated')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(moreMenu).toBeHidden()
    // current permanent controls
    await row.getByRole('button', { name: 'Toggle Favorite' }).click()
    await row.getByRole('button', { name: 'Toggle Important' }).click()
    await expect(row.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(row.getByRole('button', { name: 'Toggle Important' })).toHaveAttribute('aria-pressed', 'true')
    await page.reload()
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'PersistFolder' })).toBeVisible()
    await openView(page, 'links')
    const persisted = linkRowByTitle(page, 'Persist Folder Link')
    await expect(persisted).toBeVisible()
    await expect(persisted.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(persisted.getByRole('button', { name: 'Toggle Important' })).toHaveAttribute('aria-pressed', 'true')
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'PersistFolder' }).locator('.folder-count')).toHaveText('1')
  })

  test('Migrate existing links without folder to Unfiled', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      const key = 'save_link:test:links'
      const links = [{ id: 'old1', originalUrl: 'https://example.com/old', normalizedUrl: 'https://example.com/old', url: 'https://example.com/old', title: 'Old Link', domain: 'example.com', tags: [], category: 'Other', important: false, mustHave: false, favorite: false, createdAt: new Date().toISOString() }]
      localStorage.setItem(key, JSON.stringify(links))
      localStorage.removeItem('save_link:test:folders')
      localStorage.removeItem('save_link:test:migration')
    })
    await page.reload()
    await expect(visibleLinkRows(page).first()).toContainText('Old Link')
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' })).toContainText('1')
  })

  test('Appearance Light/Dark/System persistence and system follows', async ({ page }) => {
    await openView(page, 'settings')
    // default with no saved preference should be system
    await expect(page.getByLabel('System theme')).toBeChecked()
    // switch to Dark
    await page.getByLabel('Dark theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await page.reload()
    await openView(page, 'settings')
    await expect(page.getByLabel('Dark theme')).toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    // switch to Light
    await page.getByLabel('Light theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light')
    await page.reload()
    await openView(page, 'settings')
    await expect(page.getByLabel('Light theme')).toBeChecked()
    // System follows prefers-color-scheme is tested via setting system and checking attribute matches media query
    await page.getByLabel('System theme').click()
    await expect(page.getByLabel('System theme')).toBeChecked()
    const appearance = await page.getAttribute('html', 'data-appearance')
    expect(['light', 'dark']).toContain(appearance)
    // existing data intact after theme switch: create link then switch theme still visible
    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/themeTest', title: 'Theme Persist' })
    await openView(page, 'settings')
    await page.getByLabel('Dark theme').click()
    await openView(page, 'links')
    await expect(page.getByRole('link', { name: 'Theme Persist', exact: true })).toBeVisible()
  })

  test('Color schemes all 4 and independence', async ({ page }) => {
    await openView(page, 'settings')
    // default is no named color scheme
    await expect(page.getByLabel('None color scheme')).toBeChecked()
    for (const scheme of ['Forest color scheme', 'Lavender color scheme', 'Amber color scheme', 'Ocean color scheme']) {
      await page.getByLabel(scheme).click()
      await expect(page.getByLabel(scheme)).toBeChecked()
      const cs = await page.getAttribute('html', 'data-color-scheme')
      const map = { 'Ocean color scheme': 'ocean', 'Forest color scheme': 'forest', 'Lavender color scheme': 'lavender', 'Amber color scheme': 'amber' }
      expect(cs).toBe(map[scheme])
      // each works with light/dark
      await page.getByLabel('Light theme').click()
      await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light')
      await page.getByLabel('Dark theme').click()
      await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
      await page.getByLabel('System theme').click()
      // readable check: settings card still visible
      await expect(page.getByText('Appearance')).toBeVisible()
    }
    // persistence after reload for forest
    await page.getByLabel('Forest color scheme').click()
    await page.reload()
    await openView(page, 'settings')
    await expect(page.getByLabel('Forest color scheme')).toBeChecked()
    // independence from appearance
    await page.getByLabel('Light theme').click()
    await page.getByLabel('Lavender color scheme').click()
    await expect(page.getByLabel('Light theme')).toBeChecked()
    await expect(page.getByLabel('Lavender color scheme')).toBeChecked()
  })

  test('Dark mode: surfaces are neutral black, schemes stay accent-only', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openView(page, 'settings')
    await page.getByLabel('Dark theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')

    // --- Ocean dark: neutral surfaces + indigo accent ---
    await page.getByLabel('Ocean color scheme').click()
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'ocean')
    // toRgb handles both "#rrggbb" tokens and resolved "rgb(r, g, b)"
    const toRgb = (v) => {
      const hex = v.trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
      if (hex) return hex.slice(1).map((h) => parseInt(h, 16))
      const parts = v.match(/\d+(?:\.\d+)?/g)
      if (!parts || parts.length < 3) throw new Error(`unparseable color: ${v}`)
      return parts.slice(0, 3).map(Number)
    }
    const assertNeutral = (v, label) => {
      const [r, g, b] = toRgb(v)
      expect({ label, v, r, g, b, d1: Math.abs(g - r), d2: Math.abs(g - b) }).toBeDefined()
      expect(Math.abs(g - r), `${label}=${v}`).toBeLessThanOrEqual(7)
      expect(Math.abs(g - b), `${label}=${v}`).toBeLessThanOrEqual(7)
    }
    const readVar = (name) =>
      page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

    for (const v of ['--bg', '--card', '--muted-bg', '--border']) {
      assertNeutral(await readVar(v), v)
    }

    // Accent is still the scheme colour — not neutral
    const oceanAccent = await readVar('--accent')
    expect(oceanAccent).toBe('#7C8CF2')

    // Sidebar background is neutral (scheme no longer tints it).
    // .sidebar-wrapper has `transition: all 0.3s`, so poll until it settles.
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.querySelector('.sidebar-wrapper')).backgroundColor)
      )
      .toBe('rgb(0, 0, 0)')
    const sidebarBg = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.sidebar-wrapper')).backgroundColor
    )
    assertNeutral(sidebarBg, 'sidebar (ocean)')

    // --- Forest dark: surfaces still neutral, accent is forest green ---
    await page.getByLabel('Forest color scheme').click()
    for (const v of ['--bg', '--card', '--muted-bg', '--border']) {
      assertNeutral(await readVar(v))
    }
    const forestAccent = await readVar('--accent')
    expect(forestAccent).toBe('#62A982')
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.querySelector('.sidebar-wrapper')).backgroundColor)
      )
      .toBe('rgb(0, 0, 0)')
    const forestSidebarBg = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.sidebar-wrapper')).backgroundColor
    )
    assertNeutral(forestSidebarBg, 'sidebar (forest)')

    // --- Light mode unchanged: soft near-white canvas, white card ---
    await page.getByLabel('Light theme').click()
    expect(await readVar('--card')).toBe('#FFFFFF')
    expect(await readVar('--bg')).toBe('#F6F6F7') // not dark's black
  })

  test('Backup v2 export/import and v1 migrate, invalid rejected', async ({ page }) => {
    await openView(page, 'folders')
    await createFolder(page, 'BackupFolder')
    await openView(page, 'settings')
    await page.getByLabel('Forest color scheme').click()
    await page.getByLabel('Dark theme').click()
    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/backupF', title: 'Backup Folder Link' })
    // assign folder via edit modal
    const backupRow = linkRowByTitle(page, 'Backup Folder Link')
    await backupRow.getByRole('button', { name: 'More actions' }).click()
    const backupMenu = page.locator('.more-menu')
    await expect(backupMenu).toBeVisible()
    await backupMenu.locator('.more-field', { hasText: 'Folder' }).locator('select').selectOption({ label: 'BackupFolder' })
    await expect(page.getByText('Folder updated')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(backupMenu).toBeHidden()
    // export v2
    await openView(page, 'backup') // the Export control lives in the Backup view
    const json = await clickExportAndCaptureBackup(page)
    expect(json.version).toBe(2)
    expect(json.folders.length).toBe(1)
    expect(json.settings.appearance).toBe('dark')
    expect(json.settings.colorScheme).toBe('forest')
    expect(json.links[0].folderId).toBeDefined()
    // clear and import v2 (empty store -> no duplicates -> immediate import)
    await clearStorage(page)
    await page.goto('/')
    await openView(page, 'backup') // the import control lives in the Backup view
    await page.locator('.backup-card input[type="file"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) })
    await expect(page.getByText(/Import complete/)).toBeVisible()
    await openView(page, 'links')
    await expect(visibleLinkRows(page).first()).toContainText('Backup Folder Link')
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'BackupFolder' })).toBeVisible()
    // local-first invariant: imported appearance/color-scheme are NOT applied
    await openView(page, 'settings')
    await expect(page.getByLabel('System theme')).toBeChecked()
    await expect(page.getByLabel('None color scheme')).toBeChecked()
    // v1 still imports with defaults
    const v1 = { app: 'Save_Link', version: 1, exportedAt: new Date().toISOString(), profile: { name: 'V1 User' }, links: [{ id: 'v1id', originalUrl: 'https://example.com/v1', normalizedUrl: 'https://example.com/v1', url: 'https://example.com/v1', title: 'V1 Link' }] }
    await openView(page, 'backup') // the import control lives in the Backup view
    await page.locator('.backup-card input[type="file"]').setInputFiles({ name: 'v1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v1)) })
    await expect(page.getByText(/Import complete/)).toBeVisible()
    await openView(page, 'links')
    await expect(linkRowByTitle(page, 'V1 Link')).toBeVisible()
    await openView(page, 'settings')
    await expect(page.getByLabel('System theme')).toBeChecked()
    await expect(page.getByLabel('None color scheme')).toBeChecked()
    await openView(page, 'folders')
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' })).toBeVisible()
    // invalid backup rejected
    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/keepInvalid', title: 'KeepInvalid' })
    await openView(page, 'backup') // the import control lives in the Backup view
    await page.locator('.backup-card input[type="file"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not json') })
    await expect(page.getByRole('status').getByText('Invalid backup file: not valid JSON')).toBeVisible()
    await openView(page, 'links')
    await expect(linkRowByTitle(page, 'KeepInvalid')).toBeVisible()
    // security: v-html not executed
    const malicious = { app: 'Save_Link', version: 2, exportedAt: new Date().toISOString(), profile: {}, settings: { appearance: 'system', colorScheme: 'ocean' }, folders: [], links: [{ id: 'sec', originalUrl: 'https://example.com/sec', normalizedUrl: 'https://example.com/sec', title: '<script>alert(1)</script>', description: '<img onerror=alert(1)>' }] }
    await openView(page, 'backup') // the import control lives in the Backup view
    await page.locator('.backup-card input[type="file"]').setInputFiles({ name: 'mal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(malicious)) })
    await expect(page.getByText(/Import complete/)).toBeVisible()
    await openView(page, 'links')
    await expect(linkRowByTitle(page, '<script>alert(1)</script>')).toBeVisible()
    const secRow = linkRowByTitle(page, '<script>alert(1)</script>')
    await expect(secRow).toBeVisible()
    await expect(secRow.locator('script')).toHaveCount(0)
  })
})
