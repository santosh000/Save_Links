import { test, expect } from '@playwright/test'
import { clearStorage, saveLink } from './helpers.js'

// Step 1A — collapsible mobile search. The search field itself, its state and the
// filtering pipeline are unchanged; only its mobile presentation (collapsed behind
// an affordance, expanding into the app bar) is new.
const searchToggle = (page) => page.getByRole('button', { name: 'Search', exact: true })
const searchInput = (page) => page.getByLabel('Search links')
const noPageOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

async function seedTwo(page) {
  await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
  await saveLink(page, { url: 'https://example.com/beta', title: 'Beta Link' })
}

test.describe('Collapsible mobile search', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('search is collapsed behind its affordance at every mobile width', async ({ page }) => {
    for (const width of [320, 375, 390, 430, 480, 768]) {
      await page.setViewportSize({ width, height: 900 })
      await clearStorage(page)
      await seedTwo(page)
      const where = `collapsed @${width}`

      await expect(searchToggle(page)).toBeVisible()
      await expect(page.locator('.navbar-search-toggle')).toHaveAttribute('aria-expanded', 'false')
      await expect(searchInput(page)).toBeHidden()
      await expect(page.locator('.mobile-brand')).toBeVisible()
      await expect(page.locator('.identity-btn')).toBeVisible()
      expect({ [where]: await noPageOverflow(page) }).toEqual({ [where]: true })
    }
  })

  test('activating search reveals and focuses the existing field, and typing still filters', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 })
    await seedTwo(page)
    await expect(page.locator('.grid > .card')).toHaveCount(2)

    await searchToggle(page).click()
    await expect(searchInput(page)).toBeVisible()
    await expect(searchInput(page)).toBeFocused()
    // The affordance is display:none while the field is open, so its state is
    // asserted through a plain CSS locator (role locators skip hidden nodes).
    await expect(page.locator('.navbar-search-toggle')).toHaveAttribute('aria-expanded', 'true')

    await searchInput(page).fill('alpha')
    await expect(page.locator('.grid > .card')).toHaveCount(1)
    await expect(page.locator('.grid > .card')).toContainText('Alpha Link')

    // The existing clear control still empties the query and the filter resets.
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    await expect(page.locator('.grid > .card')).toHaveCount(2)
  })

  test('the active field takes the available app-bar space without overflow or collision', async ({ page }) => {
    for (const width of [320, 390, 480]) {
      await page.setViewportSize({ width, height: 900 })
      await clearStorage(page)
      await seedTwo(page)
      await searchToggle(page).click()
      await expect(searchInput(page)).toBeVisible()

      const box = await page.evaluate(() => {
        const nav = document.querySelector('.navbar-custom').getBoundingClientRect()
        const input = document.querySelector('.navbar-search-input').getBoundingClientRect()
        const profile = document.querySelector('.identity-btn').getBoundingClientRect()
        const toggle = document.querySelector('.navbar-search-toggle')
        return {
          navLeft: nav.left, navRight: nav.right,
          inputLeft: input.left, inputRight: input.right, inputHeight: input.height,
          profileLeft: profile.left,
          toggleHidden: getComputedStyle(toggle).display === 'none',
          brandHidden: getComputedStyle(document.querySelector('.mobile-brand')).display === 'none',
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        }
      })
      const where = `active @${width}`
      expect({ [where]: box.inputLeft >= box.navLeft && box.inputRight <= box.navRight }).toEqual({ [where]: true })
      expect({ [where]: box.inputRight <= box.profileLeft }).toEqual({ [where]: true }) // no collision
      expect({ [where]: box.toggleHidden && box.brandHidden }).toEqual({ [where]: true })
      expect({ [where]: box.inputHeight >= 32 }).toEqual({ [where]: true }) // touch-safe height
      expect({ [where]: box.overflow }).toEqual({ [where]: false })
    }
  })

  test('closing returns to the compact bar, keeps the query and restores focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await seedTwo(page)

    await searchToggle(page).click()
    await searchInput(page).fill('alpha')
    await expect(page.locator('.grid > .card')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(searchInput(page)).toBeHidden()
    await expect(searchToggle(page)).toBeVisible()
    await expect(searchToggle(page)).toBeFocused()
    await expect(page.locator('.navbar-search-toggle')).toHaveAttribute('aria-expanded', 'false')
    // The query (and therefore the active filter) is preserved, not cleared.
    await expect(page.locator('.grid > .card')).toHaveCount(1)

    await searchToggle(page).click()
    await expect(searchInput(page)).toHaveValue('alpha')
    await expect(page.getByRole('button', { name: 'Clear search', exact: true })).toBeVisible()
    await expect(page.locator('.grid > .card')).toHaveCount(1)
  })

  test('tablet and desktop search stays always-visible and unchanged', async ({ page }) => {
    for (const width of [900, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await clearStorage(page)
      await seedTwo(page)
      const where = `desktop @${width}`

      await expect(page.locator('.navbar-search-toggle')).toBeHidden()
      await expect(searchInput(page)).toBeVisible() // no interaction needed
      // The in-field icon stays decorative (not a second focusable control).
      await expect(page.locator('.navbar-search-btn')).toHaveAttribute('aria-hidden', 'true')
      await expect(page.locator('.navbar-search-btn')).toHaveAttribute('tabindex', '-1')

      await searchInput(page).fill('alpha')
      await expect(page.locator('.grid > .card')).toHaveCount(1)
      await searchInput(page).fill('')
      expect({ [where]: await noPageOverflow(page) }).toEqual({ [where]: true })
    }
  })
})
