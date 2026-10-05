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
    // no real detail content and no fake data in the placeholder state
    expect(document.querySelector('.detail-preview')).toBeNull()
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

  it('renders the approved top action order with one control family', () => {
    const w = open()
    const actions = [...document.querySelectorAll('.detail-top-actions [aria-label]')]
    expect(actions.map((el) => el.getAttribute('aria-label'))).toEqual([
      'Open link', 'Copy link', 'Edit link', 'Share link', 'Move to folder', 'Delete link',
    ])
    // one recipe for every top action; Close is NOT part of the group
    for (const el of actions) expect(el.classList.contains('navbar-action-btn')).toBe(true)
    expect(document.querySelector('.detail-top-actions [aria-label="Close details"]')).toBeNull()
    const close = document.querySelector('.detail-close')
    expect(close.getAttribute('aria-label')).toBe('Close details')
    expect(close.classList.contains('navbar-action-btn')).toBe(true)
    // the old large Open CTA is gone
    expect(document.querySelector('.detail-open')).toBeNull()
    // Favorite/Pinned are not in the action row; they sit after title + URL and
    // before the metadata.
    expect(document.querySelector('.detail-top-actions [aria-label="Toggle Favorite"]')).toBeNull()
    expect(document.querySelectorAll('.detail-state .type-pill')).toHaveLength(2)
    const url = document.querySelector('.detail-url')
    const state = document.querySelector('.detail-state')
    const meta = document.querySelector('.detail-meta')
    expect(url.compareDocumentPosition(state) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(state.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    cleanup(w)
  })

  it('marks the real favorite / pin state on the dedicated state controls', async () => {
    const w = open({ link: { ...LINK, favorite: true, pinned: false } })
    const pin = document.querySelector('[aria-label="Toggle Pin"]')
    const favorite = document.querySelector('[aria-label="Toggle Favorite"]')
    expect(pin.getAttribute('aria-pressed')).toBe('false')
    expect(favorite.getAttribute('aria-pressed')).toBe('true')
    expect(favorite.classList.contains('active')).toBe(true)
    expect(pin.classList.contains('active')).toBe(false)
    // Important / Must Have left the detail UI entirely (data stays persisted).
    expect(document.querySelector('[aria-label="Toggle Important"]')).toBeNull()
    expect(document.querySelector('[aria-label="Toggle Must Have"]')).toBeNull()
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

  it('emits pin / favorite / copy / share / delete with the link id', () => {
    const w = open()
    document.querySelector('[aria-label="Toggle Pin"]').click()
    document.querySelector('[aria-label="Toggle Favorite"]').click()
    document.querySelector('[aria-label="Copy link"]').click()
    document.querySelector('[aria-label="Share link"]').click()
    document.querySelector('[aria-label="Delete link"]').click()
    expect(w.emitted('pin')[0]).toEqual(['l1'])
    expect(w.emitted('favorite')[0]).toEqual(['l1'])
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

  it('Edit and Move toggle back to detail from their own action (one mode at a time)', async () => {
    const w = open()
    const editBtn = document.querySelector('[aria-label="Edit link"]')
    const moveBtn = document.querySelector('[aria-label="Move to folder"]')

    // Edit -> Edit again: detail mode, draft discarded, nothing saved.
    editBtn.click()
    await flushPromises()
    expect(document.querySelector('.edit-form')).not.toBeNull()
    expect(editBtn.getAttribute('aria-expanded')).toBe('true')
    editBtn.click()
    await flushPromises()
    expect(document.querySelector('.edit-form')).toBeNull()
    expect(w.emitted('edit')).toBeUndefined()
    expect(editBtn.getAttribute('aria-expanded')).toBe('false')

    // Move -> Move again: detail mode, picker closed, nothing moved.
    moveBtn.click()
    await flushPromises()
    expect(document.querySelector('#detail-move-folder')).not.toBeNull()
    moveBtn.click()
    await flushPromises()
    expect(document.querySelector('#detail-move-folder')).toBeNull()
    expect(w.emitted('move')).toBeUndefined()

    // Single mode: opening Move while editing replaces the editor.
    editBtn.click()
    await flushPromises()
    moveBtn.click()
    await flushPromises()
    expect(document.querySelector('.edit-form')).toBeNull()
    expect(document.querySelector('#detail-move-folder')).not.toBeNull()
    expect(moveBtn.getAttribute('aria-expanded')).toBe('true')
    expect(editBtn.getAttribute('aria-expanded')).toBe('false')
    cleanup(w)
  })

  it('the Add tag affordance opens the inline tag editor (not the edit form)', async () => {
    const w = open()
    document.querySelector('.detail-tag-add').click()
    await flushPromises()
    expect(document.querySelector('.edit-form')).toBeNull()
    expect(document.querySelector('#detail-tag-editor').className).toMatch(/\bopen\b/)

    const input = document.querySelector('#detail-tag-input')
    input.value = 'three'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(w.emitted('edit')[0]).toEqual(['l1', { tags: ['react', 'javascript', 'three'] }])

    // collapsing returns to the plain detail view
    document.querySelector('.detail-tag-add').click()
    await flushPromises()
    expect(document.querySelector('#detail-tag-editor').className).not.toMatch(/\bopen\b/)
    cleanup(w)
  })

  it('Move reveals the folder picker and commits the chosen folder id', async () => {
    const w = open()
    document.querySelector('[aria-label="Move to folder"]').click()
    await flushPromises()
    const select = document.querySelector('#detail-move-folder')
    expect(select).not.toBeNull()
    select.value = 'f1'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()
    // Move mode commits through its explicit Move button.
    const move = [...document.querySelectorAll('.detail-move button')].find((b) => b.textContent.trim() === 'Move')
    expect(move).not.toBeUndefined()
    move.click()
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
