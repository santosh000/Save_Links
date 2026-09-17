import { describe, it, expect } from 'vitest'
import { paginationLabel } from './pagination.js'

const SIZE = 10

describe('paginationLabel', () => {
  it('shows 0 of 0 when there are no results', () => {
    expect(paginationLabel(0, 1, SIZE)).toBe('Showing 0 of 0 links')
  })

  it('shows the full range on a single page', () => {
    expect(paginationLabel(1, 1, SIZE)).toBe('Showing 1 of 1 links')
    expect(paginationLabel(10, 1, SIZE)).toBe('Showing 1\u201310 of 10 links')
    expect(paginationLabel(14, 1, SIZE)).toBe('Showing 1\u201310 of 14 links')
  })

  it('shows the remaining range on the last page', () => {
    expect(paginationLabel(14, 2, SIZE)).toBe('Showing 11\u201314 of 14 links')
    expect(paginationLabel(20, 2, SIZE)).toBe('Showing 11\u201320 of 20 links')
  })

  it('collapses to a single number when start equals end', () => {
    expect(paginationLabel(21, 3, SIZE)).toBe('Showing 21 of 21 links')
  })

  it('uses the actual page size (not a hardcoded 10)', () => {
    expect(paginationLabel(7, 1, 5)).toBe('Showing 1\u20135 of 7 links')
    expect(paginationLabel(7, 2, 5)).toBe('Showing 6\u20137 of 7 links')
  })

  it('stays sane when the page is past the end', () => {
    expect(paginationLabel(5, 4, SIZE)).toBe('Showing 5 of 5 links')
  })
})
