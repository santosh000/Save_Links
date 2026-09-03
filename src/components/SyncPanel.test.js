// UI tests for the explicit Cloud Sync action (SyncPanel.vue, Phase 4 Chunk 6).
// Mounts the component and mocks the sync entry point + session, so behavior
// is tested without IndexedDB or a real network. The coordinator's unauthenticated
// no-op (no network) is covered by coordinator.test.js.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import SyncPanel from './SyncPanel.vue'

// vi.mock factories are hoisted, so any state they close over must be created
// with vi.hoisted and referenced via the returned handle.
const h = vi.hoisted(() => {
  const auth = { status: 'anonymous', user: null }
  const subscribers = new Set()
  return {
    auth,
    subscribers,
    getState: () => ({ status: auth.status, user: auth.user, error: null }),
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn) },
    notify: () => { for (const fn of subscribers) fn(h.getState()) },
    syncNow: vi.fn(),
  }
})

vi.mock('../composables/useSync.js', () => ({ syncNow: h.syncNow }))
vi.mock('../auth/session.js', () => ({ session: { getState: h.getState, subscribe: h.subscribe } }))

function setAuth(status, user = null) {
  h.auth.status = status
  h.auth.user = user
  h.notify()
}

const EMPTY = { pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0 }

function mountPanel() {
  return mount(SyncPanel, { attachTo: document.body })
}

describe('SyncPanel — explicit sync action', () => {
  beforeEach(() => {
    h.syncNow.mockReset()
    h.subscribers.clear()
    h.auth.status = 'anonymous'
    h.auth.user = null
  })

  it('1. renders a Sync action with an accessible name', () => {
    const wrapper = mountPanel()
    const btn = wrapper.get('button')
    expect(btn.attributes('aria-label') ?? btn.text()).toBe('Sync')
    expect(wrapper.get('button').text()).toBe('Sync')
    wrapper.unmount()
  })

  it('2. clicking Sync calls the existing sync entry point', async () => {
    setAuth('authenticated', { id: 'acc-1', name: 'A' })
    h.syncNow.mockResolvedValue(EMPTY)
    const wrapper = mountPanel()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(h.syncNow).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('3. loading state is shown while sync is in progress', async () => {
    setAuth('authenticated', { id: 'acc-1', name: 'A' })
    let resolveRun
    h.syncNow.mockImplementation(() => new Promise((r) => { resolveRun = r }))
    const wrapper = mountPanel()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    // button disabled + busy while running, status shows syncing
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button').attributes('aria-busy')).toBe('true')
    expect(wrapper.text()).toContain('Syncing')
    resolveRun({ ...EMPTY })
    await flushPromises()
    wrapper.unmount()
  })

  it('4. action is disabled/prevented from repeated UI invocation while running', async () => {
    setAuth('authenticated', { id: 'acc-1', name: 'A' })
    let resolveRun
    h.syncNow.mockImplementation(() => new Promise((r) => { resolveRun = r }))
    const wrapper = mountPanel()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await wrapper.get('button').trigger('click') // repeated click while running
    expect(h.syncNow).toHaveBeenCalledTimes(1)
    resolveRun({ ...EMPTY })
    await flushPromises()
    wrapper.unmount()
  })

  it('5. successful result is presented', async () => {
    setAuth('authenticated', { id: 'acc-1', name: 'A' })
    h.syncNow.mockResolvedValue({ ...EMPTY, pushed: 2, succeeded: 2 })
    const wrapper = mountPanel()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Synced 2 changes')
    wrapper.unmount()
  })

  it('6. conflict/rebase result is presented distinctly', async () => {
    setAuth('authenticated', { id: 'acc-1', name: 'A' })
    h.syncNow.mockResolvedValue({ ...EMPTY, pushed: 1, conflict: 1 })
    const wrapper = mountPanel()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('updated both places')
    wrapper.unmount()
  })

  it('7. failed/rejected result is presented distinctly', async () => {
    setAuth('authenticated', { id: 'acc-1', name: 'A' })
    h.syncNow.mockResolvedValue({ ...EMPTY, pushed: 1, failed: 2 })
    const wrapper = mountPanel()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('couldn\u2019t be synced')
    wrapper.unmount()
  })

  it('8. unavailable/network result is presented distinctly', async () => {
    setAuth('authenticated', { id: 'acc-1', name: 'A' })
    h.syncNow.mockResolvedValue({ ...EMPTY, pushed: 1, unavailable: 1 })
    const wrapper = mountPanel()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Sync unavailable')
    wrapper.unmount()
  })

  it('9. unexpected rejection resets loading state and shows safe error feedback', async () => {
    setAuth('authenticated', { id: 'acc-1', name: 'A' })
    h.syncNow.mockRejectedValue(new Error('boom'))
    const wrapper = mountPanel()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('button').attributes('aria-busy')).toBe('false')
    expect(wrapper.text()).toContain('could not be completed')
    // re-enabled for a subsequent attempt
    h.syncNow.mockResolvedValue({ ...EMPTY, pushed: 1, succeeded: 1 })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    expect(h.syncNow).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('10. unauth UI does not claim a successful sync (no network sync attempted here)', async () => {
    setAuth('anonymous', null)
    h.syncNow.mockResolvedValue(EMPTY)
    const wrapper = mountPanel()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    // syncNow is the coordinator no-op; the message must not claim success
    expect(wrapper.text()).toContain('Signed out')
    wrapper.unmount()
  })

  it('10b. no-pending-work message when authenticated with nothing to sync', async () => {
    setAuth('authenticated', { id: 'acc-1', name: 'A' })
    h.syncNow.mockResolvedValue(EMPTY)
    const wrapper = mountPanel()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Nothing to sync')
    wrapper.unmount()
  })
})
