// Local Profile panel — edits the LOCAL user identity (name + bio) stored
// on-device. It is a thin presentational modal: it emits `save(name, bio)` /
// `close`, and the parent persists via the existing local-profile storage
// path (useProfile).
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import LocalProfilePanel from './LocalProfilePanel.vue'

function open(name = 'santosh', bio = '') {
  return mount(LocalProfilePanel, { props: { open: true, name, bio }, attachTo: document.body })
}
function cleanup(w) {
  w?.unmount()
  document.body.innerHTML = ''
}

describe('LocalProfilePanel — open / display', () => {
  it('is not rendered when closed', () => {
    const w = mount(LocalProfilePanel, { props: { open: false, name: 'x' }, attachTo: document.body })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    w.unmount()
  })

  it('opens the panel when open prop is true', () => {
    const w = open()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    cleanup(w)
  })

  it('shows the current local name in the input', () => {
    const w = open('santosh')
    expect(document.querySelector('#lp-name').value).toBe('santosh')
    cleanup(w)
  })

  it('shows the current local bio in the bio field', () => {
    const w = open('santosh', 'My bio text')
    expect(document.querySelector('#lp-bio').value).toBe('My bio text')
    cleanup(w)
  })

  it('provides an accessible dialog name/title and input label', () => {
    const w = open()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.querySelector('#lp-title').textContent).toContain('Local Profile')
    expect(document.querySelector('#lp-name').closest('.lp-field').querySelector('label').getAttribute('for')).toBe('lp-name')
    cleanup(w)
  })

  it('close button has an accessible label', () => {
    const w = open()
    const btn = document.querySelector('.lp-close')
    expect(btn.getAttribute('aria-label')).toBe('Close')
    btn.click()
    expect(w.emitted('close')).toBeTruthy()
    cleanup(w)
  })
})

describe('LocalProfilePanel — editing behavior', () => {
  it('allows the name to be edited', async () => {
    const w = open('old')
    const input = document.querySelector('#lp-name')
    input.value = 'New Name'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(input.value).toBe('New Name')
    cleanup(w)
  })

  it('Cancel closes the panel without saving changes', async () => {
    const w = open('keeps')
    const input = document.querySelector('#lp-name')
    input.value = 'changed'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel').click()
    expect(w.emitted('save')).toBeFalsy()
    expect(w.emitted('close')).toBeTruthy()
    cleanup(w)
  })

  it('Save emits the new local name and bio, then closes the panel', async () => {
    const w = open('santosh', 'old bio')
    const input = document.querySelector('#lp-name')
    input.value = 'Santo Sh'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const bioInput = document.querySelector('#lp-bio')
    bioInput.value = 'A helpful bio'
    bioInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(w.emitted('save')).toBeTruthy()
    expect(w.emitted('save')[0][0]).toBe('Santo Sh')
    expect(w.emitted('save')[0][1]).toBe('A helpful bio')
    expect(w.emitted('close')).toBeTruthy()
    cleanup(w)
  })

  it('emits the current bio untouched when the bio is not edited', async () => {
    const w = open('santosh', 'Keep this bio')
    const input = document.querySelector('#lp-name')
    input.value = 'Renamed'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(w.emitted('save')[0][0]).toBe('Renamed')
    expect(w.emitted('save')[0][1]).toBe('Keep this bio')
    cleanup(w)
  })

  it('bio can be edited independently of the name', async () => {
    const w = open('santosh')
    const bioInput = document.querySelector('#lp-bio')
    bioInput.value = 'New bio only'
    bioInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(w.emitted('save')[0][0]).toBe('santosh') // name unchanged
    expect(w.emitted('save')[0][1]).toBe('New bio only')
    cleanup(w)
  })

  it('an empty name falls back to the default local name (matches existing profile behavior)', async () => {
    const w = open('anything')
    const input = document.querySelector('#lp-name')
    input.value = '   '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(w.emitted('save')[0][0]).toBe('Local User')
    cleanup(w)
  })

  it('clicking the backdrop closes the panel without saving', async () => {
    const w = open()
    const input = document.querySelector('#lp-name')
    input.value = 'z'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelector('.lp-backdrop').dispatchEvent(new MouseEvent('click'))
    expect(w.emitted('save')).toBeFalsy()
    expect(w.emitted('close')).toBeTruthy()
    cleanup(w)
  })

  it('Escape closes the panel', async () => {
    const w = open()
    document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(w.emitted('close')).toBeTruthy()
    cleanup(w)
  })

  it('save button is labelled clearly', () => {
    const w = open()
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save changes')
    expect(save).toBeTruthy()
    cleanup(w)
  })
})
