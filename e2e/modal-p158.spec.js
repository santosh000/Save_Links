// P15.8 — unified modal shell: mockup head/body/footer, shared Icon close,
// Escape / X / backdrop close, focus in + restore, real consumer content,
// bottom-sheet on mobile and centered panel >=768.
import { test, expect } from '@playwright/test'
import { clearStorage, openView, createFolder, saveLink, linkRowByTitle, expectNoHorizontalScroll } from './helpers.js'

const dialog = (page) => page.getByRole('dialog')

// Seed one link, then trigger the real duplicate dialog with the same URL.
async function triggerDuplicateDialog(page) {
  await saveLink(page, { url: 'https://example.com/p158-dup?utm_source=x', title: 'P158 Dup Again', expectToast: false })
  await expect(dialog(page)).toBeVisible()
}
async function openDuplicateDialog(page) {
  await saveLink(page, { url: 'https://example.com/p158-dup', title: 'P158 Dup' })
  await triggerDuplicateDialog(page)
}

test.describe('P15.8 — unified modal shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('renders the mockup shell with the real consumer content', async ({ page }) => {
    await openDuplicateDialog(page)
    const d = dialog(page)
    await expect(d).toHaveAttribute('aria-modal', 'true')
    await expect(d).toHaveAttribute('aria-labelledby', 'app-dialog-title')
    await expect(d).toHaveAttribute('aria-describedby', 'app-dialog-message')

    await expect(d.locator('.dialog-head .dialog-title')).toHaveText('Link already saved')
    await expect(d.locator('.dialog-message')).toContainText('This link is already in your saved links.')
    await expect(d.locator('.dialog-actions')).toBeVisible()
    await expect(d.locator('.dialog-actions .btn')).toHaveCount(3)
    // body scrolls on long content, panel is capped at the mockup heights
    expect(await d.locator('.dialog-message').evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto')
    const panel = await d.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { w: Math.round(el.getBoundingClientRect().width), maxW: cs.maxWidth, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow !== 'none' }
    })
    expect(panel.w).toBe(560)
    expect(panel.maxW).toBe('560px')
    expect(panel.radius).toBe('16px')
    expect(panel.shadow).toBe(true)
  })

  test('the close control uses the shared Icon registry and no inline SVG remains', async ({ page }) => {
    await openDuplicateDialog(page)
    const close = page.locator('.dialog-close')
    await expect(close).toHaveAttribute('aria-label', 'Close dialog')
    const closeIcon = close.locator('svg')
    await expect(closeIcon).toHaveClass(/\bic\b/)
    await expect(closeIcon).toHaveAttribute('width', '15')

    const svgs = await page.locator('.dialog-backdrop svg').evaluateAll((els) => els.map((s) => s.getAttribute('class') || ''))
    expect(svgs.length).toBeGreaterThan(0)
    for (const cls of svgs) expect(cls).toContain('ic')
  })

  test('Escape, the close X and the backdrop each close the real dialog', async ({ page }) => {
    await openDuplicateDialog(page)
    await page.locator('.dialog-close').click()
    await expect(dialog(page)).toHaveCount(0)

    await triggerDuplicateDialog(page)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)

    await triggerDuplicateDialog(page)
    await page.locator('.dialog-backdrop').click({ position: { x: 10, y: 10 } })
    await expect(dialog(page)).toHaveCount(0)
  })

  test('focus enters on the default action and returns to the invoking control', async ({ page }) => {
    await openDuplicateDialog(page)
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toBe('Replace existing')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(page)).toHaveCount(0)

    // The bulk Delete button survives the dialog, so focus must return to it.
    await saveLink(page, { url: 'https://example.com/p158-bulk', title: 'P158 Bulk' })
    await linkRowByTitle(page, 'P158 Bulk').getByRole('checkbox').check()
    const bulkDelete = page.getByRole('button', { name: 'Delete selected links' })
    await bulkDelete.click()
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(page)).toHaveCount(0)
    await expect(bulkDelete).toBeFocused()
  })

  test('folder delete confirms inside the sidebar ⋮ menu (mockup), not through a dialog', async ({ page }) => {
    await createFolder(page, 'Work')
    await openView(page, 'links')

    await page.getByRole('button', { name: 'Folder options for Work' }).click()
    await page.getByRole('menuitem', { name: 'Delete sidebar folder Work' }).click()
    // P15 folder pass: the confirmation lives in the menu; no AppDialog opens.
    await expect(dialog(page)).toHaveCount(0)
    await page.getByRole('button', { name: 'Confirm delete sidebar folder Work' }).click()
    await expect(page.getByText('Folder deleted')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-folder-row"]', { hasText: 'Work' })).toHaveCount(0)
  })

  test('mobile sheet and desktop centred panel both stay usable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await openDuplicateDialog(page)
    const sheet = await page.locator('.dialog').evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), bottom: Math.round(r.bottom), vw: window.innerWidth, vh: window.innerHeight, radius: getComputedStyle(el).borderBottomLeftRadius }
    })
    expect(sheet.w).toBe(sheet.vw) // full-width sheet
    expect(Math.abs(sheet.bottom - sheet.vh)).toBeLessThanOrEqual(1) // flush to the bottom edge
    expect(sheet.radius).toBe('0px') // square bottom in sheet mode
    await expect(page.locator('.dialog-actions .btn').first()).toBeVisible()
    await expectNoHorizontalScroll(page)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)

    await page.setViewportSize({ width: 1024, height: 900 })
    await triggerDuplicateDialog(page)
    const box = await page.locator('.dialog').evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { w: Math.round(r.width), cx: Math.round(r.x + r.width / 2), vw: window.innerWidth }
    })
    expect(box.w).toBe(560)
    expect(Math.abs(box.cx - box.vw / 2)).toBeLessThanOrEqual(2)
    await page.keyboard.press('Escape')
  })
})
