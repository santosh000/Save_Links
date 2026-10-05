// P15.3 — mockup topbar: composition, view tabs, theme menu, real import/export
// and the avatar/account control. The old content-toolbar view switcher is
// intentionally gone (re-baselined in mobile-navigation.spec.js).
import { test, expect } from '@playwright/test'
import { clearStorage, installBackupCapture, saveLink, linkRowByTitle, expectNoHorizontalScroll } from './helpers.js'

const topbar = (page) => page.locator('.navbar-custom')
const viewTab = (page, label) => page.locator('.view-btn').filter({ hasText: label })
const themeSwitch = (page) => page.locator('.theme-switch')

test.describe('P15.3 — mockup topbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
  })

  test('composition matches the mockup: menu · brand · search · views · theme · import/export · avatar', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/topbar', title: 'Topbar Link' })
    const bar = topbar(page)
    await expect(bar.locator('.mobile-brand')).toBeVisible()
    await expect(bar.locator('.navbar-search-input')).toBeVisible()
    await expect(bar.locator('.view-switch .view-btn')).toHaveCount(3)
    await expect(themeSwitch(page)).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Import JSON' })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Export JSON' })).toBeVisible()
    await expect(bar.locator('.identity-btn')).toBeVisible()

    // The old content-toolbar switcher is gone; no duplicate control remains.
    await expect(page.locator('.library-controls .view-switch')).toHaveCount(0)

    // Every rebuilt topbar icon is the shared registry component (class .ic),
    // never a leftover inline SVG recipe.
    const stray = await page.evaluate(() =>
      [...document.querySelectorAll('.navbar-custom svg')].filter((s) => !s.classList.contains('ic')).length
    )
    expect(stray).toBe(0)
  })

  test('view tabs switch the real viewMode state with the approved neutral active fill', async ({ page }) => {
    await saveLink(page, { url: 'https://example.com/views', title: 'Views Link' })
    // P8 default: Compact
    await expect(page.locator('.row-list.compact')).toHaveCount(1)

    await viewTab(page, 'List').click()
    await expect(page.locator('.row-list:not(.compact)')).toHaveCount(1)
    await viewTab(page, 'Card').click()
    await expect(page.locator('.grid > .card')).toHaveCount(1)

    // Active mode = the approved neutral fill (muted surface + heading text),
    // not an accent tint.
    await page.waitForTimeout(250) // .view-btn background transitions (150ms)
    const styles = await page.evaluate(() => {
      const el = document.querySelector('.view-btn.active')
      const probe = document.createElement('div')
      probe.style.background = 'var(--muted-bg)'
      probe.style.color = 'var(--text-h)'
      document.body.appendChild(probe)
      const p = getComputedStyle(probe)
      const out = { bg: getComputedStyle(el).backgroundColor, mutedBg: p.backgroundColor, color: getComputedStyle(el).color, textH: p.color }
      probe.remove()
      return out
    })
    expect(styles.bg).toBe(styles.mutedBg)
    expect(styles.color).toBe(styles.textH)

    // The existing localStorage persistence still holds across a reload.
    await page.reload()
    await expect(page.locator('.grid > .card')).toHaveCount(1)
    await viewTab(page, 'Compact').click()
    await expect(page.locator('.row-list.compact')).toHaveCount(1)
  })

  test('theme switch toggles light/dark directly, persists, and replaces the old menu', async ({ page }) => {
    const sw = themeSwitch(page)
    await expect(sw).toBeVisible()
    await expect(sw).toHaveAttribute('role', 'switch')
    // The old Light/System/Dark dropdown is gone entirely.
    await expect(page.locator('.theme-menu')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Change theme' })).toHaveCount(0)

    // Resolved System default (light in the test browser) -> explicit dark.
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light')
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect(sw).toHaveAttribute('aria-label', 'Switch to dark mode')
    await sw.click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(sw).toHaveAttribute('aria-label', 'Switch to light mode')

    // Persisted through the existing settings blob (same storage path).
    await page.reload()
    await expect(themeSwitch(page)).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark')

    // Back to light (also restores the default for the later tests).
    await themeSwitch(page).click()
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light')
    await expect(themeSwitch(page)).toHaveAttribute('aria-checked', 'false')
  })

  test('export uses the real backup payload; import runs the real pipeline', async ({ page }) => {
    await installBackupCapture(page)
    await page.reload()
    await saveLink(page, { url: 'https://example.com/backup-me', title: 'Backup Me' })

    await topbar(page).getByRole('button', { name: 'Export JSON' }).click()
    await expect(page.getByText('Backup exported')).toBeVisible()
    // The capture stores the blob text asynchronously (same pattern as
    // clickExportAndCaptureBackup); wait for it before reading.
    await page.waitForFunction(() => window.__capturedBackups && window.__capturedBackups.length > 0)
    const payload = await page.evaluate(() =>
      JSON.parse(window.__capturedBackups[window.__capturedBackups.length - 1].text)
    )
    expect(payload.app).toBe('Save_Link')
    expect(payload.links.some((l) => l.title === 'Backup Me')).toBe(true)

    // Real import: a valid v2 backup with one new link.
    const backup = {
      app: 'Save_Link',
      version: 2,
      exportedAt: new Date().toISOString(),
      profile: {},
      settings: { appearance: 'system', colorScheme: 'none' },
      folders: [],
      links: [{
        id: 'imp1',
        originalUrl: 'https://example.com/imported',
        normalizedUrl: 'https://example.com/imported',
        url: 'https://example.com/imported',
        title: 'Imported Link',
        tags: [],
        category: 'Other',
        createdAt: new Date().toISOString(),
      }],
    }
    const file = { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }
    await page.locator('.navbar-custom input[type=file]').setInputFiles(file)
    await expect(page.getByText(/Import complete/)).toBeVisible()
    await expect(linkRowByTitle(page, 'Imported Link')).toBeVisible()

    // Duplicate import → the existing AppDialog chooses the strategy.
    await page.locator('.navbar-custom input[type=file]').setInputFiles(file)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('already exist')
    await dialog.getByRole('button', { name: 'Keep existing' }).click()
    await expect(dialog).toBeHidden()
    await expect(linkRowByTitle(page, 'Imported Link')).toHaveCount(1)
  })

  test('avatar keeps the account binding and the profile name stays available', async ({ page }) => {
    const identity = page.locator('.identity-btn')
    await expect(identity).toHaveAttribute('aria-label', 'Account menu, sign in')
    await expect(identity.locator('.identity-avatar')).toHaveText('LU')
    // The existing profile-name assertions still hold; the text is sr-only now.
    await expect(identity.locator('.identity-name')).toContainText('Local User')
    const info = await identity.locator('.identity-info').boundingBox()
    expect(info.width).toBeLessThanOrEqual(1)

    await identity.click()
    await expect(page.locator('.account-panel')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.account-panel')).toBeHidden()
  })

  test('mobile topbar keeps the mockup composition without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 844 })
    await page.reload()
    await saveLink(page, { url: 'https://example.com/mobile-topbar', title: 'Mobile Topbar' })
    await expect(page.locator('.navbar-custom .view-switch')).toBeVisible()
    await expect(themeSwitch(page)).toBeVisible()
    await expect(page.locator('.navbar-action-btn.topbar-import')).toBeHidden()
    await expect(page.locator('.navbar-action-btn.topbar-export')).toBeHidden()
    await expect(page.locator('.identity-btn')).toBeVisible()
    await expectNoHorizontalScroll(page)
  })
})
