import { test, expect } from '@playwright/test'
import { clearStorage, saveLink, ensureCardView } from './helpers.js'

// P15 Group 2 (mockup topbar): the search field is inline at every width, so the
// collapsed-search mode is retired. Below 768 the topbar brand steps aside (the
// drawer header carries it); search state and the filtering pipeline are unchanged.
const searchInput = (page) => page.getByLabel('Search links')
const noPageOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

async function seedTwo(page) {
  await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
  await saveLink(page, { url: 'https://example.com/beta', title: 'Beta Link' })
  await ensureCardView(page) // P8: the library boots in Compact
}

test.describe('Inline mobile search (P15 Group 2)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('search is inline at every phone width; brand and affordance step aside', async ({ page }) => {
    for (const width of [320, 375, 390, 430, 480, 767]) {
      await page.setViewportSize({ width, height: 900 })
      await clearStorage(page)
      await seedTwo(page)
      const where = `inline @${width}`

      await expect(searchInput(page)).toBeVisible()
      await expect(page.locator('.mobile-brand')).toBeHidden()
      await expect(page.locator('.navbar-search-toggle')).toHaveCount(0)
      await expect(page.locator('.identity-btn')).toBeVisible()
      expect({ [where]: await noPageOverflow(page) }).toEqual({ [where]: true })
    }
  })

  test('the brand returns from 768px up while the field stays inline', async ({ page }) => {
    for (const width of [768, 900, 1023]) {
      await page.setViewportSize({ width, height: 900 })
      await clearStorage(page)
      await seedTwo(page)
      const where = `brand @${width}`

      await expect(searchInput(page)).toBeVisible()
      await expect(page.locator('.mobile-brand')).toBeVisible()
      await expect(page.locator('.navbar-search-toggle')).toHaveCount(0)
      expect({ [where]: await noPageOverflow(page) }).toEqual({ [where]: true })
    }
  })

  test('typing filters and the clear control empties the query', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 })
    await seedTwo(page)
    await expect(page.locator('.grid > .card')).toHaveCount(2)

    await searchInput(page).fill('alpha')
    await expect(page.locator('.grid > .card')).toHaveCount(1)
    await expect(page.locator('.grid > .card')).toContainText('Alpha Link')

    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    await expect(page.locator('.grid > .card')).toHaveCount(2)
  })

  test('the inline field takes the bar space without collision or overflow', async ({ page }) => {
    for (const width of [320, 375, 390, 480]) {
      await page.setViewportSize({ width, height: 900 })
      await clearStorage(page)
      await seedTwo(page)

      const box = await page.evaluate(() => {
        const nav = document.querySelector('.navbar-custom').getBoundingClientRect()
        const input = document.querySelector('.navbar-search-input').getBoundingClientRect()
        const views = document.querySelector('.view-switch').getBoundingClientRect()
        const profile = document.querySelector('.identity-btn').getBoundingClientRect()
        return {
          navLeft: nav.left, navRight: nav.right,
          inputLeft: input.left, inputRight: input.right, inputHeight: input.height,
          viewsLeft: views.left,
          profileLeft: profile.left,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        }
      })
      const where = `inline @${width}`
      expect({ [where]: box.inputLeft >= box.navLeft && box.inputRight <= box.navRight }).toEqual({ [where]: true })
      expect({ [where]: box.inputRight <= box.viewsLeft }).toEqual({ [where]: true }) // no collision
      expect({ [where]: box.viewsLeft <= box.profileLeft }).toEqual({ [where]: true })
      expect({ [where]: box.inputHeight >= 32 }).toEqual({ [where]: true }) // touch-safe height
      expect({ [where]: box.overflow }).toEqual({ [where]: false })
    }
  })

  test('Escape keeps the query and the inline field keeps focus (desktop parity)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await seedTwo(page)

    await searchInput(page).fill('alpha')
    await expect(page.locator('.grid > .card')).toHaveCount(1)

    await searchInput(page).press('Escape')
    await expect(searchInput(page)).toBeVisible()
    await expect(searchInput(page)).toBeFocused()
    await expect(searchInput(page)).toHaveValue('alpha')
    // The query (and therefore the active filter) is preserved, not cleared.
    await expect(page.locator('.grid > .card')).toHaveCount(1)
  })

  test('tablet and desktop search stays always-visible and unchanged', async ({ page }) => {
    for (const width of [900, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await clearStorage(page)
      await seedTwo(page)
      const where = `desktop @${width}`

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
