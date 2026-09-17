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
    links: 'Saved links',
    folders: 'Folders',
    backup: 'Backup & restore',
    settings: 'Settings',
    about: 'About',
  }
  const expectedTitle = titles[view]
  if (!expectedTitle) throw new Error(`Unknown view: ${view}`)

  // Navigation is shell-aware: desktop/tablet use the sidebar (drawer below the
  // desktop breakpoint), the mobile shell uses the bottom bar + its More menu.
  const bottomNav = page.getByRole('navigation', { name: 'Primary' })
  const bottomLabels = { links: 'Links', folders: 'Folders' }
  // Deterministic shell signal: the documented breakpoints (mobile shell <=768,
  // permanent sidebar >=1200) instead of a single race-prone visibility probe.
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  const usesBottomNav = viewportWidth <= 768

  if (usesBottomNav) {
    if (bottomLabels[view]) {
      await bottomNav.getByRole('button', { name: bottomLabels[view], exact: true }).click()
    } else {
      await bottomNav.getByRole('button', { name: 'More', exact: true }).click()
      await page.locator('#more-menu').getByRole('button', { name: expectedTitle, exact: true }).click()
    }
  } else {
    const sidebar = page.locator('.sidebar-wrapper')
    const isDesktop = viewportWidth >= 1200

    // Below the desktop breakpoint the sidebar is an off-canvas drawer. A closed
    // drawer is only translated off-screen (it still has a box), so the .show
    // class - not element visibility - is the open signal. Open it when needed,
    // then wait for the state before clicking the item.
    const item = page.locator('.sidebar-menu-link').filter({ hasText: expectedTitle }).first()
    if (!isDesktop) {
      const isOpen = await sidebar.evaluate((el) => el.classList.contains('show')).catch(() => false)
      if (!isOpen) {
        await page.locator('#sidebar-toggle').click()
        await expect(sidebar).toHaveClass(/\bshow\b/)
      }
    }

    await item.click()
  }

  // Wait for page header title to match
  await expect(page.locator('.page-title')).toHaveText(expectedTitle)
}

export async function ensureAddLinkOpen(page, { more = false } = {}) {
  await openView(page, 'links')
  if (!(await page.locator('#save-url').isVisible().catch(() => false))) {
    // The toolbar "Save a link" control is desktop/tablet only; the mobile shell
    // opens the same form from the bottom navigation's Add item.
    const mobileAdd = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Add', exact: true })
    if (await mobileAdd.isVisible().catch(() => false)) await mobileAdd.click()
    else await page.getByRole('button', { name: 'Save a link', exact: true }).click()
  }
  if (more) {
    const moreBtn = page.getByRole('button', { name: 'More options', exact: true })
    if ((await moreBtn.getAttribute('aria-expanded')) !== 'true') await moreBtn.click()
  }
}

export async function saveLink(page, { url, title, description, image, tags, category, important, mustHave, expectToast = true }) {
  const needsMore = description !== undefined || image !== undefined || tags !== undefined || important || mustHave
  await ensureAddLinkOpen(page, { more: needsMore })
  await page.locator('#save-url').fill(url)
  if (title !== undefined) await page.locator('#save-title').fill(title)
  if (description !== undefined) await page.locator('#save-desc').fill(description)
  if (image !== undefined) await page.locator('#save-image').fill(image)
  if (tags !== undefined) await page.locator('#save-tags').fill(tags)
  if (important) await page.getByLabel('Important').check()
  if (mustHave) await page.getByLabel('Must Have').check()
  if (category) await page.locator('#save-category').selectOption(category)

  await page.getByRole('button', { name: 'Save link', exact: true }).click()
  await expect(page.locator('#add-form')).toHaveCount(0)
  if (expectToast) await expect(page.getByText('Link saved')).toBeVisible()
}

export function visibleLinkRows(page) {
  // Cards (.grid > .card) and list/compact rows (.row-list > .link-row) are the
  // current link representations; the empty state is neither, so it is excluded.
  return page.locator('.grid > .card, .row-list > .link-row')
}

export async function openEditFormFor(page, rowText) {
  const row = linkRowByTitle(page, rowText)
  await row.getByRole('button', { name: 'Edit link' }).click()
  // The anchored edit form is teleported to <body>, so it is not inside the row.
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

export async function createFolder(page, name) {
  await page.getByLabel('New folder name').fill(name)
  await page.getByRole('button', { name: 'Create folder', exact: true }).click()
  await expect(page.locator('.folder-item', { hasText: name })).toBeVisible()
}
