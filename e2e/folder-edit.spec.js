import { test, expect } from '@playwright/test'
import { clearStorage, openView } from './helpers.js'

const LONG_NAME = 'youtube-documentation-videos-archive-2026'

async function createFolder(page, name) {
  await page.getByLabel('New folder name').fill(name)
  await page.getByRole('button', { name: 'Create folder', exact: true }).click()
  await expect(page.locator('.folder-item', { hasText: name })).toBeVisible()
}

async function testRenameGeometry(page, vp) {
  await page.setViewportSize({ width: vp.width, height: vp.height })
  await page.goto('/')

  // Navigation is shell-aware: sidebar on desktop/tablet, bottom bar on mobile.
  await openView(page, 'folders')

  await createFolder(page, LONG_NAME)

  await page.getByRole('button', { name: `Rename folder ${LONG_NAME}` }).click()

  const input = page.getByLabel(`Rename folder ${LONG_NAME}`)
  await expect(input).toBeVisible()
  await input.fill(LONG_NAME)

  const ib = await input.boundingBox()
  expect(ib.width).toBeGreaterThanOrEqual(100) // usable input, never a sliver
  expect(ib.height).toBeLessThanOrEqual(40) // single line, no character wrapping

  const save = page.getByRole('button', { name: 'Save folder name' })
  const cancel = page.getByRole('button', { name: 'Cancel rename' })
  for (const btn of [save, cancel]) {
    await expect(btn).toBeVisible()
    const bb = await btn.boundingBox()
    expect(bb.height).toBeGreaterThanOrEqual(26) // touch target stays usable
    const overlap = !(
      bb.x + bb.width <= ib.x || ib.x + ib.width <= bb.x ||
      bb.y + bb.height <= ib.y || ib.y + ib.height <= bb.y
    )
    expect(overlap).toBe(false) // buttons never overlap the input
  }

  // no horizontal overflow — page
  const noPageH = await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth)
  expect(noPageH).toBe(true)

  // Cancel exits edit mode and restores the normal row
  await cancel.click()
  await expect(page.getByRole('button', { name: `Rename folder ${LONG_NAME}` })).toBeVisible()
}

test.describe('Folder rename geometry', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('Desktop (1280px): folder rename input stays usable, buttons never crush it', async ({ page }) => {
    await testRenameGeometry(page, { width: 1280, height: 800 })
  })

  test('Tablet (768px): folder rename input stays usable, buttons never crush it', async ({ page }) => {
    await testRenameGeometry(page, { width: 768, height: 800 })
  })

  test('Mobile (375px): folder rename input stays usable, buttons never crush it', async ({ page }) => {
    await testRenameGeometry(page, { width: 375, height: 667 })
  })
})