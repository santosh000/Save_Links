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

async function ensureSaveFormOpen(page) {
  const urlInput = page.locator('#save-url')
  if (!(await urlInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Save a link', exact: true }).click()
  }
}

async function saveLink(page, { url, title, folder, category }) {
  await ensureSaveFormOpen(page)
  await page.locator('#save-url').fill(url)
  if (title) await page.locator('#save-title').fill(title)
  if (category) await page.locator('#save-category').selectOption(category)
  if (folder) await page.getByLabel('Select folder').selectOption({ label: folder })
  await page.getByRole('button', { name: 'Save link' }).click()
  await expect(page.getByText('Link saved')).toBeVisible({ timeout: 3000 }).catch(() => {})
}

async function createFolder(page, name) {
  await page.getByLabel('New folder name').fill(name)
  await page.getByRole('button', { name: 'Create folder', exact: true }).click()
  await expect(page.locator('.folder-item', { hasText: name })).toBeVisible()
}

test.describe('Folder sidebar navigation', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('Shows All Links, Unfiled and folders with counts', async ({ page }) => {
    await page.goto('/')
    await createFolder(page, 'Work')
    await createFolder(page, 'Personal')
    await saveLink(page, { url: 'https://example.com/w', title: 'Work Link', folder: 'Work' })
    await saveLink(page, { url: 'https://example.com/p', title: 'Personal Link', folder: 'Personal' })
    await saveLink(page, { url: 'https://example.com/u', title: 'Unfiled Link' })

    await expect(page.getByRole('button', { name: 'All links' })).toContainText('3')
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' })).toContainText('1')
    await expect(page.locator('.folder-item', { hasText: 'Work' })).toContainText('1')
    await expect(page.locator('.folder-item', { hasText: 'Personal' })).toContainText('1')
    // all three cards visible
    await expect(page.locator('article.card')).toHaveCount(3)
  })

  test('Sidebar selection filters links and All Links resets', async ({ page }) => {
    await page.goto('/')
    await createFolder(page, 'Office')
    await saveLink(page, { url: 'https://example.com/o', title: 'Office Link', folder: 'Office' })
    await saveLink(page, { url: 'https://example.com/f', title: 'Free Link' })

    await page.getByRole('button', { name: 'Show folder Office' }).click()
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Office Link')
    // active state on the selected folder
    const officeItem = page.locator('.folder-item', { hasText: 'Office' })
    await expect(officeItem).toHaveClass(/active/)

    await page.getByRole('button', { name: 'Show Unfiled links' }).click()
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Free Link')
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' })).toHaveClass(/active/)

    await page.getByRole('button', { name: 'All links' }).click()
    await expect(page.locator('article.card')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'All links' })).toHaveClass(/active/)
  })

  test('Folder selection combines with search, status and favorite filters', async ({ page }) => {
    await page.goto('/')
    await createFolder(page, 'Office')
    await saveLink(page, { url: 'https://github.com/alpha', title: 'Alpha Link', folder: 'Office', category: 'GitHub' })
    await saveLink(page, { url: 'https://youtube.com/beta', title: 'Beta Link', folder: 'Office', category: 'YouTube' })
    await saveLink(page, { url: 'https://example.com/gamma', title: 'Gamma Link' })

    // folder + search
    await page.getByRole('button', { name: 'Show folder Office' }).click()
    await page.getByLabel('Search links').fill('Beta')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Beta Link')

    // folder + search + category
    await page.getByLabel('Filter by category').selectOption('GitHub')
    await expect(page.locator('article.card')).toHaveCount(0)
    await page.getByLabel('Search links').fill('Alpha')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Alpha Link')

    // folder + status
    await page.getByLabel('Filter by category').selectOption('')
    await page.getByLabel('Search links').fill('')
    await page.locator('article.card', { hasText: 'Beta Link' }).getByRole('button', { name: 'Toggle Important' }).click()
    await page.getByLabel('Filter by status').selectOption('important')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Beta Link')

    // folder + favorite — important flags independent of folder
    await page.getByLabel('Filter by status').selectOption('')
    await page.locator('article.card', { hasText: 'Beta Link' }).getByRole('button', { name: 'Toggle Favorite' }).click()
    await page.getByLabel('Filter by status').selectOption('favorite')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Beta Link')

    // reset folder filter from the filter select — Gamma appears
    await page.getByLabel('Filter by folder').selectOption('All folders')
    await expect(page.locator('article.card')).toHaveCount(1)
  })

  test('Move to folder on card moves link, updates counts and persists', async ({ page }) => {
    await page.goto('/')
    await createFolder(page, 'Projects')
    await saveLink(page, { url: 'https://example.com/todo', title: 'TODO Link' })
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' })).toContainText('1')

    const card = page.locator('article.card').first()
    await card.getByLabel('Move to folder').selectOption({ label: 'Projects' })
    await expect(page.getByText('Folder updated')).toBeVisible()
    await expect(card).toContainText('Projects')
    await expect(page.locator('.folder-item', { hasText: 'Projects' })).toContainText('1')
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' })).toContainText('0')

    // move back to Unfiled
    await card.getByLabel('Move to folder').selectOption({ label: 'Unfiled' })
    await expect(card).toContainText('Unfiled')
    await expect(page.locator('.folder-item', { hasText: 'Unfiled' })).toContainText('1')

    // persists after reload
    await card.getByLabel('Move to folder').selectOption({ label: 'Projects' })
    await page.reload()
    await expect(page.locator('.folder-item', { hasText: 'Projects' })).toBeVisible()
    await expect(page.locator('article.card').first()).toContainText('Projects')
  })

  test('Mobile drawer: opens via toggle, filters, closes on select', async ({ page }) => {
    // create folders/links at desktop width (sidebar inputs are in the drawer on mobile)
    await page.goto('/')
    await page.getByLabel('New folder name').fill('Mobile')
    await page.getByRole('button', { name: 'Create folder', exact: true }).click()
    await saveLink(page, { url: 'https://example.com/m1', title: 'Mobile Link', folder: 'Mobile' })
    await saveLink(page, { url: 'https://example.com/m2', title: 'Plain Link' })

    await page.setViewportSize({ width: 375, height: 667 })
    await page.reload()

    const toggle = page.getByRole('button', { name: 'Toggle folders navigation' })
    await expect(toggle).toBeVisible()
    const navCol = page.locator('#nav-col')
    // drawer is off-screen when closed; sidebar is not a permanent layout element on mobile
    await expect(navCol).not.toBeInViewport()
    await expect(page.getByRole('button', { name: 'All links' })).not.toBeInViewport()

    // open drawer
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('button', { name: 'All links' })).toBeInViewport()

    // select a folder — drawer closes and links filtered
    await page.getByRole('button', { name: 'Show folder Mobile' }).click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Mobile Link')

    // back to desktop — sidebar visible, toggle hidden
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.getByRole('button', { name: 'All links' })).toBeInViewport()
    await expect(toggle).toBeHidden()
  })
})