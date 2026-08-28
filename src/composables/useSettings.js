import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { loadAppearance, saveAppearance, loadColorScheme, saveColorScheme, DEFAULT_APPEARANCE, DEFAULT_COLOR_SCHEME, APPEARANCE_VALUES, COLOR_SCHEME_VALUES } from '../utils/storage.js'

export { APPEARANCE_VALUES, COLOR_SCHEME_VALUES, DEFAULT_APPEARANCE, DEFAULT_COLOR_SCHEME }

export function useSettings() {
  const appearance = ref(loadAppearance())
  const colorScheme = ref(loadColorScheme())

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

  // watch and persist
  watch(appearance, (v) => {
    saveAppearance(v)
    applyTheme()
  })
  watch(colorScheme, (v) => {
    saveColorScheme(v)
    applyTheme()
  })
  watch(resolvedAppearance, () => {
    applyTheme()
  })

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
