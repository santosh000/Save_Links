// The shared link-type glyph mapping must only reference real registry icons.
import { describe, it, expect } from 'vitest'
import { ICONS } from '../components/icons.js'
import { LINK_TYPE_GLYPHS, linkTypeIcon } from './linkTypeIcon.js'

describe('linkTypeIcon', () => {
  it('maps every persisted link type to a registry icon', () => {
    for (const type of ['video', 'docs', 'repo', 'tutorial', 'other']) {
      expect(linkTypeIcon(type), type).toBe(LINK_TYPE_GLYPHS[type])
      expect(ICONS[LINK_TYPE_GLYPHS[type]], `${type} -> ${LINK_TYPE_GLYPHS[type]}`).toBeTruthy()
    }
  })

  it('falls back to the neutral file glyph for unknown/missing types', () => {
    expect(linkTypeIcon()).toBe('file-text')
    expect(linkTypeIcon('nope')).toBe('file-text')
  })
})
