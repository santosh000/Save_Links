// Tests for the cloud sync client transport (src/sync/protocol.js).
// Mocks fetch; never hits a real network or IndexedDB.
import { describe, it, expect, vi } from 'vitest'
import { pushMutation, pushMutations, pullObjects } from './protocol.js'

const BASE_MUTATION = {
  mutation_id: 'test-mutation-001',
  object_type: 'link',
  object_id: 'obj-001',
  operation: 'create',
  base_revision: 0,
  payload: '{"url":"https://example.com"}',
}

function mockFetch(status, body) {
  return vi.fn().mockResolvedValue({
    status,
    json: () => Promise.resolve(body),
  })
}

describe('pushMutation — client transport', () => {
  it('sends correct method, headers, and body shape', async () => {
    const fetchFn = mockFetch(200, { accepted: true, result_revision: 1 })
    await pushMutation(BASE_MUTATION, { fetch: fetchFn })

    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, opts] = fetchFn.mock.calls[0]
    expect(url).toBe('/api/sync/mutation')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')

    const sent = JSON.parse(opts.body)
    expect(sent).toEqual({
      mutation_id: BASE_MUTATION.mutation_id,
      object_type: 'link',
      object_id: 'obj-001',
      operation: 'create',
      base_revision: 0,
      payload: BASE_MUTATION.payload,
    })
    // account_id must NOT be sent
    expect(sent).not.toHaveProperty('account_id')
  })

  it('uses apiOrigin prefix when provided', async () => {
    const fetchFn = mockFetch(200, { accepted: true, result_revision: 1 })
    await pushMutation(BASE_MUTATION, { fetch: fetchFn, apiOrigin: 'https://api.example.com' })
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.example.com/api/sync/mutation')
  })

  it('200 accepted -> kind: "accepted" with resultRevision', async () => {
    const fetchFn = mockFetch(200, { accepted: true, result_revision: 3 })
    const result = await pushMutation(BASE_MUTATION, { fetch: fetchFn })
    expect(result).toEqual({ kind: 'accepted', resultRevision: 3 })
  })

  it('200 accepted (idempotent replay) -> kind: "accepted"', async () => {
    const fetchFn = mockFetch(200, { accepted: true, result_revision: 1 })
    const result = await pushMutation(BASE_MUTATION, { fetch: fetchFn })
    expect(result).toEqual({ kind: 'accepted', resultRevision: 1 })
  })

  it('409 conflict -> kind: "conflict" with current object', async () => {
    const current = { object_id: 'obj-001', object_type: 'link', revision: 5, deleted: false, deleted_at: null, payload: {} }
    const fetchFn = mockFetch(409, { accepted: false, reason: 'revision_conflict', current })
    const result = await pushMutation(BASE_MUTATION, { fetch: fetchFn })
    expect(result).toEqual({ kind: 'conflict', reason: 'revision_conflict', current })
  })

  it('409 conflict with null current -> kind: "conflict"', async () => {
    const fetchFn = mockFetch(409, { accepted: false, reason: 'revision_conflict', current: null })
    const result = await pushMutation(BASE_MUTATION, { fetch: fetchFn })
    expect(result).toEqual({ kind: 'conflict', reason: 'revision_conflict', current: null })
  })

  it('400 malformed -> kind: "rejected"', async () => {
    const fetchFn = mockFetch(400, { error: 'malformed_mutation' })
    const result = await pushMutation(BASE_MUTATION, { fetch: fetchFn })
    expect(result).toEqual({ kind: 'rejected', status: 400, reason: 'malformed_mutation' })
  })

  it('401 unauthenticated -> kind: "rejected"', async () => {
    const fetchFn = mockFetch(401, { error: 'unauthenticated' })
    const result = await pushMutation(BASE_MUTATION, { fetch: fetchFn })
    expect(result).toEqual({ kind: 'rejected', status: 401, reason: 'unauthenticated' })
  })

  it('403 forbidden -> kind: "rejected"', async () => {
    const fetchFn = mockFetch(403, { error: 'forbidden' })
    const result = await pushMutation(BASE_MUTATION, { fetch: fetchFn })
    expect(result).toEqual({ kind: 'rejected', status: 403, reason: 'forbidden' })
  })

  it('500 server error -> kind: "unavailable"', async () => {
    const fetchFn = mockFetch(500, { error: 'server_error' })
    const result = await pushMutation(BASE_MUTATION, { fetch: fetchFn })
    expect(result).toEqual({ kind: 'unavailable', status: 500, reason: 'server_error' })
  })

  it('503 service unavailable -> kind: "unavailable"', async () => {
    const fetchFn = mockFetch(503, { error: 'unavailable' })
    const result = await pushMutation(BASE_MUTATION, { fetch: fetchFn })
    expect(result).toEqual({ kind: 'unavailable', status: 503, reason: 'unavailable' })
  })

  it('network failure (fetch throws) propagates the error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('Network error'))
    await expect(pushMutation(BASE_MUTATION, { fetch: fetchFn })).rejects.toThrow('Network error')
  })

  it('malformed JSON response -> kind: "unavailable" with status from HTTP', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.reject(new Error('bad json')),
    })
    const result = await pushMutation(BASE_MUTATION, { fetch: fetchFn })
    // body?.error would be null; fallback to 'unknown'
    expect(result.kind).toBe('unavailable')
  })

  it('delete operation round-trips correctly', async () => {
    const deleteMutation = { ...BASE_MUTATION, operation: 'delete', base_revision: 3 }
    const fetchFn = mockFetch(200, { accepted: true, result_revision: 4 })
    await pushMutation(deleteMutation, { fetch: fetchFn })
    const sent = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(sent.operation).toBe('delete')
    expect(sent.base_revision).toBe(3)
  })

  it('folder object_type round-trips correctly', async () => {
    const folderMutation = { ...BASE_MUTATION, object_type: 'folder' }
    const fetchFn = mockFetch(200, { accepted: true, result_revision: 1 })
    await pushMutation(folderMutation, { fetch: fetchFn })
    const sent = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(sent.object_type).toBe('folder')
  })
})

describe('pushMutations — batched client transport', () => {
  const M1 = { ...BASE_MUTATION, mutation_id: 'batch-1', object_id: 'obj-1' }
  const M2 = { ...BASE_MUTATION, mutation_id: 'batch-2', object_id: 'obj-2', operation: 'update', base_revision: 1 }
  const M3 = { ...BASE_MUTATION, mutation_id: 'batch-3', object_id: 'obj-3', operation: 'delete', base_revision: 2 }

  it('sends one request to /api/sync/mutations with a mutations array, no account_id', async () => {
    const fetchFn = mockFetch(200, { accepted: true, results: [
      { mutation_id: 'batch-1', accepted: true, result_revision: 1 },
      { mutation_id: 'batch-2', accepted: true, result_revision: 2 },
    ] })
    await pushMutations([M1, M2], { fetch: fetchFn })

    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, opts] = fetchFn.mock.calls[0]
    expect(url).toBe('/api/sync/mutations')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')

    const sent = JSON.parse(opts.body)
    expect(sent.mutations).toEqual([
      { mutation_id: 'batch-1', object_type: 'link', object_id: 'obj-1', operation: 'create', base_revision: 0, payload: BASE_MUTATION.payload },
      { mutation_id: 'batch-2', object_type: 'link', object_id: 'obj-2', operation: 'update', base_revision: 1, payload: BASE_MUTATION.payload },
    ])
    expect(sent.mutations[0]).not.toHaveProperty('account_id')
  })

  it('uses apiOrigin prefix when provided', async () => {
    const fetchFn = mockFetch(200, { accepted: true, results: [] })
    await pushMutations([M1], { fetch: fetchFn, apiOrigin: 'https://api.example.com' })
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.example.com/api/sync/mutations')
  })

  it('maps per-entry accepted results back in input order with mutation_id', async () => {
    const fetchFn = mockFetch(200, { accepted: true, results: [
      { mutation_id: 'batch-2', accepted: true, result_revision: 2 },
      { mutation_id: 'batch-1', accepted: true, result_revision: 1 },
    ] })
    // Server response is REORDERED — results must still pair by mutation_id.
    const results = await pushMutations([M1, M2], { fetch: fetchFn })
    expect(results).toEqual([
      { kind: 'accepted', mutationId: 'batch-1', resultRevision: 1 },
      { kind: 'accepted', mutationId: 'batch-2', resultRevision: 2 },
    ])
  })

  it('maps per-entry conflicts with the server current object', async () => {
    const current = { object_id: 'obj-2', object_type: 'link', revision: 5, deleted: false, deleted_at: null, payload: {} }
    const fetchFn = mockFetch(200, { accepted: true, results: [
      { mutation_id: 'batch-1', accepted: true, result_revision: 1 },
      { mutation_id: 'batch-2', accepted: false, reason: 'revision_conflict', current },
    ] })
    const results = await pushMutations([M1, M2], { fetch: fetchFn })
    expect(results[0]).toEqual({ kind: 'accepted', mutationId: 'batch-1', resultRevision: 1 })
    expect(results[1]).toEqual({ kind: 'conflict', mutationId: 'batch-2', reason: 'revision_conflict', current })
  })

  it('maps a per-entry server error (server_error) to unavailable/retryable', async () => {
    const fetchFn = mockFetch(200, { accepted: true, results: [
      { mutation_id: 'batch-1', accepted: false, reason: 'server_error' },
    ] })
    const results = await pushMutations([M1], { fetch: fetchFn })
    expect(results).toEqual([
      { kind: 'unavailable', mutationId: 'batch-1', status: 500, reason: 'server_error' },
    ])
  })

  it('a missing/unknown result entry degrades to unavailable (retryable), not a mis-pairing', async () => {
    const fetchFn = mockFetch(200, { accepted: true, results: [
      { mutation_id: 'batch-1', accepted: true, result_revision: 1 },
      // batch-2's result is omitted entirely
    ] })
    const results = await pushMutations([M1, M2], { fetch: fetchFn })
    expect(results[0].kind).toBe('accepted')
    expect(results[1]).toEqual({ kind: 'unavailable', mutationId: 'batch-2', status: 500, reason: 'server_error' })
  })

  it('whole-request client error (401) -> one rejected result per member', async () => {
    const fetchFn = mockFetch(401, { error: 'unauthenticated' })
    const results = await pushMutations([M1, M2, M3], { fetch: fetchFn })
    expect(results).toEqual([
      { kind: 'rejected', mutationId: 'batch-1', status: 401, reason: 'unauthenticated' },
      { kind: 'rejected', mutationId: 'batch-2', status: 401, reason: 'unauthenticated' },
      { kind: 'rejected', mutationId: 'batch-3', status: 401, reason: 'unauthenticated' },
    ])
  })

  it('whole-request availability error (503) -> one unavailable result per member', async () => {
    const fetchFn = mockFetch(503, { error: 'unavailable' })
    const results = await pushMutations([M1, M2], { fetch: fetchFn })
    expect(results).toEqual([
      { kind: 'unavailable', mutationId: 'batch-1', status: 503, reason: 'unavailable' },
      { kind: 'unavailable', mutationId: 'batch-2', status: 503, reason: 'unavailable' },
    ])
  })

  it('network failure (fetch throws) propagates the error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('Network error'))
    await expect(pushMutations([M1], { fetch: fetchFn })).rejects.toThrow('Network error')
  })
})

describe('pullObjects — client read transport', () => {
  const OBJECTS = [
    { object_id: 'a', object_type: 'link', revision: 1, deleted: false, deleted_at: null, payload: {}, created_at: 1, updated_at: 1 },
  ]

  it('issues a GET to /api/sync/objects and returns the object array', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ objects: OBJECTS }),
    })
    const result = await pullObjects({ fetch: fetchFn })
    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, opts] = fetchFn.mock.calls[0]
    expect(url).toBe('/api/sync/objects')
    expect(opts.method).toBe('GET')
    expect(result).toEqual({ kind: 'ok', objects: OBJECTS })
  })

  it('uses apiOrigin prefix when provided', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ objects: [] }),
    })
    await pullObjects({ fetch: fetchFn, apiOrigin: 'https://api.example.com' })
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.example.com/api/sync/objects')
  })

  it('200 with an empty object list -> kind ok, empty array', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ objects: [] }),
    })
    expect(await pullObjects({ fetch: fetchFn })).toEqual({ kind: 'ok', objects: [] })
  })

  it('200 but objects is not an array -> kind unavailable (malformed response)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ objects: 'nope' }),
    })
    const result = await pullObjects({ fetch: fetchFn })
    expect(result.kind).toBe('unavailable')
  })

  it('401 unauthenticated -> kind rejected', async () => {
    const fetchFn = mockFetch(401, { error: 'unauthenticated' })
    expect(await pullObjects({ fetch: fetchFn })).toEqual({ kind: 'rejected', status: 401, reason: 'unauthenticated' })
  })

  it('403 forbidden -> kind rejected', async () => {
    const fetchFn = mockFetch(403, { error: 'forbidden' })
    expect(await pullObjects({ fetch: fetchFn })).toEqual({ kind: 'rejected', status: 403, reason: 'forbidden' })
  })

  it('503 unavailable -> kind unavailable', async () => {
    const fetchFn = mockFetch(503, { error: 'unavailable' })
    expect(await pullObjects({ fetch: fetchFn })).toEqual({ kind: 'unavailable', status: 503, reason: 'unavailable' })
  })

  it('500 server error -> kind unavailable', async () => {
    const fetchFn = mockFetch(500, { error: 'server_error' })
    expect(await pullObjects({ fetch: fetchFn })).toEqual({ kind: 'unavailable', status: 500, reason: 'server_error' })
  })

  it('malformed JSON response -> kind unavailable', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.reject(new Error('bad json')),
    })
    expect((await pullObjects({ fetch: fetchFn })).kind).toBe('unavailable')
  })

  it('network failure (fetch throws) propagates the error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(pullObjects({ fetch: fetchFn })).rejects.toThrow('offline')
  })
})
