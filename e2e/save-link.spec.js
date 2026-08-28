import { test, expect } from '@playwright/test'

async function clearStorage(page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
}

// The Save Link form is a collapsed compact bar by default. Expand it (and the
// optional "More options" section) whenever a test needs to interact with fields.
async function ensureSaveFormOpen(page, { more = false } = {}) {
  const urlInput = page.locator('#save-url')
  if (!(await urlInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Save a link', exact: true }).click()
  }
  if (more) {
    const moreBtn = page.getByRole('button', { name: 'More options', exact: true })
    if ((await moreBtn.getAttribute('aria-expanded')) !== 'true') await moreBtn.click()
  }
}

async function saveLink(page, { url, title, description, image, tags, category, important, mustHave }) {
  const needsMore = description !== undefined || image !== undefined || tags !== undefined || important || mustHave
  await ensureSaveFormOpen(page, { more: needsMore })
  await page.locator('#save-url').fill(url)
  if (title !== undefined) await page.locator('#save-title').fill(title)
  if (description !== undefined) await page.locator('#save-desc').fill(description)
  if (image !== undefined) await page.locator('#save-image').fill(image)
  if (tags !== undefined) await page.locator('#save-tags').fill(tags)
  if (category) await page.locator('#save-category').selectOption(category)
  if (important) await page.getByLabel('Important').check()
  if (mustHave) await page.getByLabel('Must Have').check()
  await page.getByRole('button', { name: 'Save link' }).click()
  // wait for toast or card
  await expect(page.getByText('Link saved')).toBeVisible({ timeout: 3000 }).catch(() => {})
}

test.describe('Save_Link E2E', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('A. Application load', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.brand-title')).toHaveText('Save_Link')
    await expect(page.locator('.brand-sub')).toHaveText('Local-first bookmark manager')
    // the Save Link form is a collapsed bar; expand it to assert the form
    await page.getByRole('button', { name: 'Save a link', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Save a link' })).toBeVisible()
    await expect(page.getByPlaceholder('https://example.com/article')).toBeVisible()
    // sidebar / statistics
    await expect(page.getByRole('heading', { name: 'Statistics' })).toBeVisible()
    await expect(page.getByText('Total saved')).toBeVisible()
    await expect(page.locator('.stats').getByText('Important', { exact: true })).toBeVisible()
    await expect(page.locator('.stats').getByText('Must Have', { exact: true })).toBeVisible()
    await expect(page.locator('.stats').getByText('Favorites', { exact: true })).toBeVisible()
    await expect(page.getByText('By category', { exact: true })).toBeVisible()
    // profile
    await expect(page.locator('.profile')).toBeVisible()
    await expect(page.getByText('Local User')).toBeVisible()
    // about
    await expect(page.getByText('About Save_Link')).toBeVisible()
  })

  test('B. Save link', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/article', title: 'E2E Title' })
    const card = page.locator('article.card').first()
    await expect(card).toBeVisible()
    await expect(card.getByText('E2E Title')).toBeVisible()
    await expect(card.locator('.url')).toContainText('example.com/article')
    await expect(card.locator('.domain')).toContainText('example.com')
  })

  test('C. Favorite', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/fav', title: 'Fav Test' })
    const card = page.locator('article.card').first()
    const favButton = card.getByRole('button', { name: 'Toggle Favorite' })
    const favStat = page.locator('.stats').getByText('Favorites').locator('..').locator('.num')

    // initial favorite count 0, not active
    await expect(favButton).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.stat-card', { hasText: 'Favorites' }).locator('.num')).toHaveText('0')

    // mark favorite
    await favButton.click()
    await expect(favButton).toHaveAttribute('aria-pressed', 'true')
    await expect(favButton).toHaveClass(/active/)
    await expect(page.locator('.stat-card', { hasText: 'Favorites' }).locator('.num')).toHaveText('1')

    // remove favorite
    await favButton.click()
    await expect(favButton).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.stat-card', { hasText: 'Favorites' }).locator('.num')).toHaveText('0')
  })

  test('D. Important + Must Have independent', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/status', title: 'Status Test' })
    const card = page.locator('article.card').first()
    const importantBtn = card.getByRole('button', { name: 'Toggle Important' })
    const mustHaveBtn = card.getByRole('button', { name: 'Toggle Must Have' })

    await expect(importantBtn).toHaveAttribute('aria-pressed', 'false')
    await expect(mustHaveBtn).toHaveAttribute('aria-pressed', 'false')

    await importantBtn.click()
    await expect(importantBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(importantBtn).toHaveClass(/active/)

    await mustHaveBtn.click()
    await expect(importantBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(mustHaveBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(mustHaveBtn).toHaveClass(/active/)

    // turn Important off, Must Have remains
    await importantBtn.click()
    await expect(importantBtn).toHaveAttribute('aria-pressed', 'false')
    await expect(mustHaveBtn).toHaveAttribute('aria-pressed', 'true')

    // verify stats
    await expect(page.locator('.stat-card', { hasText: 'Important' }).locator('.num')).toHaveText('0')
    await expect(page.locator('.stat-card', { hasText: 'Must Have' }).locator('.num')).toHaveText('1')
  })

  test('E. Search', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Unique' })
    await saveLink(page, { url: 'https://example.com/beta', title: 'Beta Unique' })
    await saveLink(page, { url: 'https://example.com/gamma', title: 'Gamma Unique' })

    await page.locator('#filter-search').fill('Alpha')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Alpha Unique')

    await page.locator('#filter-search').fill('Unique')
    await expect(page.locator('article.card')).toHaveCount(3)

    await page.locator('#filter-search').fill('nonexistent123')
    await expect(page.locator('article.card')).toHaveCount(0)
    await expect(page.getByText('No results')).toBeVisible()
  })

  test('F. Category filter', async ({ page }) => {
    await page.goto('/')
    // github and youtube to have distinct categories
    await saveLink(page, { url: 'https://github.com/user/repo', title: 'GitHub Link', category: 'GitHub' })
    await saveLink(page, { url: 'https://youtube.com/watch?v=123', title: 'YouTube Link', category: 'YouTube' })

    await expect(page.locator('article.card')).toHaveCount(2)

    await page.locator('#filter-category').selectOption('GitHub')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('GitHub Link')
    await expect(page.locator('article.card').first().locator('.category')).toContainText('GitHub')

    await page.locator('#filter-category').selectOption('YouTube')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('YouTube Link')

    await page.locator('#filter-category').selectOption('')
    await expect(page.locator('article.card')).toHaveCount(2)
  })

  test('G. Status filter', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/imp', title: 'Important Link' })
    await saveLink(page, { url: 'https://example.com/must', title: 'MustHave Link' })
    await saveLink(page, { url: 'https://example.com/fav', title: 'Fav Link' })

    // mark statuses using title-based locators (more robust than nth order)
    await page.locator('article.card', { hasText: 'Fav Link' }).getByRole('button', { name: 'Toggle Favorite' }).click()
    await page.locator('article.card', { hasText: 'MustHave Link' }).getByRole('button', { name: 'Toggle Must Have' }).click()
    await page.locator('article.card', { hasText: 'Important Link' }).getByRole('button', { name: 'Toggle Important' }).click()

    // Filter Important
    await page.locator('#filter-status').selectOption('important')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Important Link')

    // Filter Must Have
    await page.locator('#filter-status').selectOption('must-have')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('MustHave Link')

    // Reset status, filter Favorites
    await page.locator('#filter-status').selectOption('')
    await page.locator('#filter-status').selectOption('favorite')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Fav Link')

    // No favorite
    await page.locator('#filter-status').selectOption('not-favorite')
    await expect(page.locator('article.card')).toHaveCount(2) // imp + must
    await expect(page.locator('article.card').first()).not.toContainText('Fav Link')

    // No status (Important/Must Have) — Fav Link has favorite but no status, so should still show 1
    await page.locator('#filter-status').selectOption('none')
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('article.card').first()).toContainText('Fav Link')
  })

  test('H. Edit', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/edit', title: 'Original Title', description: 'Original Desc', tags: 'a, b' })

    const card = page.locator('article.card').first()
    await card.getByRole('button', { name: 'Edit link' }).click()

    // edit form should be visible
    const editForm = card.locator('.edit-form')
    await expect(editForm).toBeVisible()

    await editForm.locator('input').first().fill('Updated Title')
    await editForm.locator('textarea').fill('Updated Desc')
    await editForm.locator('input[placeholder="https://..."]').fill('https://example.com/new-image.jpg')
    // tags input is the second input after title? actually tags is 3rd input; we can find by placeholder or by order
    // tags field has no placeholder distinguishing, use nth
    // edit fields: Title, Description, Image URL, Tags, Category
    await editForm.getByText('Tags (comma separated)').locator('..').locator('input').fill('x, y, z')
    await editForm.getByLabel('Edit category').selectOption('GitHub')

    await editForm.getByRole('button', { name: 'Save' }).click()

    await expect(card.getByText('Updated Title')).toBeVisible()
    await expect(card.getByText('Updated Desc')).toBeVisible()
    await expect(card.getByText('#x')).toBeVisible()
    await expect(card.getByText('#y')).toBeVisible()
    await expect(card.locator('.category')).toContainText('GitHub')
    await expect(card.locator('.thumb-wrap')).toBeVisible() // image now set, container visible
  })

  test('I. Delete', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/delete-me', title: 'Delete Me' })
    await expect(page.locator('article.card')).toHaveCount(1)
    await expect(page.locator('.stat-card', { hasText: 'Total saved' }).locator('.num')).toHaveText('1')

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Delete')
      await dialog.accept()
    })
    await page.locator('article.card').first().getByRole('button', { name: 'Delete link' }).click()

    await expect(page.locator('article.card')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'No links yet' })).toBeVisible()
    await expect(page.locator('.stat-card', { hasText: 'Total saved' }).locator('.num')).toHaveText('0')
    await expect(page.getByText('Link deleted')).toBeVisible()
  })

  test('J. Local Storage persistence', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/persist', title: 'Persist Me' })
    const card = page.locator('article.card').first()
    await card.getByRole('button', { name: 'Toggle Favorite' }).click()
    await card.getByRole('button', { name: 'Toggle Important' }).click()
    await card.getByRole('button', { name: 'Toggle Must Have' }).click()

    await expect(card.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(card.getByRole('button', { name: 'Toggle Important' })).toHaveAttribute('aria-pressed', 'true')
    await expect(card.getByRole('button', { name: 'Toggle Must Have' })).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    const reloadedCard = page.locator('article.card').first()
    await expect(reloadedCard).toBeVisible()
    await expect(reloadedCard.getByText('Persist Me')).toBeVisible()
    await expect(reloadedCard.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')
    await expect(reloadedCard.getByRole('button', { name: 'Toggle Important' })).toHaveAttribute('aria-pressed', 'true')
    await expect(reloadedCard.getByRole('button', { name: 'Toggle Must Have' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('K. Original URL', async ({ page }) => {
    await page.goto('/')
    await saveLink(page, { url: 'example.com/page', title: 'No Protocol' })
    const card = page.locator('article.card').first()
    const link = card.locator('a.url').first()
    await expect(link).toContainText('example.com/page')
    const href = await link.getAttribute('href')
    expect(href).toBe('https://example.com/page')
    // also check normalized hint
    await expect(card.locator('.normalized-hint')).toContainText('https://example.com/page')
    // verify title link also uses normalized
    const titleLink = card.locator('a.title')
    expect(await titleLink.getAttribute('href')).toBe('https://example.com/page')
    expect(await titleLink.getAttribute('target')).toBe('_blank')
    expect(await titleLink.getAttribute('rel')).toContain('noopener')
  })

  test('L. Invalid URL', async ({ page }) => {
    await page.goto('/')
    await ensureSaveFormOpen(page)
    // use https:// which is reliably invalid (empty host) and triggers Invalid URL
    await page.locator('#save-url').fill('https://')
    await page.getByRole('button', { name: 'Save link' }).click()
    await expect(page.locator('.error')).toBeVisible()
    await expect(page.locator('.error')).toContainText('Invalid URL')
    await expect(page.locator('article.card')).toHaveCount(0)

    // also test empty
    await page.locator('#save-url').fill('   ')
    await page.getByRole('button', { name: 'Save link' }).click()
    await expect(page.locator('.error')).toContainText('Please paste a URL')
    await expect(page.locator('article.card')).toHaveCount(0)
  })

  test('M. Broken image', async ({ page }) => {
    await page.goto('/')
    // use data URL for valid image so it always loads and thumb-wrap is visible
    const validImg = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgZmlsbD0iI2NjYyIvPjwvc3ZnPg=='
    await saveLink(page, { url: 'https://example.com/broken-img', title: 'Broken Image', image: validImg })
    const card = page.locator('article.card').first()
    await expect(card.locator('.thumb-wrap')).toBeVisible()

    // edit to invalid image
    await card.getByRole('button', { name: 'Edit link' }).click()
    const editForm = card.locator('.edit-form')
    await editForm.locator('input[placeholder="https://..."]').fill('https://example.com/this-image-does-not-exist-404.jpg')
    await editForm.getByRole('button', { name: 'Save' }).click()

    // after save, image should fail and container should be hidden
    // trigger error by waiting a bit and then checking thumb-wrap not visible
    // Since jsdom image error not triggered automatically, we simulate by checking that thumb-wrap is either hidden after error event
    // We force image error by evaluating that src is invalid and then triggering error
    // But actual app hides container on @error; we can trigger error manually via page.evaluate
    // Alternative: verify that card still does not leave empty 16:9 block by checking thumb-wrap count
    // If imageFailed logic works, after error event, thumb-wrap should be detached
    // Force error
    await page.evaluate(() => {
      const img = document.querySelector('.thumb')
      if (img) img.dispatchEvent(new Event('error'))
    })
    // after error, container should be gone
    await expect(card.locator('.thumb-wrap')).toHaveCount(0)
  })

  test('N. Responsive UI', async ({ page }) => {
    // desktop: three areas, compact Save Link bar, stats visible in the right rail
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await expect(page.locator('.layout')).toBeVisible()
    const toggle = page.getByRole('button', { name: 'Save a link', exact: true })
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.getByRole('heading', { name: 'Save a link' })).toBeVisible()
    await expect(page.locator('#save-url')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save link' })).toBeVisible()
    await expect(page.locator('.stats')).toBeVisible()

    // mobile: Save Link form expands on demand; stats/search live in the utilities drawer
    await page.setViewportSize({ width: 375, height: 667 })
    await page.reload()
    const utilToggle = page.getByRole('button', { name: 'Toggle filters and tools' })
    await expect(utilToggle).toBeVisible()
    await page.getByRole('button', { name: 'Save a link', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Save a link' })).toBeVisible()
    await expect(page.locator('#save-url')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save link' })).toBeVisible()
    await expect(page.locator('.stats')).not.toBeInViewport()
    await utilToggle.click()
    await expect(page.locator('.stats')).toBeInViewport()
    // no horizontal scroll on mobile
    const noHS = await page.evaluate(() => document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth)
    expect(noHS).toBe(true)
    // close the drawer, then add a link on mobile and verify still usable
    await utilToggle.click()
    await saveLink(page, { url: 'https://example.com/mobile', title: 'Mobile Test' })
    await expect(page.locator('article.card').first()).toBeVisible()
  })
})
