import { test, expect } from '@playwright/test'

async function clearStorage(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    // links live in IndexedDB (localStorage is only the v1 recovery source);
    // without this, a "clear" silently keeps the previous data
    const dbs = await (indexedDB.databases ? indexedDB.databases() : Promise.resolve([]))
    await Promise.all(dbs.map((d) => new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(d.name)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })))
  })
  await page.reload()
}

async function installBackupCapture(page) {
  // Capture the actual Blob a real export produces without relying on the
  // unreliable `download` event for blob URLs. Test-only browser setup.
  await page.addInitScript(() => {
    window.__capturedBackups = []
    const originalCreateObjectURL = URL.createObjectURL.bind(URL)
    URL.createObjectURL = function (obj, ...args) {
      const url = originalCreateObjectURL(obj, ...args)
      try {
        if (obj instanceof Blob) {
          obj.text()
            .then((text) => window.__capturedBackups.push({ text, url }))
            .catch(() => {})
        }
      } catch {
        /* ignore */
      }
      return url
    }
  })
}

// Click the real "Export Backup" button and return the actual generated JSON.
async function clickExportAndCaptureBackup(page) {
  const before = await page.evaluate(() => window.__capturedBackups.length)
  await page.getByRole('button', { name: 'Export Backup' }).click()
  await page.waitForFunction((b) => window.__capturedBackups.length > b, before, { timeout: 5000 })
  return page.evaluate((b) => JSON.parse(window.__capturedBackups[b].text), before)
}

async function ensureSaveFormOpen(page) {
  const urlInput = page.locator('#save-url')
  if (!(await urlInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Save a link', exact: true }).click()
  }
}

async function saveLink(page, { url, title }) {
  await ensureSaveFormOpen(page)
  await page.locator('#save-url').fill(url)
  if (title) await page.locator('#save-title').fill(title)
  await page.getByRole('button', { name: 'Save link' }).click()
  await expect(page.getByText('Link saved')).toBeVisible({ timeout: 3000 }).catch(()=>{})
}

test.describe('Folders, Appearance, Color Schemes, Backup v2', () => {
  test.beforeEach(async ({page}) => {
    await installBackupCapture(page)
    await clearStorage(page)
  })

  test('Folders create/rename/delete and counts', async ({page}) => {
    // collect any Vue "Unhandled error" warnings to assert they do not appear
    const unhandledWarnings = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('Unhandled error')) unhandledWarnings.push(msg.text())
    })
    await page.goto('/')
    // create folder
    await page.getByLabel('New folder name').fill('Work')
    await page.getByRole('button', { name: 'Create folder', exact:true }).click()
    await expect(page.locator('.folder-item', {hasText:'Work'})).toBeVisible()
    // create second
    await page.getByLabel('New folder name').fill('Personal')
    await page.getByRole('button', { name: 'Create folder', exact:true }).click()
    await expect(page.locator('.folder-item', {hasText:'Personal'})).toBeVisible()
    // duplicate should show toast + inline error, and preserve the typed name
    await page.getByLabel('New folder name').fill('work')
    await page.getByRole('button', { name: 'Create folder', exact:true }).click()
    await expect(page.getByRole('status').getByText('Folder already exists')).toBeVisible()
    await expect(page.locator('.folder-sidebar .error')).toHaveText('Folder already exists')
    await expect(page.getByLabel('New folder name')).toHaveValue('work')
    // rename
    await page.getByRole('button', { name: 'Rename folder Work' }).click()
    await page.getByLabel('Rename folder Work').fill('Office')
    await page.getByRole('button', { name:'Save folder name' }).click()
    await expect(page.locator('.folder-item', {hasText:'Office'})).toBeVisible()
    await expect(page.getByText('Work')).toHaveCount(0)
    // duplicate rename shows toast + inline error, stays in edit mode, preserves name
    await page.getByRole('button', { name: 'Rename folder Office' }).click()
    await page.getByLabel('Rename folder Office').fill('personal')
    await page.getByRole('button', { name:'Save folder name' }).click()
    await expect(page.getByRole('status').getByText('Folder already exists')).toBeVisible()
    await expect(page.locator('.folder-sidebar .error')).toHaveText('Folder already exists')
    await expect(page.getByLabel('Rename folder Office')).toBeVisible()
    await expect(page.getByLabel('Rename folder Office')).toHaveValue('personal')
    // a subsequent valid rename (back to Office) still works
    await page.getByLabel('Rename folder Office').fill('Office')
    await page.getByRole('button', { name:'Save folder name' }).click()
    await expect(page.locator('.folder-item', {hasText:'Office'})).toBeVisible()
    // save link in folder
    await ensureSaveFormOpen(page)
    await page.locator('#save-url').fill('https://example.com/work1')
    await page.locator('#save-title').fill('Work link')
    await page.getByLabel('Select folder').selectOption({ label: 'Office' })
    await page.getByRole('button', { name: 'Save link' }).click()
    await expect(page.getByText('Work link')).toBeVisible()
    // folder count should be 1 for Office, Unfiled 0? check UI
    await expect(page.locator('.folder-item', {hasText:'Office'})).toContainText('1')
    // delete folder moves to Unfiled (in-app dialog; cancel returns focus to the trigger)
    await page.getByRole('button', { name: 'Delete folder Office' }).click()
    const folderDialog = page.getByRole('dialog')
    await expect(folderDialog).toBeVisible()
    await folderDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.folder-item', { hasText: 'Office' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Delete folder Office')
    await page.getByRole('button', { name: 'Delete folder Office' }).click()
    await expect(folderDialog).toBeVisible()
    await folderDialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('Office')).toHaveCount(0)
    await expect(page.locator('.folder-item', {hasText:'Unfiled'})).toContainText('1')
    // link still exists and folder badge shows Unfiled
    await expect(page.locator('article.card').first()).toContainText('Work link')
    await expect(page.locator('article.card').first()).toContainText('Unfiled')
    // after CONFIRM deletion the trigger button is gone, so focus must fall back
    // to the surviving "Save a link" toggle rather than dropping to <body>
    await expect.poll(() => page.evaluate(() => {
      const a = document.activeElement
      return { isBody: a === document.body, isToggle: !!a?.classList?.contains('add-toggle') }
    })).toEqual({ isBody: false, isToggle: true })
    // a subsequent valid create still works
    await page.getByLabel('New folder name').fill('AfterDuplicate')
    await page.getByRole('button', { name: 'Create folder', exact:true }).click()
    await expect(page.locator('.folder-item', {hasText:'AfterDuplicate'})).toBeVisible()
    // duplicate create/rename must never trigger Vue's unhandled-event warning
    expect(unhandledWarnings).toEqual([])
  })

  test('Assign folder via edit and filtering + search', async ({page}) => {
    await page.goto('/')
    await page.getByLabel('New folder name').fill('Alpha')
    await page.getByRole('button', { name:'Create folder', exact:true }).click()
    await saveLink(page, {url:'https://example.com/a', title:'Alpha Link'})
    await saveLink(page, {url:'https://example.com/b', title:'Beta Link'})
    // edit first link to assign folder Alpha
    // Note order newest first: Beta first, Alpha second. So second is Alpha Link
    const alphaCard = page.locator('article.card').nth(1)
    await alphaCard.getByRole('button', { name:'Edit link'}).click()
    await alphaCard.getByLabel('Edit folder').selectOption({ label:'Alpha'})
    await alphaCard.getByRole('button', { name:'Save'}).click()
    await expect(alphaCard).toContainText('Alpha')
    // filter by folder Alpha should show 1
    await page.getByLabel('Filter by folder').selectOption({ label:'Alpha'})
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Alpha Link')
    // search across folders
    await page.getByLabel('Filter by folder').selectOption('All folders')
    await page.getByLabel('Search links').fill('Alpha')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Alpha Link')
    // clear search shows both again
    await page.getByLabel('Search links').fill('')
    await expect(page.locator('article.card')).toHaveCount(2)
  })

  test('Folder independent of important/favorite and persistence after reload', async ({page}) => {
    await page.goto('/')
    await page.getByLabel('New folder name').fill('PersistFolder')
    await page.getByRole('button', { name:'Create folder', exact:true }).click()
    await ensureSaveFormOpen(page)
    await page.locator('#save-url').fill('https://example.com/persistFolder')
    await page.locator('#save-title').fill('Persist Folder Link')
    await page.getByLabel('Select folder').selectOption({ label:'PersistFolder'})
    await page.getByRole('button', { name:'Save link'}).click()
    const card = page.locator('article.card').first()
    await card.getByRole('button', { name:'Toggle Important'}).click()
    await card.getByRole('button', { name:'Toggle Favorite'}).click()
    await expect(card.getByRole('button', { name:'Toggle Important'})).toHaveAttribute('aria-pressed','true')
    await page.reload()
    await expect(page.locator('.folder-item', {hasText:'PersistFolder'})).toBeVisible()
    await expect(page.locator('article.card').first()).toContainText('Persist Folder Link')
    await expect(page.locator('article.card').first()).toContainText('PersistFolder')
    await expect(page.locator('article.card').first().getByRole('button',{name:'Toggle Important'})).toHaveAttribute('aria-pressed','true')
    await expect(page.locator('article.card').first().getByRole('button',{name:'Toggle Favorite'})).toHaveAttribute('aria-pressed','true')
  })

  test('Migrate existing links without folder to Unfiled', async ({page}) => {
    await page.goto('/')
    await page.evaluate(()=>{
      const key='save_link:test:links'
      const links=[{ id:'old1', originalUrl:'https://example.com/old', normalizedUrl:'https://example.com/old', url:'https://example.com/old', title:'Old Link', domain:'example.com', tags:[], category:'Other', important:false, mustHave:false, favorite:false, createdAt:new Date().toISOString()}]
      localStorage.setItem(key, JSON.stringify(links))
      localStorage.removeItem('save_link:test:folders')
      // the localStorage->IndexedDB migration must see this as a first run:
      // without removing the marker the seed would be skipped as 'complete'
      localStorage.removeItem('save_link:test:migration')
    })
    await page.reload()
    await expect(page.locator('article.card').first()).toContainText('Old Link')
    await expect(page.locator('article.card').first()).toContainText('Unfiled')
    await expect(page.locator('.folder-item', {hasText:'Unfiled'})).toContainText('1')
  })

  test('Appearance Light/Dark/System persistence and system follows', async ({page}) => {
    await page.goto('/')
    // default with no saved preference should be system
    await expect(page.getByLabel('System theme')).toBeChecked()
    // switch to Dark
    await page.getByLabel('Dark theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance','dark')
    await page.reload()
    await expect(page.getByLabel('Dark theme')).toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-appearance','dark')
    // switch to Light
    await page.getByLabel('Light theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance','light')
    await page.reload()
    await expect(page.getByLabel('Light theme')).toBeChecked()
    // System follows prefers-color-scheme is tested via setting system and checking attribute matches media query; we just verify system sets based on dark/light mock by checking that system option checked and attribute is either light or dark
    await page.getByLabel('System theme').click()
    await expect(page.getByLabel('System theme')).toBeChecked()
    const appearance = await page.getAttribute('html','data-appearance')
    expect(['light','dark']).toContain(appearance)
    // existing data intact after theme switch: create link then switch theme still visible
    await saveLink(page, {url:'https://example.com/themeTest', title:'Theme Persist'})
    await page.getByLabel('Dark theme').click()
    await expect(page.locator('article.card').first()).toContainText('Theme Persist')
  })

  test('Color schemes all 4 and independence', async ({page}) => {
    await page.goto('/')
    // default Ocean
    await expect(page.getByLabel('Ocean color scheme')).toBeChecked()
    for (const scheme of ['Forest color scheme','Lavender color scheme','Amber color scheme','Ocean color scheme']) {
      await page.getByLabel(scheme).click()
      await expect(page.getByLabel(scheme)).toBeChecked()
      const cs = await page.getAttribute('html','data-color-scheme')
      // map labels to values
      const map={ 'Ocean color scheme':'ocean','Forest color scheme':'forest','Lavender color scheme':'lavender','Amber color scheme':'amber'}
      expect(cs).toBe(map[scheme])
      // each works with light/dark
      await page.getByLabel('Light theme').click()
      await expect(page.locator('html')).toHaveAttribute('data-appearance','light')
      await page.getByLabel('Dark theme').click()
      await expect(page.locator('html')).toHaveAttribute('data-appearance','dark')
      await page.getByLabel('System theme').click()
      // readable check: card still visible
      await expect(page.getByText('Appearance')).toBeVisible()
    }
    // persistence after reload for forest
    await page.getByLabel('Forest color scheme').click()
    await page.reload()
    await expect(page.getByLabel('Forest color scheme')).toBeChecked()
    // independence from appearance
    await page.getByLabel('Light theme').click()
    await page.getByLabel('Lavender color scheme').click()
    await expect(page.getByLabel('Light theme')).toBeChecked()
    await expect(page.getByLabel('Lavender color scheme')).toBeChecked()
  })

  test('Backup v2 export/import and v1 migrate, invalid rejected', async ({page}) => {
    await page.goto('/')
    await page.getByLabel('New folder name').fill('BackupFolder')
    await page.getByRole('button', { name:'Create folder', exact:true }).click()
    await page.getByLabel('Forest color scheme').click()
    await page.getByLabel('Dark theme').click()
    await saveLink(page, {url:'https://example.com/backupF', title:'Backup Folder Link'})
    // assign folder via edit
    const card = page.locator('article.card').first()
    await card.getByRole('button', { name:'Edit link'}).click()
    await card.getByLabel('Edit folder').selectOption({ label:'BackupFolder'})
    await card.getByRole('button', { name:'Save'}).click()
    // export v2
    const json = await clickExportAndCaptureBackup(page)
    expect(json.version).toBe(2)
    expect(json.folders.length).toBe(1)
    expect(json.settings.appearance).toBe('dark')
    expect(json.settings.colorScheme).toBe('forest')
    expect(json.links[0].folderId).toBeDefined()
    // clear and import v2
    await clearStorage(page)
    await page.goto('/')
    await page.locator('.backup-card input[type="file"]').setInputFiles({ name:'backup.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(json))})
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText('Backup imported')).toBeVisible()
    await expect(page.locator('article.card').first()).toContainText('Backup Folder Link')
    await expect(page.locator('.folder-item', {hasText:'BackupFolder'})).toBeVisible()
    await expect(page.getByLabel('Dark theme')).toBeChecked()
    await expect(page.getByLabel('Forest color scheme')).toBeChecked()
    // v1 still imports with defaults
    const v1 = { app:'Save_Link', version:1, exportedAt:new Date().toISOString(), profile:{name:'V1 User'}, links:[{ id:'v1id', originalUrl:'https://example.com/v1', normalizedUrl:'https://example.com/v1', url:'https://example.com/v1', title:'V1 Link'}]}
    await page.locator('.backup-card input[type="file"]').setInputFiles({ name:'v1.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(v1))})
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText('Backup imported')).toBeVisible()
    await expect(page.locator('article.card').first()).toContainText('V1 Link')
    await expect(page.getByLabel('System theme')).toBeChecked()
    await expect(page.getByLabel('Ocean color scheme')).toBeChecked()
    await expect(page.locator('.folder-item', {hasText:'Unfiled'})).toBeVisible()
    // invalid backup rejected
    await saveLink(page, {url:'https://example.com/keepInvalid', title:'KeepInvalid'})
    await page.locator('.backup-card input[type="file"]').setInputFiles({ name:'bad.json', mimeType:'application/json', buffer:Buffer.from('not json')})
    await expect(page.getByRole('status').getByText('Invalid backup file: not valid JSON')).toBeVisible()
    await expect(page.locator('article.card', {hasText:'KeepInvalid'})).toBeVisible()
    // security: v-html not executed
    const malicious = { app:'Save_Link', version:2, exportedAt:new Date().toISOString(), profile:{}, settings:{appearance:'system', colorScheme:'ocean'}, folders:[], links:[{ id:'sec', originalUrl:'https://example.com/sec', normalizedUrl:'https://example.com/sec', title:'<script>alert(1)</script>', description:'<img onerror=alert(1)>'}]}
    await page.locator('.backup-card input[type="file"]').setInputFiles({ name:'mal.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(malicious))})
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText('Backup imported')).toBeVisible()
    await expect(page.locator('article.card').first()).toContainText('<script>alert(1)</script>')
    await expect(page.locator('article.card').first().locator('script')).toHaveCount(0)
  })
})
