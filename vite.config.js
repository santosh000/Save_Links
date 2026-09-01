import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Bakes the hashed production assets referenced by the built index.html into
// dist/sw.js, so the service worker precaches the COMPLETE app shell during
// install. Without this, an update that deletes the old cache could go
// offline before the new hashed /assets/* files had ever been requested, and
// the new HTML would reference assets the cache does not hold.
function precacheShellAssets() {
  let outDir = 'dist'
  return {
    name: 'save-links:precache-shell',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const html = readFileSync(join(outDir, 'index.html'), 'utf8')
      // exactly the same-origin static paths the generated HTML references
      // (hashed JS/CSS under /assets/, favicon, manifest) — nothing more
      const htmlAssets = [...new Set(
        [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1])
      )]
      // manifest icons are not referenced from HTML but belong to the shell
      const precache = [...htmlAssets, '/icon-192.png', '/icon-512.png']
      const swPath = join(outDir, 'sw.js')
      const sw = readFileSync(swPath, 'utf8').replace(
        '/*__PRECACHE__*/ []',
        `/*__PRECACHE__*/ ${JSON.stringify(precache)}`
      )
      writeFileSync(swPath, sw)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), precacheShellAssets()],
  test: {
    environment: 'jsdom',
    globals: true,
    environmentOptions: {
      jsdom: { url: 'http://localhost' },
    },
    include: ['src/**/*.{test,spec}.{js,ts}', 'worker/**/*.{test,spec}.{js,ts}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})