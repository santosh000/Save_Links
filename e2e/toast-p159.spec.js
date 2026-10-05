// P15.9 — toast surface: mockup pill, real messages, existing timing/slot
// behaviour, and the overlay-aware layer fix (toast never covers a modal
// footer, never blocks modal interaction, never hides behind the backdrop).
import { test, expect } from '@playwright/test'
import { clearStorage, openView, createFolder, saveLink, importBackupFile, expectNoHorizontalScroll } from './helpers.js'

const toast = (page) => page.locator('.sl-toast')

// A real import result long enough to wrap at 320px: "Import complete: 20
// links added, 9 folders added" (no URL overlap -> additive, no preview).
function bigBackup() {
  const now = new Date().toISOString()
  const link = (i) => ({
    id: `imp-${i}`,
    originalUrl: `https://example.com/imported-${i}`,
    normalizedUrl: `https://example.com/imported-${i}`,
    url: `https://example.com/imported-${i}`,
    title: `Imported ${i}`,
    description: '', image: '', tags: [], category: 'Other',
    important: false, mustHave: false, favorite: false,
    domain: 'example.com', createdAt: now,
  })
  return {
    app: 'Save_Link',
    version: 2,
    exportedAt: now,
    profile: { name: 'P159' },
    links: Array.from({ length: 20 }, (_, i) => link(i)),
    folders: Array.from({ length: 9 }, (_, i) => ({ id: `imp-f-${i}`, name: `Imported folder ${i}`, parentId: null, createdAt: now })),
  }
}

test.describe('P15.9 — toast surface', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('the real message renders on the rebuilt mockup surface', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/p159-surface', title: 'P159 Surface' })
    const el = toast(page)
    await expect(el).toContainText('Link saved')
    await expect(el).toHaveCSS('border-radius', '24px') // mockup pill
    await expect(el).toHaveCSS('padding', '10px 20px')
    await expect(el).toHaveCSS('font-size', '13.6px') // --text-sm, the app's mapping of the mockup's 13px
    await expect(el).toHaveCSS('font-weight', '500')
    await expect(el).toHaveCSS('text-align', 'center')
    await expect(el).toHaveCSS('border-top-width', '0px') // no border, no accent edge
    await expect(el).toHaveCSS('position', 'fixed')
    await expect(el).toHaveAttribute('role', 'status')
    await expect(el).toHaveAttribute('aria-live', 'polite')
    // inverted surface in light mode: --text on --bg
    const colors = await page.evaluate(() => {
      const probe = document.createElement('div')
      document.body.appendChild(probe)
      const read = (v, p) => { probe.style.setProperty(p, `var(${v})`); return getComputedStyle(probe).getPropertyValue(p) }
      const out = { text: read('--text', 'background-color'), bg: read('--bg', 'color'), shadow: read('--shadow-lg', 'box-shadow') }
      probe.remove()
      return out
    })
    await expect(el).toHaveCSS('background-color', colors.text)
    await expect(el).toHaveCSS('color', colors.bg)
    await expect(el).toHaveCSS('box-shadow', colors.shadow)
    // the mockup toast has no icon and no dismiss control — and this one has none either
    await expect(el.locator('svg')).toHaveCount(0)
    await expect(el.locator('button')).toHaveCount(0)
  })

  test('existing auto-dismiss timing is untouched', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/p159-timer', title: 'P159 Timer' })
    const el = toast(page)
    await expect(el).toBeVisible()
    const t0 = Date.now()
    await expect(el).toHaveCount(0, { timeout: 5000 })
    const elapsed = Date.now() - t0
    expect(elapsed, 'not cut short').toBeGreaterThan(1200)
    expect(elapsed, 'existing 2500ms window').toBeLessThan(3400)
  })

  test('a replacing message keeps one slot and gets its own full window', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await saveLink(page, { url: 'https://example.com/p159-slot', title: 'P159 Slot' })
    await expect(toast(page)).toContainText('Link saved')

    // let the first message age most of the way out, then replace it
    await page.waitForTimeout(1800)
    await page.getByRole('button', { name: 'More actions' }).first().click()
    await page.locator('.more-menu').first().getByRole('button', { name: 'Copy link' }).click()
    await expect(toast(page)).toContainText('Link copied')

    // the old message's timer must not clear the replacing message early:
    // 1200ms after the replacement (past the first timer's deadline) it is still up
    await page.waitForTimeout(1200)
    await expect(toast(page)).toContainText('Link copied')
    await expect(toast(page)).toHaveCount(0, { timeout: 4000 })
  })

  test('a repeated message keeps a single toast (no stacking)', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/p159-a', title: 'P159 A' })
    await saveLink(page, { url: 'https://example.com/p159-b', title: 'P159 B' })
    await expect(toast(page)).toHaveText('Link saved')
    await expect(toast(page)).toHaveCount(1)
  })

  test('a long real import message wraps at 320px without overflow', async ({ page }) => {
    await importBackupFile(page, bigBackup())
    await expect(toast(page)).toContainText('Import complete: 20 links added, 9 folders added')

    await page.setViewportSize({ width: 320, height: 640 })
    await expect(toast(page)).toBeVisible()
    const metrics = await toast(page).evaluate((el) => {
      const cs = getComputedStyle(el)
      const line = parseFloat(cs.lineHeight) || 0
      const r = el.getBoundingClientRect()
      return {
        lines: Math.round(r.height / line),
        line,
        left: r.left,
        right: r.right,
        vw: window.innerWidth,
        maxWidth: parseFloat(cs.maxWidth),
      }
    })
    expect(metrics.lines, 'real long message wraps').toBeGreaterThan(1)
    expect(metrics.left).toBeGreaterThanOrEqual(0)
    expect(metrics.right).toBeLessThanOrEqual(metrics.vw + 1)
    expect(metrics.maxWidth).toBeLessThanOrEqual(metrics.vw * 0.9 + 1)
    await expectNoHorizontalScroll(page)
  })

  test('mobile: with the dialog sheet open the toast keeps off the footer and blocks nothing', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 })
    await saveLink(page, { url: 'https://example.com/p159-layer', title: 'P159 Layer' })
    await expect(toast(page)).toContainText('Link saved')

    // re-save the same URL while the toast is still up -> the dialog sheet opens on top
    await saveLink(page, { url: 'https://example.com/p159-layer?utm_source=x', title: 'P159 Layer 2', expectToast: false })
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(toast(page)).toBeVisible()

    const geo = await page.evaluate(() => {
      const t = document.querySelector('.sl-toast').getBoundingClientRect()
      const d = document.querySelector('[role="dialog"]').getBoundingClientRect()
      const toastZ = Number(getComputedStyle(document.querySelector('.sl-toast')).zIndex)
      const backdropZ = Number(getComputedStyle(document.querySelector('.dialog-backdrop')).zIndex)
      const btn = [...document.querySelectorAll('.dialog-actions .btn')].find((b) => b.textContent.trim() === 'Cancel')
      const r = btn.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return {
        toastButtonClear: btn.contains(hit),
        toastBottom: t.bottom,
        dialogTop: d.top,
        toastTop: t.top,
        toastZ,
        backdropZ,
        vh: window.innerHeight,
      }
    })
    // moved to the top edge, clear of the sheet's footer
    expect(geo.toastTop).toBeLessThan(80)
    expect(geo.toastBottom).toBeLessThanOrEqual(geo.dialogTop + 1)
    // still above the modal: never hidden behind the backdrop
    expect(geo.toastZ).toBeGreaterThan(geo.backdropZ)
    // and it intercepts nothing: the modal's own footer is the hit target
    expect(geo.toastButtonClear).toBe(true)

    // the modal action works, then the toast returns to its bottom placement
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(toast(page)).toBeVisible()
    const bottomAfter = await toast(page).evaluate((el) => getComputedStyle(el).bottom)
    expect(bottomAfter).not.toBe('auto')
  })

  test('existing link/folder toasts still fire through their handlers', async ({ page }) => {
    await openView(page, 'folders')
    // The tree creates with a generated name, then names it through the inline
    // rename editor — so the folder toast here is the rename confirmation.
    await createFolder(page, 'P159 Folder')
    await expect(toast(page)).toContainText('Folder renamed')

    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/p159-consume', title: 'P159 Consume' })
    await page.getByRole('button', { name: 'More actions' }).first().click()
    await page.locator('.more-menu').first().getByRole('combobox', { name: 'Change category' }).click()
    await page.getByRole('option', { name: 'GitHub' }).click()
    await expect(toast(page)).toContainText('Link updated')
  })
})
