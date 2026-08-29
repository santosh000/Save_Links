import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { repository } from './storage/repository.js'
import { boot } from './storage/migration.js'

// Boot BEFORE mounting: migrate localStorage -> IndexedDB if necessary, then
// hydrate the in-memory snapshot so the first render never shows an empty or
// pre-migration state. If boot fails (storage unavailable, migration conflict),
// render a plain fatal-error screen instead of a broken app.
async function start() {
  try {
    await boot(repository)
    createApp(App).mount('#app')
  } catch (err) {
    console.error('Save Links failed to start:', err)
    const root = document.getElementById('app')
    if (!root) return
    root.innerHTML = ''
    const box = document.createElement('div')
    box.style.cssText = 'max-width:480px;margin:80px auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.6'
    const heading = document.createElement('h1')
    heading.textContent = 'Save Links could not start'
    const detail = document.createElement('p')
    detail.textContent = String((err && err.message) || err)
    const reloadButton = document.createElement('button')
    reloadButton.type = 'button'
    reloadButton.textContent = 'Reload'
    reloadButton.addEventListener('click', () => window.location.reload())
    box.append(heading, detail, reloadButton)
    root.append(box)
  }
}

start()

// PWA app-shell service worker: register from the entry point, production
// only (never in dev/e2e-test mode). Runs on window load so it never delays
// first render; gracefully no-ops when service workers are unavailable.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err)
    })
  })
}