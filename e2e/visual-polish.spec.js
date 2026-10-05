import { test, expect } from '@playwright/test'
import { clearStorage, ensureAddLinkOpen, openView, saveLink, ensureCardView } from './helpers.js'

// Step 2C-6 contract (visual polish):
// 1. the sidebar active indicator is a straight rail (no curved leading edge)
// 2. the search keycap reads as a compact key, not a pill, and never affects layout
// 3. bordered form controls show exactly ONE focus boundary: their own accent
//    border. No outer outline, no box-shadow halo, no second ring — while the
//    focused state stays clearly distinguishable (border contrast >= 3:1).
//    Non-form controls keep the shared global outline.
const tokens = (page) =>
  page.evaluate(() => {
    const probe = document.createElement('div')
    document.body.appendChild(probe)
    const read = (v, prop) => {
      probe.style.setProperty(prop, `var(${v})`)
      return getComputedStyle(probe).getPropertyValue(prop)
    }
const out = {
text: read('--text', 'color'),
textSm: read('--text-sm', 'font-size'),
bg: read('--bg', 'background-color'),
muted: read('--muted', 'color'),
mutedBg: read('--muted-bg', 'background-color'),
card: read('--card', 'background-color'),
textH: read('--text-h', 'color'),
border: read('--border', 'border-top-color'),
borderStrong: read('--border-strong', 'border-top-color'),
accent: read('--accent', 'color'),
shadowSm: read('--shadow-sm', 'box-shadow'),
shadowMd: read('--shadow-md', 'box-shadow'),
shadowLg: read('--shadow-lg', 'box-shadow'),
accentBorder: read('--accent-border', 'border-top-color'),
sidebarActiveBg: read('--sidebar-active-bg', 'background-color'),
sm: read('--radius-sm', 'border-top-left-radius'),
radius: read('--radius', 'border-top-left-radius'),
}
    probe.remove()
    return out
  })

const contrast = (page, a, b) =>
  page.evaluate(([x, y]) => {
    const lum = (c) => {
      const [r, g, bl] = c.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl
    }
    const [l1, l2] = [lum(x), lum(y)].sort((m, n) => n - m)
    return (l1 + 0.05) / (l2 + 0.05)
  }, [a, b])

const rectOf = (page, sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect()
    return { h: Math.round(r.height), w: Math.round(r.width) }
  }, sel)

test.describe('Visual polish (Step 2C-6)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('sidebar active state is the mockup soft accent block (no rail, no shift)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    const t = await tokens(page)

    // P7 re-baseline: the mockup marks the active nav row with a soft accent
    // fill + accent text + filled count pill (supersedes the 2C-6 rail).
    const active = page.locator('.sidebar-menu-link.active')
    await expect(active).toHaveCSS('border-inline-start-width', '0px')
    await expect(active).toHaveCSS('background-color', t.sidebarActiveBg)
    await expect(active).toHaveCSS('color', t.accent)
    await expect(active).toHaveCSS('border-start-start-radius', t.sm)
    await expect(active).toHaveCSS('border-start-end-radius', t.sm)
    await expect(active).toHaveCSS('min-height', '44px') // P15.4: mockup nav item
    await expect(active).toHaveCSS('font-weight', '500')
    await expect(active).toHaveCSS('padding-left', '10px') // compact mockup row

    // Inactive rows stay unfilled and muted (no layout shift between rows).
    const inactive = page.locator('.sidebar-menu-link:not(.active)').first()
    await expect(inactive).toHaveCSS('border-inline-start-width', '0px')
    await expect(inactive).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(inactive).toHaveCSS('min-height', '44px') // P15.4: mockup nav item
  })

  test('search keycap is a compact key and never affects search geometry', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    const t = await tokens(page)

    const kbd = page.locator('.navbar-search-kbd')
    await expect(kbd).toBeVisible()
    await expect(kbd).toHaveCSS('border-top-width', '1px')
    // P7: mockup keycap values (surface + faint text + 11px), still absolutely
    // positioned so it can never affect search geometry.
    await expect(kbd).toHaveCSS('background-color', await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--card)'
      document.body.appendChild(probe)
      const out = getComputedStyle(probe).color
      probe.remove()
      return out
    }))
    expect(parseFloat(await kbd.evaluate((el) => getComputedStyle(el).borderRadius))).toBeLessThan(6)
    await expect(kbd).toHaveCSS('color', await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--text-subtle)'
      document.body.appendChild(probe)
      const out = getComputedStyle(probe).color
      probe.remove()
      return out
    }))
    expect(t.text).not.toBe(t.muted)
    await expect(kbd).toHaveCSS('font-size', '11px')
    await expect(kbd).toHaveCSS('position', 'absolute') // cannot contribute to layout
    await expect(kbd).toHaveCSS('pointer-events', 'none')

    // geometry is identical with the keycap shown and hidden
    const visible = await rectOf(page, '.navbar-search-wrapper')
    const inputVisible = await rectOf(page, '.navbar-search-input')
    await page.locator('.navbar-search-input').click() // focused -> keycap hidden
    await expect(kbd).toBeHidden()
    expect(await rectOf(page, '.navbar-search-wrapper')).toEqual(visible)
    expect(await rectOf(page, '.navbar-search-input')).toEqual(inputVisible)
  })

  test('focused form controls show ONE boundary: the accent border, no outline or halo', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    const t = await tokens(page)

    const check = async (locator, label) => {
      const resting = await locator.evaluate((el) => getComputedStyle(el).borderTopColor)
      expect(resting, `${label} is not accent before focus`).not.toBe(t.accent)
      await page.keyboard.press('Tab')
      await locator.focus()
      await expect(locator, label).toHaveCSS('outline-style', 'none') // no separate outer ring
      await expect(locator, label).toHaveCSS('box-shadow', 'none') // no halo
      for (const side of ['top', 'right', 'bottom', 'left']) {
        await expect(locator, `${label} ${side} border`).toHaveCSS(`border-${side}-color`, t.accent)
      }
      // the single boundary must be perceivable against both surfaces
      expect(await contrast(page, t.accent, t.card), `${label} accent vs card`).toBeGreaterThanOrEqual(3)
      expect(await contrast(page, t.accent, t.mutedBg), `${label} accent vs inset surface`).toBeGreaterThanOrEqual(3)
    }

    const search = page.locator('.navbar-search-input')
    await check(search, 'search')
    // toolbar select (sort/filter) renders once a link exists; check it before the
    // Add popover opens so its focus trap cannot bounce focus back
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await check(page.locator('.asel--header .asel-trigger').first(), 'sort/filter select')

    await ensureAddLinkOpen(page, { more: true })
    for (const sel of ['#save-desc', '#save-title', '#save-url', '#add-form .asel--field .asel-trigger']) {
      await check(page.locator(sel).first(), sel)
    }

    // non-form controls still use the shared global outline
    const navItem = page.locator('.sidebar-menu-link').nth(1)
    await page.keyboard.press('Tab')
    await navItem.focus()
    await expect(navItem).toHaveCSS('outline-style', 'solid')
    await expect(navItem).toHaveCSS('outline-width', '2px')
  })

  test('the same polish holds in dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await openView(page, 'settings')
    await page.getByLabel('Dark theme').click()

    const t = await tokens(page)
    expect(t.text).not.toBe(t.muted)

    const kbd = page.locator('.navbar-search-kbd')
    await expect(kbd).toHaveCSS('color', await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--text-subtle)'
      document.body.appendChild(probe)
      const out = getComputedStyle(probe).color
      probe.remove()
      return out
    }))
    await expect(kbd).toHaveCSS('background-color', await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--card)'
      document.body.appendChild(probe)
      const out = getComputedStyle(probe).color
      probe.remove()
      return out
    }))
    expect(parseFloat(await kbd.evaluate((el) => getComputedStyle(el).borderRadius))).toBeLessThan(6)

    const active = page.locator('.sidebar-menu-link.active')
    await expect(active).toHaveCSS('color', t.accent)
    await expect(active).toHaveCSS('background-color', t.sidebarActiveBg)

    const search = page.locator('.navbar-search-input')
    await search.focus()
    await expect(search).toHaveCSS('border-top-color', t.accent)
    await expect(search).toHaveCSS('outline-style', 'none')
    await expect(search).toHaveCSS('box-shadow', 'none')
    expect(await contrast(page, t.accent, t.card)).toBeGreaterThanOrEqual(3)
    expect(await contrast(page, t.accent, t.mutedBg)).toBeGreaterThanOrEqual(3)
  })
})

test.describe('Toast (P15.9 mockup pill)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('every toast uses the mockup pill recipe and keeps its behaviour', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    const t = await tokens(page)

    // P15.9 re-baseline: the mockup replaces the old "quiet accent edge" recipe
    // with an inverted pill (--text on --bg, radius 24, --shadow-lg, no border).
    const recipe = async (toast, label) => {
      const box = await toast.boundingBox()
      expect(box.height, `${label} stays compact`).toBeLessThanOrEqual(44)
      const radius = parseFloat(await toast.evaluate((el) => getComputedStyle(el).borderRadius))
      expect(radius, `${label} mockup pill radius`).toBe(24)
      await expect(toast).toHaveCSS('box-shadow', t.shadowLg) // mockup elevation
      await expect(toast).toHaveCSS('border-top-width', '0px') // no border, no accent edge
      await expect(toast).toHaveCSS('border-left-width', '0px')
      await expect(toast).toHaveCSS('background-color', t.text) // inverted: --text on --bg
      await expect(toast).toHaveCSS('color', t.bg)
      await expect(toast).toHaveCSS('padding', '10px 20px')
      await expect(toast).toHaveCSS('font-size', t.textSm) // --text-sm maps the mockup's 13px
      await expect(toast).toHaveCSS('font-weight', '500')
      await expect(toast).toHaveCSS('text-align', 'center')
      await expect(toast).toHaveCSS('position', 'fixed') // still an overlay
      await expect(toast).toHaveAttribute('role', 'status')
      await expect(toast).toHaveAttribute('aria-live', 'polite')
      // long real messages wrap instead of clipping: the pill is capped in viewport units
      const cap = await toast.evaluate((el) => ({ max: parseFloat(getComputedStyle(el).maxWidth), vw: window.innerWidth }))
      expect(cap.max).toBeLessThanOrEqual(cap.vw * 0.9 + 1)
      expect(box.x, `${label} inside viewport`).toBeGreaterThanOrEqual(0)
      return radius
    }

    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    const success = page.locator('.sl-toast')
    await expect(success).toContainText('Link saved')
    const successRadius = await recipe(success, 'Link saved')
    await expect(success).toHaveCount(0) // existing auto-dismiss timing untouched

    await page.getByRole('button', { name: 'More actions' }).first().click()
    const menu = page.locator('.more-menu').first()
    await expect(menu).toBeVisible()
    await menu.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    const deleted = page.locator('.sl-toast')
    await expect(deleted).toContainText('Link deleted')
    const deleteRadius = await recipe(deleted, 'Link deleted')
    expect(deleteRadius, 'one shared recipe for every message').toBe(successRadius)
  })

  test('the toast recipe holds in dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await openView(page, 'settings')
    await page.getByLabel('Dark theme').click()

    const t = await tokens(page)
    await openView(page, 'links')
    await saveLink(page, { url: 'https://example.com/beta', title: 'Beta Link' })
    const toast = page.locator('.sl-toast')
    await expect(toast).toContainText('Link saved')
    expect(parseFloat(await toast.evaluate((el) => getComputedStyle(el).borderRadius))).toBe(24)
    await expect(toast).toHaveCSS('box-shadow', t.shadowLg)
    await expect(toast).toHaveCSS('background-color', t.text) // still inverted in dark
    await expect(toast).toHaveCSS('color', t.bg)
    await expect(toast).toHaveCSS('border-top-width', '0px')
  })
})

// Step 2C-8 audit follow-up: Bootstrap's own focus resets were beating the shared
// ring on .btn (invisible keyboard focus) and painting an off-palette halo plus a
// fixed light background on .page-link (worst in dark). Both now use the shared
// accent ring. These tests pin the whole interaction-state contract.
test.describe('Interaction states (Step 2C-8)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  const ring = async (locator, label, offset = '2px', boxShadow = 'none') => {
    await expect(locator, label).toHaveCSS('outline-style', 'solid')
    await expect(locator, label).toHaveCSS('outline-width', '2px')
    await expect(locator, label).toHaveCSS('outline-offset', offset)
    // never a focus halo — a raised control keeps only its resting elevation
    await expect(locator, label).toHaveCSS('box-shadow', boxShadow)
  }
  const kfocus = async (page, locator) => {
    await page.keyboard.press('Tab')
    await locator.focus()
  }

  test('keyboard focus, hover and menu states stay consistent (light)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    const t = await tokens(page)
    await saveLink(page, { url: 'https://example.com/alpha', title: 'Alpha Link' })
    await ensureCardView(page) // P8: the library boots in Compact
    await page.waitForTimeout(2600)

    // card controls (do this before the Add popover opens — it would cover them)
    const bannerAction = page.locator('.banner-action').first()
    await kfocus(page, bannerAction)
    // the raised banner circle keeps its resting elevation, never a focus halo
    await ring(bannerAction, 'banner-action', '1px', t.shadowSm)
    // P15.11: the item status toggles are the mockup banner/row recipes, so
    // they carry the same focus ring.
    const star = page.getByRole('button', { name: 'Toggle Favorite' }).first()
    await kfocus(page, star)
    await ring(star, 'favorite-toggle', '1px', t.shadowSm)

    // card hover = the mockup's stronger edge + one elevation step
    const card = page.locator('.card').first()
    await card.scrollIntoViewIfNeeded()
    await card.hover({ position: { x: 24, y: 24 } })
    await expect(card).toHaveCSS('border-top-color', t.borderStrong)
    await expect(card).toHaveCSS('box-shadow', t.shadowMd)

    // quick-action menu surface + icon family
    const trigger = page.getByRole('button', { name: 'More actions' }).first()
    await trigger.click()
    const menu = page.locator('.more-menu').first()
    await expect(menu).toBeVisible()
    await expect(menu).toHaveCSS('box-shadow', t.shadowMd)
    await expect(menu).toHaveCSS('border-top-left-radius', t.radius) // popover panel radius (has embedded fields)
    const menuIcon = menu.locator('svg').first()
    await expect(menuIcon).toHaveCSS('stroke-width', '1.8px')
    await expect(menuIcon).toHaveCSS('fill', 'none')
    expect(await menuIcon.evaluate((el) => getComputedStyle(el).stroke)).not.toBe('rgb(0, 0, 0)')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused() // focus returns to the trigger

    // custom select: accent border (not a second outline), keyboard, focus return
    const sel = page.locator('.asel--header .asel-trigger').first()
    await kfocus(page, sel)
    await expect(sel).toHaveCSS('border-top-color', t.accent)
    await expect(sel).toHaveCSS('outline-style', 'none')
    await page.keyboard.press('Enter')
    await expect(sel).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.asel-option.is-active')).toBeVisible()
    await expect(page.locator('.asel-option[aria-selected="true"]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(sel).toHaveAttribute('aria-expanded', 'false')
    await expect(sel).toBeFocused() // focus returns to the trigger

    // buttons: Bootstrap's outline:0 no longer suppresses the shared ring
    await ensureAddLinkOpen(page, { more: false })
    const primary = page.locator('#add-form .btn.primary').first()
    await kfocus(page, primary)
    await ring(primary, 'btn.primary')
    const ghost = page.locator('#add-form .btn.ghost').first()
    await kfocus(page, ghost)
    await ring(ghost, 'btn.ghost')
    await ghost.click() // Cancel closes the popover deterministically
    await expect(page.locator('#add-form .btn.primary')).toHaveCount(0)
  })

  test('settings selection and focus stay distinguishable, and the ring holds (dark)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    for (let i = 0; i < 11; i++) await saveLink(page, { url: `https://example.com/a-${i}`, title: `Alpha ${i}`, expectToast: false })
    await page.waitForTimeout(2600)
    await openView(page, 'settings')
    await page.getByLabel('Dark theme').click()
    const t = await tokens(page)

    // theme tiles: selection (border+fill+text) and focus (ring) are different cues
    const selected = page.locator('.theme-opt.active')
    await expect(selected).toHaveCSS('border-top-color', t.accent)
    const radio = page.locator('input[name="appearance"]:not(:checked)').first()
    await page.keyboard.press('Tab')
    await radio.focus()
    await ring(page.locator('.theme-opt:has(input:focus-visible)'), 'theme tile focus')
    // swatches: the selected dot is marked, the unselected one is not
    await expect(page.locator('.swatch.active .swatch-dot')).toHaveCSS('outline-style', 'solid')
    await expect(page.locator('.swatch:not(.active) .swatch-dot').first()).toHaveCSS('outline-style', 'none')

    // pagination: the Bootstrap blue halo and its fixed light focus background are gone
    await openView(page, 'links')
    await ensureCardView(page) // P8: the library boots in Compact
    await page.waitForTimeout(400)
    const pageLink = page.locator('.page-item:not(.active) .page-link').first()
    await kfocus(page, pageLink)
    await ring(pageLink, 'page-link')
    await expect(pageLink).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    // buttons, card surface and icon family in dark
    await ensureAddLinkOpen(page, { more: false })
    const primary = page.locator('#add-form .btn.primary').first()
    await kfocus(page, primary)
    await ring(primary, 'dark btn.primary')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    const card = page.locator('.card').first()
    await expect(card).toHaveCSS('background-color', t.card)
    expect(await page.locator('.banner-action svg').first().evaluate((el) => getComputedStyle(el).stroke)).not.toBe('rgb(0, 0, 0)')
    await expect(page.locator('.banner-action svg').first()).toHaveCSS('stroke-width', '1.8px')
  })
})


// Step 2D: secondary surfaces (folders view, secondary labels, empty states).
test.describe('Secondary surfaces (Step 2D)', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('account panel labels are quiet supporting text', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.locator('.identity-btn').click()
    for (const sel of ['.local-profile-label', '.online-account-label']) {
      const el = page.locator(sel).first()
      await expect(el).toHaveCSS('text-transform', 'none')
      const ls = await el.evaluate((x) => getComputedStyle(x).letterSpacing)
      expect(Number.isNaN(parseFloat(ls)) ? 0 : parseFloat(ls)).toBeLessThanOrEqual(0)
    }
  })
})
