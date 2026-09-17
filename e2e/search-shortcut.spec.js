import { test, expect } from '@playwright/test'
import { clearStorage, ensureAddLinkOpen, saveLink } from './helpers.js'

// Step 2C-5 contract: the Search shortcut (Ctrl+K / ⌘K) reuses the existing
// search-opening path, never fires from editable controls, and is discoverable
// through a decorative keycap that only appears for the empty, unfocused,
// keyboard context. The tooltip pass only removes tooltips that duplicate a
// visible label or an accessible name — names and kept tooltips are asserted.
const SEARCH = '.navbar-search-input'
const KBD = '.navbar-search-kbd'

test.describe('Search shortcut + keycap (Step 2C-5)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('Ctrl+K focuses the existing search field', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator(SEARCH)).not.toBeFocused()
    await page.keyboard.press('Control+k')
    await expect(page.locator(SEARCH)).toBeFocused()
    await expect(page.locator(SEARCH)).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K')
  })

  test('Meta+K behaves the same way (macOS modifier)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    // The document-level listener only exists once the app has mounted: wait for
    // the real search field (the keypress is otherwise dispatched into nothing).
    await expect(page.locator(SEARCH)).toBeVisible()
    await expect(page.locator(SEARCH)).not.toBeFocused()
    await page.keyboard.press('Meta+k')
    await expect(page.locator(SEARCH)).toBeFocused()
  })

  test('the shortcut is ignored while an editable control has focus', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await ensureAddLinkOpen(page)
    await page.locator('#save-url').fill('https://example.com/alpha')
    await page.locator('#save-title').click()
    await page.keyboard.press('Control+k')
    // native editing is untouched: focus and value stay where the user was
    await expect(page.locator('#save-title')).toBeFocused()
    await expect(page.locator('#save-title')).toHaveValue('')
    await expect(page.locator(SEARCH)).not.toBeFocused()
  })

  test('search still filters, and Escape preserves the query', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await saveLink(page, { url: 'https://example.com/beta', title: 'Beta Link' })
    await expect(page.locator('.grid > .card')).toHaveCount(2)

    await page.keyboard.press('Control+k')
    await page.locator(SEARCH).fill('alpha')
    await expect(page.locator('.grid > .card')).toHaveCount(1)
    await page.keyboard.press('Escape')
    // the query is never cleared and filtering stays in effect; on desktop the
    // field keeps focus (the collapsed-close path belongs to the mobile shell,
    // covered in the mobile test below and in mobile-search.spec.js)
    await expect(page.locator(SEARCH)).toHaveValue('alpha')
    await expect(page.locator('.grid > .card')).toHaveCount(1)
  })

  test('the keycap shows only for the empty, unfocused desktop field', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    const kbd = page.locator(KBD)
    await expect(kbd).toBeVisible()
    await expect(kbd).toHaveText(/(Ctrl K|⌘ K)/)
    await expect(kbd).toHaveAttribute('aria-hidden', 'true')

    // focused -> hidden (the user is already in the field)
    await page.locator(SEARCH).click()
    await expect(kbd).toBeHidden()

    // has text (blurred) -> hidden
    await page.locator(SEARCH).fill('alpha')
    await page.locator('.page-title').click()
    await expect(kbd).toBeHidden()

    // empty again and unfocused -> visible
    await page.locator(SEARCH).fill('')
    await page.locator('.page-title').click()
    await expect(kbd).toBeVisible()
  })

  test('the keycap stays out of the mobile shell', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.locator(KBD)).toBeHidden()
    // the existing collapsed search still opens and focuses as before
    await page.locator('.navbar-search-toggle').click()
    await expect(page.locator(SEARCH)).toBeFocused()
    await expect(page.locator(KBD)).toBeHidden()
    // and Escape still collapses it (pre-existing mobile behaviour)
    await page.keyboard.press('Escape')
    await expect(page.locator('.navbar-search-wrapper')).toBeHidden()
  })

  test('macOS platforms label the keycap with the command glyph', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgentData', { get: () => ({ platform: 'macOS' }) })
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      })
    })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator(KBD)).toHaveText('⌘ K')
  })

  test('tooltip de-duplication removes only the redundant tooltips', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })

    const card = page.locator('.grid > .card').first()
    // removed: tooltips that only repeated a visible label or the accessible name
    await expect(card.locator('.pill[title]')).toHaveCount(0)
    await expect(card.locator('.icon-btn[aria-controls][title]')).toHaveCount(0)
    expect(await page.locator('.toolbar-export[title]').count()).toBe(0)

    // kept: accessible names, icon-only tooltips and the truncated-content tooltip
    await expect(card.getByRole('button', { name: 'Toggle Important' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Toggle Favorite' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Toggle Must Have' })).toHaveCount(0) // lives in the menu (2C-3)
    await expect(card.locator('.url[title]')).toHaveCount(1)
    await expect(card.locator('.icon-btn[aria-label="Edit link"]')).toHaveAttribute('title', 'Edit')

    // list view keeps the icon-only row toggles' tooltips
    await page.locator('.view-btn').nth(1).click()
    const row = page.locator('.row-list > .link-row').first()
    await expect(row.getByRole('button', { name: 'Toggle Important' })).toHaveAttribute('title', 'Important')
    await expect(row.getByRole('button', { name: 'Toggle Favorite' })).toHaveAttribute('title', 'Favorite')
    await expect(row.locator('.icon-btn[aria-controls][title]')).toHaveCount(0)
    await expect(row.locator('.row-main[title]')).toHaveCount(1)
  })
})
