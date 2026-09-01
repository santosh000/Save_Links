// @vitest-environment node
//
// Phase 3C-1 — signed OAuth state + PKCE (worker/oauth/state.js).
// Round-trip, tamper, expiry, secret-mismatch and format-rejection cases.
import { describe, it, expect } from 'vitest'
import {
  OAUTH_STATE_TTL_MS,
  createStateCookieValue,
  verifyStateCookieValue,
  pkceCodeChallenge,
  hmacSign,
} from './state.js'

const SECRET = 'test-hmac-secret'
const NOW = 1_700_000_000_000

describe('createStateCookieValue', () => {
  it('produces an unguessable state, a 256-bit verifier and a signed cookie', async () => {
    const { value, state, codeVerifier, expiresAt } = await createStateCookieValue({ secret: SECRET, now: NOW })
    expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/) // 16 random bytes, base64url
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32 random bytes, base64url, no padding
    expect(expiresAt).toBe(NOW + OAUTH_STATE_TTL_MS)
    expect(value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/) // payload.signature
  })

  it('unique per call', async () => {
    const a = await createStateCookieValue({ secret: SECRET, now: NOW })
    const b = await createStateCookieValue({ secret: SECRET, now: NOW })
    expect(a.state).not.toBe(b.state)
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
    expect(a.value).not.toBe(b.value)
  })

  it('rejects empty/absent secret and invalid ttl at the boundary', async () => {
    await expect(createStateCookieValue({ secret: '', now: NOW })).rejects.toThrow()
    await expect(createStateCookieValue({ secret: SECRET, ttlMs: 0, now: NOW })).rejects.toThrow()
    await expect(createStateCookieValue({ secret: SECRET, ttlMs: -5, now: NOW })).rejects.toThrow()
  })
})

describe('verifyStateCookieValue', () => {
  it('round-trips to the exact state and verifier', async () => {
    const created = await createStateCookieValue({ secret: SECRET, now: NOW })
    const verified = await verifyStateCookieValue(created.value, { secret: SECRET, now: NOW })
    expect(verified).toEqual({
      state: created.state,
      codeVerifier: created.codeVerifier,
      expiresAt: created.expiresAt,
    })
  })

  it('rejects a tampered payload (signature mismatch, constant-time path)', async () => {
    const created = await createStateCookieValue({ secret: SECRET, now: NOW })
    const [payload, sig] = created.value.split('.')
    // flip one base64url character in the middle of the payload
    const flipped = payload.slice(0, 10) + (payload[10] === 'A' ? 'B' : 'A') + payload.slice(11)
    expect(await verifyStateCookieValue(`${flipped}.${sig}`, { secret: SECRET, now: NOW })).toBeNull()
  })

  it('rejects a value signed with a different secret', async () => {
    const created = await createStateCookieValue({ secret: SECRET, now: NOW })
    expect(await verifyStateCookieValue(created.value, { secret: 'other-secret', now: NOW })).toBeNull()
  })

  it('rejects an expired value (GitHub codes survive ~10 minutes)', async () => {
    const created = await createStateCookieValue({ secret: SECRET, now: NOW })
    expect(await verifyStateCookieValue(created.value, { secret: SECRET, now: created.expiresAt - 1 })).not.toBeNull()
    expect(await verifyStateCookieValue(created.value, { secret: SECRET, now: created.expiresAt })).toBeNull()
    expect(await verifyStateCookieValue(created.value, { secret: SECRET, now: created.expiresAt + 60_000 })).toBeNull()
  })

  it('rejects malformed/foreign values without throwing', async () => {
    for (const bad of ['', 'no-separator', '.', 'a.', '.b', 'a.b.c', JSON.stringify({ s: 'x', v: 'y' })]) {
      expect(await verifyStateCookieValue(bad, { secret: SECRET, now: NOW })).toBeNull()
    }
  })

  it('rejects validly-signed values whose payload shape is wrong', async () => {
    const payload = btoa(JSON.stringify({ foo: 'bar' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const sig = await hmacSign(SECRET, payload)
    expect(await verifyStateCookieValue(`${payload}.${sig}`, { secret: SECRET, now: NOW })).toBeNull()
  })
})

describe('pkceCodeChallenge', () => {
  it('S256 challenge: deterministic, 43 base64url chars, no padding', async () => {
    const verifier = (await createStateCookieValue({ secret: SECRET, now: NOW })).codeVerifier
    const challenge = await pkceCodeChallenge(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await pkceCodeChallenge(verifier)).toBe(challenge)
  })

  it('differs across verifiers', async () => {
    const a = await pkceCodeChallenge('verifier-one')
    const b = await pkceCodeChallenge('verifier-two')
    expect(a).not.toBe(b)
  })

  it('rejects an empty verifier', async () => {
    await expect(pkceCodeChallenge('')).rejects.toThrow()
  })
})