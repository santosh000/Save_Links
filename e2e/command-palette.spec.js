import { test, expect } from '@playwright/test'
import { clearStorage, saveLink, visibleLinkRows, ensureCardView } from './helpers.js'

// P2 — command palette: a keyboard layer over real SaveLink actions.
// Ctrl/Cmd+K opens it; search stays the existing navbar field (the palette's
// first command focuses it — no second search implementation).

const palette = (page) => page.locator('.command-palette')
const paletteInput = (page) => page.locator('.command-palette .command-input')
const option = (page, name) => page.getByRole('option', { name })

// The shortcut listener is registered on mount, so every test waits for the
// app shell before pressing the shortcut.
async function openPalette(page, { modifier = 'Control' } = {}) {
  await expect(page.locator('.navbar-search-input')).toBeVisible()
  await page.keyboard.press(`${modifier}+k`)
  await expect(palette(page)).toBeVisible()
}

test.describe('Command palette', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('Ctrl+K opens; Escape closes and restores focus', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    const trigger = page.locator('.btn-date-picker')
    await trigger.focus()
    await openPalette(page)
    await expect(paletteInput(page)).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(palette(page)).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('Meta+K opens the palette (macOS modifier)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await openPalette(page, { modifier: 'Meta' })
    await expect(paletteInput(page)).toBeFocused()
  })

  test('typing filters commands; Enter executes the active one', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/a', title: 'Alpha' })
    await openPalette(page)
    await paletteInput(page).fill('compact')

    await expect(page.getByRole('option')).toHaveCount(1)
    await expect(option(page, /Switch to Compact view/)).toBeVisible()
    await page.keyboard.press('Enter')

    await expect(palette(page)).toBeHidden()
    await expect(page.locator('.view-btn').filter({ hasText: 'Compact' })).toHaveClass(/active/)
    await expect(visibleLinkRows(page).first()).toBeVisible()
  })

  test('ArrowDown/ArrowUp move the active option', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await openPalette(page)

    const first = page.getByRole('option', { name: /Search links/ })
    const second = page.getByRole('option', { name: /Add link/ })
    await expect(first).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('ArrowDown')
    await expect(second).toHaveAttribute('aria-selected', 'true')
    await expect(first).toHaveAttribute('aria-selected', 'false')

    await page.keyboard.press('ArrowUp')
    await expect(first).toHaveAttribute('aria-selected', 'true')
  })

  test('Search links command focuses the existing search field', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await openPalette(page)
    await paletteInput(page).fill('search')
    await page.keyboard.press('Enter')

    await expect(page.locator('.navbar-search-input')).toBeFocused()
  })

  test('Add link command opens the existing add form', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await openPalette(page)
    await paletteInput(page).fill('add link')
    await page.keyboard.press('Enter')

    await expect(page.locator('#save-url')).toBeVisible()
  })

  test('Show favorites command applies the real favorites filter', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await saveLink(page, { url: 'https://example.com/a', title: 'Alpha' })
    await saveLink(page, { url: 'https://example.com/b', title: 'Beta' })
    await ensureCardView(page) // P8: the library boots in Compact
    await page.locator('.grid > .card').filter({ hasText: 'Alpha' })
      .getByRole('button', { name: 'Toggle Favorite' }).click()

    await openPalette(page)
    await paletteInput(page).fill('favorites')
    await page.keyboard.press('Enter')

    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Alpha')
  })

  test('the palette does not open while an editable control has focus', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.navbar-search-input')).toBeVisible()
    await page.locator('.content-head .add-toggle').click()
    await page.locator('#save-url').fill('https://example.com/alpha')
    await page.locator('#save-title').click()
    await page.keyboard.press('Control+k')

    await expect(palette(page)).toBeHidden()
    await expect(page.locator('#save-title')).toBeFocused()
  })
})
