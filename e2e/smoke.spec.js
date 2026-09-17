import { test, expect } from '@playwright/test'
import { clearStorage, openView, saveLink, visibleLinkRows } from './helpers.js'

// Runtime smoke test: the shell mounts without unexpected console/page errors,
// a saved link renders in the current representation (card or list/compact row,
// never a table), and every current primary view is reachable through the
// current navigation. Smoke-level only - no CRUD coverage here.

test.describe('Application smoke', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('shell mounts, a saved link renders, and every primary view is reachable', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
    page.on('response', (r) => { if (r.status() === 404) errors.push(`404: ${r.url()}`) })

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')

    // Shell mounts: sidebar brand + the default view header
    await expect(page.locator('.sidebar-brand')).toContainText('Save Links')
    await expect(page.locator('.page-title')).toHaveText('Saved links')

    // A link can be saved and renders in the current representation. The title is
    // given explicitly so the smoke test does not depend on the metadata network
    // fetch; the domain still comes from the saved URL.
    await saveLink(page, { url: 'https://example.com/smoke', title: 'Smoke Link' })
    const rows = visibleLinkRows(page)
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Smoke Link')
    await expect(rows.first()).toContainText('example.com')

    // Every current primary view is reachable (openView clicks the real
    // navigation and asserts the view's page title).
    for (const view of ['folders', 'backup', 'settings', 'about', 'links']) {
      await openView(page, view)
    }

    // /api/me 404s in dev/test mode (no Worker backend running) and the external
    // metadata fetch for example.com is blocked by CORS here: that environment
    // noise is expected, anything else is a real error.
    const unexpected = errors.filter(
      (e) => !/api\/me|Failed to load resource|net::ERR_FAILED|has been blocked by CORS policy/.test(e),
    )
    expect(unexpected).toEqual([])
  })
})
