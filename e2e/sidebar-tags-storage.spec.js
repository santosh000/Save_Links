// P15.6 — sidebar Tags cloud + storage meter. Tags are real aggregations of the
// stored link tags (P15.2 collectTags) bound to the existing filterTag bar
// filter; the storage meter shows the real UTF-8 metadata size (P15.2
// estimateMetadataBytes) with no fabricated quota/percentage.
import { test, expect } from '@playwright/test'
import { clearStorage, openView, createFolder, saveLink, visibleLinkRows, expectNoHorizontalScroll } from './helpers.js'

const tagCloud = (page) => page.locator('[data-testid="sidebar-tag-cloud"]')
const tagPill = (page, tag) => tagCloud(page).locator('.tag-pill', { hasText: `#${tag}` })
const storageText = (page) => page.locator('[data-testid="sidebar-storage-text"]')
const sectionTitles = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.sidebar-wrapper .sidebar-menu-title')].map((t) => t.textContent.trim())
)
async function openDrawer(page) {
  const bottomNav = page.getByRole('navigation', { name: 'Primary' })
  const moreBtn = bottomNav.getByRole('button', { name: 'More', exact: true })
  if (await moreBtn.isVisible().catch(() => false)) await moreBtn.click()
  else await page.locator('#sidebar-toggle').click()
  await expect(page.locator('.sidebar-wrapper')).toHaveClass(/\bshow\b/)
}

test.describe('P15.6 — sidebar Tags + storage meter', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('Tags section renders real aggregated tags in the mockup order', async ({ page }) => {
    // No tags: the section does not invent content.
    await expect(tagCloud(page)).toHaveCount(0)

    await saveLink(page, { url: 'https://example.com/a', title: 'Alpha', tags: 'react, javascript' })
    await saveLink(page, { url: 'https://example.com/b', title: 'Beta', tags: 'react, css' })
    await saveLink(page, { url: 'https://example.com/c', title: 'Gamma', tags: 'react, css' })
    await saveLink(page, { url: 'https://example.com/d', title: 'Delta', tags: 'vue' })

    // Section order follows the mockup: Library -> Folders -> Tags. The Tools
    // section was intentionally removed; Settings is the bottom footer item.
    const titles = await sectionTitles(page)
    expect(titles.indexOf('Tags')).toBeGreaterThan(titles.indexOf('Folders'))
    expect(titles).not.toContain('Tools')

    // Real tags only, most-used first, ties alphabetical (P15.2 contract).
    await expect(tagCloud(page)).toBeVisible()
    const pills = await tagCloud(page).locator('.tag-pill').allTextContents()
    expect(pills).toEqual(['#react', '#css', '#javascript', '#vue'])

    // No inline SVG recipe in the rebuilt Tags/storage surface.
    const stray = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="sidebar-tag-cloud"] svg, [data-testid="sidebar-storage-meter"] svg')]
        .filter((s) => !s.classList.contains('ic')).length
    )
    expect(stray).toBe(0)
  })

  test('clicking a tag drives the existing filterTag state, results and chips', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/a', title: 'Alpha', tags: 'react, javascript' })
    await saveLink(page, { url: 'https://example.com/b', title: 'Beta', tags: 'react' })
    await saveLink(page, { url: 'https://example.com/c', title: 'Gamma', tags: 'vue' })
    await expect(visibleLinkRows(page)).toHaveCount(3)

    await tagPill(page, 'react').click()
    await expect(tagPill(page, 'react')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.filter-chip', { hasText: 'Tag: #react' })).toBeVisible()
    await expect(visibleLinkRows(page)).toHaveCount(2)
    await expect(visibleLinkRows(page).filter({ hasText: 'Alpha' })).toHaveCount(1)
    await expect(visibleLinkRows(page).filter({ hasText: 'Beta' })).toHaveCount(1)

    // Switching tags replaces the filter (not a second tag state).
    await tagPill(page, 'vue').click()
    await expect(tagPill(page, 'vue')).toHaveAttribute('aria-pressed', 'true')
    await expect(tagPill(page, 'react')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('.filter-chip', { hasText: 'Tag: #vue' })).toBeVisible()
    await expect(visibleLinkRows(page)).toHaveCount(1)

    // Clearing through the chip restores the complete collection.
    await page.locator('.filter-chip', { hasText: 'Tag: #vue' }).getByRole('button').click()
    await expect(page.locator('.filter-chip', { hasText: 'Tag:' })).toHaveCount(0)
    await expect(visibleLinkRows(page)).toHaveCount(3)

    // Clicking the active pill toggles it off (mockup pill behaviour).
    await tagPill(page, 'react').click()
    await expect(page.locator('.filter-chip', { hasText: 'Tag: #react' })).toBeVisible()
    await tagPill(page, 'react').click()
    await expect(page.locator('.filter-chip', { hasText: 'Tag: #react' })).toHaveCount(0)
    await expect(visibleLinkRows(page)).toHaveCount(3)
  })

  test('tag filter combines with folder navigation and survives destination changes', async ({ page }) => {
    await createFolder(page, 'Work')

    // Alpha is in Work; Beta is not.
    await openView(page, 'links')
    await page.locator('.content-head .add-toggle').click()
    await page.locator('#save-folder + .asel-trigger').click()
    await page.locator('.asel-menu').getByRole('option').filter({ hasText: 'Work' }).first().click()
    await page.locator('#save-url').fill('https://example.com/w')
    await page.locator('#save-title').fill('Work React')
    await page.getByRole('button', { name: 'More options', exact: true }).click()
    await page.locator('#save-tags').fill('react')
    await page.getByRole('button', { name: 'Save link', exact: true }).click()
    await expect(page.locator('#add-form')).toHaveCount(0)
    await saveLink(page, { url: 'https://example.com/b', title: 'Free React', tags: 'react' })
    await saveLink(page, { url: 'https://example.com/c', title: 'Vue Only', tags: 'vue' })

    // Tag + folder combine (intersection), both chips present.
    await tagPill(page, 'react').click()
    await page.locator('[data-testid="sidebar-folder-row"]', { hasText: 'Work' }).click()
    await expect(page.locator('.filter-chip', { hasText: 'Tag: #react' })).toBeVisible()
    await expect(page.locator('.filter-chip', { hasText: 'Folder: Work' })).toBeVisible()
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expect(visibleLinkRows(page).first()).toContainText('Work React')

    // Folder selection clears the Recently-Added destination but keeps the tag.
    await page.locator('.sidebar-menu-link', { hasText: 'Recently Added' }).click()
    await expect(page.locator('.filter-chip', { hasText: 'Recently added' })).toBeVisible()
    await expect(page.locator('.filter-chip', { hasText: 'Tag: #react' })).toBeVisible()
    await page.locator('[data-testid="sidebar-folder-row"]', { hasText: 'Work' }).click()
    await expect(page.locator('.filter-chip', { hasText: 'Recently added' })).toHaveCount(0)
    await expect(page.locator('.filter-chip', { hasText: 'Tag: #react' })).toBeVisible()
  })

  test('storage meter shows the real metadata size and updates with the data', async ({ page }) => {
    // Empty library: the exact real byte count of the persisted shape.
    await expect(storageText(page)).toHaveText('0 links · 25 B metadata')

    // The meter is pinned at the bottom of the sidebar, outside the scroller.
    const pinned = await page.evaluate(() => {
      const meter = document.querySelector('[data-testid="sidebar-storage-meter"]').getBoundingClientRect()
      const scroller = document.querySelector('.sidebar-menu-scroll').getBoundingClientRect()
      return meter.top >= scroller.bottom - 1
    })
    expect(pinned).toBe(true)

    await saveLink(page, { url: 'https://example.com/one', title: 'One Link' })
    const one = await storageText(page).textContent()
    expect(one).toMatch(/^1 link · \d+ B metadata$/)
    const oneBytes = Number(one.match(/(\d+) B/)[1])
    expect(oneBytes).toBeGreaterThan(22)

    await saveLink(page, { url: 'https://example.com/two', title: 'Two Link' })
    const two = await storageText(page).textContent()
    expect(two).toMatch(/^2 links · \d+ B metadata$/)
    expect(Number(two.match(/(\d+) B/)[1])).toBeGreaterThan(oneBytes)

    // No fabricated quota/percentage or progress bar anywhere.
    await expect(page.locator('.storage-fill')).toHaveCount(0)
    await expect(page.locator('.storage-meter progress')).toHaveCount(0)
    expect(two).not.toContain('%')
  })

  test('mobile drawer: tags filter and close the drawer; the meter stays truthful', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/m', title: 'Mobile Tagged', tags: 'mobile' })
    await saveLink(page, { url: 'https://example.com/p', title: 'Plain' })

    await page.setViewportSize({ width: 390, height: 900 })
    await page.reload()
    await openDrawer(page)
    await expect(tagCloud(page)).toBeVisible()
    await expect(storageText(page)).toHaveText(/^2 links · .+ metadata$/)
    await tagPill(page, 'mobile').click()
    await expect(page.locator('.sidebar-wrapper')).not.toHaveClass(/\bshow\b/)
    await expect(page.locator('.filter-chip', { hasText: 'Tag: #mobile' })).toBeVisible()
    await expect(visibleLinkRows(page)).toHaveCount(1)
    await expectNoHorizontalScroll(page)
  })
})
