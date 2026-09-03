// Tests for the cloud sync client transport (src/sync/protocol.js).
// Mocks fetch; never hits a real network or IndexedDB.
import { describe, it, expect, vi } from 'vitest'
import { pushMutation } from './protocol.js'

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
