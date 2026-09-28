// P4 — Nested folders (parentId tree): create, indent, expand/collapse, rename,
// move (invalid destinations excluded), depth limit, subtree filtering and
// deletion, link selectors, persistence and backup export.
import { test, expect } from '@playwright/test'
import {
  clearStorage, openView, ensureAddLinkOpen, saveLink, visibleLinkRows,
  installBackupCapture, clickExportAndCaptureBackup, expectNoHorizontalScroll,
} from './helpers.js'

// ---- local helpers -------------------------------------------------------

async function createRoot(page, name) {
  await page.getByLabel('New folder name').fill(name)
  await page.getByRole('button', { name: 'Create folder', exact: true }).click()
  await expect(page.locator('.folder-item', { hasText: name })).toBeVisible()
}

async function createChild(page, parentName, name) {
  await page.getByRole('button', { name: `Add subfolder to ${parentName}` }).click()
  await page.getByLabel(`New subfolder name in ${parentName}`).fill(name)
  await page.getByRole('button', { name: `Create subfolder in ${parentName}` }).click()
  await expect(page.locator('.folder-item', { hasText: name })).toBeVisible()
}

function folderItem(page, name) {
  return page.locator('.folder-item', { hasText: name })
}

// Read the inline tree indentation (paddingInlineStart is set per depth).
function indentOf(page, name) {
  return folderItem(page, name).evaluate((el) => el.style.paddingInlineStart)
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
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createRoot(page, 'Personal')
    await createChild(page, 'Work', 'Engineering')
    await createChild(page, 'Engineering', 'Frontend')

    // Depth is expressed as indentation: 8px root, +14px per level.
    expect(await indentOf(page, 'Work')).toBe('8px')
    expect(await indentOf(page, 'Engineering')).toBe('22px')
    expect(await indentOf(page, 'Frontend')).toBe('36px')

    // Collapsing a parent hides its whole subtree; expanding brings it back.
    await page.getByRole('button', { name: 'Collapse folder Work' }).click()
    await expect(folderItem(page, 'Engineering')).toHaveCount(0)
    await expect(folderItem(page, 'Frontend')).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand folder Work' }).click()
    await expect(folderItem(page, 'Engineering')).toBeVisible()
    await expect(folderItem(page, 'Frontend')).toBeVisible()

    // A leaf has no caret.
    await expect(page.getByRole('button', { name: 'Expand folder Frontend' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Collapse folder Frontend' })).toHaveCount(0)
  })

  test('renames a nested folder and keeps the hierarchy', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    await createChild(page, 'Engineering', 'Frontend')

    await page.getByRole('button', { name: 'Rename folder Engineering' }).click()
    await page.getByLabel('Rename folder Engineering').fill('Platform')
    await page.getByRole('button', { name: 'Save folder name' }).click()
    await expect(folderItem(page, 'Platform')).toBeVisible()
    // The child stays nested under the renamed parent.
    expect(await indentOf(page, 'Platform')).toBe('22px')
    expect(await indentOf(page, 'Frontend')).toBe('36px')
  })

  test('moves a folder to the root and under another folder; invalid destinations are excluded', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Alpha')
    await createRoot(page, 'Beta')
    await createChild(page, 'Alpha', 'SubOne')
    await createChild(page, 'SubOne', 'LeafX')

    // SubOne's own move menu must not offer itself or its descendant (LeafX).
    await page.getByRole('button', { name: 'Move folder SubOne' }).click()
    const moveAsel = folderItem(page, 'SubOne').locator('.move-row .asel-trigger')
    await moveAsel.click()
    await expect(page.locator('.asel-menu')).toBeVisible()
    await expect(page.locator('.asel-menu .asel-option').filter({ hasText: 'SubOne' })).toHaveCount(0)
    await expect(page.locator('.asel-menu .asel-option').filter({ hasText: 'LeafX' })).toHaveCount(0)
    await pickFromOpenMenu(page, 'Root (top level)')
    await expect(page.getByText('Folder moved')).toBeVisible()
    expect(await indentOf(page, 'SubOne')).toBe('8px')
    // Its subtree follows it.
    expect(await indentOf(page, 'LeafX')).toBe('22px')

    // Move Beta under Alpha.
    await page.getByRole('button', { name: 'Move folder Beta' }).click()
    await folderItem(page, 'Beta').locator('.move-row .asel-trigger').click()
    await pickFromOpenMenu(page, 'Alpha')
    await expect(page.getByText('Folder moved')).toBeVisible()
    expect(await indentOf(page, 'Beta')).toBe('22px')
  })

  test('depth limit: four levels are allowed, a fifth is not offered', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'L1')
    await createChild(page, 'L1', 'L2')
    await createChild(page, 'L2', 'L3')
    await createChild(page, 'L3', 'L4')
    expect(await indentOf(page, 'L4')).toBe('50px')
    // Depth 4 has no "add subfolder" affordance.
    await expect(page.getByRole('button', { name: 'Add subfolder to L4' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add subfolder to L3' })).toHaveCount(1)
  })

  test('selecting a folder filters its whole subtree', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Parent')
    await createChild(page, 'Parent', 'ChildF')
    await saveLinkInFolder(page, { url: 'https://example.com/childf', title: 'ChildF Link', folderName: 'ChildF' })
    await saveLinkInFolder(page, { url: 'https://example.com/parent', title: 'Parent Link', folderName: 'Parent' })
    await saveLink(page, { url: 'https://example.com/unfiled', title: 'Unfiled Link' })

    await openView(page, 'folders')
    await page.getByRole('button', { name: 'Show folder Parent' }).click()
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await openView(page, 'folders')
    await page.getByRole('button', { name: 'Show folder ChildF' }).click()
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('ChildF Link')
    await openView(page, 'folders')
    await page.getByRole('button', { name: 'Show Unfiled links' }).click()
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Unfiled Link')
  })

  test('nested folders are offered in the item folder menu and bulk move', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    await saveLink(page, { url: 'https://example.com/one', title: 'Bulk One' })
    await saveLink(page, { url: 'https://example.com/two', title: 'Bulk Two' })

    // Per-item menu: pick the nested folder through the shared AppSelect.
    const row = visibleLinkRows(page).filter({ hasText: 'Bulk One' }).first()
    await row.getByRole('button', { name: 'More actions' }).click()
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
    await openView(page, 'folders')
    await expect(folderItem(page, 'Engineering').locator('.folder-count')).toHaveText('2')
    await page.getByRole('button', { name: 'Show folder Work' }).click()
    await expect(visibleLinkRows(page)).toHaveCount(2)
  })

  test('deleting a folder deletes its subtree and their links (with confirmation)', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'RootSub')
    await createChild(page, 'RootSub', 'LeafSub')
    await saveLinkInFolder(page, { url: 'https://example.com/rootsub', title: 'RootSub Link', folderName: 'RootSub' })
    await saveLinkInFolder(page, { url: 'https://example.com/leafsub', title: 'LeafSub Link', folderName: 'LeafSub' })

    await openView(page, 'folders')
    await page.getByRole('button', { name: 'Delete folder RootSub' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Scope is explicit: the subfolder and the links inside are named.
    await expect(dialog).toContainText('Delete "RootSub" and its 1 subfolder?')
    await expect(dialog).toContainText('2 folders and 2 links inside will be deleted. This cannot be undone.')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(folderItem(page, 'RootSub')).toBeVisible()
    await expect(folderItem(page, 'LeafSub')).toBeVisible()

    await page.getByRole('button', { name: 'Delete folder RootSub' }).click()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('2 folders deleted')).toBeVisible()
    await expect(folderItem(page, 'RootSub')).toHaveCount(0)
    await expect(folderItem(page, 'LeafSub')).toHaveCount(0)
    await openView(page, 'links')
    await expect(visibleLinkRows(page)).toHaveCount(0)
  })

  test('nested hierarchy survives reload and is exported in the backup', async ({ page }) => {
    await installBackupCapture(page)
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')

    await page.reload()
    await openView(page, 'folders')
    expect(await indentOf(page, 'Engineering')).toBe('22px')
    await page.getByRole('button', { name: 'Collapse folder Work' }).click()
    await expect(folderItem(page, 'Engineering')).toHaveCount(0)
    await page.getByRole('button', { name: 'Expand folder Work' }).click()
    await expect(folderItem(page, 'Engineering')).toBeVisible()

    await openView(page, 'backup')
    const json = await clickExportAndCaptureBackup(page)
    const work = json.folders.find((f) => f.name === 'Work')
    const eng = json.folders.find((f) => f.name === 'Engineering')
    expect(work.parentId).toBe(null)
    expect(eng.parentId).toBe(work.id)
  })

  test('nested tree is usable on mobile and in dark mode without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    expect(await indentOf(page, 'Engineering')).toBe('22px')
    await expect(folderItem(page, 'Engineering')).toBeVisible()
    await expectNoHorizontalScroll(page)

    await openView(page, 'settings')
    await page.getByLabel('Dark theme').click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await openView(page, 'folders')
    await expect(folderItem(page, 'Engineering')).toBeVisible()
    await page.getByRole('button', { name: 'Collapse folder Work' }).click()
    await expect(folderItem(page, 'Engineering')).toHaveCount(0)
    await expectNoHorizontalScroll(page)
  })
})
