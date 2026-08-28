// Environment detection using Vite's standard mechanism (import.meta.env.MODE)
const ENV_MAP = {
  development: 'dev',
  test: 'test',
  production: 'prod',
}

function detectEnvironment() {
  // Vite sets import.meta.env.MODE to 'development' | 'test' | 'production'
  const mode = import.meta.env?.MODE
  if (mode && ENV_MAP[mode]) return ENV_MAP[mode]
  // Fallback for Node / Vitest where process.env may be set
  if (typeof process !== 'undefined' && process.env?.NODE_ENV && ENV_MAP[process.env.NODE_ENV]) {
    return ENV_MAP[process.env.NODE_ENV]
  }
  if (typeof process !== 'undefined' && process.env?.VITEST) return 'test'
  return 'dev'
}

export const ENVIRONMENT = detectEnvironment()
export const STORAGE_PREFIX = `save_link:${ENVIRONMENT}:`

export function getStorageKey(name) {
  return `${STORAGE_PREFIX}${name}`
}

// For testing: expose mapping helper
export function getEnvironmentForMode(mode) {
  return ENV_MAP[mode] || 'dev'
}
