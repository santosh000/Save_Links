import { test, expect } from '@playwright/test'
import { clearStorage, saveLink } from './helpers.js'

// Step 2 — mobile presentation of the Add / Edit forms. Both keep the existing
// anchoredPopover system, form components, fields, IDs and behaviour; only the
// mobile presentation differs (centred Add form, viewport-capped height with
// internal scrolling, consistent side margins).
const bottomNav = (page) => page.getByRole('navigation', { name: 'Primary' })
const addForm = (page) => page.locator('#add-form')
const editPopover = (page) => page.locator('.edit-popover')

async function openAdd(page) {
  const bottomAdd = bottomNav(page).getByRole('button', { name: 'Add', exact: true })
  if (await bottomAdd.isVisible().catch(() => false)) await bottomAdd.click()
  else await page.getByRole('button', { name: 'Save a link', exact: true }).click()
  await expect(addForm(page)).toBeVisible()
}

async function openEdit(page) {
  await page.getByRole('button', { name: 'Edit link' }).first().click()
  await expect(editPopover(page)).toBeVisible()
}

async function geometry(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    const b = el.getBoundingClientRect()
    const vh = window.visualViewport?.height ?? window.innerHeight
    const bar = document.querySelector('.bottom-nav')
    const barVisible = !!bar && getComputedStyle(bar).display !== 'none'
    const barTop = barVisible ? Math.round(bar.getBoundingClientRect().top) : null
    return {
      width: Math.round(b.width),
      height: Math.round(b.height),
      left: Math.round(b.left),
      right: Math.round(window.innerWidth - b.right),
      top: Math.round(b.top),
      bottom: Math.round(vh - b.bottom),
      vh: Math.round(vh),
      vw: window.innerWidth,
      scrolls: el.scrollHeight > el.clientHeight,
      pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      barTop,
      // The fixed mobile bottom navigation is not usable space for a popover.
      intrudesIntoBar: barTop === null ? null : Math.round(b.bottom) > barTop,
    }
  }, selector)
}

// Collect failures so a broken width is named in the assertion output.
// allowBarIntrusion is for anchored dropdown menus (AppSelect), which are
// transient overlays anchored to a control inside the form and are unchanged by
// the form-presentation work; the Add/Edit popovers themselves must not reach
// into the fixed bottom navigation.
function expectInsideViewport(box, label, { minMargin = 12, allowBarIntrusion = false } = {}) {
  const problems = []
  if (box.left < minMargin) problems.push(`left margin ${box.left}px`)
  if (box.right < minMargin) problems.push(`right margin ${box.right}px`)
  if (box.top < 0) problems.push(`top ${box.top}px (above viewport)`)
  if (box.bottom < 0) problems.push(`bottom ${box.bottom}px (below viewport)`)
  if (!allowBarIntrusion && box.intrudesIntoBar) problems.push(`reaches into the bottom navigation (bar top ${box.barTop}px)`)
  if (box.pageOverflowX) problems.push('page overflows horizontally')
  expect({ [label]: problems }).toEqual({ [label]: [] })
}

test.describe('Mobile Add/Edit form presentation', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
  })

  test('Add at 320px is centred, fits the viewport, focuses #save-url and closes', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await openAdd(page)

    const box = await geometry(page, '#add-form')
    expectInsideViewport(box, 'add 320x568')
    // Centred presentation: equal side margins.
    expect(Math.abs(box.left - box.right)).toBeLessThanOrEqual(1)
    await expect(page.locator('#save-url')).toBeFocused()

    await addForm(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(addForm(page)).toHaveCount(0)
  })

  test('Add closes on an outside pointerdown in the mobile presentation', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 844 })
    await openAdd(page)
    await expect(addForm(page)).toBeVisible()

    // Tap the top bar, which stays clear of the centred form on a phone viewport.
    await page.locator('.mobile-brand').click()
    await expect(addForm(page)).toHaveCount(0)
  })

  test('Add scrolls internally and keeps Save reachable on a short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await openAdd(page)
    await page.locator('#save-url').fill('https://example.com/short-viewport')
    await addForm(page).getByRole('button', { name: /More options/ }).click()
    await page.waitForTimeout(200)

    const box = await geometry(page, '#add-form')
    expectInsideViewport(box, 'add expanded 320x568')
    expect(box.height).toBeLessThanOrEqual(box.vh - 24) // capped to the visible viewport
    expect(box.scrolls).toBe(true) // tall form scrolls inside the popover

    // Save stays reachable (clicking scrolls the form content internally).
    await addForm(page).getByRole('button', { name: 'Save link', exact: true }).click()
    await expect(page.getByText('Link saved')).toBeVisible()
    await expect(addForm(page)).toHaveCount(0)
  })

  test('Add stays inside the viewport with the full form open at 320/375/390/430/480/768', async ({ page }) => {
    for (const width of [320, 375, 390, 430, 480, 768]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 844 })
      await openAdd(page)
      await addForm(page).getByRole('button', { name: /More options/ }).click()
      await page.waitForTimeout(200)

      const box = await geometry(page, '#add-form')
      expectInsideViewport(box, `add ${width}px`)

      for (const name of ['Cancel', 'Save link']) {
        const bb = await addForm(page).getByRole('button', { name, exact: true }).boundingBox()
        expect({ [`${name} @${width}`]: bb.y >= 0 && bb.y + bb.height <= box.vh }).toEqual({ [`${name} @${width}`]: true })
      }

      await addForm(page).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(addForm(page)).toHaveCount(0)
    }
  })

  test('Add dropdown stays inside the viewport at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await openAdd(page)

    await page.getByRole('combobox', { name: 'Category' }).click()
    await expect(page.locator('.asel-menu')).toBeVisible()
    expectInsideViewport(await geometry(page, '.asel-menu'), 'add category menu @320', { allowBarIntrusion: true })

    await page.locator('.asel-menu [role="option"]').first().click()
    await expect(page.locator('.asel-menu')).toHaveCount(0)
  })

  test('Edit at 320px, 375px and 390px fits the viewport, keeps fields usable and saves', async ({ page }) => {
    for (const width of [320, 375, 390]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 844 })
      await saveLink(page, { url: 'https://example.com/edit-me', title: 'Edit Me Link' })

      await openEdit(page)
      const box = await geometry(page, '.edit-popover')
      expectInsideViewport(box, `edit ${width}px`)

      const title = editPopover(page).getByLabel('Title')
      await expect(title).toBeVisible()
      await title.fill(`Edited @${width}`)
      await editPopover(page).getByRole('button', { name: 'Save', exact: true }).click()
      await expect(editPopover(page)).toHaveCount(0)
      await expect(page.getByText('Link updated')).toBeVisible()
      await expect(page.locator('.grid > .card').first()).toContainText(`Edited @${width}`)
    }
  })

  test('Edit at 320px cancels without saving and scrolls internally on a short window', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 })
    await saveLink(page, { url: 'https://example.com/edit-cancel', title: 'Cancel Me Link' })

    await openEdit(page)
    const box = await geometry(page, '.edit-popover')
    expectInsideViewport(box, 'edit 320x480')
    expect(box.height).toBeLessThanOrEqual(box.vh - 24)
    expect(box.scrolls).toBe(true)

    await editPopover(page).getByLabel('Title').fill('Should Not Persist')
    await editPopover(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(editPopover(page)).toHaveCount(0)
    await expect(page.locator('.grid > .card').first()).toContainText('Cancel Me Link')
  })

  test('tablet and desktop keep the anchored presentation unchanged', async ({ page }) => {
    for (const width of [900, 1280]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 900 })
      await saveLink(page, { url: 'https://example.com/desktop-forms', title: 'Desktop Forms Link' })

      // Add: desktop/tablet width, anchored (not centred)
      await openAdd(page)
      const add = await geometry(page, '#add-form')
      expect(add.width).toBe(520)
      expect(Math.abs(add.left - add.right)).toBeGreaterThan(16)
      expectInsideViewport(add, `add ${width}px`)
      await addForm(page).getByRole('button', { name: 'Cancel', exact: true }).click()

      // Edit: desktop/tablet width, anchored (not centred)
      await openEdit(page)
      const edit = await geometry(page, '.edit-popover')
      expect(edit.width).toBe(340)
      expect(Math.abs(edit.left - edit.right)).toBeGreaterThan(16)
      expectInsideViewport(edit, `edit ${width}px`)
      await editPopover(page).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(editPopover(page)).toHaveCount(0)
    }
  })
})
