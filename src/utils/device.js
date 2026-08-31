// Broad platform/OS detection, kept out of the LinkCard component.
// Only identifies the general platform/OS — never a unique device, device
// name, IP, browser identity or hardware identifier.
//
// Values are intentionally restricted to a small known set so the UI can
// render an icon/label deterministically:
//   Windows | macOS | Linux | Android | iOS | ChromeOS | Unknown
//
// Detection is defensive: any failure (missing/broken navigator, unexpected
// data) resolves to 'Unknown' rather than throwing or inventing a value.

export const PLATFORM_VALUES = ['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'ChromeOS', 'Unknown']

// Pure mapping from a user-agent string to a platform label. Testable without
// a browser. Order matters: iOS/Android/CrOS are checked before their more
// generic relatives (Android and X11 user-agents also mention "Linux").
export function detectPlatformFromUserAgent(ua) {
  if (typeof ua !== 'string' || !ua) return 'Unknown'
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) return 'iOS'
  if (/\bAndroid\b/i.test(ua)) return 'Android'
  if (/\bCrOS\b/i.test(ua)) return 'ChromeOS'
  if (/\bWindows\b/i.test(ua)) return 'Windows'
  if (/\bMac OS X\b|\bMacintosh\b/i.test(ua)) return 'macOS'
  if (/\bLinux\b|\bX11\b/i.test(ua)) return 'Linux'
  return 'Unknown'
}

// Map a UA-CH platform string (navigator.userAgentData.platform) onto the
// same restricted set. Unknowns fall through so the caller keeps the UA path.
function platformLabelFromValue(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (/\bwin/i.test(s)) return 'Windows'
  if (/\b(?:mac|macintosh|mac os)/i.test(s)) return 'macOS'
  if (/\bli[nu][a-z]*/i.test(s)) return 'Linux'
  if (/\bandroid/i.test(s)) return 'Android'
  if (/\b(?:iphone|ipad|ipod)/i.test(s)) return 'iOS'
  if (/\bcros\b/i.test(s)) return 'ChromeOS'
  return null
}

// Live detection reading the environment. Prefers the modern UA-CH platform
// value, falls back to user-agent parsing, and ultimately to 'Unknown'.
export function detectPlatform() {
  try {
    const nav = globalThis.navigator
    if (!nav) return 'Unknown'
    if (nav.userAgentData && typeof nav.userAgentData.platform === 'string') {
      const mapped = platformLabelFromValue(nav.userAgentData.platform)
      if (mapped) return mapped
    }
    if (typeof nav.userAgent === 'string') {
      return detectPlatformFromUserAgent(nav.userAgent)
    }
    return 'Unknown'
  } catch {
    return 'Unknown'
  }
}
