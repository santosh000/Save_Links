// P4 — Nested folders (parentId tree) through the sidebar tree — the app's
// folder surface since the standalone Folders page was removed: create, indent,
// expand/collapse, rename, move (invalid destinations excluded), depth limit,
// subtree filtering and deletion, link selectors, persistence and backup export.
import { test, expect } from '@playwright/test'
import {
  clearStorage, openView, createFolder, createSubfolder, ensureAddLinkOpen, saveLink, visibleLinkRows,
  installBackupCapture, clickExportAndCaptureBackup, expectNoHorizontalScroll,
} from './helpers.js'

// ---- local helpers -------------------------------------------------------

const row = (page, name) => page.locator('[data-testid="sidebar-folder-row"]').filter({ hasText: name })
const toggle = (page, name) => page.locator(
  `[data-testid="sidebar-folder-toggle"][aria-label="Expand sidebar folder ${name}"], [data-testid="sidebar-folder-toggle"][aria-label="Collapse sidebar folder ${name}"]`
)
const more = (page, name) => page.getByRole('button', { name: `Folder options for ${name}` })
const menu = (page) => page.getByRole('menu', { name: 'Folder options' })
const count = (page, name) => page.locator('.sidebar-folder-line')
  .filter({ has: page.locator('[data-testid="sidebar-folder-row"]', { hasText: name }) })
  .locator('.sidebar-folder-count')

// Read the inline tree indentation (paddingInlineStart is set per depth).
function indentOf(page, name) {
  return row(page, name).evaluate((el) => el.closest('.sidebar-folder-line').style.paddingInlineStart)
}

// Creation auto-expands the parent branch (the new row must be visible for the
// inline rename). Tests that need the collapsed state collapse explicitly.
async function ensureExpanded(page, name) {
  if ((await toggle(page, name).getAttribute('aria-expanded')) !== 'true') await toggle(page, name).click()
}

async function menuAction(page, name, itemLabel) {
  await more(page, name).click()
  await expect(menu(page)).toBeVisible()
  await menu(page).getByRole('menuitem', { name: itemLabel }).click()
}

async function pickFromOpenMenu(page, text) {
  await expect(page.locator('.asel-menu')).toBeVisible()
  await page.locator('.asel-menu').getByRole('option').filter({ hasText: text }).first().click()
  await expect(page.locator('.asel-menu')).toHaveCount(0)
}

async function saveLinkInFolder(page, { url, title, folderName }) {
  await ensureAddLinkOpen(page)
  await page.locator('#save-folder + .asel-trigger').click()
  await pickFromOpenMenu(page, folderName)
  await page.locator('#save-url').fill(url)
  await page.locator('#save-title').fill(title)
  await page.getByRole('button', { name: 'Save link', exact: true }).click()
  await expect(page.locator('#add-form')).toHaveCount(0)
  await expect(page.getByText('Link saved')).toBeVisible()
}

test.describe('Nested folders (P4)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('creates a nested tree, indents by depth, and expand/collapse works', async ({ page }) => {
    await createFolder(page, 'Work')
    await createFolder(page, 'Personal')
    await createSubfolder(page, 'Work', 'Engineering')
    await createSubfolder(page, 'Engineering', 'Frontend')

    // Depth is expressed as indentation: 8px root, +14px per level.
    expect(await indentOf(page, 'Work')).toBe('8px')
    expect(await indentOf(page, 'Engineering')).toBe('22px')
    expect(await indentOf(page, 'Frontend')).toBe('36px')

    // Collapsing a parent hides its whole subtree; expanding brings it back.
    await toggle(page, 'Work').click()
    await expect(row(page, 'Engineering')).toHaveCount(0)
    await expect(row(page, 'Frontend')).toHaveCount(0)
    await toggle(page, 'Work').click()
    await expect(row(page, 'Engineering')).toBeVisible()
    await expect(row(page, 'Frontend')).toBeVisible()

    // A leaf has no caret.
    await expect(toggle(page, 'Frontend')).toHaveCount(0)
  })

  test('renames a nested folder and keeps the hierarchy', async ({ page }) => {
    await createFolder(page, 'Work')
    await createSubfolder(page, 'Work', 'Engineering')
    await createSubfolder(page, 'Engineering', 'Frontend')

    await menuAction(page, 'Engineering', 'Rename sidebar folder Engineering')
    await page.locator('.sidebar-folder-rename').fill('Platform')
    await page.keyboard.press('Enter')
    await expect(row(page, 'Platform')).toBeVisible()
    // The child stays nested under the renamed parent.
    expect(await indentOf(page, 'Platform')).toBe('22px')
    expect(await indentOf(page, 'Frontend')).toBe('36px')
  })

  test('moves a folder to the root and under another folder; invalid destinations are excluded', async ({ page }) => {
    await createFolder(page, 'Alpha')
    await createFolder(page, 'Beta')
    await createSubfolder(page, 'Alpha', 'SubOne')
    await createSubfolder(page, 'SubOne', 'LeafX')

    // SubOne's own move menu must not offer itself or its descendant (LeafX).
    await menuAction(page, 'SubOne', 'Move sidebar folder SubOne')
    const combo = page.getByRole('combobox', { name: 'Move sidebar folder SubOne to' })
    await combo.click()
    await expect(page.locator('.asel-menu')).toBeVisible()
    await expect(page.locator('.asel-menu .asel-option').filter({ hasText: 'SubOne' })).toHaveCount(0)
    await expect(page.locator('.asel-menu .asel-option').filter({ hasText: 'LeafX' })).toHaveCount(0)
    await pickFromOpenMenu(page, 'Root (top level)')
    await expect(page.getByText('Folder moved')).toBeVisible()
    expect(await indentOf(page, 'SubOne')).toBe('8px')
    // Its subtree follows it.
    expect(await indentOf(page, 'LeafX')).toBe('22px')

    // Move Beta under Alpha.
    await menuAction(page, 'Beta', 'Move sidebar folder Beta')
    await page.getByRole('combobox', { name: 'Move sidebar folder Beta to' }).click()
    await pickFromOpenMenu(page, 'Alpha')
    await expect(page.getByText('Folder moved')).toBeVisible()
    expect(await indentOf(page, 'Beta')).toBe('22px')
  })

  test('depth limit: four levels are allowed, a fifth is not offered', async ({ page }) => {
    await createFolder(page, 'L1')
    await createSubfolder(page, 'L1', 'L2')
    await createSubfolder(page, 'L2', 'L3')
    await createSubfolder(page, 'L3', 'L4')
    for (const name of ['L1', 'L2', 'L3']) await ensureExpanded(page, name)
    expect(await indentOf(page, 'L4')).toBe('50px')

    // Depth 4 has no "new subfolder" affordance.
    await more(page, 'L4').click()
    await expect(menu(page)).toBeVisible()
    await expect(menu(page).getByRole('menuitem', { name: 'New subfolder in L4' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await more(page, 'L3').click()
    await expect(menu(page).getByRole('menuitem', { name: 'New subfolder in L3' })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('selecting a folder filters its whole subtree', async ({ page }) => {
    await createFolder(page, 'Parent')
    await createSubfolder(page, 'Parent', 'ChildF')
    await saveLinkInFolder(page, { url: 'https://example.com/childf', title: 'ChildF Link', folderName: 'ChildF' })
    await saveLinkInFolder(page, { url: 'https://example.com/parent', title: 'Parent Link', folderName: 'Parent' })
    await saveLink(page, { url: 'https://example.com/unfiled', title: 'Unfiled Link' })

    await ensureExpanded(page, 'Parent')
    await row(page, 'Parent').click()
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await row(page, 'ChildF').click()
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('ChildF Link')
  })

  test('nested folders are offered in the item folder menu and bulk move', async ({ page }) => {
    await createFolder(page, 'Work')
    await createSubfolder(page, 'Work', 'Engineering')
    await saveLink(page, { url: 'https://example.com/one', title: 'Bulk One' })
    await saveLink(page, { url: 'https://example.com/two', title: 'Bulk Two' })

    // Per-item menu: pick the nested folder through the shared AppSelect.
    const itemRow = visibleLinkRows(page).filter({ hasText: 'Bulk One' }).first()
    await itemRow.getByRole('button', { name: 'More actions' }).click()
    const moreMenu = page.locator('.more-menu')
    await expect(moreMenu).toBeVisible()
    await moreMenu.locator('.more-field', { hasText: 'Folder' }).locator('.asel-trigger').click()
    await pickFromOpenMenu(page, 'Engineering')
    await expect(page.getByText('Folder updated')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(moreMenu).toBeHidden()

    // Bulk bar: move the other link into the same nested folder.
    const secondRow = visibleLinkRows(page).filter({ hasText: 'Bulk Two' }).first()
    await secondRow.getByRole('checkbox').check()
    await expect(page.locator('.bulk-bar')).toBeVisible()
    await page.locator('.bulk-bar .asel-trigger').click()
    await pickFromOpenMenu(page, 'Engineering')
    await expect(page.getByText('Folder updated')).toBeVisible()

    // Both links now surface under the parent folder (subtree filter).
    await expect(count(page, 'Engineering')).toHaveText('2')
    await row(page, 'Work').click()
    await expect(visibleLinkRows(page)).toHaveCount(2)
  })

  test('deleting a folder deletes its subtree and their links (with confirmation)', async ({ page }) => {
    await createFolder(page, 'RootSub')
    await createSubfolder(page, 'RootSub', 'LeafSub')
    await saveLinkInFolder(page, { url: 'https://example.com/rootsub', title: 'RootSub Link', folderName: 'RootSub' })
    await saveLinkInFolder(page, { url: 'https://example.com/leafsub', title: 'LeafSub Link', folderName: 'LeafSub' })

    // The tree confirms inside the ⋮ menu (no dialog).
    await more(page, 'RootSub').click()
    await menu(page).getByRole('menuitem', { name: 'Delete sidebar folder RootSub' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(menu(page)).toContainText('Delete this folder and its subfolders?')
    await menu(page).getByRole('button', { name: 'Cancel delete sidebar folder RootSub' }).click()
    await expect(row(page, 'RootSub')).toBeVisible()
    await expect(row(page, 'LeafSub')).toBeVisible()
    await page.keyboard.press('Escape')

    await more(page, 'RootSub').click()
    await menu(page).getByRole('menuitem', { name: 'Delete sidebar folder RootSub' }).click()
    await menu(page).getByRole('button', { name: 'Confirm delete sidebar folder RootSub' }).click()
    await expect(page.getByText('2 folders deleted')).toBeVisible()
    await expect(row(page, 'RootSub')).toHaveCount(0)
    await expect(row(page, 'LeafSub')).toHaveCount(0)
    // the two links survive in Unfiled
    await openView(page, 'links')
    await expect(visibleLinkRows(page)).toHaveCount(2)
  })

  test('nested hierarchy survives reload and is exported in the backup', async ({ page }) => {
    await installBackupCapture(page)
    await createFolder(page, 'Work')
    await createSubfolder(page, 'Work', 'Engineering')

    await page.reload()
    await openView(page, 'folders')
    // After reload the tree starts collapsed; expand to observe the nested row.
    await toggle(page, 'Work').click()
    expect(await indentOf(page, 'Engineering')).toBe('22px')
    await toggle(page, 'Work').click()
    await expect(row(page, 'Engineering')).toHaveCount(0)
    await toggle(page, 'Work').click()
    await expect(row(page, 'Engineering')).toBeVisible()

    await openView(page, 'backup')
    const json = await clickExportAndCaptureBackup(page)
    const work = json.folders.find((f) => f.name === 'Work')
    const eng = json.folders.find((f) => f.name === 'Engineering')
    expect(work.parentId).toBe(null)
    expect(eng.parentId).toBe(work.id)
  })

  test('nested tree is usable on mobile and in dark mode without horizontal scroll', async ({ page }) => {
    // Dark mode first (the Settings sheet closes cleanly at desktop width),
    // then the same nested tree is exercised through the mobile drawer.
    await page.setViewportSize({ width: 1280, height: 900 })
    await openView(page, 'settings')
    await page.getByLabel('Dark theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await openView(page, 'folders')
    await createFolder(page, 'Work')
    await createSubfolder(page, 'Work', 'Engineering')
    expect(await indentOf(page, 'Engineering')).toBe('22px')
    await expect(row(page, 'Engineering')).toBeVisible()
    await expectNoHorizontalScroll(page)

    await toggle(page, 'Work').click()
    await expect(row(page, 'Engineering')).toHaveCount(0)
    await expectNoHorizontalScroll(page)
  })
})
