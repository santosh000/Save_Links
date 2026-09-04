// Tests for the cloud sync coordinator (src/sync/coordinator.js).
// Pure unit tests with injected mocks — no IndexedDB, no network.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncNow, rebaseConflict, pullAndReconcile } from './coordinator.js'

// ---- mock helpers -----------------------------------------------------------

function makeMutation(overrides = {}) {
  return {
    mutation_id: 'mut-001',
    account_id: 'acc-1',
    object_type: 'link',
    object_id: 'obj-1',
    operation: 'create',
    base_revision: 0,
    payload: '{"url":"https://example.com"}',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'pending',
    ...overrides,
  }
}

function makeRepo(mutations = []) {
  const pending = [...mutations]
  const local = { links: [], folders: [] }
  return {
    pending,
    local,
    calls: {
      updateRevision: [],
      markSucceeded: [],
      markFailed: [],
      rebased: [],
      upsert: [],
      deleted: [],
    },
    async getPendingMutations() { return pending.filter(m => m.status === 'pending') },
    async getAllLinks() { return local.links },
    async getAllFolders() { return local.folders },
    async upsertLink(record) { local.links.push(record); this.calls.upsert.push({ type: 'link', record }) },
    async upsertFolder(record) { local.folders.push(record); this.calls.upsert.push({ type: 'folder', record }) },
    async deleteLink(id) { local.links = local.links.filter(l => l.id !== id); this.calls.deleted.push({ type: 'link', id }) },
    async deleteFolder(id) { local.folders = local.folders.filter(f => f.id !== id); this.calls.deleted.push({ type: 'folder', id }) },
    async updateObjectRevision(storeName, objectId, revision) {
      this.calls.updateRevision.push({ storeName, objectId, revision })
    },
    async markMutationSucceeded(mutationId) {
      this.calls.markSucceeded.push(mutationId)
      const m = pending.find(x => x.mutation_id === mutationId)
      if (m) m.status = 'succeeded'
    },
    async markMutationFailed(mutationId) {
      this.calls.markFailed.push(mutationId)
      const m = pending.find(x => x.mutation_id === mutationId)
      if (m) m.status = 'failed'
    },
    async rebasePendingMutation(originalMutationId, rebased) {
      this.calls.rebased.push({ originalMutationId, rebased })
      // Simulate atomic: mark original failed, insert rebased
      const m = pending.find(x => x.mutation_id === originalMutationId)
      if (m) m.status = 'failed'
      rebased.status = 'pending'
      pending.push(rebased)
      return rebased.mutation_id
    },
  }
}

function mockPush(results) {
  // results: array of return values, one per call (cycling if fewer than calls)
  let call = 0
  return vi.fn(() => {
    const r = results[Math.min(call, results.length - 1)]
    call++
    if (r instanceof Error) return Promise.reject(r)
    return Promise.resolve(r)
  })
}

// Stub session to return an authenticated user
vi.mock('../auth/session.js', () => ({
  session: { getState: () => ({ status: 'authenticated', user: { id: 'acc-1' } }) },
}))

// Stub the pull transport so syncNow()'s pull phase returns no server objects
// by default (push-only tests). Individual pull tests override pullFn instead.
vi.mock('./protocol.js', () => ({
  pushMutation: vi.fn(),
  pullObjects: vi.fn(() => Promise.resolve({ kind: 'ok', objects: [] })),
}))

// The base (push-only) summary shape every syncNow() test starts from.
const BASE_SUMMARY = { pushed: 0, succeeded: 0, failed: 0, conflict: 0, unavailable: 0, pulled: 0, applied: 0, skippedLocal: 0, skippedStale: 0 }

// ---- rebaseConflict unit tests ----------------------------------------------

describe('rebaseConflict', () => {
  it('null serverCurrent: marks failed, no rebase created', async () => {
    const repo = makeRepo([makeMutation()])
    await rebaseConflict(repo.pending[0], null, repo)
    expect(repo.calls.markFailed).toEqual(['mut-001'])
    expect(repo.calls.rebased).toEqual([])
    expect(repo.calls.markSucceeded).toEqual([])
  })

  it('DELETE conflict with server deleted=true: marks succeeded, no rebase', async () => {
    const m = makeMutation({ operation: 'delete' })
    const repo = makeRepo([m])
    const serverCurrent = { revision: 5, deleted: true, deleted_at: 123, payload: null, object_id: 'obj-1', object_type: 'link' }
    await rebaseConflict(m, serverCurrent, repo)
    expect(repo.calls.markSucceeded).toEqual(['mut-001'])
    expect(repo.calls.rebased).toEqual([])
    expect(repo.calls.updateRevision).toEqual([
      { storeName: 'links', objectId: 'obj-1', revision: 5 },
    ])
  })

  it('CREATE conflict with existing object: converts to UPDATE', async () => {
    const m = makeMutation({ operation: 'create', payload: { id: 'obj-1', title: 'Test' } })
    const repo = makeRepo([m])
    const serverCurrent = { revision: 3, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' }
    await rebaseConflict(m, serverCurrent, repo)
    expect(repo.calls.rebased).toHaveLength(1)
    const rebased = repo.calls.rebased[0].rebased
    expect(rebased.operation).toBe('update')
    expect(rebased.base_revision).toBe(3)
    expect(rebased.account_id).toBe('acc-1')
    expect(rebased.object_id).toBe('obj-1')
    expect(rebased.object_type).toBe('link')
    expect(rebased.status).toBe('pending')
  })

  it('UPDATE conflict: rebased as UPDATE with server revision', async () => {
    const m = makeMutation({ operation: 'update', base_revision: 1, payload: { id: 'obj-1', title: 'V2' } })
    const repo = makeRepo([m])
    const serverCurrent = { revision: 5, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' }
    await rebaseConflict(m, serverCurrent, repo)
    const rebased = repo.calls.rebased[0].rebased
    expect(rebased.operation).toBe('update')
    expect(rebased.base_revision).toBe(5)
  })

  it('DELETE conflict against live object: rebased as DELETE', async () => {
    const m = makeMutation({ operation: 'delete', payload: { id: 'obj-1' } })
    const repo = makeRepo([m])
    const serverCurrent = { revision: 7, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' }
    await rebaseConflict(m, serverCurrent, repo)
    const rebased = repo.calls.rebased[0].rebased
    expect(rebased.operation).toBe('delete')
    expect(rebased.base_revision).toBe(7)
    expect(rebased.payload).toEqual({ id: 'obj-1' })
  })

  it('rebased mutation gets a new mutation_id', async () => {
    const m = makeMutation({ mutation_id: 'original-id' })
    const repo = makeRepo([m])
    const serverCurrent = { revision: 1, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' }
    await rebaseConflict(m, serverCurrent, repo)
    const rebased = repo.calls.rebased[0].rebased
    expect(rebased.mutation_id).not.toBe('original-id')
    expect(typeof rebased.mutation_id).toBe('string')
    expect(rebased.mutation_id.length).toBeGreaterThan(0)
  })

  it('rebased mutation uses server revision as base_revision', async () => {
    const m = makeMutation({ operation: 'update', base_revision: 0 })
    const repo = makeRepo([m])
    const serverCurrent = { revision: 42, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' }
    await rebaseConflict(m, serverCurrent, repo)
    expect(repo.calls.rebased[0].rebased.base_revision).toBe(42)
  })

  it('original payload is preserved in rebased mutation', async () => {
    const payload = { id: 'obj-1', title: 'My Link', tags: ['a'] }
    const m = makeMutation({ operation: 'update', payload })
    const repo = makeRepo([m])
    const serverCurrent = { revision: 2, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' }
    await rebaseConflict(m, serverCurrent, repo)
    expect(repo.calls.rebased[0].rebased.payload).toEqual(payload)
  })

  it('object_id is preserved', async () => {
    const m = makeMutation({ object_id: 'specific-id' })
    const repo = makeRepo([m])
    const serverCurrent = { revision: 1, deleted: false, deleted_at: null, payload: {}, object_id: 'specific-id', object_type: 'link' }
    await rebaseConflict(m, serverCurrent, repo)
    expect(repo.calls.rebased[0].rebased.object_id).toBe('specific-id')
  })

  it('object_type is preserved', async () => {
    const m = makeMutation({ object_type: 'folder' })
    const repo = makeRepo([m])
    const serverCurrent = { revision: 1, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'folder' }
    await rebaseConflict(m, serverCurrent, repo)
    expect(repo.calls.rebased[0].rebased.object_type).toBe('folder')
  })

  it('account_id is preserved', async () => {
    const m = makeMutation({ account_id: 'acc-99' })
    const repo = makeRepo([m])
    const serverCurrent = { revision: 1, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' }
    await rebaseConflict(m, serverCurrent, repo)
    expect(repo.calls.rebased[0].rebased.account_id).toBe('acc-99')
  })

  it('original mutation becomes failed via rebasePendingMutation', async () => {
    const m = makeMutation()
    const repo = makeRepo([m])
    const serverCurrent = { revision: 1, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' }
    await rebaseConflict(m, serverCurrent, repo)
    expect(repo.calls.rebased[0].originalMutationId).toBe('mut-001')
    // The mock marks original as failed inside rebasePendingMutation
    expect(m.status).toBe('failed')
  })

  it('already-deleted DELETE becomes succeeded without rebase', async () => {
    const m = makeMutation({ operation: 'delete' })
    const repo = makeRepo([m])
    const serverCurrent = { revision: 10, deleted: true, deleted_at: 999, payload: null, object_id: 'obj-1', object_type: 'link' }
    await rebaseConflict(m, serverCurrent, repo)
    expect(repo.calls.markSucceeded).toEqual(['mut-001'])
    expect(repo.calls.rebased).toEqual([])
    expect(repo.calls.markFailed).toEqual([])
  })
})

// ---- syncNow integration tests ----------------------------------------------

describe('syncNow', () => {
  it('returns zeros when queue is empty', async () => {
    const repo = makeRepo([])
    const pushFn = mockPush([])
    const result = await syncNow({ pushFn, repo })
    expect(result).toEqual(BASE_SUMMARY)
    expect(pushFn).not.toHaveBeenCalled()
  })

  it('returns zeros when not authenticated', async () => {
    const { session: realSession } = await import('../auth/session.js')
    const original = realSession.getState
    realSession.getState = () => ({ status: 'anonymous', user: null })
    try {
      const repo = makeRepo([makeMutation()])
      const pushFn = mockPush([])
      const result = await syncNow({ pushFn, repo })
      expect(result).toEqual(BASE_SUMMARY)
      expect(pushFn).not.toHaveBeenCalled()
    } finally {
      realSession.getState = original
    }
  })

  it('filters mutations to the authenticated account only', async () => {
    const own = makeMutation({ mutation_id: 'own-1', account_id: 'acc-1' })
    const other = makeMutation({ mutation_id: 'other-1', account_id: 'acc-999' })
    const repo = makeRepo([own, other])
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 1 }])
    const result = await syncNow({ pushFn, repo })
    expect(result.pushed).toBe(1)
    expect(pushFn).toHaveBeenCalledOnce()
    expect(pushFn.mock.calls[0][0].mutation_id).toBe('own-1')
  })

  it('successful create: updates local revision and marks succeeded', async () => {
    const m = makeMutation({ object_type: 'link', operation: 'create' })
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 1 }])
    const result = await syncNow({ pushFn, repo })
    expect(result).toEqual({ ...BASE_SUMMARY, pushed: 1, succeeded: 1, failed: 0, conflict: 0, unavailable: 0 })
    expect(repo.calls.updateRevision).toEqual([
      { storeName: 'links', objectId: 'obj-1', revision: 1 },
    ])
    expect(repo.calls.markSucceeded).toEqual(['mut-001'])
  })

  it('successful update: increments revision from server', async () => {
    const m = makeMutation({ operation: 'update', base_revision: 1 })
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 2 }])
    const result = await syncNow({ pushFn, repo })
    expect(result.succeeded).toBe(1)
    expect(repo.calls.updateRevision[0].revision).toBe(2)
  })

  it('successful delete: updates revision and marks succeeded', async () => {
    const m = makeMutation({ object_type: 'folder', operation: 'delete', base_revision: 3 })
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 4 }])
    const result = await syncNow({ pushFn, repo })
    expect(result.succeeded).toBe(1)
    expect(repo.calls.updateRevision).toEqual([
      { storeName: 'folders', objectId: 'obj-1', revision: 4 },
    ])
    expect(repo.calls.markSucceeded).toEqual(['mut-001'])
  })

  it('conflict: rebase creates a new pending mutation', async () => {
    const m = makeMutation()
    const repo = makeRepo([m])
    const pushFn = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: { object_id: 'obj-1', object_type: 'link', revision: 5, deleted: false, deleted_at: null, payload: {} },
    }])
    const result = await syncNow({ pushFn, repo })
    expect(result).toEqual({ ...BASE_SUMMARY, pushed: 1, succeeded: 0, failed: 0, conflict: 1, unavailable: 0 })
    expect(repo.calls.rebased).toHaveLength(1)
    expect(repo.calls.rebased[0].originalMutationId).toBe('mut-001')
    const rebased = repo.calls.rebased[0].rebased
    expect(rebased.base_revision).toBe(5)
    expect(rebased.status).toBe('pending')
  })

  it('conflict with null current: marks failed, no rebase', async () => {
    const m = makeMutation()
    const repo = makeRepo([m])
    const pushFn = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: null,
    }])
    const result = await syncNow({ pushFn, repo })
    expect(result.conflict).toBe(1)
    expect(repo.calls.rebased).toEqual([])
    expect(repo.calls.markFailed).toEqual(['mut-001'])
  })

  it('rejected (400/401/403): marks failed, not retryable', async () => {
    const m = makeMutation()
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'rejected', status: 401, reason: 'unauthenticated' }])
    const result = await syncNow({ pushFn, repo })
    expect(result).toEqual({ ...BASE_SUMMARY, pushed: 1, succeeded: 0, failed: 1, conflict: 0, unavailable: 0 })
    expect(repo.calls.markFailed).toEqual(['mut-001'])
    expect(repo.calls.rebased).toEqual([])
  })

  it('unavailable (500/503): leaves pending, does not mark anything', async () => {
    const m = makeMutation()
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'unavailable', status: 503, reason: 'unavailable' }])
    const result = await syncNow({ pushFn, repo })
    expect(result).toEqual({ ...BASE_SUMMARY, pushed: 1, succeeded: 0, failed: 0, conflict: 0, unavailable: 1 })
    expect(repo.calls.markFailed).toEqual([])
    expect(repo.calls.markSucceeded).toEqual([])
    expect(repo.calls.rebased).toEqual([])
  })

  it('network failure (fetch throws): leaves pending', async () => {
    const m = makeMutation()
    const repo = makeRepo([m])
    const pushFn = mockPush([new Error('Failed to fetch')])
    const result = await syncNow({ pushFn, repo })
    expect(result).toEqual({ ...BASE_SUMMARY, pushed: 1, succeeded: 0, failed: 0, conflict: 0, unavailable: 1 })
    expect(repo.calls.markFailed).toEqual([])
    expect(repo.calls.markSucceeded).toEqual([])
  })

  it('retry preserves the same mutation_id', async () => {
    const m = makeMutation({ mutation_id: 'stable-id-42' })
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 1 }])
    await syncNow({ pushFn, repo })
    const sent = pushFn.mock.calls[0][0]
    expect(sent.mutation_id).toBe('stable-id-42')
  })

  it('multiple pending mutations processed in queue order', async () => {
    const m1 = makeMutation({ mutation_id: 'm-1', object_id: 'obj-1' })
    const m2 = makeMutation({ mutation_id: 'm-2', object_id: 'obj-2', operation: 'update', base_revision: 1 })
    const m3 = makeMutation({ mutation_id: 'm-3', object_id: 'obj-3', operation: 'delete', base_revision: 2 })
    const repo = makeRepo([m1, m2, m3])
    const pushFn = mockPush([
      { kind: 'accepted', resultRevision: 1 },
      { kind: 'accepted', resultRevision: 2 },
      { kind: 'accepted', resultRevision: 3 },
    ])
    const result = await syncNow({ pushFn, repo })
    expect(result).toEqual({ ...BASE_SUMMARY, pushed: 3, succeeded: 3, failed: 0, conflict: 0, unavailable: 0 })
    expect(pushFn.mock.calls.map(c => c[0].mutation_id)).toEqual(['m-1', 'm-2', 'm-3'])
  })

  it('mixed results: accepted, conflict (rebased), rejected, unavailable', async () => {
    const m1 = makeMutation({ mutation_id: 'm-1' })
    const m2 = makeMutation({ mutation_id: 'm-2' })
    const m3 = makeMutation({ mutation_id: 'm-3' })
    const m4 = makeMutation({ mutation_id: 'm-4' })
    const repo = makeRepo([m1, m2, m3, m4])
    const pushFn = mockPush([
      { kind: 'accepted', resultRevision: 1 },
      { kind: 'conflict', reason: 'revision_conflict', current: { revision: 3, object_id: 'obj-1', object_type: 'link', deleted: false, deleted_at: null, payload: {} } },
      { kind: 'rejected', status: 400, reason: 'malformed_mutation' },
      { kind: 'unavailable', status: 500, reason: 'server_error' },
    ])
    const result = await syncNow({ pushFn, repo })
    expect(result).toEqual({ ...BASE_SUMMARY, pushed: 4, succeeded: 1, failed: 1, conflict: 1, unavailable: 1 })
    expect(repo.calls.markSucceeded).toEqual(['m-1'])
    expect(repo.calls.markFailed).toEqual(['m-3'])
    expect(repo.calls.rebased).toHaveLength(1)
  })

  it('stringifies object payloads before sending', async () => {
    const objPayload = { id: 'obj-1', url: 'https://example.com', title: 'Test' }
    const m = makeMutation({ payload: objPayload })
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 1 }])
    await syncNow({ pushFn, repo })
    const sent = pushFn.mock.calls[0][0]
    expect(typeof sent.payload).toBe('string')
    expect(JSON.parse(sent.payload)).toEqual(objPayload)
  })

  it('passes string payloads through unchanged', async () => {
    const strPayload = '{"id":"obj-1","url":"https://example.com"}'
    const m = makeMutation({ payload: strPayload })
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 1 }])
    await syncNow({ pushFn, repo })
    const sent = pushFn.mock.calls[0][0]
    expect(sent.payload).toBe(strPayload)
  })

  it('local revision is never incremented by the coordinator', async () => {
    const m = makeMutation({ base_revision: 0 })
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 1 }])
    await syncNow({ pushFn, repo })
    expect(repo.calls.updateRevision[0].revision).toBe(1)
  })

  it('does not update revision on unavailable — leaves mutation pending', async () => {
    const m = makeMutation()
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'unavailable', status: 503, reason: 'unavailable' }])
    await syncNow({ pushFn, repo })
    expect(repo.calls.updateRevision).toEqual([])
    expect(repo.calls.markFailed).toEqual([])
  })

  it('object_type folder maps to the folders store', async () => {
    const m = makeMutation({ object_type: 'folder' })
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 1 }])
    await syncNow({ pushFn, repo })
    expect(repo.calls.updateRevision[0].storeName).toBe('folders')
  })

  it('object_type link maps to the links store', async () => {
    const m = makeMutation({ object_type: 'link' })
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 1 }])
    await syncNow({ pushFn, repo })
    expect(repo.calls.updateRevision[0].storeName).toBe('links')
  })

  // --- Chunk 4 rebase integration tests ---

  it('conflict rebase creates a new pending mutation with unique mutation_id', async () => {
    const m = makeMutation({ mutation_id: 'orig-123' })
    const repo = makeRepo([m])
    const pushFn = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: { revision: 4, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' },
    }])
    await syncNow({ pushFn, repo })
    const rebased = repo.calls.rebased[0].rebased
    expect(rebased.mutation_id).not.toBe('orig-123')
    expect(rebased.mutation_id.length).toBeGreaterThan(0)
  })

  it('conflict rebase: CREATE converts to UPDATE', async () => {
    const m = makeMutation({ operation: 'create', payload: { id: 'obj-1', title: 'New' } })
    const repo = makeRepo([m])
    const pushFn = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: { revision: 2, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' },
    }])
    await syncNow({ pushFn, repo })
    expect(repo.calls.rebased[0].rebased.operation).toBe('update')
  })

  it('conflict rebase: UPDATE stays UPDATE', async () => {
    const m = makeMutation({ operation: 'update', base_revision: 1, payload: { id: 'obj-1', title: 'V2' } })
    const repo = makeRepo([m])
    const pushFn = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: { revision: 5, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' },
    }])
    await syncNow({ pushFn, repo })
    expect(repo.calls.rebased[0].rebased.operation).toBe('update')
    expect(repo.calls.rebased[0].rebased.base_revision).toBe(5)
  })

  it('conflict rebase: DELETE against live object stays DELETE', async () => {
    const m = makeMutation({ operation: 'delete', payload: { id: 'obj-1' } })
    const repo = makeRepo([m])
    const pushFn = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: { revision: 8, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' },
    }])
    await syncNow({ pushFn, repo })
    expect(repo.calls.rebased[0].rebased.operation).toBe('delete')
    expect(repo.calls.rebased[0].rebased.base_revision).toBe(8)
  })

  it('conflict rebase: DELETE against already-deleted object marks succeeded', async () => {
    const m = makeMutation({ operation: 'delete', payload: { id: 'obj-1' } })
    const repo = makeRepo([m])
    const pushFn = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: { revision: 6, deleted: true, deleted_at: 999, payload: null, object_id: 'obj-1', object_type: 'link' },
    }])
    await syncNow({ pushFn, repo })
    expect(repo.calls.markSucceeded).toEqual(['mut-001'])
    expect(repo.calls.rebased).toEqual([])
  })

  it('rebased mutation is NOT processed during the same syncNow() call', async () => {
    const m = makeMutation({ mutation_id: 'first' })
    const repo = makeRepo([m])
    // First call: conflict -> creates rebased mutation
    const pushFn = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: { revision: 1, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' },
    }])
    const result = await syncNow({ pushFn, repo })
    expect(result.pushed).toBe(1)
    expect(result.conflict).toBe(1)
    // pushFn was called exactly once — the rebased mutation was NOT pushed
    expect(pushFn).toHaveBeenCalledOnce()
  })

  it('multiple conflicts create separate rebased mutations', async () => {
    const m1 = makeMutation({ mutation_id: 'm-1', object_id: 'obj-1' })
    const m2 = makeMutation({ mutation_id: 'm-2', object_id: 'obj-2', operation: 'update', base_revision: 1 })
    const repo = makeRepo([m1, m2])
    const pushFn = mockPush([
      { kind: 'conflict', reason: 'revision_conflict', current: { revision: 3, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' } },
      { kind: 'conflict', reason: 'revision_conflict', current: { revision: 7, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-2', object_type: 'link' } },
    ])
    const result = await syncNow({ pushFn, repo })
    expect(result.conflict).toBe(2)
    expect(repo.calls.rebased).toHaveLength(2)
    expect(repo.calls.rebased[0].rebased.base_revision).toBe(3)
    expect(repo.calls.rebased[1].rebased.base_revision).toBe(7)
  })

  it('object payload survives rebase', async () => {
    const payload = { id: 'obj-1', title: 'Test', tags: ['a', 'b'] }
    const m = makeMutation({ operation: 'update', payload })
    const repo = makeRepo([m])
    const pushFn = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: { revision: 2, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' },
    }])
    await syncNow({ pushFn, repo })
    expect(repo.calls.rebased[0].rebased.payload).toEqual(payload)
  })

  it('string payload survives rebase', async () => {
    const payload = '{"id":"obj-1","title":"Test"}'
    const m = makeMutation({ operation: 'update', payload })
    const repo = makeRepo([m])
    const pushFn = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: { revision: 3, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' },
    }])
    await syncNow({ pushFn, repo })
    expect(repo.calls.rebased[0].rebased.payload).toBe(payload)
  })

  it('unavailable/network failure creates no rebased mutation', async () => {
    const m = makeMutation()
    const repo = makeRepo([m])
    const pushFn = mockPush([new Error('network error')])
    const result = await syncNow({ pushFn, repo })
    expect(result.unavailable).toBe(1)
    expect(repo.calls.rebased).toEqual([])
  })

  it('rejected mutation creates no rebased mutation', async () => {
    const m = makeMutation()
    const repo = makeRepo([m])
    const pushFn = mockPush([{ kind: 'rejected', status: 400, reason: 'malformed' }])
    const result = await syncNow({ pushFn, repo })
    expect(result.failed).toBe(1)
    expect(repo.calls.rebased).toEqual([])
  })

  it('no local revision increment occurs during rebase', async () => {
    const m = makeMutation({ operation: 'update', base_revision: 0 })
    const repo = makeRepo([m])
    const pushFn = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: { revision: 5, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' },
    }])
    await syncNow({ pushFn, repo })
    // No updateRevision should have been called (rebase doesn't update local revision)
    expect(repo.calls.updateRevision).toEqual([])
  })

  it('repeated syncNow() would process the rebased mutation', async () => {
    const m = makeMutation({ mutation_id: 'first' })
    const repo = makeRepo([m])
    // First syncNow: conflict -> rebase
    const pushFn1 = mockPush([{
      kind: 'conflict',
      reason: 'revision_conflict',
      current: { revision: 1, deleted: false, deleted_at: null, payload: {}, object_id: 'obj-1', object_type: 'link' },
    }])
    await syncNow({ pushFn: pushFn1, repo })
    expect(repo.pending.filter(x => x.status === 'pending').length).toBe(1)

    // Second syncNow: the rebased mutation is now pending
    const pushFn2 = mockPush([{ kind: 'accepted', resultRevision: 2 }])
    const result2 = await syncNow({ pushFn: pushFn2, repo })
    expect(result2.succeeded).toBe(1)
    expect(pushFn2).toHaveBeenCalledOnce()
  })

  // --- pull integration: pull → reconcile → push ---

  it('pull then push: acceptable server objects applied locally, then queue drains', async () => {
    const repo = makeRepo([makeMutation({ operation: 'update', base_revision: 1 })])
    // Server reports a NEWER authoritative object for a *different* id than the
    // mutation — reconciled, then the pending update is pushed.
    const pullFn = vi.fn().mockResolvedValue({
      kind: 'ok',
      objects: [
        { object_id: 'remote-1', object_type: 'link', revision: 3, deleted: false, deleted_at: null, payload: { id: 'remote-1', title: 'from server' }, created_at: 1, updated_at: 2 },
      ],
    })
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 2 }])
    const result = await syncNow({ pullFn, pushFn, repo })

    // pull applied the server object
    expect(repo.calls.upsert).toHaveLength(1)
    expect(repo.calls.upsert[0]).toEqual({ type: 'link', record: { id: 'remote-1', title: 'from server', revision: 3 } })
    expect(result.pulled).toBe(1)
    expect(result.applied).toBe(1)
    // push drained the pending mutation
    expect(result.pushed).toBe(1)
    expect(result.succeeded).toBe(1)
  })

  it('pull is unavailable: no push occurs and unavailable is reported (no false success)', async () => {
    const repo = makeRepo([makeMutation()])
    const pullFn = vi.fn().mockResolvedValue({ kind: 'unavailable', status: 503, reason: 'unavailable' })
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 1 }])
    const result = await syncNow({ pullFn, pushFn, repo })
    expect(result.unavailable).toBe(1)
    expect(result.succeeded).toBe(0)
    expect(pushFn).not.toHaveBeenCalled()
  })

  it('pull is rejected (401): reported as failed, no push', async () => {
    const repo = makeRepo([makeMutation()])
    const pullFn = vi.fn().mockResolvedValue({ kind: 'rejected', status: 401, reason: 'unauthenticated' })
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 1 }])
    const result = await syncNow({ pullFn, pushFn, repo })
    expect(result.failed).toBe(1)
    expect(pushFn).not.toHaveBeenCalled()
  })

  it('pull network failure (fetch throws): unavailable, no push', async () => {
    const repo = makeRepo([makeMutation()])
    const pullFn = vi.fn().mockRejectedValue(new Error('offline'))
    const pushFn = mockPush([{ kind: 'accepted', resultRevision: 1 }])
    const result = await syncNow({ pullFn, pushFn, repo })
    expect(result.unavailable).toBe(1)
    expect(pushFn).not.toHaveBeenCalled()
  })
})

// ---- pullAndReconcile unit tests ----------------------------------------------

describe('pullAndReconcile', () => {
  it('returns the base shape when not authenticated (no network)', async () => {
    const original = (await import('../auth/session.js')).session.getState
    try {
      (await import('../auth/session.js')).session.getState = () => ({ status: 'anonymous', user: null })
      const pullFn = vi.fn()
      const repo = makeRepo([])
      const summary = await pullAndReconcile({ pullFn, repo })
      expect(summary).toEqual({ pulled: 0, applied: 0, skippedLocal: 0, skippedStale: 0, unavailable: false, rejected: false })
      expect(pullFn).not.toHaveBeenCalled()
    } finally {
      (await import('../auth/session.js')).session.getState = original
    }
  })

  it('server object newer than local -> applied to local store with server revision', async () => {
    const repo = makeRepo([])
    repo.local.links.push({ id: 'a', title: 'local v1', revision: 1 })
    const pullFn = vi.fn().mockResolvedValue({
      kind: 'ok',
      objects: [{ object_id: 'a', object_type: 'link', revision: 2, deleted: false, deleted_at: null, payload: { id: 'a', title: 'server v2' } }],
    })
    const summary = await pullAndReconcile({ pullFn, repo })
    expect(summary.applied).toBe(1)
    expect(repo.calls.upsert).toHaveLength(1)
    expect(repo.calls.upsert[0].record).toMatchObject({ id: 'a', title: 'server v2', revision: 2 })
  })

  it('server tombstone -> local object deleted (preserved as local-deleted)', async () => {
    const repo = makeRepo([])
    repo.local.links.push({ id: 'gone', title: 'x', revision: 1 })
    const pullFn = vi.fn().mockResolvedValue({
      kind: 'ok',
      objects: [{ object_id: 'gone', object_type: 'link', revision: 2, deleted: true, deleted_at: 5, payload: null }],
    })
    const summary = await pullAndReconcile({ pullFn, repo })
    expect(summary.applied).toBe(1)
    expect(repo.calls.deleted).toEqual([{ type: 'link', id: 'gone' }])
    expect(repo.local.links).toEqual([])
  })

  it('server tombstone for a folder -> local folder deleted', async () => {
    const repo = makeRepo([])
    repo.local.folders.push({ id: 'f1', name: 'F', revision: 1 })
    const pullFn = vi.fn().mockResolvedValue({
      kind: 'ok',
      objects: [{ object_id: 'f1', object_type: 'folder', revision: 2, deleted: true, deleted_at: 5, payload: null }],
    })
    const summary = await pullAndReconcile({ pullFn, repo })
    expect(summary.applied).toBe(1)
    expect(repo.calls.deleted).toEqual([{ type: 'folder', id: 'f1' }])
  })

  it('local newer than server -> server does not overwrite local', async () => {
    const repo = makeRepo([])
    repo.local.links.push({ id: 'a', title: 'newer local', revision: 5 })
    const pullFn = vi.fn().mockResolvedValue({
      kind: 'ok',
      objects: [{ object_id: 'a', object_type: 'link', revision: 2, deleted: false, deleted_at: null, payload: { id: 'a', title: 'older server' } }],
    })
    const summary = await pullAndReconcile({ pullFn, repo })
    expect(summary.skippedStale).toBe(1)
    expect(summary.applied).toBe(0)
    expect(repo.calls.upsert).toEqual([])
  })

  it('pending local mutation is preserved (server object not applied to that id)', async () => {
    const repo = makeRepo([makeMutation({ object_id: 'p', account_id: 'acc-1' })])
    const pullFn = vi.fn().mockResolvedValue({
      kind: 'ok',
      objects: [{ object_id: 'p', object_type: 'link', revision: 9, deleted: false, deleted_at: null, payload: { id: 'p', title: 'server' } }],
    })
    const summary = await pullAndReconcile({ pullFn, repo })
    expect(summary.skippedLocal).toBe(1)
    expect(summary.applied).toBe(0)
    expect(repo.calls.upsert).toEqual([])
    // The pending mutation is untouched.
    expect(repo.pending[0].status).toBe('pending')
  })

  it('unavailable pull -> unreconciled, no network-object application', async () => {
    const pullFn = vi.fn().mockResolvedValue({ kind: 'unavailable', status: 503, reason: 'unavailable' })
    const summary = await pullAndReconcile({ pullFn, repo: makeRepo([]) })
    expect(summary.unavailable).toBe(true)
    expect(summary.applied).toBe(0)
  })
})
