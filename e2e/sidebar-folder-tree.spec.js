// P11 — sidebar nested-folder navigation (read-only tree).
// Unique selectors only: [data-testid="sidebar-folder-tree|sidebar-folder-row|sidebar-folder-toggle"].
// The tree reuses the real folders state and the existing handleSelectFolder
// path; these tests cover rendering, indentation, collapse, subtree filtering,
// active state, CRUD sync, the drawer close, depth 4, keyboard, aria-expanded
// and light/dark.
import { test, expect } from '@playwright/test'
import { clearStorage, openView, createFolder, createSubfolder, ensureAddLinkOpen, saveLink, linkRowByTitle, visibleLinkRows, expectNoHorizontalScroll } from './helpers.js'

const tree = (page) => page.locator('[data-testid="sidebar-folder-tree"]')
const row = (page, name) => page.locator('[data-testid="sidebar-folder-row"]').filter({ hasText: name })
const toggle = (page, name) => page.locator(
  `[data-testid="sidebar-folder-toggle"][aria-label="Expand sidebar folder ${name}"], [data-testid="sidebar-folder-toggle"][aria-label="Collapse sidebar folder ${name}"]`
)
const indentOf = (page, name) => row(page, name).evaluate((el) => el.closest('.sidebar-folder-line').style.paddingInlineStart)
const activeRowNames = (page) => page.locator('[data-testid="sidebar-folder-row"][aria-current="true"]').allTextContents()

// Creation auto-expands the parent branch (the new row must be visible for the
// inline rename). Tests that need the collapsed state collapse explicitly.
async function createRoot(page, name) {
  await createFolder(page, name)
}
async function createChild(page, parent, name) {
  await createSubfolder(page, parent, name)
}
async function ensureExpanded(page, name) {
  if ((await toggle(page, name).getAttribute('aria-expanded')) !== 'true') await toggle(page, name).click()
}
async function saveLinkInFolder(page, { url, title, folderName }) {
  await ensureAddLinkOpen(page)
  await page.locator('#save-folder + .asel-trigger').click()
  await page.locator('.asel-menu').getByRole('option').filter({ hasText: folderName }).first().click()
  await page.locator('#save-url').fill(url)
  await page.locator('#save-title').fill(title)
  await page.getByRole('button', { name: 'Save link', exact: true }).click()
  await expect(page.locator('#add-form')).toHaveCount(0)
}
async function openDrawer(page) {
  const bottomNav = page.getByRole('navigation', { name: 'Primary' })
  const more = bottomNav.getByRole('button', { name: 'More', exact: true })
  if (await more.isVisible().catch(() => false)) await more.click()
  else await page.locator('#sidebar-toggle').click()
  await expect(page.locator('.sidebar-wrapper')).toHaveClass(/\bshow\b/)
}

test.describe('P11 — sidebar folder tree', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('renders real root folders with depth indentation and collapse/expand', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createRoot(page, 'Personal')
    await createChild(page, 'Work', 'Engineering')
    await createChild(page, 'Engineering', 'Frontend')

    // Roots are visible; creation expanded the branch, so collapse it first to
    // assert the collapsed default state.
    await expect(tree(page)).toBeVisible()
    await expect(row(page, 'Work')).toBeVisible()
    await expect(row(page, 'Personal')).toBeVisible()
    await toggle(page, 'Work').click()
    await expect(row(page, 'Engineering')).toHaveCount(0)
    await expect(row(page, 'Frontend')).toHaveCount(0)

    // Expand Work -> Engineering appears at depth 2 (P15.5 mockup: 8 + 14 = 22px).
    await toggle(page, 'Work').click()
    await expect(row(page, 'Engineering')).toBeVisible()
    expect(await indentOf(page, 'Work')).toBe('8px')
    expect(await indentOf(page, 'Engineering')).toBe('22px')

    // Expand Engineering -> Frontend appears at depth 3 (36px).
    await ensureExpanded(page, 'Engineering')
    await expect(row(page, 'Frontend')).toBeVisible()
    expect(await indentOf(page, 'Frontend')).toBe('36px')

    // Collapse Work -> the whole subtree hides again.
    await toggle(page, 'Work').click()
    await expect(row(page, 'Engineering')).toHaveCount(0)
    await expect(row(page, 'Frontend')).toHaveCount(0)
  })

  test('aria-expanded reflects the local expansion state', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')

    // Creation expanded Work; collapse so the state machine is observed from false.
    await toggle(page, 'Work').click()
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-expanded', 'false')
    await toggle(page, 'Work').click()
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-label', 'Collapse sidebar folder Work')
    await toggle(page, 'Work').click()
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-label', 'Expand sidebar folder Work')
    // a leaf has no disclosure control
    await expect(toggle(page, 'Engineering')).toHaveCount(0)
  })

  test('clicking a folder selects it, filters the subtree and switches to Links', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    await saveLinkInFolder(page, { url: 'https://example.com/eng', title: 'Engineering Link', folderName: 'Engineering' })
    await saveLinkInFolder(page, { url: 'https://example.com/work', title: 'Work Link', folderName: 'Work' })
    await saveLink(page, { url: 'https://example.com/unfiled', title: 'Unfiled Link' })

    // Select the child: only its own link.
    await ensureExpanded(page, 'Work')
    await row(page, 'Engineering').click()
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Engineering Link')
    await expect(page.locator('.filter-chip', { hasText: 'Folder: Work / Engineering' })).toBeVisible()

    // Select the parent: the whole subtree (its own link + the child's).
    await row(page, 'Work').click()
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expect(page.locator('.filter-chip', { hasText: 'Folder: Work' })).toBeVisible()
  })

  test('active sidebar row follows the current selection', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createRoot(page, 'Personal')
    await createChild(page, 'Work', 'Engineering')

    await ensureExpanded(page, 'Work')
    await row(page, 'Engineering').click()
    await expect(page.locator('[data-testid="sidebar-folder-row"][aria-current="true"]')).toHaveText('Engineering')
    expect(await activeRowNames(page)).toEqual(['Engineering'])

    // Selecting another row takes over the single active state.
    await row(page, 'Personal').click()
    await expect(page.locator('[data-testid="sidebar-folder-row"][aria-current="true"]')).toHaveText('Personal')
    expect(await activeRowNames(page)).toEqual(['Personal'])
  })

  test('sidebar tree CRUD updates the tree (rename, create child, delete)', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    await expect(row(page, 'Work')).toBeVisible()

    // rename through the ⋮ menu
    await page.getByRole('button', { name: 'Folder options for Work' }).click()
    await page.getByRole('menuitem', { name: 'Rename sidebar folder Work' }).click()
    await page.getByLabel('Rename sidebar folder Work').fill('Office')
    await page.keyboard.press('Enter')
    await expect(row(page, 'Office')).toBeVisible()
    await expect(row(page, 'Work')).toHaveCount(0)

    // create another child -> appears after expanding
    await ensureExpanded(page, 'Office')
    await expect(row(page, 'Engineering')).toBeVisible()
    await createChild(page, 'Office', 'Design')
    await expect(row(page, 'Design')).toBeVisible()
    expect(await indentOf(page, 'Design')).toBe('22px')

    // delete a subtree -> its rows disappear (confirmation lives in the menu)
    await page.getByRole('button', { name: 'Folder options for Engineering' }).click()
    await page.getByRole('menuitem', { name: 'Delete sidebar folder Engineering' }).click()
    await page.getByRole('button', { name: 'Confirm delete sidebar folder Engineering' }).click()
    await expect(row(page, 'Engineering')).toHaveCount(0)
    await expect(row(page, 'Design')).toHaveCount(1)
  })

  test('depth 4 renders with correct indentation and no disclosure on the leaf', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'L1')
    await createChild(page, 'L1', 'L2')
    await createChild(page, 'L2', 'L3')
    await createChild(page, 'L3', 'L4')

    for (const name of ['L1', 'L2', 'L3']) await ensureExpanded(page, name)
    await expect(row(page, 'L4')).toBeVisible()
    expect(await indentOf(page, 'L1')).toBe('8px')
    expect(await indentOf(page, 'L2')).toBe('22px')
    expect(await indentOf(page, 'L3')).toBe('36px')
    expect(await indentOf(page, 'L4')).toBe('50px')
    await expect(toggle(page, 'L4')).toHaveCount(0)
  })

  test('mobile/tablet: selecting a folder from the drawer closes it and lands on Links', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    await saveLinkInFolder(page, { url: 'https://example.com/drawer', title: 'Drawer Link', folderName: 'Engineering' })

    for (const width of [390, 820]) {
      await page.setViewportSize({ width, height: 900 })
      await page.reload()
      await openDrawer(page)
      await expect(tree(page)).toBeVisible()
      await ensureExpanded(page, 'Work')
      await row(page, 'Engineering').click()
      await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/\bshow\b/)
      await expect(page.locator('.page-title')).toHaveText('Links')
      await expect(visibleLinkRows(page)).toHaveCount(1)
      await expect(visibleLinkRows(page).first()).toContainText('Drawer Link')
    }
  })

  test('keyboard: rows are reachable and Enter/Space select the folder', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createRoot(page, 'Personal')
    await createChild(page, 'Work', 'Engineering')

    await ensureExpanded(page, 'Work')
    await row(page, 'Engineering').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expect(page.locator('[data-testid="sidebar-folder-row"][aria-current="true"]')).toHaveText('Engineering')

    await row(page, 'Personal').focus()
    await page.keyboard.press('Space')
    await expect(page.locator('[data-testid="sidebar-folder-row"][aria-current="true"]')).toHaveText('Personal')

    // the disclosure is separately reachable and operable (Work is expanded
    // from the keyboard selection above, so the first Enter collapses it)
    await toggle(page, 'Work').focus()
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Enter')
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-expanded', 'true')
  })

  test('no horizontal overflow, long names ellipsize, light and dark (all shell widths)', async ({ page }) => {
    // folder names are capped at 50 chars by the existing model
    const longName = 'Long folder name that truncates inside the sidebar'
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', longName)

    for (const width of [375, 390, 480, 640, 768, 820, 900, 1023, 1024, 1100, 1199, 1200, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      if (width < 1200) await openDrawer(page)
      await expect(tree(page)).toBeVisible()
      // expansion state persists across width changes — only toggle when needed
      if ((await toggle(page, 'Work').getAttribute('aria-expanded')) !== 'true') await toggle(page, 'Work').click()
      const longRow = row(page, 'Long folder name that truncates')
      await expect(longRow).toBeVisible()
      const label = longRow.locator('.sidebar-folder-label')
      const style = await label.evaluate((el) => ({ overflow: getComputedStyle(el).textOverflow, clipped: el.scrollWidth > el.clientWidth }))
      expect(style.overflow, `@${width}`).toBe('ellipsis')
      expect(style.clipped, `@${width} long name clipped`).toBe(true)
      // the tree never exceeds the sidebar's own width
      const fits = await page.evaluate(() => {
        const w = document.querySelector('.sidebar-wrapper')
        const t = document.querySelector('[data-testid="sidebar-folder-tree"]')
        return t.getBoundingClientRect().right <= w.getBoundingClientRect().right + 1
      })
      expect(fits, `tree fits @${width}`).toBe(true)
      await expectNoHorizontalScroll(page)
      if (width < 1200) await page.locator('.sidebar-close').click()
    }

    // dark mode keeps the tree usable
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.evaluate(() => document.documentElement.setAttribute('data-appearance', 'dark'))
    await openView(page, 'folders')
    await expect(row(page, 'Work')).toBeVisible()
    expect(await indentOf(page, 'Work')).toBe('8px')
    await row(page, 'Work').click()
    await expect(page.locator('.page-title')).toHaveText('Links')
    await expectNoHorizontalScroll(page)
  })
})

// P15.5 — sidebar folder rows + per-row ⋮ menu. Every action reuses the same
// App.vue handlers/validation as the Folders view, so these tests assert the
// shared rules through the rebuilt sidebar surface.
test.describe('P15.5 — sidebar folder rows + ⋮ menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  const more = (page, name) => page.getByRole('button', { name: `Folder options for ${name}` })
  const menu = (page) => page.getByRole('menu', { name: 'Folder options' })
  const linksItem = (page) => page.locator('.sidebar-menu-link', { hasText: 'Links' })

  test('A/B: folder selection owns the active state; Links returns to the complete collection', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    await saveLinkInFolder(page, { url: 'https://example.com/eng', title: 'Engineering Link', folderName: 'Engineering' })
    await saveLink(page, { url: 'https://example.com/free', title: 'Free Link' })

    // Unfiltered: Links is the active destination.
    await expect(linksItem(page)).toHaveClass(/active/)

    // Folder selected: the folder row is active, Links is not.
    await ensureExpanded(page, 'Work')
    await row(page, 'Engineering').click()
    await expect(row(page, 'Engineering')).toHaveAttribute('aria-current', 'true')
    await expect(linksItem(page)).not.toHaveClass(/active/)
    await expect(page.locator('.sidebar-menu-link.active')).toHaveCount(0)
    await expect(visibleLinkRows(page)).toHaveCount(1)

    // Links = the complete collection: folder filter cleared, folder inactive.
    await linksItem(page).click()
    await expect(linksItem(page)).toHaveClass(/active/)
    await expect(page.locator('.filter-chip', { hasText: 'Folder:' })).toHaveCount(0)
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expect(row(page, 'Engineering')).not.toHaveAttribute('aria-current', 'true')
  })

  test('C: Favorites clears the folder filter and takes the active state', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    await saveLinkInFolder(page, { url: 'https://example.com/fav', title: 'Favorite Eng', folderName: 'Engineering' })
    await saveLink(page, { url: 'https://example.com/plain', title: 'Plain Link' })
    await linkRowByTitle(page, 'Favorite Eng').getByRole('button', { name: 'Toggle Favorite' }).click()
    await expect(linkRowByTitle(page, 'Favorite Eng').getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')

    // Mobile shell: the bottom bar carries the Favorites destination.
    await page.setViewportSize({ width: 390, height: 900 })
    await page.reload()
    await openDrawer(page)
    await ensureExpanded(page, 'Work')
    await row(page, 'Engineering').click()
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/\bshow\b/)
    await expect(visibleLinkRows(page)).toHaveCount(1)

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Favorites', exact: true }).click()
    await expect(page.locator('.bottom-nav-item[aria-current="page"]')).toHaveText('Favorites')
    await expect(page.locator('.filter-chip', { hasText: 'Folder:' })).toHaveCount(0)
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Favorite Eng')

    // The folder is no longer the active navigation state.
    await openDrawer(page)
    await expect(row(page, 'Engineering')).not.toHaveAttribute('aria-current', 'true')
  })

  test('D: the ⋮ menu opens, exposes the real actions and closes like a popover', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    await openView(page, 'links')

    await expect(more(page, 'Work')).toHaveAttribute('aria-expanded', 'false')
    await more(page, 'Work').click()
    await expect(menu(page)).toBeVisible()
    await expect(more(page, 'Work')).toHaveAttribute('aria-expanded', 'true')
    for (const label of ['New subfolder in Work', 'Rename sidebar folder Work', 'Move sidebar folder Work', 'Delete sidebar folder Work']) {
      await expect(menu(page).getByRole('menuitem', { name: label })).toBeVisible()
    }

    // Outside click closes the menu.
    await page.locator('.navbar-custom').click({ position: { x: 4, y: 4 } })
    await expect(menu(page)).toHaveCount(0)
    await expect(more(page, 'Work')).toHaveAttribute('aria-expanded', 'false')

    // Escape closes the menu.
    await more(page, 'Work').click()
    await expect(menu(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)

    // Open menu never causes horizontal overflow.
    await more(page, 'Work').click()
    await expect(menu(page)).toBeVisible()
    await expectNoHorizontalScroll(page)
    await page.keyboard.press('Escape')
  })

  test('D: rename is inline — Enter commits, Escape cancels, duplicates auto-suffix', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createRoot(page, 'Personal')
    await openView(page, 'links')

    // menu -> Rename: one input in the row, focused for keyboard users
    await more(page, 'Work').click()
    await menu(page).getByRole('menuitem', { name: 'Rename sidebar folder Work' }).click()
    const input = page.getByLabel('Rename sidebar folder Work')
    await expect(input).toBeFocused()

    // Escape cancels and keeps the old name
    await input.fill('Discarded')
    await page.keyboard.press('Escape')
    await expect(row(page, 'Work')).toBeVisible()
    await expect(row(page, 'Discarded')).toHaveCount(0)

    // duplicate names auto-suffix like the mockup (no blocking error)
    await more(page, 'Work').click()
    await menu(page).getByRole('menuitem', { name: 'Rename sidebar folder Work' }).click()
    await page.getByLabel('Rename sidebar folder Work').fill('Personal')
    await page.keyboard.press('Enter')
    await expect(row(page, 'Personal')).toHaveCount(2)
    await expect(page.getByText('Folder renamed')).toBeVisible()
    await expect(page.locator('.sidebar-folder-error')).toHaveCount(0)

    // double-click also starts a rename; Enter commits a unique name
    await row(page, 'Personal 2').dblclick()
    await page.getByLabel('Rename sidebar folder Personal 2').fill('Office')
    await page.keyboard.press('Enter')
    await expect(row(page, 'Office')).toBeVisible()
    await expect(row(page, 'Personal 2')).toHaveCount(0)
  })

  test('D/E: add subfolder respects depth 4 and keeps indentation/expansion', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'L1')
    await createChild(page, 'L1', 'L2')
    await createChild(page, 'L2', 'L3')
    await createChild(page, 'L3', 'L4')
    await openView(page, 'links')

    await more(page, 'L1').click()
    await menu(page).getByRole('menuitem', { name: 'New subfolder in L1' }).click()
    // Mockup: the subfolder is created immediately with a generated name, then
    // that row goes into inline rename (no separate create form).
    const input = page.getByLabel('Rename sidebar folder New Folder')
    await expect(input).toBeFocused()
    await input.fill('Sub')
    await page.keyboard.press('Enter')
    await expect(row(page, 'Sub')).toBeVisible() // parent auto-expanded
    expect(await indentOf(page, 'Sub')).toBe('22px')

    // Depth cap: L4 (depth 4) never offers New subfolder; the others remain.
    for (const name of ['L1', 'L2', 'L3']) {
      if ((await toggle(page, name).getAttribute('aria-expanded')) !== 'true') await toggle(page, name).click()
    }
    await more(page, 'L4').click()
    await expect(menu(page)).toBeVisible()
    await expect(menu(page).getByRole('menuitem', { name: 'New subfolder in L4' })).toHaveCount(0)
    await expect(menu(page).getByRole('menuitem', { name: 'Rename sidebar folder L4' })).toBeVisible()
    await expect(menu(page).getByRole('menuitem', { name: 'Move sidebar folder L4' })).toBeVisible()
    await expect(menu(page).getByRole('menuitem', { name: 'Delete sidebar folder L4' })).toBeVisible()
    await page.keyboard.press('Escape')

    // The rebuilt rows keep the mockup indentation and expansion behaviour.
    expect(await indentOf(page, 'L1')).toBe('8px')
    expect(await indentOf(page, 'L2')).toBe('22px')
    expect(await indentOf(page, 'L3')).toBe('36px')
    expect(await indentOf(page, 'L4')).toBe('50px')
    await toggle(page, 'L1').click()
    await expect(row(page, 'L2')).toHaveCount(0)
    await toggle(page, 'L1').click()
    await expect(row(page, 'L2')).toBeVisible()
  })

  test('D: move offers only valid destinations and reparents through the real handler', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    await createRoot(page, 'Personal')
    await openView(page, 'links')

    await more(page, 'Work').click()
    await menu(page).getByRole('menuitem', { name: 'Move sidebar folder Work' }).click()
    const combo = page.getByRole('combobox', { name: 'Move sidebar folder Work to' })
    await expect(combo).toBeVisible()
    await combo.click()
    const selectMenu = page.locator('.asel-menu')
    // self and own descendants are never offered (canonical folderTree validation)
    await expect(selectMenu.getByRole('option', { name: /Work/ })).toHaveCount(0)
    await expect(selectMenu.getByRole('option', { name: /Engineering/ })).toHaveCount(0)
    await selectMenu.getByRole('option', { name: /Personal/ }).click()
    await expect(page.getByText('Folder moved')).toBeVisible()

    // Personal was expanded by the move; Work nests under it at depth 2.
    await expect(row(page, 'Work')).toBeVisible()
    expect(await indentOf(page, 'Work')).toBe('22px')
    await ensureExpanded(page, 'Work')
    await expect(row(page, 'Engineering')).toBeVisible()
    expect(await indentOf(page, 'Engineering')).toBe('36px')
  })

  test('D: delete confirms inside the ⋮ menu and keeps the subtree semantics', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    await openView(page, 'links')

    await more(page, 'Work').click()
    await menu(page).getByRole('menuitem', { name: 'Delete sidebar folder Work' }).click()
    // Mockup: the confirmation replaces the menu items in place (no dialog).
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const confirm = menu(page)
    await expect(confirm).toContainText('Delete this folder and its subfolders?')
    await expect(confirm.getByRole('button', { name: 'Confirm delete sidebar folder Work' })).toBeVisible()
    // Cancel returns to the menu items, nothing is deleted.
    await confirm.getByRole('button', { name: 'Cancel delete sidebar folder Work' }).click()
    await expect(confirm.getByRole('menuitem', { name: 'Rename sidebar folder Work' })).toBeVisible()
    await expect(row(page, 'Work')).toBeVisible()
    await page.keyboard.press('Escape')

    await more(page, 'Work').click()
    await menu(page).getByRole('menuitem', { name: 'Delete sidebar folder Work' }).click()
    await menu(page).getByRole('button', { name: 'Confirm delete sidebar folder Work' }).click()
    await expect(row(page, 'Work')).toHaveCount(0)
    await expect(row(page, 'Engineering')).toHaveCount(0)
    await expect(page.getByText('2 folders deleted')).toBeVisible()
  })

  test('F: the ⋮ menu works at desktop, the 1024 boundary and in the drawer', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')

    for (const width of [375, 768, 820, 1024, 1100, 1199, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.reload()
      if (width < 1200) await openDrawer(page)

      await expect(more(page, 'Work'), `⋮ @${width}`).toBeVisible()
      await more(page, 'Work').click()
      await expect(menu(page), `menu @${width}`).toBeVisible()
      await expect(more(page, 'Work')).toHaveAttribute('aria-expanded', 'true')

      // The menu and the tree never overflow the sidebar or the document.
      const fits = await page.evaluate(() => {
        const w = document.querySelector('.sidebar-wrapper')
        const t = document.querySelector('[data-testid="sidebar-folder-tree"]')
        const m = document.querySelector('.sidebar-folder-menu')
        const mr = m.getBoundingClientRect()
        return {
          tree: t.getBoundingClientRect().right <= w.getBoundingClientRect().right + 1,
          menu: mr.left >= -1 && mr.right <= window.innerWidth + 1,
        }
      })
      expect(fits.tree, `tree fits @${width}`).toBe(true)
      expect(fits.menu, `menu fits @${width}`).toBe(true)
      await expectNoHorizontalScroll(page)

      await page.keyboard.press('Escape')
      await expect(menu(page)).toHaveCount(0)
      if (width < 1200) await page.locator('.sidebar-close').click()
    }
  })

  test('G: keyboard operation and exposed state; no nested interactive controls', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await createChild(page, 'Work', 'Engineering')
    await openView(page, 'links')

    // caret state stays correct (creation auto-expanded Work)
    await ensureExpanded(page, 'Work')
    await expect(toggle(page, 'Work')).toHaveAttribute('aria-expanded', 'true')

    // folder active state is exposed as aria-current
    await row(page, 'Engineering').click()
    await expect(row(page, 'Engineering')).toHaveAttribute('aria-current', 'true')

    // ⋮ menu: accessible name + expanded state, operable from the keyboard
    await expect(more(page, 'Work')).toHaveAttribute('aria-label', 'Folder options for Work')
    await more(page, 'Work').focus()
    await page.keyboard.press('Enter')
    await expect(menu(page)).toBeVisible()
    await expect(more(page, 'Work')).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)

    // rename through the menu: the field takes focus; Escape cancels
    await more(page, 'Work').click()
    await menu(page).getByRole('menuitem', { name: 'Rename sidebar folder Work' }).click()
    await expect(page.getByLabel('Rename sidebar folder Work')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(row(page, 'Work')).toBeVisible()

    // no interactive element nested inside another one in the sidebar
    const nested = await page.evaluate(() => {
      const root = document.querySelector('.sidebar-wrapper')
      return root.querySelectorAll('button button, a button, button a, a a, button input, a input').length
    })
    expect(nested).toBe(0)
  })
})
