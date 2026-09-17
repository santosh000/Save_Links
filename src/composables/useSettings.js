import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { DEFAULT_APPEARANCE, DEFAULT_COLOR_SCHEME, APPEARANCE_VALUES, COLOR_SCHEME_VALUES } from '../utils/storage.js'
import { repository } from '../storage/repository.js'
import { bootState } from '../storage/migration.js'

export { APPEARANCE_VALUES, COLOR_SCHEME_VALUES, DEFAULT_APPEARANCE, DEFAULT_COLOR_SCHEME }

export function useSettings() {
  const bootSettings = bootState.ready && bootState.settings ? bootState.settings : null
  const appearance = ref(bootSettings ? bootSettings.appearance : DEFAULT_APPEARANCE)
  const colorScheme = ref(bootSettings ? bootSettings.colorScheme : DEFAULT_COLOR_SCHEME)

  // Reactive OS preference so System mode follows live light/dark changes.
  const systemPrefersDark = ref(
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  )

  const resolvedAppearance = computed(() => {
    if (appearance.value === 'system') return systemPrefersDark.value ? 'dark' : 'light'
    return appearance.value
  })

  function applyTheme() {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.setAttribute('data-appearance', resolvedAppearance.value)
    // "none" means no named scheme: the base theme tokens apply unchanged.
    root.setAttribute('data-color-scheme', colorScheme.value || 'none')
    // also set color-scheme css property for native controls
    root.style.colorScheme = resolvedAppearance.value
    syncBrowserChrome()
  }

  // Keep the browser/PWA chrome neutral and aligned with the page canvas.
  // --bg is the design-system source of truth, so the value is read from the
  // token rather than duplicated here. The static media-scoped <meta> tags in
  // index.html remain the no-JS / System fallback: when the token is unreadable
  // (e.g. jsdom, or a stylesheet that has not applied yet) this is a no-op and
  // the tags keep deciding. Never scheme-tinted.
  function syncBrowserChrome() {
    const canvas = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    if (!canvas) return
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', canvas)
    }
  }

  // watch and persist — both settings are written together in one settings
  // blob, so an appearance change can never clobber a colorScheme change
  watch(appearance, () => {
    persistSettings()
    applyTheme()
  })
  watch(colorScheme, () => {
    persistSettings()
    applyTheme()
  })
  watch(resolvedAppearance, () => {
    applyTheme()
  })

  function persistSettings() {
    repository.saveSettings({ appearance: appearance.value, colorScheme: colorScheme.value })
      .catch((err) => console.warn('saveSettings failed', err))
  }

  let mql = null
  let handler = null

  function setupSystemListener() {
    if (typeof window === 'undefined' || !window.matchMedia) return
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    handler = () => {
      systemPrefersDark.value = mql.matches
    }
    if (mql.addEventListener) mql.addEventListener('change', handler)
    else if (mql.addListener) mql.addListener(handler)
  }

  function cleanup() {
    if (mql && handler) {
      if (mql.removeEventListener) mql.removeEventListener('change', handler)
      else if (mql.removeListener) mql.removeListener(handler)
    }
  }

  // apply immediately (avoid flash)
  applyTheme()
  // setup listener
  if (typeof window !== 'undefined') {
    setupSystemListener()
  }

  function setAppearance(val) {
    if (!APPEARANCE_VALUES.includes(val)) throw new Error('Invalid appearance')
    appearance.value = val
  }

  function setColorScheme(val) {
    if (!COLOR_SCHEME_VALUES.includes(val)) throw new Error('Invalid color scheme')
    colorScheme.value = val
  }

  function setSettings({ appearance: a, colorScheme: c }) {
    if (a && APPEARANCE_VALUES.includes(a)) appearance.value = a
    else if (a) appearance.value = DEFAULT_APPEARANCE
    if (c && COLOR_SCHEME_VALUES.includes(c)) colorScheme.value = c
    else if (c) colorScheme.value = DEFAULT_COLOR_SCHEME
  }

  return { appearance, colorScheme, resolvedAppearance, setAppearance, setColorScheme, setSettings, applyTheme, cleanup }
}
