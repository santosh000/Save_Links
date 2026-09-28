// P5 — Link detail panel: displayed fields, missing-optional handling, emitted
// actions, rail/sheet semantics, keyboard and accessibility attributes.
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import LinkDetailPanel from './LinkDetailPanel.vue'

const LINK = {
  id: 'l1',
  title: 'React Server Components: A Complete Guide',
  originalUrl: 'https://react.dev/blog/server-components',
  normalizedUrl: 'https://react.dev/blog/server-components',
  url: 'https://react.dev/blog/server-components',
  domain: 'react.dev',
  description: 'A complete walkthrough of React Server Components.',
  image: '',
  tags: ['react', 'javascript'],
  category: 'GitHub',
  important: false,
  mustHave: false,
  favorite: false,
  pinned: true,
  type: 'article',
  folderId: 'f2',
  createdAt: '2026-09-01T12:18:00.000Z',
}

const RAW_FOLDERS = [
  { id: 'f1', name: 'Work', parentId: null },
  { id: 'f2', name: 'Engineering', parentId: 'f1' },
]
const FOLDER_OPTIONS = [
  { value: 'f1', label: 'Work' },
  { value: 'f2', label: '\u00A0\u00A0Engineering' },
]

function open(props = {}) {
  return mount(LinkDetailPanel, {
    props: { open: true, link: LINK, folders: RAW_FOLDERS, folderOptions: FOLDER_OPTIONS, overlay: false, ...props },
    attachTo: document.body,
  })
}
function cleanup(w) {
  w?.unmount()
  document.body.innerHTML = ''
}

describe('LinkDetailPanel — presentation', () => {
  it('renders nothing without a link', () => {
    const w = mount(LinkDetailPanel, { props: { open: false, link: null }, attachTo: document.body })
    expect(document.querySelector('.detail')).toBeNull()
    cleanup(w)
  })

  it('rail semantics: complementary region, no modal, no backdrop or handle', () => {
    const w = open()
    const panel = document.querySelector('.detail')
    expect(panel).not.toBeNull()
    expect(panel.getAttribute('role')).toBe('complementary')
    expect(panel.getAttribute('aria-label')).toBe('Link details')
    expect(panel.getAttribute('aria-modal')).toBeNull()
    expect(panel.classList.contains('detail--rail')).toBe(true)
    expect(document.querySelector('.detail-backdrop')).toBeNull()
    expect(document.querySelector('.sheet-handle')).toBeNull()
    cleanup(w)
  })

  it('desktop rail renders an honest placeholder before a selection (P8)', () => {
    const w = mount(LinkDetailPanel, { props: { link: null, overlay: false }, attachTo: document.body })
    const panel = document.querySelector('.detail')
    expect(panel).not.toBeNull()
    expect(panel.getAttribute('role')).toBe('complementary')
    expect(document.querySelector('.detail-empty-title').textContent).toBe('No link selected')
    expect(document.querySelector('.detail-empty-text')).not.toBeNull()
    // no real detail controls and no fake data in the placeholder state
    expect(document.querySelector('.detail-actions')).toBeNull()
    expect(document.querySelector('.detail-title')).toBeNull()
    cleanup(w)
  })

  it('sheet semantics: modal dialog with backdrop and handle; close button takes focus', async () => {
    const w = open({ overlay: true })
    await flushPromises()
    const panel = document.querySelector('.detail')
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(panel.classList.contains('detail--sheet')).toBe(true)
    expect(document.querySelector('.detail-backdrop')).not.toBeNull()
    expect(document.querySelector('.sheet-handle')).not.toBeNull()
    expect(document.activeElement).toBe(document.querySelector('.detail-close'))
    cleanup(w)
  })

  it('shows the real link fields (title, url, domain, type, category, folder path, saved, tags, description)', () => {
    const w = open()
    expect(document.querySelector('.detail-title').textContent).toBe(LINK.title)
    expect(document.querySelector('.detail-url').textContent).toBe(LINK.originalUrl)
    expect(document.querySelector('.detail-url').getAttribute('href')).toBe(LINK.normalizedUrl)
    expect(document.querySelector('.detail-badge').textContent).toBe('Article')
    const meta = document.querySelector('.detail-meta').textContent
    expect(meta).toContain('react.dev')
    expect(meta).toContain('Article')
    expect(meta).toContain('GitHub')
    expect(meta).toContain('Work / Engineering')
    const tags = [...document.querySelectorAll('.detail-tag')].map((t) => t.textContent)
    expect(tags).toEqual(['#react', '#javascript'])
    expect(document.querySelector('.detail-desc').textContent).toContain('complete walkthrough')
    cleanup(w)
  })

  it('renders the preview image when present and a type glyph when not', async () => {
    const w = open()
    expect(document.querySelector('.preview-glyph')).not.toBeNull()
    expect(document.querySelector('.detail-image')).toBeNull()
    await w.setProps({ link: { ...LINK, image: 'https://example.com/cover.png' } })
    expect(document.querySelector('.detail-image')).not.toBeNull()
    expect(document.querySelector('.detail-image').getAttribute('loading')).toBe('lazy')
    cleanup(w)
  })

  it('handles missing optional fields without inventing data', () => {
    const w = open({
      link: {
        id: 'l2',
        title: 'Bare link',
        originalUrl: 'https://example.com/bare',
        normalizedUrl: 'https://example.com/bare',
        url: 'https://example.com/bare',
        domain: '',
        description: '',
        image: '',
        tags: [],
        category: '',
        important: false,
        mustHave: false,
        favorite: false,
        pinned: false,
        type: 'other',
        folderId: null,
        createdAt: '',
      },
    })
    expect(document.querySelectorAll('.detail-tag')).toHaveLength(0)
    expect(document.querySelector('.detail-desc').textContent).toBe('—')
    const meta = document.querySelector('.detail-meta').textContent
    expect(meta).toContain('Unfiled')
    expect(meta).toContain('example.com') // derived from the URL, not stored
    cleanup(w)
  })

  it('marks the real pin / important / must-have state on the actions', async () => {
    const w = open({ link: { ...LINK, important: true, mustHave: true, pinned: false } })
    const pin = document.querySelector('[aria-label="Toggle Pin"]')
    const important = document.querySelector('[aria-label="Toggle Important"]')
    const mustHave = document.querySelector('[aria-label="Toggle Must Have"]')
    expect(pin.getAttribute('aria-pressed')).toBe('false')
    expect(important.getAttribute('aria-pressed')).toBe('true')
    expect(mustHave.getAttribute('aria-pressed')).toBe('true')
    expect(important.classList.contains('is-on')).toBe(true)
    expect(pin.classList.contains('is-on')).toBe(false)
    cleanup(w)
  })
})

describe('LinkDetailPanel — actions', () => {
  it('close button and Escape emit close', async () => {
    const w = open()
    document.querySelector('.detail-close').click()
    expect(w.emitted('close')).toHaveLength(1)
    await document.querySelector('.detail').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(w.emitted('close')).toHaveLength(2)
    cleanup(w)
  })

  it('emits pin / favorite / important / must-have / copy / share / delete with the link id', () => {
    const w = open()
    document.querySelector('[aria-label="Toggle Pin"]').click()
    document.querySelector('[aria-label="Toggle Favorite"]').click()
    document.querySelector('[aria-label="Toggle Important"]').click()
    document.querySelector('[aria-label="Toggle Must Have"]').click()
    document.querySelector('[aria-label="Copy link"]').click()
    document.querySelector('[aria-label="Share link"]').click()
    document.querySelector('[aria-label="Delete link"]').click()
    expect(w.emitted('pin')[0]).toEqual(['l1'])
    expect(w.emitted('favorite')[0]).toEqual(['l1'])
    expect(w.emitted('important')[0]).toEqual(['l1'])
    expect(w.emitted('must-have')[0]).toEqual(['l1'])
    expect(w.emitted('copy')[0]).toEqual(['l1'])
    expect(w.emitted('share')[0]).toEqual(['l1'])
    expect(w.emitted('delete')[0]).toEqual(['l1'])
    cleanup(w)
  })

  it('opens the shared edit form, saves a patch, and cancels', async () => {
    const w = open()
    document.querySelector('[aria-label="Edit link"]').click()
    await flushPromises()
    const form = document.querySelector('.edit-form')
    expect(form).not.toBeNull()
    const titleInput = form.querySelector('input')
    titleInput.value = 'Edited title'
    titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    ;[...form.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save').click()
    await flushPromises()
    const edit = w.emitted('edit')
    expect(edit).toHaveLength(1)
    expect(edit[0][0]).toBe('l1')
    expect(edit[0][1].title).toBe('Edited title')
    expect(document.querySelector('.edit-form')).toBeNull()

    document.querySelector('[aria-label="Edit link"]').click()
    await flushPromises()
    ;[...document.querySelectorAll('.edit-form button')].find((b) => b.textContent.trim() === 'Cancel').click()
    await flushPromises()
    expect(document.querySelector('.edit-form')).toBeNull()
    cleanup(w)
  })

  it('the Add tag affordance opens the same edit form', async () => {
    const w = open()
    document.querySelector('.detail-tag-add').click()
    await flushPromises()
    expect(document.querySelector('.edit-form')).not.toBeNull()
    cleanup(w)
  })

  it('Move reveals the folder picker and emits the chosen folder id', async () => {
    const w = open()
    document.querySelector('[aria-label="Move to folder"]').click()
    await flushPromises()
    const select = document.querySelector('#detail-move-folder')
    expect(select).not.toBeNull()
    select.value = 'f1'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()
    expect(w.emitted('move')[0]).toEqual(['l1', 'f1'])
    cleanup(w)
  })

  it('switching the inspected link resets the edit form and picker', async () => {
    const w = open()
    document.querySelector('[aria-label="Edit link"]').click()
    await flushPromises()
    expect(document.querySelector('.edit-form')).not.toBeNull()
    await w.setProps({ link: { ...LINK, id: 'l9', title: 'Another link' } })
    await flushPromises()
    expect(document.querySelector('.edit-form')).toBeNull()
    expect(document.querySelector('.detail-title').textContent).toBe('Another link')
    cleanup(w)
  })
})
