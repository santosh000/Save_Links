// Shared utilities for SaveLink E2E specs
// All tests import from here to avoid duplication and keep selectors centralized.
import { expect } from '@playwright/test'

export async function clearStorage(page, { reload = true } = {}) {
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
  if (reload) await page.reload()
}

// Read the real persisted link rows from the on-device database. Used for
// data-level assertions where the UI intentionally has no control anymore
// (e.g. the Important / Must Have flags).
export async function readStoredLinks(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('save_links:test')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction('links', 'readonly')
      const rq = tx.objectStore('links').getAll()
      rq.onsuccess = () => resolve(rq.result)
      rq.onerror = () => reject(rq.error)
    })
    db.close()
    return rows
  })
}

export async function installBackupCapture(page) {
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

export async function clickExportAndCaptureBackup(page) {
  const before = await page.evaluate(() => window.__capturedBackups.length)
  await page.getByRole('button', { name: 'Export Backup' }).click()
  await page.waitForFunction((b) => window.__capturedBackups.length > b, before, { timeout: 5000 })
  return page.evaluate((b) => JSON.parse(window.__capturedBackups[b].text), before)
}

export async function openView(page, view) {
  const titles = {
    links: 'Links',
    settings: 'Settings',
    about: 'About',
    // Backup & restore is no longer a standalone view: it is the Settings
    // modal's Data section (the Tools sidebar entries were removed).
    backup: 'Backup & restore',
  }
  if (view !== 'folders' && !titles[view]) throw new Error(`Unknown view: ${view}`)
  // An open overlay (the Settings modal / import preview / Add-Edit form) must
  // never block the navigation this helper performs — close it first, then go.
  const blockingDialog = page.getByRole('dialog')
  if (await blockingDialog.count()) {
    await page.keyboard.press('Escape')
    await expect(blockingDialog).toHaveCount(0)
  }
  for (const form of [page.locator('#add-form'), page.locator('.edit-form')]) {
    if (await form.count()) {
      await form.getByRole('button', { name: 'Cancel', exact: true }).first().click()
      await expect(form).toHaveCount(0)
    }
  }
  // The standalone Folders page was removed: the sidebar folder tree is the
  // only folder surface. A request for the old view now just reveals the tree.
  if (view === 'folders') {
    await openSidebarFolderTree(page)
    return
  }
  const expectedTitle = titles[view]

  // Settings is the single app-level sidebar item (bottom footer); Backup &
  // restore and About are its Data/About sections. The footer opens from the
  // desktop sidebar, the 80px rail and the tablet/mobile drawer alike.
  const openSettingsModal = async () => {
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    if (viewportWidth < 1200) {
      const drawer = page.locator('.sidebar-wrapper')
      const drawerOpen = await drawer.evaluate((el) => el.classList.contains('show')).catch(() => false)
      if (!drawerOpen) {
        const toggle = page.locator('#sidebar-toggle')
        if (await toggle.isVisible().catch(() => false)) await toggle.click()
        else await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'More', exact: true }).click()
      }
      await expect(drawer).toHaveClass(/\bshow\b/)
    }
    await page.locator('.sidebar-menu-link').filter({ hasText: 'Settings' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    return page.getByRole('dialog')
  }

  if (view === 'settings' || view === 'about' || view === 'backup') {
    const dialog = await openSettingsModal()
    if (view === 'about') {
      await dialog.locator('.settings-nav-item').filter({ hasText: 'About' }).click()
      await expect(dialog.locator('.dialog-title')).toHaveText('About')
      return
    }
    if (view === 'backup') {
      await dialog.locator('.settings-nav-item').filter({ hasText: 'Data' }).click()
      await expect(dialog.locator('.dialog-title')).toHaveText('Settings')
      await expect(dialog.locator('.backup-card')).toBeVisible()
      return
    }
    await expect(dialog.locator('.dialog-title')).toHaveText('Settings')
    return
  }

  // Links: the bottom bar below the desktop shell, the sidebar footer on
  // desktop.
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  if (viewportWidth < 1200) {
    // The drawer must not stay open over the target view (specs interact with
    // the page right after navigating).
    const drawer = page.locator('.sidebar-wrapper')
    if (await drawer.evaluate((el) => el.classList.contains('show')).catch(() => false)) {
      await page.locator('.sidebar-close').click()
      await expect(drawer).not.toHaveClass(/\bshow\b/)
    }
    // Already on the target view: clicking "All" would clear the active
    // filters, so navigation is a no-op exactly like the old bar item.
    if ((await page.locator('.page-title').textContent()) === expectedTitle) return
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'All', exact: true }).click()
    await expect(page.locator('.page-title')).toHaveText(expectedTitle)
    return
  }

  await expect(page.locator('.sidebar-wrapper')).toBeVisible()
  await page.locator('.sidebar-menu-link').filter({ hasText: expectedTitle }).first().click()
  await expect(page.locator('.page-title')).toHaveText(expectedTitle)
}

// P8: the library boots in Compact; specs that exercise the card grid opt in
// explicitly (the same control a user would press).
export async function setViewMode(page, mode) {
  const labels = { card: 'Card', list: 'List', compact: 'Compact' }
  const btn = page.locator('.view-btn').filter({ hasText: labels[mode] })
  await btn.click()
  await expect(btn).toHaveClass(/active/)
}

export async function ensureCardView(page) {
  const card = page.locator('.view-btn').filter({ hasText: 'Card' })
  if (!(await card.evaluate((el) => el.classList.contains('active')).catch(() => false))) {
    await setViewMode(page, 'card')
  }
}

export async function ensureAddLinkOpen(page, { more = false } = {}) {
  await openView(page, 'links')
  if (!(await page.locator('#save-url').isVisible().catch(() => false))) {
    // P8: below the desktop grid the floating action is the single Add entry
    // point; the desktop grid (>=1200) keeps the toolbar toggle.
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    if (viewportWidth < 1200) await page.locator('.fab').click()
    else await page.locator('.content-head .add-toggle').click()
  }
  if (more) {
    const moreBtn = page.getByRole('button', { name: 'More options', exact: true })
    if ((await moreBtn.getAttribute('aria-expanded')) !== 'true') await moreBtn.click()
  }
}

export async function saveLink(page, { url, title, description, image, tags, category, expectToast = true }) {
  // Image / Category live in the Add form's secondary "More options" block;
  // Description and Tags are primary fields. Important / Must Have have no UI
  // surface anymore — seed those data-only fields with seedLinks().
  const needsMore = image !== undefined || category !== undefined
  await ensureAddLinkOpen(page, { more: needsMore })
  await page.locator('#save-url').fill(url)
  if (title !== undefined) await page.locator('#save-title').fill(title)
  if (description !== undefined) await page.locator('#save-desc').fill(description)
  if (image !== undefined) await page.locator('#save-image').fill(image)
  if (tags !== undefined) await page.locator('#save-tags').fill(tags)
  if (category) await page.locator('#save-category').selectOption(category)

  await page.getByRole('button', { name: 'Save link', exact: true }).click()
  await expect(page.locator('#add-form')).toHaveCount(0)
  if (expectToast) await expect(page.getByText('Link saved')).toBeVisible()
}

// Build a full link record for data-level seeding (the app normalizes any
// partial record, but explicit fields keep store/export assertions exact).
export function linkRecord(overrides = {}) {
  const url = overrides.url || 'https://example.com/seeded'
  return {
    id: overrides.id || `seed-${Math.random().toString(36).slice(2, 10)}`,
    originalUrl: url,
    normalizedUrl: url,
    url,
    title: 'Seeded Link',
    description: '',
    image: '',
    tags: [],
    category: 'Other',
    important: false,
    mustHave: false,
    favorite: false,
    domain: 'example.com',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// Important / Must Have are real stored fields with no UI control anymore, so
// they are seeded through the app's real legacy migration path (localStorage ->
// IndexedDB), exactly like migration.spec.js does.
export async function seedLinks(page, links) {
  await page.goto('/')
  await page.evaluate((rows) => {
    localStorage.setItem('save_link:test:links', JSON.stringify(rows))
    localStorage.removeItem('save_link:test:migration')
  }, links)
  await page.reload()
}

// Read the real persisted profile blob (kv store) so specs can wait for the
// app's async profile save before reloading.
export async function readStoredProfile(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('save_links:test')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly')
      const rq = tx.objectStore('kv').get('profile')
      rq.onsuccess = () => resolve(rq.result)
      rq.onerror = () => reject(rq.error)
    })
    db.close()
    return record ? record.value : null
  })
}

// Color-scheme radios are visually hidden under their own swatch dot, so the
// input is never the hit target: click the label a user clicks (the nested
// radio toggles natively) and assert the input's checked state as usual.
export async function selectColorScheme(page, name) {
  await page.locator('.swatch', { hasText: name }).click()
}

export function visibleLinkRows(page) {
  // Cards (.grid > .card) and list/compact rows (.row-list > .link-row) are the
  // current link representations; the empty state is neither, so it is excluded.
  return page.locator('.grid > .card, .row-list > .link-row')
}

export async function openEditFormFor(page, rowText) {
  const row = linkRowByTitle(page, rowText)
  // P15.11: the shared edit form opens from the item's own ⋮ menu (the mockup
  // item surface keeps a quiet action cluster), and is teleported to <body>.
  await row.getByRole('button', { name: 'More actions' }).click()
  await page.locator('.more-menu').getByRole('button', { name: 'Edit link' }).click()
  const form = page.locator('.edit-form')
  await expect(form).toBeVisible()
  return { form, row }
}

export async function setNavbarSearch(page, query) {
  await page.getByLabel('Search links').fill(query)
}

export async function importBackupFile(page, backupData) {
  await openView(page, 'backup')
  await page.locator('.backup-card input[type="file"]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backupData)),
  })
}

export async function expectNoHorizontalScroll(page) {
  const noHS = await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth)
  expect(noHS).toBe(true)
}

// Helper to find a specific row (card or list/compact row) by title text
export function linkRowByTitle(page, title) {
  return visibleLinkRows(page).filter({ hasText: title }).first()
}

export async function getVisibleRowCount(page) {
  return await visibleLinkRows(page).count()
}

export function sidebarFolderRow(page, name) {
  return page.locator('[data-testid="sidebar-folder-row"]').filter({ hasText: name })
}

// Reveal the sidebar folder tree (the app's folder management surface): the
// persistent sidebar on the desktop grid, the drawer below it. The tree <ul>
// is empty before the first folder exists (zero height), so the always-present
// section action is the visibility anchor.
export async function openSidebarFolderTree(page) {
  const anchor = page.locator('[data-testid="sidebar-folder-new"]')
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  if (viewportWidth >= 1200) {
    await expect(anchor).toBeVisible()
    return
  }
  const drawer = page.locator('.sidebar-wrapper')
  if (await drawer.evaluate((el) => el.classList.contains('show')).catch(() => false)) {
    await expect(anchor).toBeVisible()
    return
  }
  const toggle = page.locator('#sidebar-toggle')
  if (await toggle.isVisible().catch(() => false)) await toggle.click()
  else await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'More', exact: true }).click()
  await expect(drawer).toHaveClass(/\bshow\b/)
  await expect(anchor).toBeVisible()
}

// Create a root folder through the sidebar tree. The mockup flow: the + button
// creates with a generated name and puts the row into inline rename.
export async function createFolder(page, name) {
  await openSidebarFolderTree(page)
  await page.locator('[data-testid="sidebar-folder-new"]').click()
  const input = page.locator('.sidebar-folder-rename')
  await expect(input).toBeVisible()
  await input.fill(name)
  await input.press('Enter')
  await expect(sidebarFolderRow(page, name)).toBeVisible()
}

// Create a subfolder through the tree's per-row ⋮ menu.
export async function createSubfolder(page, parentName, name) {
  await openSidebarFolderTree(page)
  await page.getByRole('button', { name: `Folder options for ${parentName}` }).click()
  await page.getByRole('menuitem', { name: `New subfolder in ${parentName}` }).click()
  const input = page.locator('.sidebar-folder-rename')
  await expect(input).toBeVisible()
  await input.fill(name)
  await input.press('Enter')
  await expect(sidebarFolderRow(page, name)).toBeVisible()
}
