// @vitest-environment node
//
// Decision #18 — daily expiry-cleanup maintenance. Proves worker/index.js
// exposes a `scheduled()` handler that runs BOTH cleanup functions with one
// shared Cron timestamp and the real D1 binding, exercising the REAL
// migration SQL through the shared in-memory D1 facade (no production D1).
//
// The two store functions are wrapped in spies (implementations preserved) so
// the tests can assert both call wiring and real database effects together.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  TOMBSTONE_RETENTION_MS,
  applyObjectMutation,
  createAccount,
  createSession,
  deleteExpiredSessions,
  getObject,
  purgeExpiredTombstones,
} from './db/store.js'
import { createTestDb } from './db/d1-facade.js'
import worker from './index.js'

vi.mock('./db/store.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    deleteExpiredSessions: vi.fn(actual.deleteExpiredSessions),
    purgeExpiredTombstones: vi.fn(actual.purgeExpiredTombstones),
  }
})

// Fixed Cron controller timestamp (epoch ms UTC). Deliberately in the past so
// the boundary rows below would be deleted by a real `Date.now()` — the tests
// therefore fail if the handler ignores the controller timestamp.
const SCHEDULED_TIME = 1_800_000_000_000
const CONTROLLER = { cron: '0 3 * * *', type: 'scheduled', scheduledTime: SCHEDULED_TIME }
const CTX = { waitUntil: () => {} }

let db
let env
let accountId

async function seedTombstone(objectId, deletedAt) {
  await applyObjectMutation(db, {
    accountId,
    mutationId: crypto.randomUUID(),
    objectType: 'link',
    objectId,
    operation: 'create',
    baseRevision: 0,
    payload: '{}',
    now: deletedAt - 1000,
  })
  await applyObjectMutation(db, {
    accountId,
    mutationId: crypto.randomUUID(),
    objectType: 'link',
    objectId,
    operation: 'delete',
    baseRevision: 1,
    payload: '{}',
    now: deletedAt,
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  db = createTestDb()
  env = { DB: db }
  accountId = (await createAccount(db, { now: SCHEDULED_TIME })).accountId
})

describe('scheduled expiry cleanup (Decision #18)', () => {
  it('exposes a scheduled handler alongside fetch', () => {
    expect(typeof worker.scheduled).toBe('function')
    expect(typeof worker.fetch).toBe('function')
  })

  it('runs both cleanups against env.DB with the same controller timestamp', async () => {
    await worker.scheduled(CONTROLLER, env, CTX)

    expect(deleteExpiredSessions).toHaveBeenCalledTimes(1)
    expect(deleteExpiredSessions).toHaveBeenCalledWith(env.DB, { now: SCHEDULED_TIME })
    expect(purgeExpiredTombstones).toHaveBeenCalledTimes(1)
    expect(purgeExpiredTombstones).toHaveBeenCalledWith(env.DB, { now: SCHEDULED_TIME })
  })

  it('deletes expired sessions (expires_at <= now) and preserves active ones', async () => {
    // Boundary: expires_at == SCHEDULED_TIME (eligible, <=).
    await createSession(db, { accountId, ttlMs: 1, now: SCHEDULED_TIME - 1 })
    // Clearly expired.
    await createSession(db, { accountId, ttlMs: 1000, now: SCHEDULED_TIME - 60_000 })
    // Active: expires_at is in the future relative to the controller timestamp.
    const active = await createSession(db, { accountId, ttlMs: 1000, now: SCHEDULED_TIME })

    await worker.scheduled(CONTROLLER, env, CTX)

    const left = db._sqlite.prepare('SELECT token_hash, expires_at FROM sessions').all()
    expect(left).toHaveLength(1)
    expect(left[0].token_hash).toBe(active.tokenHash)
    expect(left[0].expires_at).toBeGreaterThan(SCHEDULED_TIME)
  })

  it('purges tombstones at/past the 30-day boundary and keeps newer ones and live rows', async () => {
    const boundary = crypto.randomUUID() // deleted_at == now - 30d (eligible, <=)
    const inside = crypto.randomUUID() // deleted_at == now - 30d + 1 (within window)
    const fresh = crypto.randomUUID() // deleted_at == now - 1s (recent delete)
    const live = crypto.randomUUID() // never deleted

    await seedTombstone(boundary, SCHEDULED_TIME - TOMBSTONE_RETENTION_MS)
    await seedTombstone(inside, SCHEDULED_TIME - TOMBSTONE_RETENTION_MS + 1)
    await seedTombstone(fresh, SCHEDULED_TIME - 1000)
    await applyObjectMutation(db, {
      accountId,
      mutationId: crypto.randomUUID(),
      objectType: 'link',
      objectId: live,
      operation: 'create',
      baseRevision: 0,
      payload: '{}',
      now: SCHEDULED_TIME - 5000,
    })

    await worker.scheduled(CONTROLLER, env, CTX)

    expect(await getObject(db, { accountId, objectType: 'link', objectId: boundary })).toBeNull()
    expect((await getObject(db, { accountId, objectType: 'link', objectId: inside })).deleted).toBe(1)
    expect((await getObject(db, { accountId, objectType: 'link', objectId: fresh })).deleted).toBe(1)
    expect((await getObject(db, { accountId, objectType: 'link', objectId: live })).deleted).toBe(0)
  })

  it('propagates a cleanup failure instead of silently swallowing it', async () => {
    deleteExpiredSessions.mockRejectedValueOnce(new Error('d1 unavailable'))

    await expect(worker.scheduled(CONTROLLER, env, CTX)).rejects.toThrow('d1 unavailable')
    expect(deleteExpiredSessions).toHaveBeenCalledTimes(1)
    // Sequential design: the failed first cleanup aborts the run; the next
    // daily invocation retries both (functions are idempotent).
    expect(purgeExpiredTombstones).not.toHaveBeenCalled()
  })

  it('is idempotent across repeated scheduled executions', async () => {
    await createSession(db, { accountId, ttlMs: 1, now: SCHEDULED_TIME - 1 })
    await seedTombstone(crypto.randomUUID(), SCHEDULED_TIME - TOMBSTONE_RETENTION_MS)

    await worker.scheduled(CONTROLLER, env, CTX)
    const sessionsAfterFirst = db._sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n
    const objectsAfterFirst = db._sqlite.prepare('SELECT count(*) AS n FROM sync_objects').get().n

    await worker.scheduled(CONTROLLER, env, CTX)

    expect(db._sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n).toBe(sessionsAfterFirst)
    expect(db._sqlite.prepare('SELECT count(*) AS n FROM sync_objects').get().n).toBe(objectsAfterFirst)
    expect(deleteExpiredSessions).toHaveBeenCalledTimes(2)
    expect(purgeExpiredTombstones).toHaveBeenCalledTimes(2)
  })
})
