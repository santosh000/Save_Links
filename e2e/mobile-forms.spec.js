import { test, expect } from '@playwright/test'
import { clearStorage, saveLink, ensureCardView } from './helpers.js'

// Step 2 / P15 Group 3 — Add / Edit form presentation. The Add form uses the
// shared modal shell (bottom sheet <768, centred panel >=768) while the Edit
// form keeps its anchored popover; field IDs, components and behaviour are
// unchanged, with viewport-capped heights and internal scrolling.
const addForm = (page) => page.locator('#add-form')
const editPopover = (page) => page.locator('.edit-popover')

async function openAdd(page) {
  // P8 shell: below the desktop grid the floating action is the single Add
  // entry point (same AddLink form); the desktop grid keeps the toolbar toggle.
  const fab = page.locator('.fab')
  if (await fab.isVisible().catch(() => false)) await fab.click()
  else await page.locator('.content-head .add-toggle').click()
  await expect(addForm(page)).toBeVisible()
  // The modal enters with a scale/translate transition; wait for it to settle
  // before any geometry read so the measured box is the final one.
  await page.locator('.dialog').evaluate((el) =>
    Promise.all([...(el.getAnimations?.() ?? [])].map((a) => a.finished.catch(() => {})))
  )
}

async function openEdit(page) {
  // P15.11: the item surface keeps a quiet action cluster; the shared edit form
  // opens from the item's own ⋮ menu (same anchored popover as before).
  await page.getByRole('button', { name: 'More actions' }).first().click()
  await page.getByRole('button', { name: 'Edit link' }).click()
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

    const box = await geometry(page, '.dialog')
    // The phone sheet is full-width by design, so edge margins are 0.
    expectInsideViewport(box, 'add 320x568', { allowBarIntrusion: true, minMargin: 0 })
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

    // The modal's backdrop owns the outside tap (the top bar is covered).
    await page.locator('.dialog-backdrop').click({ position: { x: 4, y: 4 } })
    await expect(addForm(page)).toHaveCount(0)
  })

  test('Add scrolls internally and keeps Save reachable on a short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await openAdd(page)
    await page.locator('#save-url').fill('https://example.com/short-viewport')
    await addForm(page).getByRole('button', { name: /More options/ }).click()
    await page.waitForTimeout(200)

    const box = await geometry(page, '.dialog')
    expectInsideViewport(box, 'add expanded 320x568', { allowBarIntrusion: true, minMargin: 0 })
    expect(box.height).toBeLessThanOrEqual(box.vh - 24) // capped to the visible viewport
    const bodyScrolls = await page.evaluate(() => {
      const body = document.querySelector('.dialog-message')
      return !!body && body.scrollHeight > body.clientHeight
    })
    expect(bodyScrolls).toBe(true) // tall form scrolls inside the dialog body

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

      const box = await geometry(page, '.dialog')
      expectInsideViewport(box, `add ${width}px`, { allowBarIntrusion: true, minMargin: 0 })

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

    // Category is a SaveLink-only field in the secondary "More options" block.
    await addForm(page).getByRole('button', { name: /More options/ }).click()
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
      await ensureCardView(page) // P8: the library boots in Compact

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
    await ensureCardView(page) // P8: the library boots in Compact

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

  test('tablet and desktop use the centred Add modal and keep the anchored Edit popover', async ({ page }) => {
    for (const width of [900, 1280]) {
      await clearStorage(page)
      await page.setViewportSize({ width, height: 900 })
      await saveLink(page, { url: 'https://example.com/desktop-forms', title: 'Desktop Forms Link' })
      // P8: below the desktop grid the fixed bottom bar exists; the centred
      // modal may cover it (z-modal > z-sticky), while the anchored edit
      // popover sits above it (z-popover > z-sticky).
      const anchored = width < 1024 ? { allowBarIntrusion: true } : {}

      // Add: the mockup modal model at >=768 (centred panel, radius 16)
      await openAdd(page)
      // The modal scales in; poll until the panel reaches its final width.
      await expect.poll(async () => (await geometry(page, '.dialog')).width).toBe(560)
      const add = await geometry(page, '.dialog')
      expect(Math.abs(add.left - add.right)).toBeLessThanOrEqual(1)
      expectInsideViewport(add, `add ${width}px`, anchored)
      await addForm(page).getByRole('button', { name: 'Cancel', exact: true }).click()

      // Edit: still the anchored popover (width 340)
      await openEdit(page)
      const edit = await geometry(page, '.edit-popover')
      expect(edit.width).toBe(340)
      expect(Math.abs(edit.left - edit.right)).toBeGreaterThan(16)
      expectInsideViewport(edit, `edit ${width}px`, anchored)
      await editPopover(page).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(editPopover(page)).toHaveCount(0)
    }
  })
})
