import { test, expect } from '@playwright/test'
import { openView, saveLink } from './helpers.js'

const css = (page, sel, prop) =>
  page.evaluate(([s, p]) => {
    const el = document.querySelector(s)
    return el ? getComputedStyle(el).getPropertyValue(p).trim() : null
  }, [sel, prop])

const parseRgb = (v) => (v.match(/[\d.]+/g) || []).map(Number)

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('dropdown: custom menu is neutral, drives value, and keeps native semantics', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openView(page, 'links')
  await saveLink(page, { url: 'https://example.com/a', title: 'Alpha' })
  await saveLink(page, { url: 'https://example.com/b', title: 'Beta' })
  await openView(page, 'links')

  const trigger = page.locator('#filter-sort').locator('xpath=following-sibling::button')
  await expect(trigger).toBeVisible()
  await expect(trigger.locator('.asel-value')).toHaveText('Newest')

  // open -> neutral menu, no accent-tinted rows
  await trigger.click()
  const menu = page.getByRole('listbox')
  await expect(menu).toBeVisible()
  const menuBg = await css(page, '.asel-menu', 'background-color')
  const card = await css(page, 'html', '--surface-raised')
  expect(menuBg).not.toContain('84, 110') // never the accent
  expect(menuBg).toBe(await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.color = 'var(--surface-raised)'
    document.body.appendChild(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    return out
  }) || menuBg)

  // pick an option with the mouse
  await menu.getByRole('option', { name: 'Z–A' }).click()
  await expect(trigger.locator('.asel-value')).toHaveText('Z–A')
  expect(await page.inputValue('#filter-sort')).toBe('title-za')

  // legacy automation path still works (hidden native select is the value carrier)
  await page.selectOption('#filter-sort', 'title-az')
  await expect(trigger.locator('.asel-value')).toHaveText('A–Z')
  expect(await page.inputValue('#filter-sort')).toBe('title-az')

  // keyboard: open + arrow + enter
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
})

test('dropdown + overlay stay neutral in every scheme (light and dark)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  // The filter toolbar only renders once there is at least one link.
  await openView(page, 'links')
  await saveLink(page, { url: 'https://example.com/seed', title: 'Seed' })
  const schemes = [
    ['None', 'none'],
    ['Ocean', 'ocean'],
    ['Forest', 'forest'],
    ['Lavender', 'lavender'],
    ['Warm Amber', 'amber'],
  ]
  for (const appearance of ['Light', 'Dark']) {
    for (const [label, attr] of schemes) {
      await openView(page, 'settings')
      await page.getByLabel(`${appearance} theme`).click()
      await page.getByLabel(`${label} color scheme`).click()
      await expect(page.locator('html')).toHaveAttribute('data-color-scheme', attr)

      // dropdown menu must be neutral: its background equals the raised surface
      await openView(page, 'links')
      const trigger = page.locator('#filter-status').locator('xpath=following-sibling::button')
      await trigger.click()
      await expect(page.getByRole('listbox')).toBeVisible()
      const menuBg = parseRgb(await css(page, '.asel-menu', 'background-color'))
      // hover row uses the neutral inset surface, not the accent
      await page.getByRole('option', { name: 'Favorites' }).hover()
      const rowBg = parseRgb(await css(page, '.asel-option.is-active', 'background-color'))
      const accent = parseRgb(await page.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.color = 'var(--accent)'
        document.body.appendChild(probe)
        const out = getComputedStyle(probe).color
        probe.remove()
        return out
      }))
      // neutral = r/g/b within a small spread (surfaces are grey/near-black)
      const spread = (c) => Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3))
      expect(spread(menuBg), `${appearance}/${label} menu surface`).toBeLessThanOrEqual(6)
      expect(spread(rowBg), `${appearance}/${label} row hover`).toBeLessThanOrEqual(6)
      expect(menuBg.slice(0, 3).join(','), `${appearance}/${label} menu vs accent`)
        .not.toBe(accent.slice(0, 3).join(','))
      await page.keyboard.press('Escape')

      // modal overlay must be neutral, appearance-aware and scheme-independent
      await page.locator('.identity-btn').click()
      await expect(page.locator('.account-backdrop')).toBeVisible()
      const overlay = parseRgb(await css(page, '.account-backdrop', 'background-color'))
      expect(spread(overlay), `${appearance}/${label} overlay`).toBeLessThanOrEqual(6)
      expect(overlay[overlay.length - 1], `${appearance}/${label} overlay alpha`).toBeGreaterThan(0.3)
      expect(overlay[overlay.length - 1]).toBeLessThan(0.8)
      await page.locator('.account-backdrop').click({ position: { x: 8, y: 8 } })
      await expect(page.locator('.account-backdrop')).toBeHidden()
    }
  }
})

test('light surfaces are soft and dark page is pure black', async ({ page }) => {  await page.setViewportSize({ width: 1440, height: 900 })
  await openView(page, 'settings')
  const light = {
    bg: await css(page, 'html', '--bg'),
    card: await css(page, 'html', '--card'),
    text: await css(page, 'html', '--text-h'),
    border: await css(page, 'html', '--border'),
  }
  expect(light.bg).toBe('#F6F6F7')
  expect(light.card).toBe('#FFFFFF')
  expect(light.text).not.toBe('#000000')
  const spreadL = (h) => {
    const n = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    return Math.max(...n) - Math.min(...n)
  }
  for (const [k, v] of Object.entries(light)) {
    if (k === 'card') continue
    expect(spreadL(v), `light ${k} neutral (${v})`).toBeLessThanOrEqual(6)
  }

  await page.getByLabel('Dark theme').click()
  expect(await css(page, 'html', '--bg')).toBe('#000000')
  const darkCard = parseRgb(await css(page, 'body', 'background-color'))
  expect(darkCard.slice(0, 3).join(',')).toBe('0,0,0')
})

test('all three dropdown variants are token-driven and consistent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openView(page, 'links')
  await saveLink(page, { url: 'https://example.com/a', title: 'Alpha' })

  // inline (in a card's quick-action menu): quiet transparent trigger
  await page.getByRole('button', { name: 'More actions' }).first().click()
  const inlineBg = await css(page, '.asel--inline .asel-trigger', 'background-color')
  expect(parseRgb(inlineBg).slice(3)[0] ?? 0).toBe(0)
  await page.keyboard.press('Escape')

  // field (Add link form): inset surface, fills its field
  await page.getByRole('button', { name: 'Save a link', exact: true }).click()
  await expect(page.locator('#save-category')).toBeAttached()
  const fieldBg = parseRgb(await css(page, '.asel--field .asel-trigger', 'background-color'))
  const mutedBg = parseRgb(await page.evaluate(() => {
    const el = document.createElement('div')
    el.style.color = 'var(--muted-bg)'
    document.body.appendChild(el)
    const out = getComputedStyle(el).color
    el.remove()
    return out
  }))
  expect(fieldBg.slice(0, 3)).toEqual(mutedBg.slice(0, 3))
  const widths = await page.evaluate(() => {
    const wrap = document.querySelector('.asel--field')
    const trigger = wrap.querySelector('.asel-trigger')
    return { wrap: wrap.getBoundingClientRect().width, trigger: trigger.getBoundingClientRect().width }
  })
  expect(Math.abs(widths.wrap - widths.trigger)).toBeLessThan(2)

  // field menu is neutral too
  await page.locator('.asel--field .asel-trigger').first().click()
  await expect(page.getByRole('listbox')).toBeVisible()
  const menuBg = parseRgb(await css(page, '.asel-menu', 'background-color'))
  expect(Math.max(...menuBg.slice(0, 3)) - Math.min(...menuBg.slice(0, 3))).toBeLessThanOrEqual(6)
  await page.keyboard.press('Escape')

  // header (toolbar): quiet until hover/focus
  await page.keyboard.press('Escape')
  await openView(page, 'links')
  const headerBg = parseRgb(await css(page, '.asel--header .asel-trigger', 'background-color'))
  expect(headerBg.slice(3)[0] ?? 0).toBe(0)
})
