// The mockup's link-type → icon mapping, shared by every surface that shows a
// link's type glyph (detail preview, list rows, compact rows, cards) so the
// same link reads the same everywhere. Names are registry keys from
// src/components/icons.js (asserted by the unit test).
export const LINK_TYPE_GLYPHS = {
  video: 'video',
  docs: 'book-open',
  repo: 'github',
  tutorial: 'graduation-cap',
  other: 'file-text',
}

export function linkTypeIcon(type) {
  return LINK_TYPE_GLYPHS[type] || LINK_TYPE_GLYPHS.other
}
