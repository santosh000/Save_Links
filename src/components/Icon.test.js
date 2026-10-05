// P15.1 — one icon system for the app: vendored lucide 0.468.0 geometry (the
// mockup's icon language) plus the Icon.vue rendering contract.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Icon from './Icon.vue'
import { ICONS, ICON_NAMES, ICON_SIZES } from './icons.js'

// The mockup's minimum icon inventory (shell, sidebar, folder tree, content,
// detail, dialog, palette) — must all exist in the registry.
const MOCKUP_ICONS = [
  'menu', 'search', 'align-justify', 'list', 'layout-grid', 'sun-moon', 'sun', 'monitor', 'moon', 'check',
  'download', 'upload', 'x', 'clipboard-list', 'star', 'clock', 'chevrons-down-up', 'folder-plus', 'settings',
  'chevron-right', 'folder', 'folder-open', 'more-vertical', 'chevron-down', 'plus', 'database', 'folder-input',
  'trash-2', 'link', 'sparkles', 'external-link', 'pencil', 'copy', 'share-2', 'pin', 'tag', 'ellipsis',
  'file-text', 'folder-off',
]
// Per-link glyphs the mockup card/detail render by link type.
const TYPE_GLYPHS = [
  'atom', 'server', 'file-code', 'palette', 'terminal', 'wind', 'zap', 'container', 'triangle', 'flame',
  'puzzle', 'gamepad-2', 'box', 'book-open', 'bar-chart-3', 'globe', 'video', 'github', 'graduation-cap',
]

const SVG_NS = 'http://www.w3.org/2000/svg'
const DRAWABLE = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']

describe('icon registry (lucide 0.468.0)', () => {
  it('contains every mockup icon name', () => {
    for (const name of [...MOCKUP_ICONS, ...TYPE_GLYPHS]) expect(ICONS[name], name).toBeTruthy()
  })

  it('maps the four sizes to the mockup values', () => {
    expect(ICON_SIZES).toEqual({ xs: 13, sm: 15, md: 18, lg: 22 })
  })

  it('every icon has drawable nodes and every node carries attributes', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(60)
    for (const [name, nodes] of Object.entries(ICONS)) {
      expect(nodes.length, name).toBeGreaterThan(0)
      for (const [tag, attrs] of nodes) {
        expect(DRAWABLE, `${name} <${tag}>`).toContain(tag)
        expect(Object.keys(attrs).length, `${name} <${tag}>`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the documented 0.468 substitutions for missing mockup names', () => {
    // more-vertical -> ellipsis-vertical (three vertical dots)
    expect(ICONS['more-vertical'].map(([t]) => t)).toEqual(['circle', 'circle', 'circle'])
    // bar-chart-3 -> chart-column (axis + three columns)
    expect(ICONS['bar-chart-3'].map(([, a]) => a.d)).toEqual(['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'])
    // folder-off -> folder-x (folder outline + x)
    expect(ICONS['folder-off']).toHaveLength(3)
  })
})

describe('Icon.vue', () => {
  it('renders the exact mockup contract', () => {
    const w = mount(Icon, { props: { name: 'star' } })
    const svg = w.find('svg')
    expect(svg.attributes('viewBox')).toBe('0 0 24 24')
    expect(svg.attributes('fill')).toBe('none')
    expect(svg.attributes('stroke')).toBe('currentColor')
    expect(svg.attributes('stroke-width')).toBe('2')
    expect(svg.attributes('stroke-linecap')).toBe('round')
    expect(svg.attributes('stroke-linejoin')).toBe('round')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('width')).toBe('18')
    expect(svg.attributes('height')).toBe('18')
  })

  it('sizes xs/sm/md/lg to 13/15/18/22', () => {
    for (const [size, px] of Object.entries(ICON_SIZES)) {
      const svg = mount(Icon, { props: { name: 'plus', size } }).find('svg')
      expect(svg.attributes('width'), size).toBe(String(px))
      expect(svg.attributes('height'), size).toBe(String(px))
    }
  })

  it('renders geometry as real SVG-namespace elements', () => {
    const w = mount(Icon, { props: { name: 'menu' } })
    const lines = w.findAll('line')
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(line.element.namespaceURI).toBe(SVG_NS)
      expect(line.attributes('x1')).toBe('4')
      expect(line.attributes('y2')).toBeTruthy()
    }
  })

  it('renders every registry icon without throwing', () => {
    for (const name of ICON_NAMES) {
      const w = mount(Icon, { props: { name } })
      expect(w.find('svg').element.children.length, name).toBeGreaterThan(0)
    }
  })

  it('unknown name renders an empty svg, warns in dev and never crashes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = mount(Icon, { props: { name: 'not-an-icon' } })
    expect(w.find('svg').exists()).toBe(true)
    expect(w.find('svg').element.children.length).toBe(0)
    expect(warn).toHaveBeenCalledWith('[Icon] unknown icon name: not-an-icon')
    warn.mockRestore()
  })

  it('passes consumer classes through for layout', () => {
    const w = mount(Icon, { props: { name: 'plus' }, attrs: { class: 'fab-glyph' } })
    expect(w.find('svg').classes()).toContain('fab-glyph')
    expect(w.find('svg').classes()).toContain('ic')
  })
})
