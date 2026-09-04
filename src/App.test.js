// UI tests for the anonymous → authenticated sync flow (App.vue).
// Tests the login transition, anonymous data detection, and sync confirmation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import App from './App.vue'
import 'fake-indexeddb/auto'

// Mock the logo image as a virtual module
vi.mock('/logo.png', () => ({ default: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==' }))

// All hoisted values must be created inside vi.hoisted
const h = vi.hoisted(() => {
  const auth = { status: 'anonymous', user: null }
  const subscribers = new Set()
  let loginResolve = null
  let initResolve = null
  const addPendingMutationMock = vi.fn()
  const syncNowMock = vi.fn()
  const anonLinks = []
  const anonFolders = []
  return {
    auth,
    subscribers,
    getState: () => ({ status: auth.status, user: auth.user, error: null }),
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn) },
    notify: () => { for (const fn of subscribers) fn(h.getState()) },
    initSession: vi.fn(() => new Promise((r) => { initResolve = r })),
    login: vi.fn(() => new Promise((r) => { loginResolve = r })),
    logout: vi.fn(() => Promise.resolve()),
    getLoginResolve: () => loginResolve,
    getInitResolve: () => initResolve,
    addPendingMutationMock,
    syncNowMock,
    anonLinks,
    anonFolders,
  }
})

// Mock all dependencies using the hoisted handles
vi.mock('./auth/session.js', () => ({
  session: {
    getState: h.getState,
    subscribe: h.subscribe,
    initSession: h.initSession,
    login: h.login,
    logout: h.logout,
  },
  initSession: h.initSession,
}))

vi.mock('./composables/useSync.js', () => ({ syncNow: h.syncNowMock, syncNowWithMutations: h.syncNowMock }))

vi.mock('./storage/repository.js', () => ({
  repository: {
    addPendingMutation: h.addPendingMutationMock.mockResolvedValue(undefined),
    getAllLinks: vi.fn(() => Promise.resolve([])),
    getAllFolders: vi.fn(() => Promise.resolve([])),
    setAllLinks: vi.fn(() => Promise.resolve()),
    setAllFolders: vi.fn(() => Promise.resolve()),
  }
}))

vi.mock('./composables/useLinks.js', () => ({
  useLinks: () => ({
    links: ref([]),
    total: 0,
    importantCount: 0,
    mustHaveCount: 0,
    favoriteCount: 0,
    byCategory: {},
    storageError: '',
    addLink: vi.fn(),
    replaceLink: vi.fn(),
    updateLink: vi.fn(),
    setStatus: vi.fn(),
    toggleImportant: vi.fn(),
    toggleMustHave: vi.fn(),
    toggleFavorite: vi.fn(),
    removeLink: vi.fn(),
    setLinks: vi.fn(),
    mergeLinks: vi.fn(),
    moveLinksFromFolder: vi.fn(),
    getAnonymousLinksCount: vi.fn(() => h.anonLinks.length),
    getAnonymousLinks: vi.fn(() => h.anonLinks),
  }),
  DuplicateLinkError: class extends Error {},
}))

vi.mock('./composables/useFolders.js', () => ({
  useFolders: () => ({
    folders: ref([]),
    folderMap: new Map(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    setFolders: vi.fn(),
    mergeFolders: vi.fn(),
    sanitizeFolders: vi.fn(),
    getAnonymousFoldersCount: vi.fn(() => h.anonFolders.length),
    getAnonymousFolders: vi.fn(() => h.anonFolders),
  }),
}))

vi.mock('./composables/useProfile.js', () => ({
  useProfile: () => ({
    profile: { name: 'Local User', bio: '' },
    updateProfile: vi.fn(),
  }),
}))

vi.mock('./composables/useSettings.js', () => ({
  useSettings: () => ({
    appearance: 'system',
    colorScheme: 'system',
    setAppearance: vi.fn(),
    setColorScheme: vi.fn(),
  }),
}))

function setAuth(status, user = null) {
  h.auth.status = status
  h.auth.user = user
  h.notify()
}

function resetAnonData() {
  h.anonLinks.length = 0
  h.anonFolders.length = 0
  h.syncNowMock.mockReset()
  h.syncNowMock.mockResolvedValue({ pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0, pulled: 0, applied: 0, skippedLocal: 0, skippedStale: 0 })
  h.addPendingMutationMock.mockClear()
  h.loginResolve = null
  h.initResolve = null
}

function mountApp() {
  return mount(App, { attachTo: document.body })
}

async function flush() {
  await flushPromises()
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
}

describe('App — anonymous → authenticated sync flow', () => {
  beforeEach(async () => {
    resetAnonData()
    h.auth.status = 'anonymous'
    h.auth.user = null
    if (h.initResolve) {
      h.initResolve(null)
      h.initResolve = null
    }
    await flush()
  })

  afterEach(async () => {
    vi.clearAllMocks()
  })

  // Helper: mount app in anonymous state, then transition to authenticated
  async function mountAndLogin(links = [], folders = []) {
    h.anonLinks.length = 0
    h.anonFolders.length = 0
    h.anonLinks.push(...links)
    h.anonFolders.push(...folders)

    // Start with anonymous
    setAuth('anonymous', null)
    if (h.initResolve) {
      h.initResolve(null)
      h.initResolve = null
    }
    await flush()

    const wrapper = mountApp()
    await flush()

    // Now transition to authenticated - this should trigger the watcher
    setAuth('authenticated', { id: 'acc-1', name: 'Test' })
    if (h.loginResolve) {
      h.loginResolve({ id: 'acc-1', name: 'Test' })
      h.loginResolve = null
    }
    await flush()

    return wrapper
  }

  describe('Anonymous login with zero local data', () => {
    it('does NOT show sync confirmation prompt', async () => {
      const wrapper = await mountAndLogin()
      // Initial sync should have run
      await flush()
      expect(wrapper.findComponent({ name: 'AppDialog' }).props('open')).toBe(false)
      wrapper.unmount()
    })

    it('triggers automatic authenticated sync exactly once', async () => {
      const wrapper = await mountAndLogin()
      await flush()
      expect(h.syncNowMock).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    })
  })

  describe('Anonymous login with local data', () => {
    it('shows confirmation prompt with correct link count', async () => {
      const wrapper = await mountAndLogin([{ id: 'link-1', account_id: null, normalizedUrl: 'https://example.com' }])
      await flush()

      const dialog = wrapper.findComponent({ name: 'AppDialog' })
      expect(dialog.props('open')).toBe(true)
      expect(dialog.props('title')).toBe('Sync your local data?')
      expect(dialog.props('message')).toContain('1 link')
      expect(dialog.props('message')).toContain('saved locally')
      wrapper.unmount()
    })

    it('shows confirmation prompt with correct folder count', async () => {
      const wrapper = await mountAndLogin([], [{ id: 'folder-1', account_id: null, name: 'Test Folder' }])
      await flush()

      const dialog = wrapper.findComponent({ name: 'AppDialog' })
      expect(dialog.props('open')).toBe(true)
      expect(dialog.props('message')).toContain('1 folder')
      wrapper.unmount()
    })

    it('shows confirmation prompt with both links and folders', async () => {
      const wrapper = await mountAndLogin(
        [{ id: 'link-1', account_id: null }, { id: 'link-2', account_id: null }],
        [{ id: 'folder-1', account_id: null }]
      )
      await flush()

      const dialog = wrapper.findComponent({ name: 'AppDialog' })
      expect(dialog.props('open')).toBe(true)
      expect(dialog.props('message')).toContain('2 links')
      expect(dialog.props('message')).toContain('1 folder')
      wrapper.unmount()
    })

    it('dialog has correct buttons: Sync & Merge (primary) and Keep Local (ghost)', async () => {
      const wrapper = await mountAndLogin([{ id: 'link-1', account_id: null }])
      await flush()

      const dialog = wrapper.findComponent({ name: 'AppDialog' })
      const buttons = dialog.props('buttons')
      expect(buttons).toHaveLength(2)
      expect(buttons[0].label).toBe('Sync & Merge')
      expect(buttons[0].variant).toBe('primary')
      expect(buttons[0].value).toBe('merge')
      expect(buttons[1].label).toBe('Keep Local')
      expect(buttons[1].variant).toBe('ghost')
      expect(buttons[1].value).toBe('keep-local')
      wrapper.unmount()
    })
  })

  describe('Keep Local choice', () => {
    it('creates update mutations to mark items as kept_local', async () => {
      const wrapper = await mountAndLogin([{ id: 'link-1', account_id: null }])
      await flush()

      await wrapper.findComponent({ name: 'AppDialog' }).vm.$emit('choose', 'keep-local')
      await flush()

      // Keep Local now marks items as kept_local via update mutations
      expect(h.addPendingMutationMock).toHaveBeenCalled()
      const calls = h.addPendingMutationMock.mock.calls
      const linkCall = calls.find(c => c[1] === 'link-1' && c[2] === 'link')
      expect(linkCall).toBeDefined()
      expect(linkCall[0]).toBe('update')
      expect(linkCall[3]).toBeDefined()
      expect(linkCall[3].kept_local).toBe(true)
      expect(linkCall[3].account_id).toBe('acc-1')
      wrapper.unmount()
    })

    it('shows "Local data kept on this device" toast', async () => {
      const wrapper = await mountAndLogin([{ id: 'link-1', account_id: null }])
      await flush()

      await wrapper.findComponent({ name: 'AppDialog' }).vm.$emit('choose', 'keep-local')
      await flush()

      // The toast might be rendered in a teleport, check the wrapper text
      expect(wrapper.text()).toContain('Local data kept on this device')
      wrapper.unmount()
    })
  })

  describe('Sync & Merge choice', () => {
    it('creates create mutations for anonymous links with correct account_id', async () => {
      const wrapper = await mountAndLogin([{ id: 'link-1', account_id: null, title: 'Test Link', normalizedUrl: 'https://example.com' }])
      await flush()

      await wrapper.findComponent({ name: 'AppDialog' }).vm.$emit('choose', 'merge')
      await flush()

      expect(h.addPendingMutationMock).toHaveBeenCalled()
      const calls = h.addPendingMutationMock.mock.calls
      const linkCall = calls.find(c => c[1] === 'link-1' && c[2] === 'link')
      expect(linkCall).toBeDefined()
      expect(linkCall[0]).toBe('create')
      expect(linkCall[3]).toBeDefined()
      expect(linkCall[3].account_id).toBe('acc-1')
      expect(linkCall[4]).toBe('acc-1')
      expect(linkCall[5]).toBe(0)
      wrapper.unmount()
    })

    it('creates create mutations for anonymous folders with correct account_id', async () => {
      const wrapper = await mountAndLogin([], [{ id: 'folder-1', account_id: null, name: 'Test Folder' }])
      await flush()

      await wrapper.findComponent({ name: 'AppDialog' }).vm.$emit('choose', 'merge')
      await flush()

      const calls = h.addPendingMutationMock.mock.calls
      const folderCall = calls.find(c => c[1] === 'folder-1' && c[2] === 'folder')
      expect(folderCall).toBeDefined()
      expect(folderCall[0]).toBe('create')
      expect(folderCall[3].account_id).toBe('acc-1')
      expect(folderCall[4]).toBe('acc-1')
      expect(folderCall[5]).toBe(0)
      wrapper.unmount()
    })

    it('calls syncNow after creating mutations', async () => {
      const wrapper = await mountAndLogin([{ id: 'link-1', account_id: null }])
      await flush()

      h.syncNowMock.mockClear()

      await wrapper.findComponent({ name: 'AppDialog' }).vm.$emit('choose', 'merge')
      await flush()

      expect(h.syncNowMock).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    })

    it('shows "Local data synced to your account" toast', async () => {
      const wrapper = await mountAndLogin([{ id: 'link-1', account_id: null }])
      await flush()

      await wrapper.findComponent({ name: 'AppDialog' }).vm.$emit('choose', 'merge')
      await flush()

      expect(wrapper.text()).toContain('Local data synced to your account')
      wrapper.unmount()
    })
  })

  describe('Session restore (already authenticated on mount)', () => {
    it('performs exactly one automatic initial sync', async () => {
      // Mount already authenticated (no login transition)
      setAuth('authenticated', { id: 'acc-1', name: 'Test' })
      if (h.initResolve) {
        h.initResolve({ id: 'acc-1', name: 'Test' })
        h.initResolve = null
      }
      await flush()

      const wrapper = mountApp()
      await flush()

      expect(h.syncNowMock).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    })

    it('does not trigger duplicate sync on subsequent auth state changes', async () => {
      setAuth('authenticated', { id: 'acc-1', name: 'Test' })
      if (h.initResolve) {
        h.initResolve({ id: 'acc-1', name: 'Test' })
        h.initResolve = null
      }
      await flush()

      const wrapper = mountApp()
      await flush()

      h.syncNowMock.mockClear()

      h.notify()
      await flush()

      expect(h.syncNowMock).not.toHaveBeenCalled()
      wrapper.unmount()
    })
  })

  describe('Logout → Login transition', () => {
    it('resets initialSyncTriggered so next login gets initial sync', async () => {
      // Start authenticated
      setAuth('authenticated', { id: 'acc-1', name: 'Test' })
      if (h.initResolve) {
        h.initResolve({ id: 'acc-1', name: 'Test' })
        h.initResolve = null
      }
      await flush()

      const wrapper = mountApp()
      await flush()

      expect(h.syncNowMock).toHaveBeenCalledTimes(1)
      h.syncNowMock.mockClear()

      // Logout
      setAuth('anonymous', null)
      await flush()

      // Login again - this should trigger the watcher
      setAuth('authenticated', { id: 'acc-1', name: 'Test' })
      if (h.loginResolve) {
        h.loginResolve({ id: 'acc-1', name: 'Test' })
        h.loginResolve = null
      }
      await flush()

      // Should trigger another initial sync
      expect(h.syncNowMock).toHaveBeenCalledTimes(1)
      wrapper.unmount()
    })

    it('resets hasPromptedForAnonymousSync so prompt appears again', async () => {
      // First login with anonymous data
      const wrapper = await mountAndLogin([{ id: 'link-1', account_id: null }])
      await flush()

      expect(wrapper.findComponent({ name: 'AppDialog' }).props('open')).toBe(true)
      await wrapper.findComponent({ name: 'AppDialog' }).vm.$emit('choose', 'keep-local')
      await flush()

      // Logout
      setAuth('anonymous', null)
      await flush()

      // Login again with same anonymous data - prompt should appear again
      setAuth('authenticated', { id: 'acc-1', name: 'Test' })
      if (h.loginResolve) {
        h.loginResolve({ id: 'acc-1', name: 'Test' })
        h.loginResolve = null
      }
      await flush()

      expect(wrapper.findComponent({ name: 'AppDialog' }).props('open')).toBe(true)
      wrapper.unmount()
    })
  })
})