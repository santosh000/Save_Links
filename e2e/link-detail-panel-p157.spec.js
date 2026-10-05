// P15.7 — rebuilt link-detail surface: real fields, registry icons, edit/save/
// cancel, favorite/pin, real tags, delete via the existing AppDialog, and the
// mockup responsive behavior (sheet <1024, static rail >=1024, preview 180px and
// the 2-column action grid at 1024).
import { test, expect } from '@playwright/test'
import { clearStorage, openView, saveLink, createFolder, expectNoHorizontalScroll, ensureCardView } from './helpers.js'

function card(page, title) {
  return page.locator('.grid > .card').filter({ hasText: title }).first()
}
function detail(page) {
  return page.locator('.detail')
}
async function openDetail(page, title) {
  await ensureCardView(page)
  // The meta row is always rendered (the description may be absent) and is
  // outside the card's anchors, so it triggers the real inspect path.
  await card(page, title).locator('.card-domain').click()
  await expect(detail(page)).toBeVisible()
}
async function saveDetailedLink(page, { url, title, description, tags, folder }) {
  await openView(page, 'links')
  if (!(await page.locator('#save-url').isVisible().catch(() => false))) await page.locator('.content-head .add-toggle').click()
  if (folder) {
    await page.locator('#save-folder + .asel-trigger').click()
    await page.locator('.asel-menu').getByRole('option').filter({ hasText: folder }).first().click()
  }
  await page.locator('#save-url').fill(url)
  await page.locator('#save-title').fill(title)
  await page.getByRole('button', { name: 'More options', exact: true }).click()
  await page.locator('#save-desc').fill(description)
  await page.locator('#save-tags').fill(tags)
  await page.locator('#add-form .type-pill', { hasText: 'Article' }).click()
  await page.getByRole('button', { name: 'Save link', exact: true }).click()
  await expect(page.locator('#add-form')).toHaveCount(0)
}

test.describe('P15.7 — rebuilt detail panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('opens with the real link information and real stored tags', async ({ page }) => {
    await openView(page, 'folders')
    await createFolder(page, 'Work')
    await saveDetailedLink(page, {
      url: 'https://react.dev/blog/server-components',
      title: 'React Server Components',
      description: 'A complete walkthrough.',
      tags: 'react, javascript',
      folder: 'Work',
    })
    await openDetail(page, 'React Server Components')

    const panel = detail(page)
    await expect(panel.locator('.detail-title')).toHaveText('React Server Components')
    await expect(panel.locator('.detail-url')).toHaveText('https://react.dev/blog/server-components')
    await expect(panel.locator('.detail-desc')).toHaveText('A complete walkthrough.')
    await expect(panel.locator('.detail-badge')).toHaveText('Article')
    await expect(panel.locator('.detail-tags .detail-tag')).toHaveText(['#react', '#javascript'])
    const meta = await panel.locator('.detail-meta').evaluate((el) => {
      const out = {}
      const dts = [...el.querySelectorAll('dt')]
      const dds = [...el.querySelectorAll('dd')]
      dts.forEach((dt, i) => { out[dt.textContent.trim()] = dds[i].textContent.trim() })
      return out
    })
    expect(meta.Domain).toBe('react.dev')
    expect(meta.Type).toBe('Article')
    expect(meta.Folder).toBe('Work')
    expect(meta.Category).toBe('Other')
    expect(meta.Saved).not.toBe('—')
  })

  test('uses only the shared registry icons in the default state', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/icons', title: 'Icon Link' })
    await openDetail(page, 'Icon Link')

    const svgs = await page.locator('.detail svg').evaluateAll((els) =>
      els.map((el) => ({ cls: el.getAttribute('class') || '', w: Math.round(el.getBoundingClientRect().width) }))
    )
    expect(svgs.length).toBeGreaterThan(5)
    for (const svg of svgs) expect(svg.cls).toContain('ic')

    // One control family in the top row: action icons and close are 15px; the
    // preview glyph stays 44px. (The old large Open CTA is gone.)
    await expect(page.locator('.detail-top-actions [aria-label="Copy link"] svg')).toHaveAttribute('width', '15')
    await expect(page.locator('.detail-close svg')).toHaveAttribute('width', '15')
    await expect(page.locator('.detail-top-actions [aria-label="Open link"] svg')).toHaveAttribute('width', '15')
    await expect(page.locator('.detail-open')).toHaveCount(0)
    expect(await page.locator('.preview-glyph').evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(44)
  })

  test('close control returns the rail to its real placeholder', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/close', title: 'Close Link' })
    await openDetail(page, 'Close Link')
    await page.locator('.detail-close').click()
    await expect(page.locator('.detail-title')).toHaveCount(0)
    await expect(page.locator('.detail-empty-title')).toHaveText('No link selected')
  })

  test('edit mode saves through the existing handler and cancel restores', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/edit', title: 'Original Title', description: 'Original description.', tags: 'one, two' })
    await openDetail(page, 'Original Title')

    // Cancel keeps the stored values.
    await page.locator('.detail-top-actions button[aria-label="Edit link"]').click()
    await expect(page.locator('.edit-form')).toBeVisible()
    await page.locator('.edit-form .edit-input').first().fill('Discarded Title')
    await page.locator('.edit-form').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.edit-form')).toHaveCount(0)
    await expect(page.locator('.detail-title')).toHaveText('Original Title')

    // Save persists through the existing updateLink handler.
    await page.locator('.detail-top-actions button[aria-label="Edit link"]').click()
    await page.locator('.edit-form .edit-input').first().fill('Edited Title')
    await page.locator('.edit-form').getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.edit-form')).toHaveCount(0)
    await expect(page.getByText('Link updated')).toBeVisible()
    await expect(page.locator('.detail-title')).toHaveText('Edited Title')
    await expect(card(page, 'Edited Title')).toBeVisible()

    // The Tags "Add" affordance opens the inline tag editor (not the edit form)
    // and the tag is persisted through the real edit handler.
    await page.locator('.detail-tag-add').click()
    await expect(page.locator('#detail-tag-editor')).toHaveClass(/\bopen\b/)
    await page.locator('#detail-tag-input').fill('three')
    await page.locator('#detail-tag-input').press('Enter')
    await expect(page.locator('.detail-tag', { hasText: '#three' })).toBeVisible()
    await expect(page.getByText('Link updated')).toBeVisible()

    // Collapsing the inline editor returns to the plain detail view.
    await page.locator('.detail-tag-add').click()
    await expect(page.locator('#detail-tag-editor')).not.toHaveClass(/\bopen\b/)
    await expect(page.locator('.edit-form')).toHaveCount(0)
  })

  test('favorite and pin keep their real state and handlers', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/state', title: 'State Link' })
    await openDetail(page, 'State Link')

    const fav = page.locator('.detail-state button[aria-label="Toggle Favorite"]')
    const pin = page.locator('.detail-state button[aria-label="Toggle Pin"]')
    await expect(fav).toHaveAttribute('aria-pressed', 'false')
    await expect(pin).toHaveAttribute('aria-pressed', 'false')

    await fav.click()
    await expect(fav).toHaveAttribute('aria-pressed', 'true')
    await expect(fav).toHaveClass(/active/)
    await expect(card(page, 'State Link').getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('aria-pressed', 'true')

    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await expect(card(page, 'State Link').getByRole('button', { name: 'Toggle Pin' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('delete keeps the real AppDialog confirmation and handler', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/delete', title: 'Delete Link' })
    await openDetail(page, 'Delete Link')

    await page.locator('.detail-top-actions button[aria-label="Delete link"]').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Delete this link?')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.detail-title')).toHaveText('Delete Link')

    await page.locator('.detail-top-actions button[aria-label="Delete link"]').click()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('Link deleted')).toBeVisible()
    await expect(page.locator('.detail-title')).toHaveCount(0)
    await expect(page.locator('.detail-empty-title')).toHaveText('No link selected')
  })

  test('responsive: sheet below 1200, static rail at 1200 with the mockup preview and grid', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/resp', title: 'Responsive Link' })

    // Mobile sheet: dialog + backdrop, closes on Escape.
    await page.setViewportSize({ width: 390, height: 900 })
    await page.reload()
    await openDetail(page, 'Responsive Link')
    await expect(detail(page)).toHaveClass(/detail--sheet/)
    await expect(detail(page)).toHaveAttribute('role', 'dialog')
    await expect(page.locator('.detail-backdrop')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.detail-title')).toHaveCount(0)
    await expect(page.locator('.detail-backdrop')).toHaveCount(0)
    await expectNoHorizontalScroll(page)

    // Tablet sheet: centred 560px, top action row + state pills present.
    await page.setViewportSize({ width: 900, height: 900 })
    await openDetail(page, 'Responsive Link')
    expect(await detail(page).evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(560)
    expect(await page.locator('.detail-top-actions > *').count()).toBe(6)
    expect(await page.locator('.detail-close').count()).toBe(1)
    expect(await page.locator('.detail-state .type-pill').count()).toBe(2)
    // close this sheet before the next width (it now stays a sheet at 1024 too)
    await page.keyboard.press('Escape')
    await expect(page.locator('.detail-title')).toHaveCount(0)
    await expect(page.locator('.detail-backdrop')).toHaveCount(0)

    // Tablet at 1024 is still the sheet (the desktop rail starts at 1200).
    await page.setViewportSize({ width: 1024, height: 900 })
    await openDetail(page, 'Responsive Link')
    await expect(detail(page)).toHaveClass(/detail--sheet/)
    await expect(page.locator('.detail-backdrop')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.detail-title')).toHaveCount(0)
    // the sheet backdrop must fully leave before the next interaction
    await expect(page.locator('.detail-backdrop')).toHaveCount(0)

    // Desktop rail at 1200: static column, mockup preview 180px + same toolbar.
    await page.setViewportSize({ width: 1200, height: 900 })
    await openDetail(page, 'Responsive Link')
    await expect(detail(page)).toHaveClass(/detail--rail/)
    await expect(detail(page)).toHaveAttribute('role', 'complementary')
    await expect(page.locator('.detail-backdrop')).toHaveCount(0)
    expect(await page.locator('.detail-preview').evaluate((el) => Math.round(el.getBoundingClientRect().height))).toBe(180)
    expect(await page.locator('.detail-top-actions > *').count()).toBe(6)
    expect(await page.locator('.detail-close').count()).toBe(1)
    await expectNoHorizontalScroll(page)
  })
})
