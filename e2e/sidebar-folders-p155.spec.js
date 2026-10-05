// P15.5 — mockup sidebar folder system: section, real hierarchy, registry
// icons, real subtree counts, expand/collapse, toggle-all, active navigation,
// the per-folder ⋮ menu and the mobile drawer path. Folder CRUD still runs
// through the existing App.vue/useFolders handlers (asserted in depth in
// sidebar-folder-tree.spec.js).
import { test, expect } from '@playwright/test'
import { clearStorage, openView, createFolder, createSubfolder, saveLink, visibleLinkRows, expectNoHorizontalScroll } from './helpers.js'

const tree = (page) => page.locator('[data-testid="sidebar-folder-tree"]')
const row = (page, name) => page.locator('[data-testid="sidebar-folder-row"]').filter({ hasText: name })
const toggle = (page, name) => page.locator(
  `[data-testid="sidebar-folder-toggle"][aria-label="Expand sidebar folder ${name}"], [data-testid="sidebar-folder-toggle"][aria-label="Collapse sidebar folder ${name}"]`
)
const more = (page, name) => page.getByRole('button', { name: `Folder options for ${name}` })
const menu = (page) => page.getByRole('menu', { name: 'Folder options' })
const count = (page, name) => page.locator('.sidebar-folder-line')
  .filter({ has: page.locator('[data-testid="sidebar-folder-row"]', { hasText: name }) })
  .locator('.sidebar-folder-count')
const indentOf = (page, name) => row(page, name).evaluate((el) => el.closest('.sidebar-folder-line').style.paddingInlineStart)
// Creation auto-expands the parent branch; tests that need a collapsed start
// collapse it explicitly (or use the toggle-all control).
async function ensureExpanded(page, name) {
  if ((await toggle(page, name).getAttribute('aria-expanded')) !== 'true') await toggle(page, name).click()
}

async function createRoot(page, name) {
  await createFolder(page, name)
}
async function createChild(page, parent, name) {
  await createSubfolder(page, parent, name)
}
async function saveLinkInFolder(page, { url, title, folderName }) {
  await openView(page, 'links')
  if (!(await page.locator('#save-url').isVisible().catch(() => false))) await page.locator('.content-head .add-toggle').click()
  await page.locator('#save-folder + .asel-trigger').click()
  await page.locator('.asel-menu').getByRole('option').filter({ hasText: folderName }).first().click()
  await page.locator('#save-url').fill(url)
  await page.locator('#save-title').fill(title)
  await page.getByRole('button', { name: 'Save link', exact: true }).click()
  await expect(page.locator('#add-form')).toHaveCount(0)
}
async function openDrawer(page) {
  const bottomNav = page.getByRole('navigation', { name: 'Primary' })
  const moreBtn = bottomNav.getByRole('button', { name: 'More', exact: true })
  if (await moreBtn.isVisible().catch(() => false)) await moreBtn.click()
  else await page.locator('#sidebar-toggle').click()
  await expect(page.locator('.sidebar-wrapper')).toHaveClass(/\bshow\b/)
}
async function seedTree(page) {
  await openView(page, 'folders')
  await createRoot(page, 'Work')
  await createChild(page, 'Work', 'Design')
  await createChild(page, 'Design', 'Frontend')
  await createRoot(page, 'Personal')
}

test.describe('P15.5 — sidebar folder system', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('section, real hierarchy, registry icons and the open/closed folder glyph', async ({ page }) => {
    await seedTree(page)
    await openView(page, 'links')

    await expect(tree(page)).toBeVisible()
    await expect(page.locator('.sidebar-menu-title', { hasText: 'Folders' })).toBeVisible()
    // Collapse what creation expanded, then assert the collapsed default.
    await page.locator('[data-testid="sidebar-folder-toggle-all"]').click()
    await expect(row(page, 'Work')).toBeVisible()
    await expect(row(page, 'Design')).toHaveCount(0)

    // expand: nested rows appear at the mockup indentation
    await toggle(page, 'Work').click()
    await expect(row(page, 'Design')).toBeVisible()
    expect(await indentOf(page, 'Design')).toBe('22px')
    await toggle(page, 'Design').click()
    await expect(row(page, 'Frontend')).toBeVisible()
    expect(await indentOf(page, 'Frontend')).toBe('36px')

    // every icon in the rebuilt surface is the shared registry component
    const stray = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="sidebar-folder-tree"] svg')].filter((s) => !s.classList.contains('ic')).length
    )
    expect(stray).toBe(0)
    await expect(page.locator('[data-testid="sidebar-folder-toggle"] svg').first()).toHaveAttribute('width', '13')
    await expect(row(page, 'Work').locator('svg').first()).toHaveAttribute('width', '15')

    // open/closed state: expanded-with-children uses the folder-open geometry,
    // a leaf/closed row uses the folder geometry (exact registry paths).
    const openD = await row(page, 'Work').locator('svg path').first().getAttribute('d')
    const closedD = await row(page, 'Personal').locator('svg path').first().getAttribute('d')
    expect(openD.startsWith('m6 14')).toBe(true)
    expect(closedD.startsWith('M20 20')).toBe(true)
  })

  test('real subtree counts roll descendants up and update live', async ({ page }) => {
    await seedTree(page)
    await saveLinkInFolder(page, { url: 'https://example.com/w', title: 'Work Link', folderName: 'Work' })
    await saveLinkInFolder(page, { url: 'https://example.com/d', title: 'Design Link', folderName: 'Design' })
    await saveLinkInFolder(page, { url: 'https://example.com/f', title: 'Frontend Link', folderName: 'Frontend' })
    await saveLink(page, { url: 'https://example.com/p', title: 'Plain Link' })

    await expect(count(page, 'Work')).toHaveText('3') // own + descendants
    await expect(count(page, 'Personal')).toHaveText('0')
    await ensureExpanded(page, 'Work')
    await expect(count(page, 'Design')).toHaveText('2')
    await ensureExpanded(page, 'Design')
    await expect(count(page, 'Frontend')).toHaveText('1')

    // real-time: a new link in Frontend rolls up immediately
    await saveLinkInFolder(page, { url: 'https://example.com/f2', title: 'Second Frontend', folderName: 'Frontend' })
    await expect(count(page, 'Frontend')).toHaveText('2')
    await expect(count(page, 'Design')).toHaveText('3')
    await expect(count(page, 'Work')).toHaveText('4')
  })

  test('expand/collapse and the mockup toggle-all control', async ({ page }) => {
    await seedTree(page)
    await openView(page, 'links')
    const all = page.locator('[data-testid="sidebar-folder-toggle-all"]')
    // Start from the collapsed state (creation expanded the branch).
    await all.click()
    await expect(all).toHaveAttribute('aria-label', 'Expand all folders')

    await all.click()
    await expect(all).toHaveAttribute('aria-label', 'Collapse all folders')
    await expect(row(page, 'Design')).toBeVisible()
    await expect(row(page, 'Frontend')).toBeVisible()
    await expect(page.getByText('All folders expanded')).toBeVisible()

    await all.click()
    await expect(row(page, 'Design')).toHaveCount(0)
    await expect(row(page, 'Frontend')).toHaveCount(0)
    await expect(page.getByText('All folders collapsed')).toBeVisible()
    await expect(all).toHaveAttribute('aria-label', 'Expand all folders')

    // individual collapse hides descendants without touching folder data
    await toggle(page, 'Work').click()
    await expect(row(page, 'Design')).toBeVisible()
    await toggle(page, 'Work').click()
    await expect(row(page, 'Design')).toHaveCount(0)
    await toggle(page, 'Work').click()
    await expect(row(page, 'Design')).toBeVisible()
  })

  test('header new-folder creates a real root folder through the inline rename step', async ({ page }) => {
    await openView(page, 'folders')
    await createRoot(page, 'Work')
    await openView(page, 'links')

    // Mockup interaction: the folder is created immediately with a generated
    // default name, then that row goes into inline rename.
    await page.locator('[data-testid="sidebar-folder-new"]').click()
    const input = page.getByLabel('Rename sidebar folder New Folder')
    await expect(input).toBeFocused()
    await expect(page.getByText('Type a name, press Enter')).toBeVisible()
    await input.fill('Research')
    await page.keyboard.press('Enter')
    await expect(row(page, 'Research')).toBeVisible()
    await expect(page.getByText('Folder renamed')).toBeVisible()

    // Escape leaves the created folder with its generated name (no editor rows).
    await page.locator('[data-testid="sidebar-folder-new"]').click()
    await expect(page.getByLabel('Rename sidebar folder New Folder')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(row(page, 'New Folder')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-folder-root-create"]')).toHaveCount(0)

    // A second create with the same generated base name auto-suffixes.
    await page.locator('[data-testid="sidebar-folder-new"]').click()
    await expect(page.getByLabel('Rename sidebar folder New Folder 2')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(row(page, 'New Folder 2')).toBeVisible()
  })

  test('folder selection filters the subtree and clears the Recently-Added destination', async ({ page }) => {
    await seedTree(page)
    await saveLinkInFolder(page, { url: 'https://example.com/d', title: 'Design Link', folderName: 'Design' })
    await saveLink(page, { url: 'https://example.com/free', title: 'Free Link' })

    // Recently Added destination active first
    await page.locator('.sidebar-menu-link', { hasText: 'Recently Added' }).click()
    await expect(page.locator('.filter-chip', { hasText: 'Recently added' })).toBeVisible()

    // Selecting a folder clears it (P15.2 destination exclusivity).
    await ensureExpanded(page, 'Work')
    await row(page, 'Design').click()
    await expect(page.locator('.filter-chip', { hasText: 'Recently added' })).toHaveCount(0)
    await expect(row(page, 'Design')).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('.filter-chip', { hasText: 'Folder: Work / Design' })).toBeVisible()
    await expect(visibleLinkRows(page)).toHaveCount(1)

    // Parent selection keeps the existing subtree filtering.
    await row(page, 'Work').click()
    await expect(page.locator('.filter-chip', { hasText: 'Folder: Work' })).toBeVisible()
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Design Link')
  })

  test('⋮ menu anchors to its row, closes on outside click/Escape and nested rows keep working', async ({ page }) => {
    await seedTree(page)
    await openView(page, 'links')
    await ensureExpanded(page, 'Work')
    await ensureExpanded(page, 'Design')

    await more(page, 'Design').click()
    await expect(menu(page)).toBeVisible()
    await expect(more(page, 'Design')).toHaveAttribute('aria-expanded', 'true')
    const box = await page.evaluate(() => {
      const m = document.querySelector('.sidebar-folder-menu').getBoundingClientRect()
      return { w: Math.round(m.width), left: Math.round(m.left), right: Math.round(m.right) }
    })
    expect(box.w).toBeGreaterThan(150)
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(1281)

    await page.locator('.navbar-custom').click({ position: { x: 4, y: 4 } }) // outside click
    await expect(menu(page)).toHaveCount(0)
    await expect(more(page, 'Design')).toHaveAttribute('aria-expanded', 'false')

    await more(page, 'Design').click()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)

    // nested rows keep their own selection and menu
    await row(page, 'Frontend').click()
    await expect(row(page, 'Frontend')).toHaveAttribute('aria-current', 'true')
    await more(page, 'Frontend').click()
    await expect(menu(page)).toBeVisible()
    await expect(menu(page).getByRole('menuitem', { name: 'New subfolder in Frontend' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expectNoHorizontalScroll(page)
  })

  test('mobile drawer: rows, chevrons and the ⋮ menu stay functional', async ({ page }) => {
    await seedTree(page)
    await saveLinkInFolder(page, { url: 'https://example.com/m', title: 'Drawer Folder Link', folderName: 'Design' })

    await page.setViewportSize({ width: 390, height: 900 })
    await page.reload()
    await openDrawer(page)
    await toggle(page, 'Work').click()
    await expect(row(page, 'Design')).toBeVisible()

    // touch widths: the ⋮ is always visible (no hover needed)
    expect(await more(page, 'Design').evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    await more(page, 'Design').click()
    await expect(menu(page)).toBeVisible()
    await page.keyboard.press('Escape')

    // selecting a folder closes the drawer and applies the subtree filter
    await row(page, 'Design').click()
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/\bshow\b/)
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Drawer Folder Link')
    await expectNoHorizontalScroll(page)
  })
})
