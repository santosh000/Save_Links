import { describe, it, expect } from 'vitest'
import { detectPlatformFromUserAgent, detectPlatform, PLATFORM_VALUES } from './device.js'

describe('detectPlatformFromUserAgent', () => {
  it('detects each supported platform', () => {
    expect(detectPlatformFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows')
    expect(detectPlatformFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('macOS')
    expect(detectPlatformFromUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux')
    expect(detectPlatformFromUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel)')).toBe('Android')
    expect(detectPlatformFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('iOS')
    expect(detectPlatformFromUserAgent('Mozilla/5.0 (iPad; CPU OS 16_0)')).toBe('iOS')
    expect(detectPlatformFromUserAgent('CrOS x86_64 14541.0.0')).toBe('ChromeOS')
  })

  it('android/linux precedence: Android UA containing Linux still maps to Android', () => {
    expect(detectPlatformFromUserAgent('Mozilla/5.0 (Linux; Android 12; SM)')).toBe('Android')
  })

  it('returns Unknown for empty, non-string, or unrecognizable input', () => {
    expect(detectPlatformFromUserAgent('')).toBe('Unknown')
    expect(detectPlatformFromUserAgent(undefined)).toBe('Unknown')
    expect(detectPlatformFromUserAgent(null)).toBe('Unknown')
    expect(detectPlatformFromUserAgent('curl/8.0')).toBe('Unknown')
  })
})

describe('detectPlatform', () => {
  it('is defensive: returns a value in the supported set or Unknown, never throws', () => {
    const nav = globalThis.navigator

    // simulate missing navigator
    globalThis.navigator = undefined
    expect(detectPlatform()).toBe('Unknown')

    // simulate broken navigator
    globalThis.navigator = { userAgent: 123 }
    expect(detectPlatform()).toBe('Unknown')

    // restore
    if (nav === undefined) delete globalThis.navigator
    else globalThis.navigator = nav
  })

  it('returns a label from the supported set whenever it can read a UA', () => {
    // real (or mocked) browser-like navigator
    const nav = globalThis.navigator
    globalThis.navigator = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    const result = detectPlatform()
    expect(PLATFORM_VALUES).toContain(result)
    expect(result).toBe('Windows')
    globalThis.navigator = nav
  })
})
