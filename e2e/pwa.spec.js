import { test, expect } from '@playwright/test'

// PWA foundation + offline verification against the PRODUCTION build
// (project 'pwa' serves `vite preview` of the real dist/ output). The dev
// suite (project 'chromium') runs with --mode test where the service worker
// is intentionally not registered, so this file only exists in this project.

test.describe('PWA foundation (production build)', () => {
  test('manifest is served, referenced from the app shell, and declares install fields', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest')
    expect(res.ok()).toBeTruthy()
    const manifest = await res.json()
    expect(manifest.name).toBe('Save_Links')
    expect(manifest.short_name).toBe('Save_Links')
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toBe('#4f46e5')
    const sizes = manifest.icons.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')

    const html = await (await request.get('/')).text()
    expect(html).toContain('href="/manifest.webmanifest"')
  })

  test('declared manifest icons exist in the build', async ({ request }) => {
    for (const icon of ['/icon-192.png', '/icon-512.png', '/logo.png']) {
      const res = await request.get(icon)
      expect(res.ok(), `${icon} should be served`).toBeTruthy()
      expect(res.headers()['content-type']).toContain('image/png')
    }
  })

  test('service worker is served; app registers it and loads offline after one online visit', async ({ page, context }) => {
    // Fresh-user first load: seed one localStorage link so the normal
    // localStorage -> IndexedDB migration puts real data in IndexedDB,
    // exactly like a returning v1.0.0 user.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('pwa.spec.seeded')) return
      sessionStorage.setItem('pwa.spec.seeded', '1')
      localStorage.removeItem('save_link:prod:migration')
      localStorage.setItem('save_link:prod:links', JSON.stringify([{
        id: 'p1', originalUrl: 'https://example.com/seed', normalizedUrl: 'https://example.com/seed', url: 'https://example.com/seed',
        title: 'Offline Seed', domain: 'example.com', category: 'Other', tags: [], important: false, mustHave: false, favorite: false,
        createdAt: '2023-01-01T00:00:00.000Z',
      }]))
    })

    // 1. ONLINE: app loads, data migrates to IndexedDB, SW registers.
    await page.goto('/')
    await expect(page.locator('article.card', { hasText: 'Offline Seed' })).toBeVisible()
    await page.evaluate(() => navigator.serviceWorker.ready)
    // Reload so the current page is CONTROLLED by the active service worker
    // (required for the offline reload to be served from cache).
    await page.reload()
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy()
    expect(await page.evaluate(() => caches.keys().then((k) => k.join(',')))).toContain('save-links-shell-v2')

    // 2. OFFLINE: shell + IndexedDB data both load from the installed SW.
    await context.setOffline(true)
    await page.reload()
    await expect(page.locator('article.card', { hasText: 'Offline Seed' })).toBeVisible()

    // 3. Local CRUD while offline (metadata fetch fails gracefully — save still works).
    await page.getByRole('button', { name: 'Save a link', exact: true }).click()
    await page.locator('#save-url').fill('https://example.com/offline-new')
    await page.locator('#save-title').fill('Offline New')
    await page.getByRole('button', { name: 'Save link' }).click()
    await expect(page.locator('article.card', { hasText: 'Offline New' })).toBeVisible()

    // Card scoped by position: while the edit form is open the title lives in
    // an input VALUE (not text content), so a hasText filter breaks mid-edit.
    const card = page.locator('article.card').first()
    await card.getByRole('button', { name: 'Edit link' }).click()
    await card.locator('.edit-form').locator('input').first().fill('Offline Edited')
    await card.locator('.edit-form').getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('article.card', { hasText: 'Offline Edited' })).toBeVisible()

    page.once('dialog', async (dialog) => { await dialog.accept() })
    await page.locator('article.card', { hasText: 'Offline Seed' }).getByRole('button', { name: 'Delete link' }).click()
    await expect(page.locator('article.card', { hasText: 'Offline Seed' })).toHaveCount(0)

    // 4. RELOAD OFFLINE: shell comes from cache, data survives from IndexedDB.
    await page.reload()
    await expect(page.locator('article.card', { hasText: 'Offline Edited' })).toBeVisible()
    await expect(page.locator('article.card', { hasText: 'Offline Seed' })).toHaveCount(0)
    await expect(page.locator('.stat-card', { hasText: 'Total saved' }).locator('.num')).toHaveText('1')
  })

  test('installed service worker cache holds every asset the built HTML references', async ({ page, request }) => {
    // every same-origin path the PRODUCTION HTML references = what must be
    // precached at install (hashed JS/CSS included) — the update/offline risk
    const html = await (await request.get('/')).text()
    const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1])
    expect(assets.some((a) => a.startsWith('/assets/'))).toBeTruthy()

    const swText = await (await request.get('/sw.js')).text()
    const cacheName = swText.match(/SHELL_CACHE = '([^']+)'/)[1]

    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready) // precache done before activate

    const found = await page.evaluate(async (args) => {
      const cache = await caches.open(args.cacheName)
      const result = {}
      for (const path of args.assets) result[path] = !!(await cache.match(path))
      return result
    }, { cacheName, assets })

    for (const path of assets) {
      expect(found[path], `${path} must be precached by the service worker`).toBeTruthy()
    }
  })

  test('activation deletes only save-links-shell-* caches, never unrelated ones', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready)

    // plant an obsolete Save_Links cache and an unrelated app's cache
    await page.evaluate(async () => {
      const oldShell = await caches.open('save-links-shell-v1')
      await oldShell.put('/old', new Response('old'))
      const foreign = await caches.open('unrelated-app-cache')
      await foreign.put('/x', new Response('keep'))
    })

    // force a genuinely fresh install + activate so cleanup runs. (A bare
    // unregister + register does NOT re-install: the script is byte-identical,
    // so the browser treats it as an update and returns the existing worker
    // without ever re-running activate. Reloading after unregister clears the
    // stale registration; the app then registers a brand-new worker whose
    // activate performs the cleanup.)
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.unregister()))
    await page.reload()
    await page.evaluate(() => navigator.serviceWorker.register('/sw.js'))
    await page.evaluate(() => navigator.serviceWorker.ready)

    // obsolete Save_Links cache removed, other apps' caches untouched
    await expect.poll(() => page.evaluate(async () => {
      const keys = await caches.keys()
      return {
        obsoleteShell: keys.includes('save-links-shell-v1'),
        foreign: keys.includes('unrelated-app-cache'),
        current: keys.some((k) => k.startsWith('save-links-shell-')),
      }
    })).toEqual({ obsoleteShell: false, foreign: true, current: true })
  })
})