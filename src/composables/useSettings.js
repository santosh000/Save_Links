import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { DEFAULT_APPEARANCE, DEFAULT_COLOR_SCHEME, APPEARANCE_VALUES, COLOR_SCHEME_VALUES } from '../utils/storage.js'
import { repository } from '../storage/repository.js'
import { bootState } from '../storage/migration.js'

export { APPEARANCE_VALUES, COLOR_SCHEME_VALUES, DEFAULT_APPEARANCE, DEFAULT_COLOR_SCHEME }

export function useSettings() {
  const bootSettings = bootState.ready && bootState.settings ? bootState.settings : null
  const appearance = ref(bootSettings ? bootSettings.appearance : DEFAULT_APPEARANCE)
  const colorScheme = ref(bootSettings ? bootSettings.colorScheme : DEFAULT_COLOR_SCHEME)

  const resolvedAppearance = computed(() => {
    if (appearance.value === 'system') {
      if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      }
      return 'light'
    }
    return appearance.value
  })

  function applyTheme() {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.setAttribute('data-appearance', resolvedAppearance.value)
    root.setAttribute('data-color-scheme', colorScheme.value)
    // also set color-scheme css property for native controls
    root.style.colorScheme = resolvedAppearance.value
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
      if (appearance.value === 'system') {
        applyTheme()
      }
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
