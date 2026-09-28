// P9 — mockup parity cleanup contracts: sticky group headers, drawer width,
// bottom-bar height + FAB clearance, compact row structure, grid outer spacing.
import { test, expect } from '@playwright/test'
import { clearStorage, saveLink, visibleLinkRows, expectNoHorizontalScroll, ensureCardView } from './helpers.js'

// ---- seeding through the real IndexedDB store (same path as the P0 spec) ----
function seedLinks(count, { spreadHours = 12 } = {}) {
  const now = Date.now()
  return Array.from({ length: count }, (_, i) => {
    const url = `https://example.com/p9-${String(i).padStart(4, '0')}`
    return {
      id: `p9-${String(i).padStart(4, '0')}`,
      originalUrl: url, normalizedUrl: url, url, domain: 'example.com',
      title: `P9 Link ${String(i).padStart(4, '0')}`,
      description: 'P9 parity fixture.', image: '', category: 'Other', tags: ['p9'],
      important: false, mustHave: false, favorite: false, pinned: false,
      type: 'article', folderId: null, status: null,
      createdAt: new Date(now - i * spreadHours * 3600000).toISOString(), savedFrom: 'Unknown',
    }
  })
}

async function seedAndBoot(page, count, opts) {
  await clearStorage(page)
  // Seed through the app's REAL localStorage -> IndexedDB migration path (the
  // same one folders-appearance.spec.js uses). Writing straight into IndexedDB
  // can race the app's own delete/upgrade cycle after clearStorage.
  await page.evaluate((rows) => {
    localStorage.setItem('save_link:test:links', JSON.stringify(rows))
    localStorage.removeItem('save_link:test:folders')
    localStorage.removeItem('save_link:test:migration')
  }, seedLinks(count, opts))
  await page.reload()
  await expect(visibleLinkRows(page).first()).toBeVisible()
}

test.describe('P9 — sticky group headers', () => {
  test('headers park at the top edge of the content scroller at every shell width', async ({ page }) => {
    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 700 })
      await seedAndBoot(page, 40)
      // default is Compact (row mode, newest sort) -> group headers render
      await expect(page.locator('.row-list .group-h').first()).toBeAttached()
      const result = await page.evaluate(async () => {
        const sc = document.querySelector('.main-wrapper')
        const before = document.querySelector('.group-h').getBoundingClientRect().top
        sc.scrollTop = 500
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const scTop = sc.getBoundingClientRect().top
        const headers = [...document.querySelectorAll('.group-h')].map((h) => h.getBoundingClientRect())
        const visible = headers.filter((h) => h.bottom > scTop + 1 && h.top < scTop + 300)
        return {
          scrolled: sc.scrollTop,
          moved: Math.abs(before - (headers[0]?.top ?? before)) > 10,
          sticky: getComputedStyle(document.querySelector('.group-h')).position,
          top: getComputedStyle(document.querySelector('.group-h')).top,
          minVisibleTop: visible.length ? Math.round(Math.min(...visible.map((h) => h.top))) : null,
          scTop: Math.round(scTop),
        }
      })
      const where = `@${width}`
      expect(result.sticky, where).toBe('sticky')
      expect(result.top, where).toBe('0px')
      expect(result.scrolled, where).toBeGreaterThan(0)
      // the topmost visible header is flush with the scroller's top edge —
      // it must not float lower while rows scroll above it
      expect(result.minVisibleTop, where).toBe(result.scTop)
    }
  })
})

test.describe('P9 — navigation drawer width', () => {
  test('drawer is 280px / max 85vw below 1024; desktop column is unchanged', async ({ page }) => {
    for (const width of [375, 480, 768, 900, 1023]) {
      await page.setViewportSize({ width, height: 844 })
      await clearStorage(page)
      await saveLink(page, { url: 'https://example.com/drawer', title: 'Drawer Link' })
      const toggle = page.locator('#sidebar-toggle')
      if (await toggle.isVisible().catch(() => false)) await toggle.click()
      else await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'More', exact: true }).click()
      await expect(page.locator('.sidebar-wrapper')).toHaveClass(/show/)
      const drawer = await page.evaluate(() => {
        const el = document.querySelector('.sidebar-wrapper')
        const cs = getComputedStyle(el)
        return { w: Math.round(el.getBoundingClientRect().width), maxW: cs.maxWidth, vw: window.innerWidth }
      })
      expect(drawer.w, `drawer @${width}`).toBe(280)
      expect(drawer.w, `drawer fits @${width}`).toBeLessThanOrEqual(Math.floor(drawer.vw * 0.85) + 1)
    }

    // desktop static columns keep the token widths (260 below 1280, 280 from 1280)
    await page.setViewportSize({ width: 1024, height: 900 })
    await clearStorage(page)
    await saveLink(page, { url: 'https://example.com/d1', title: 'Desktop One' })
    const w1024 = await page.locator('.sidebar-wrapper').evaluate((el) => Math.round(el.getBoundingClientRect().width))
    expect(w1024).toBe(260)
    await page.setViewportSize({ width: 1280, height: 900 })
    const w1280 = await page.locator('.sidebar-wrapper').evaluate((el) => Math.round(el.getBoundingClientRect().width))
    expect(w1280).toBe(280)
  })
})

test.describe('P9 — bottom bar height and FAB clearance', () => {
  test('bar is 58px, the FAB clears it, and the content end is never covered', async ({ page }) => {
    for (const width of [390, 768, 900, 1023]) {
      await page.setViewportSize({ width, height: 844 })
      await seedAndBoot(page, 12)
      const bar = page.locator('.bottom-nav')
      await expect(bar).toBeVisible()
      const metrics = await page.evaluate(async () => {
        const b = document.querySelector('.bottom-nav').getBoundingClientRect()
        const f = document.querySelector('.fab').getBoundingClientRect()
        const sc = document.querySelector('.main-wrapper')
        sc.scrollTop = sc.scrollHeight
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const last = document.querySelector('.table-footer-control').getBoundingClientRect()
        const b2 = document.querySelector('.bottom-nav').getBoundingClientRect()
        const f2 = document.querySelector('.fab').getBoundingClientRect()
        // the FAB must never cover an interactive control
        const covered = []
        for (const el of document.querySelectorAll('a.page-link, .pagination button, .bulk-btn, .view-btn, .asel-trigger')) {
          const r = el.getBoundingClientRect()
          if (!r.width || !r.height || r.top > window.innerHeight || r.bottom < 0) continue
          if (!(r.right < f2.left || r.left > f2.right || r.bottom < f2.top || r.top > f2.bottom)) {
            covered.push((el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20))
          }
        }
        return {
          barH: Math.round(b.height),
          fabGap: Math.round(b.top - f.bottom),
          lastBottom: Math.round(last.bottom),
          barTop: Math.round(b2.top),
          covered,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }
      })
      const where = `@${width}`
      expect(metrics.barH, where).toBe(58)
      expect(metrics.fabGap, where).toBe(16)
      expect(metrics.lastBottom, where).toBeLessThanOrEqual(metrics.barTop + 1)
      expect(metrics.covered, where).toEqual([])
      expect(metrics.overflow, where).toBe(false)
    }
    await expectNoHorizontalScroll(page)
  })
})

test.describe('P9 — compact row structure', () => {
  test('compact hides the meta line and shows the right-aligned domain column', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await clearStorage(page)
    await saveLink(page, { url: 'https://example.com/compact-parity', title: 'Compact Parity Link' })
    // default view is Compact
    const row = visibleLinkRows(page).first()
    await expect(row.locator('.row-title')).toHaveText('Compact Parity Link')
    await expect(row.locator('.row-meta')).toBeHidden()
    const domain = row.locator('.row-domain-inline')
    await expect(domain).toBeVisible()
    await expect(domain).toHaveText('example.com')
    const style = await domain.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { maxW: cs.maxWidth, overflow: cs.textOverflow, size: cs.fontSize }
    })
    expect(style.maxW).toBe('120px')
    expect(style.overflow).toBe('ellipsis')
    expect(style.size).toBe('11.5px')
    // real controls stay in the row
    await expect(row.getByRole('checkbox', { name: 'Select Compact Parity Link' })).toBeVisible()
    for (const name of ['Toggle Important', 'Toggle Favorite', 'Toggle Pin', 'Edit link', 'More actions']) {
      await expect(row.getByRole('button', { name }), name).toBeVisible()
    }

    // list mode keeps the meta line and hides the inline domain
    await page.locator('.view-btn').filter({ hasText: 'List' }).click()
    const listRow = visibleLinkRows(page).first()
    await expect(listRow.locator('.row-meta')).toBeVisible()
    await expect(listRow.locator('.row-domain-inline')).toBeHidden()
  })

  test('compact row stays usable on a phone width (no overflow, controls present)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await clearStorage(page)
    await saveLink(page, { url: 'https://example.com/compact-mobile', title: 'Compact Mobile Link' })
    const row = visibleLinkRows(page).first()
    await expect(row.locator('.row-domain-inline')).toBeVisible()
    await expect(row.getByRole('button', { name: 'More actions' })).toBeVisible()
    await expectNoHorizontalScroll(page)
  })
})

test.describe('P9 — desktop grid outer spacing', () => {
  test('content column is full-bleed: no scroller inset, panel flush, header inset kept', async ({ page }) => {
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await clearStorage(page)
      await saveLink(page, { url: 'https://example.com/grid-spacing', title: 'Grid Spacing Link' })
      await ensureCardView(page)
      const m = await page.evaluate(() => {
        const cs = (s, p) => getComputedStyle(document.querySelector(s))[p]
        const panel = document.querySelector('.links-panel').getBoundingClientRect()
        const rail = document.querySelector('.detail').getBoundingClientRect()
        const header = document.querySelector('.page-header').getBoundingClientRect()
        const sc = document.querySelector('.main-wrapper').getBoundingClientRect()
        return {
          scrollerPadLeft: cs('.main-wrapper', 'paddingLeft'),
          scrollerPadTop: cs('.main-wrapper', 'paddingTop'),
          panelBorderLeft: cs('.links-panel', 'borderLeftWidth'),
          panelRadius: cs('.links-panel', 'borderTopLeftRadius'),
          headerPadLeft: parseFloat(cs('.page-header', 'paddingLeft')),
          headerPadTop: parseFloat(cs('.page-header', 'paddingTop')),
          panelLeft: Math.round(panel.left),
          scrollerLeft: Math.round(sc.left),
          panelRight: Math.round(panel.right),
          railLeft: Math.round(rail.left),
          headerLeft: Math.round(header.left),
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }
      })
      const where = `@${width}`
      expect(m.scrollerPadLeft, where).toBe('0px')
      expect(m.scrollerPadTop, where).toBe('0px')
      expect(m.panelBorderLeft, where).toBe('0px')
      expect(m.panelRadius, where).toBe('0px')
      expect(m.headerPadLeft, where).toBeGreaterThan(0)
      expect(m.headerPadTop, where).toBeGreaterThan(0)
      // the panel spans the content column and meets the rail exactly
      expect(m.panelLeft, where).toBe(m.scrollerLeft)
      expect(m.panelRight, where).toBeLessThanOrEqual(m.railLeft + 1)
      // the page header keeps its own inset inside the full-bleed column
      expect(m.headerLeft, where).toBeGreaterThanOrEqual(m.scrollerLeft)
      expect(m.overflow, where).toBe(false)
    }
  })
})

test.describe('P9 — responsive sweep (light + dark)', () => {
  test('no horizontal overflow and correct shell band at every audited width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedAndBoot(page, 12)
    for (const width of [375, 390, 430, 480, 640, 768, 820, 900, 1023, 1024, 1100, 1200, 1279, 1280, 1440]) {
      await page.setViewportSize({ width, height: width <= 480 ? 844 : 900 })
      await page.waitForTimeout(150)
      for (const dark of [false, true]) {
        await page.evaluate((d) => {
          if (d) document.documentElement.setAttribute('data-appearance', 'dark')
          else document.documentElement.removeAttribute('data-appearance')
        }, dark)
        await page.waitForTimeout(60)
        const shell = await page.evaluate(() => {
          const vis = (s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0 }
          return {
            bar: vis('.bottom-nav'),
            rail: !!document.querySelector('.detail--rail'),
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          }
        })
        const where = `@${width}${dark ? ' dark' : ''}`
        expect(shell.overflow, where).toBe(false)
        if (width < 1024) {
          expect(shell.bar, where).toBe(true)
          expect(shell.rail, where).toBe(false)
        } else {
          expect(shell.bar, where).toBe(false)
          expect(shell.rail, where).toBe(true)
        }
      }
      await page.evaluate(() => document.documentElement.removeAttribute('data-appearance'))
    }
  })
})
