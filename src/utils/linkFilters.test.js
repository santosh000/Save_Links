// P15.2 — the shared link-filter pipeline: day math, tag/date/Recently-Added
// rules and the existing folder/status/search/type/category/pinned rules.
import { describe, it, expect } from 'vitest'
import {
  calendarDaysSince,
  isRecentlyAdded,
  isWithinDays,
  localDateKey,
  matchesDateFilter,
  matchesLinkFilters,
  startOfLocalDay,
  startOfLocalWeekKey,
} from './linkFilters.js'

// Fixed local midday so the calendar-day math is timezone/DST robust.
const NOW = new Date(2026, 8, 29, 12, 0, 0).getTime() // Tue 29 Sep 2026, 12:00 local
const iso = (daysAgo, hour = 12) => new Date(2026, 8, 29 - daysAgo, hour, 0, 0).toISOString()

const link = (overrides = {}) => ({
  id: 'l1',
  title: 'React Server Components',
  originalUrl: 'https://react.dev/blog',
  normalizedUrl: 'https://react.dev/blog',
  url: 'https://react.dev/blog',
  domain: 'react.dev',
  description: 'A guide',
  category: 'Other',
  tags: ['react', 'javascript'],
  important: false,
  mustHave: false,
  favorite: false,
  pinned: false,
  type: 'article',
  folderId: null,
  createdAt: iso(0),
  ...overrides,
})

describe('day math', () => {
  it('counts whole local calendar days', () => {
    expect(calendarDaysSince(iso(0), NOW)).toBe(0)
    expect(calendarDaysSince(iso(1), NOW)).toBe(1)
    expect(calendarDaysSince(iso(2), NOW)).toBe(2)
    expect(calendarDaysSince(iso(40), NOW)).toBe(40)
    expect(calendarDaysSince('not-a-date', NOW)).toBe(Infinity)
  })

  it('startOfLocalDay zeroes the time part', () => {
    const t = startOfLocalDay(iso(3, 23))
    expect(new Date(t).getHours()).toBe(0)
    expect(new Date(t).getMinutes()).toBe(0)
  })
})

describe('Recently Added (mockup Library destination)', () => {
  it('matches today and yesterday only', () => {
    expect(isRecentlyAdded(link({ createdAt: iso(0) }), NOW)).toBe(true)
    expect(isRecentlyAdded(link({ createdAt: iso(1) }), NOW)).toBe(true)
    expect(isRecentlyAdded(link({ createdAt: iso(2) }), NOW)).toBe(false)
    expect(isRecentlyAdded(link({ createdAt: 'nope' }), NOW)).toBe(false)
  })
})

describe('date window (mockup "Last 30 days")', () => {
  it('is inclusive of the boundary and off when no window is set', () => {
    expect(isWithinDays(link({ createdAt: iso(10) }), 30, NOW)).toBe(true)
    expect(isWithinDays(link({ createdAt: iso(30) }), 30, NOW)).toBe(true)
    expect(isWithinDays(link({ createdAt: iso(31) }), 30, NOW)).toBe(false)
    expect(isWithinDays(link({ createdAt: 'nope' }), 30, NOW)).toBe(false)
    expect(isWithinDays(link({ createdAt: iso(400) }), null, NOW)).toBe(true)
  })
})

describe('P15.10 date presets and custom range', () => {
  // Tue 29 Sep 2026 is the fixed NOW; the local week starts Mon 28 Sep.
  it('local date keys are local-calendar, zero padded', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23).getTime())).toBe('2026-01-05')
    expect(localDateKey('nope')).toBe(null)
    expect(startOfLocalWeekKey(NOW)).toBe('2026-09-28')
  })

  it('today / yesterday match exactly one calendar day', () => {
    expect(matchesDateFilter(link({ createdAt: iso(0) }), { preset: 'today' }, NOW)).toBe(true)
    expect(matchesDateFilter(link({ createdAt: iso(1) }), { preset: 'today' }, NOW)).toBe(false)
    expect(matchesDateFilter(link({ createdAt: iso(1) }), { preset: 'yesterday' }, NOW)).toBe(true)
    expect(matchesDateFilter(link({ createdAt: iso(2) }), { preset: 'yesterday' }, NOW)).toBe(false)
  })

  it('this week runs from the Monday of the current local week, capped at today', () => {
    expect(matchesDateFilter(link({ createdAt: iso(1) }), { preset: 'week' }, NOW)).toBe(true) // Mon
    expect(matchesDateFilter(link({ createdAt: iso(2) }), { preset: 'week' }, NOW)).toBe(false) // Sun before
    expect(matchesDateFilter(link({ createdAt: iso(-1) }), { preset: 'week' }, NOW)).toBe(false) // future
  })

  it('older is the complement of the same week boundary', () => {
    expect(matchesDateFilter(link({ createdAt: iso(2) }), { preset: 'older' }, NOW)).toBe(true) // Sun before the week
    expect(matchesDateFilter(link({ createdAt: iso(1) }), { preset: 'older' }, NOW)).toBe(false) // Mon (week start)
    expect(matchesDateFilter(link({ createdAt: iso(0) }), { preset: 'older' }, NOW)).toBe(false) // today
    expect(matchesDateFilter(link({ createdAt: iso(-1) }), { preset: 'older' }, NOW)).toBe(false) // future
  })

  it('custom range includes both From and To', () => {
    const from = '2026-09-10'
    const to = '2026-09-20'
    expect(matchesDateFilter(link({ createdAt: iso(19) }), { preset: 'custom', from, to }, NOW)).toBe(true) // 10 Sep
    expect(matchesDateFilter(link({ createdAt: iso(9) }), { preset: 'custom', from, to }, NOW)).toBe(true) // 20 Sep
    expect(matchesDateFilter(link({ createdAt: iso(20) }), { preset: 'custom', from, to }, NOW)).toBe(false)
    expect(matchesDateFilter(link({ createdAt: iso(8) }), { preset: 'custom', from, to }, NOW)).toBe(false)
    // one-sided ranges stay open at the other end
    expect(matchesDateFilter(link({ createdAt: iso(200) }), { preset: 'custom', to }, NOW)).toBe(true)
    expect(matchesDateFilter(link({ createdAt: iso(0) }), { preset: 'custom', from }, NOW)).toBe(true)
    expect(matchesDateFilter(link({ createdAt: iso(200) }), { preset: 'custom', from }, NOW)).toBe(false)
  })

  it('all time, missing and unparsable timestamps', () => {
    expect(matchesDateFilter(link(), { preset: 'all' }, NOW)).toBe(true)
    expect(matchesDateFilter(link(), null, NOW)).toBe(true)
    expect(matchesDateFilter(link({ createdAt: 'nope' }), { preset: 'today' }, NOW)).toBe(false)
    expect(matchesDateFilter(link({ createdAt: 'nope' }), { preset: 'older' }, NOW)).toBe(false)
    expect(matchesDateFilter(link({ createdAt: 'nope' }), { preset: 'custom', from: '2026-01-01' }, NOW)).toBe(false)
    expect(matchesDateFilter(link({ createdAt: 'nope' }), { preset: 'all' }, NOW)).toBe(true)
  })

  it('composes with the other filters through matchesLinkFilters', () => {
    const date = { preset: 'custom', from: '2026-09-01', to: '2026-09-30' }
    expect(matchesLinkFilters(link({ createdAt: iso(5) }), { date, now: NOW })).toBe(true)
    expect(matchesLinkFilters(link({ createdAt: iso(120) }), { date, now: NOW })).toBe(false)
    expect(matchesLinkFilters(link({ createdAt: iso(5), pinned: false }), { date, pinned: true, now: NOW })).toBe(false)
  })
})

describe('matchesLinkFilters — existing rules stay intact', () => {
  it('passes everything with no filters', () => {
    expect(matchesLinkFilters(link())).toBe(true)
    expect(matchesLinkFilters(link({ folderId: 'f1', pinned: true }), {})).toBe(true)
  })

  it('folder subtree: matches the folder and its descendants only', () => {
    const folderIds = new Set(['f1', 'f2'])
    expect(matchesLinkFilters(link({ folderId: 'f1' }), { folderId: 'f1', folderIds })).toBe(true)
    expect(matchesLinkFilters(link({ folderId: 'f2' }), { folderId: 'f1', folderIds })).toBe(true)
    expect(matchesLinkFilters(link({ folderId: 'f3' }), { folderId: 'f1', folderIds })).toBe(false)
    expect(matchesLinkFilters(link({ folderId: null }), { folderId: 'f1', folderIds })).toBe(false)
  })

  it('folder __unfiled matches only links without a folder', () => {
    expect(matchesLinkFilters(link({ folderId: null }), { folderId: '__unfiled' })).toBe(true)
    expect(matchesLinkFilters(link({ folderId: 'f1' }), { folderId: '__unfiled' })).toBe(false)
  })

  it('category, type (defaulting to other), pinned and status', () => {
    expect(matchesLinkFilters(link({ category: 'GitHub' }), { category: 'GitHub' })).toBe(true)
    expect(matchesLinkFilters(link({ category: 'GitHub' }), { category: 'YouTube' })).toBe(false)
    expect(matchesLinkFilters(link({ type: 'video' }), { type: 'video' })).toBe(true)
    expect(matchesLinkFilters(link({ type: undefined }), { type: 'other' })).toBe(true)
    expect(matchesLinkFilters(link({ type: undefined }), { type: 'video' })).toBe(false)
    expect(matchesLinkFilters(link({ pinned: true }), { pinned: true })).toBe(true)
    expect(matchesLinkFilters(link({ pinned: false }), { pinned: true })).toBe(false)

    expect(matchesLinkFilters(link({ important: true }), { status: 'important' })).toBe(true)
    expect(matchesLinkFilters(link({ mustHave: true }), { status: 'must-have' })).toBe(true)
    expect(matchesLinkFilters(link({ favorite: true }), { status: 'favorite' })).toBe(true)
    expect(matchesLinkFilters(link({ favorite: false }), { status: 'not-favorite' })).toBe(true)
    expect(matchesLinkFilters(link({ favorite: false }), { status: 'favorite' })).toBe(false)
    expect(matchesLinkFilters(link({ important: true }), { status: 'none' })).toBe(false)
    expect(matchesLinkFilters(link({ favorite: true }), { status: 'none' })).toBe(true)
  })

  it('query searches title/url/domain/description/category/tags and folder name', () => {
    const folderNameById = new Map([['f1', 'Work'], ['f2', 'Design']])
    expect(matchesLinkFilters(link({ title: 'Vite Guide' }), { query: 'vite' })).toBe(true)
    expect(matchesLinkFilters(link({ domain: 'vitejs.dev' }), { query: 'vitejs' })).toBe(true)
    expect(matchesLinkFilters(link({ tags: ['webgpu'] }), { query: 'webgpu' })).toBe(true)
    expect(matchesLinkFilters(link({ folderId: 'f1' }), { query: 'work', folderNameById })).toBe(true)
    expect(matchesLinkFilters(link({ folderId: null }), { query: 'unfiled' })).toBe(true)
    expect(matchesLinkFilters(link({ title: 'Vite Guide' }), { query: 'webpack' })).toBe(false)
  })
})

describe('matchesLinkFilters — new P15.2 rules', () => {
  it('tag filter matches exact stored tags only', () => {
    expect(matchesLinkFilters(link({ tags: ['react', 'javascript'] }), { tag: 'react' })).toBe(true)
    expect(matchesLinkFilters(link({ tags: ['react'] }), { tag: 'vue' })).toBe(false)
    expect(matchesLinkFilters(link({ tags: [] }), { tag: 'react' })).toBe(false)
    expect(matchesLinkFilters(link({ tags: undefined }), { tag: 'react' })).toBe(false)
    expect(matchesLinkFilters(link({ tags: ['React'] }), { tag: 'react' })).toBe(false)
  })

  it('Recently Added destination', () => {
    expect(matchesLinkFilters(link({ createdAt: iso(1) }), { recent: true, now: NOW })).toBe(true)
    expect(matchesLinkFilters(link({ createdAt: iso(3) }), { recent: true, now: NOW })).toBe(false)
  })

  it('date window', () => {
    expect(matchesLinkFilters(link({ createdAt: iso(12) }), { dateWithinDays: 30, now: NOW })).toBe(true)
    expect(matchesLinkFilters(link({ createdAt: iso(45) }), { dateWithinDays: 30, now: NOW })).toBe(false)
  })

  it('bar filters combine with each other and with a destination', () => {
    const l = link({ tags: ['react'], createdAt: iso(5), folderId: 'f1', category: 'GitHub' })
    expect(matchesLinkFilters(l, { tag: 'react', dateWithinDays: 30, category: 'GitHub', now: NOW })).toBe(true)
    expect(matchesLinkFilters(l, { tag: 'react', dateWithinDays: 30, recent: true, now: NOW })).toBe(false)
  })

  it('does not mutate the link or its tags', () => {
    const l = link({ tags: ['react'] })
    matchesLinkFilters(l, { tag: 'react', query: 'react' })
    expect(l.tags).toEqual(['react'])
  })
})
