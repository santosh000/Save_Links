# Save_Links — Cloud Sync Architecture

**Status:** Design-only. No application/source code, migration, IndexedDB schema,
or scaffold file is changed by this document. This is the review-and-approve
gate before any sync code is written.

**Basis:** Read from the actual repository (`master` `608209e` + the preserved
working state `5fe38b4`): `.opencode/architecture.md`, `.opencode/project.md`,
`SECURITY.md`, `AGENTS.md`, `worker/auth.js`, `worker/api.js`, `worker/index.js`,
`worker/db/store.js`, `worker/db/store.test.js` (read-only), `worker/oauth/*`,
`migrations/0001..0003`, `src/domain/link.js`, `src/storage/indexeddb.js`,
`src/storage/contract.js`, `src/storage/repository.js`, `src/auth/*` (session,
contract, memory-adapter, accountService, authValidation), `src/composables/useLinks.js`,
`useFolders.js`, `useProfile.js`, `useSettings.js`, `src/utils/backup.js`, the
preserved sync scaffold (`src/sync/*`, `useSync.js`, `SyncPanel.vue`,
`AccountPanel.vue`, `LocalProfilePanel.vue`), and `src/App.vue`.

---

## 1. Executive decision

**Implement v1 cloud sync as a per-account, object-level, mutation-outbox
(push-first) + incremental-snapshot (pull) protocol over the existing
Cloudflare Worker + D1 + GitHub-OAuth foundation, with per-object integer
`revision`s and last-writer-wins (LWW) conflict resolution keyed on the
server-assigned revision. No device IDs, no vector clocks, no event sourcing,
no background sync in v1.**

Rationale for the three load-bearing decisions:

- **Globally-unique client IDs are already true and are KEPT.** New links and
  folders are created with RFC-4122 UUIDv4 (`domain/link.js generateId()`).
  UUIDv4 collision odds across any realistic user population are negligible
  (~2^122 keyspace). The scaffold's `(object_id)` primary-key-per-account model
  therefore needs **no migration of IDs and no cloud/object indirection**: a
  browser-generated UUIDv4 is globally unique, so it is safe to use as the
  cloud object identity across all devices of an account. (Full tradeoff in §4.)

- **Per-object integer `revision`, server-authoritative, LWW on revision.**
  This is the smallest model that is deterministic, recoverable, and safe for
  the product's actual shape (a single human editing a personal bookmark list,
  typically one device active at a time). Links/folders are independent rows;
  the only cross-object dependency is folder membership, handled as a reference
  (see §9, §17). This deliberately **rejects** the added machinery of vector
  clocks / CRDTs / per-field merge, because concurrent multi-device edits of
  the *same* link by the *same* person are rare, and LWW always converges to a
  single deterministic end-state. The cost — one device's older write may be
  overwritten — is accepted and made *visible and recoverable* (§6, §10, §17),
  not silently hidden.

- **Push-first outbox + page-by-revision pull, explicit/user-triggered, no
  background sync in v1.** Local CRUD stays fully synchronous and offline-first
  (writes to IndexedDB immediately, queue a pending mutation). A pending-mutation
  outbox guarantees cloud changes reach the server *in order and exactly once*
  (idempotency key = `mutation_id`). Pull is incremental (objects newer than a
  cursor), bounded, page-driven, and free-plan friendly. It is triggered
  explicitly (`syncNow()`: on login, on an explicit "Sync" affordance, and after
  a successful push batch) — never on a service-worker timer.

### Decisions changed from the existing design
- **`savedFrom` is now explicitly declared local-only and NOT synced.** The
  current local model stores it per link; the scaffold propagates the whole
  link `payload` opaque. This doc scopes the sync payload to exclude
  `savedFrom` (§3, §12). No code is changed now; this is the contract the
  sync payload will implement.
- **Account-scoped, not global, object namespace.** The scaffold already keys
  `sync_objects` by `(account_id, object_id)` — this doc elevates that to a hard
  isolation boundary and adds the equivalent per-account keyspace/cursor model
  for pull (§5, §8, §12).
- **Conflicting create → update, not create:** the scaffold maps a CREATE-hit
  to UPDATE (§6). Kept and made explicit.
- **The existing single-mutation `POST /api/sync/mutation` endpoint is kept as
  the push primitive; a new minimal `GET /api/sync/objects` pull endpoint is
  added (§12).** The current scaffold has no pull transport.
- **`revision: 0` = "never accepted by server."** For a CREATE this is the
  correct sentinel; the scaffold already enforces `create` requires
  `base_revision === 0`. Made explicit and extended to conflict resolution.

---

## 2. Architectural invariants

These are non-negotiable and checked against every design decision below.

1. **Local-first and offline-first.** Local application boot, CRUD, search,
   folders, favorites/important/must-have, profile, appearance/color-scheme,
   and export/import all work with **zero** cloud connectivity. Cloud failure
   must never block a local operation.
2. **Authentication and synchronization are separate layers.** Auth owns
   identity/session; sync owns data replication. Sync never implements or
   fakes authentication; auth never reads or claims application data.
3. **Account isolation is absolute.** Every cloud object, revision, mutation
   ledger row, and pull cursor is scoped by `account_id` derived **exclusively
   from the authenticated session** — never from any request body, header, or
   query. No cross-account read or write is possible (§11, §12).
4. **No silent local data destruction, ever.** Local deletes only ever remove
   local data through explicit user action or an explicit, reversible, agreed
   sync outcome. Adoption/login and logout never silently clear, merge, or
   overwrite local data (§7, §14).
5. **`savedFrom` is local provenance, never a device ID and never synced.**
   OAuth/provider identity is authentication metadata, never application data.
   No device identity is introduced for v1 (§3, §4, §12, §14).
6. **Deterministic convergence.** Identical input (same outbox, same server
   state, same revisions) always yields the same result. No timestamps are used
   for conflict ranking (§6).
7. **Server revision is the single source of truth for ordering.** Client
   revisions are the "last server-acked revision" for a given object; only the
   server increments a revision (§6, §8).
8. **Backup and sync are distinct** and user-distinguishable (§15).
9. **Minimal surface.** No new platforms, no new queues beyond the existing
   outbox, no background sync, no vector clocks, no device table in v1.
10. **Free-tier compatible.** Incremental, indexed, bounded reads; no polling;
    no full-database upload/download; page-driven pull (§19).

---

## 3. Authentication boundary

Reuse the existing Cloudflare-native foundation exactly as built. **Do not**
invent a new auth system.

- **Providers:** GitHub OAuth (web application flow, PKCE, no scopes) is the
  v1 provider. The identity model (`auth_identities`) is provider-neutral, so
  a second provider is a later additive change.
- **Provider → account mapping:** GitHub's stable, immutable numeric user id
  (String(id)) is the `provider_subject`; it maps to one opaque, provider-
  neutral D1 `account_id` (UUIDv4) via `auth_identities`, resolved/create
  atomically in `resolveAccountByProvider`. **The account id is the sync
  ownership key** (§4, §5).
- **No passwords.** GitHub OAuth + HttpOnly session is sufficient identity for
  cross-device sync. Introducing username/password would add credential
  storage, reset flows, and session-fixation surface with no product need.
  (The dangling username/password seams in `accountService.js`/`authValidation.js`
  are scaffold that applies only to a credential backend — see §20.)
- **Session:** opaque 32-byte token, only SHA-256 hash persisted, `__Host-`
  HttpOnly SameSite=Lax cookie in prod (dev fallback on plain http), 30-day
  TTL, expiration/revocation enforced in SQL, rotation on auth. **Reused as-is.**
- **Session expiry/offline behavior:** a session is a server-side artifact
  checked per request. If it expires or D1 is unreachable, the API returns 401
  / 503 and the **local app continues normally** (invariant 1). The client
  treats 401 as "cloud not available right now," keeps the outbox intact, and
  stops attempting push/pull until a fresh session exists — it never deletes
  local data and never blocks local CRUD. There is **no** offline session
  cache, no refresh token on the client: a re-login is a top-level OAuth flow.

**Separation of layers:** `src/auth/session.js` (state) is the only auth
surface the app/UI observes. The sync coordinator reads only `session.
getState().user?.id` to know *which account* an outbox entry belongs to — it
never triggers login, never stores a token, and never implements OAuth. The
worker treats each sync request as an independent authenticated call; it has no
notion of a "sync connection."

---

## 4. Identity model

**Account identity**
- `users.account_id` — opaque UUIDv4, provider-neutral, stable, the owner
  scope for all cloud data.
- `auth_identities(provider, provider_subject)` — provider-neutral mapping;
  one GitHub id → one account.

**Object identity (links / folders)**
- Client-generated RFC-4122 UUIDv4 (`domain/link.js generateId()`), stored as
  `id` locally and `object_id` on the server; `object_type` distinguishes
  link vs folder.
- **Decision: keep the client UUIDv4 as the single object identity (global);
  no ID migration, no namespacing, no separate cloud-object id.**
- **Why this is safe across devices:** UUIDv4 unique keyspace is ~2^122;
  birthday-collision probability stays negligible even at the full population
  of the app over decades. A device generates a UUID independently; the server
  keyspace is (account_id, object_id), so even a theoretical collision between
  two *different accounts* cannot merge data. Within one account, a collision
  between two *different devices* is astronomically improbable and, if it ever
  happened, would manifest as a deterministic create/update conflict (§6) that
  converges to one row — recoverable, never silently duplicated or dropped.
- **Tradeoff vs alternatives:**
  - *Migrate to globally unique IDs:* unnecessary — they already are unique.
  - *Namespace existing IDs (account prefix):* adds no safety (UUIDs already
    globally unique) and would break every existing local link/folder id,
    forcing a local migration with no benefit.
  - *Separate cloud/object identity:* adds a mapping layer (server-side
    `object_id` ≠ client `id`) purely to defer a collision that already cannot
    occur. Not worth the indirection for v1.
  - **Cost of keeping client UUID:** none for correctness; the only requirement
    is that create must be idempotent under `(account_id, object_id)` (§6, §8).

**No device identity.** v1 introduces no `device_id`. It is not needed for
ownership (account keys everything), not needed for conflict resolution
(server revisions order everything), and adds privacy surface (§14). A device
column can be added later if multi-device diagnostics or per-device outbox
sharding is ever required — flagged as a `ponytail:`-style deferral, not built
now.

**OAuth/provider identity is authentication metadata, never application data.**
The app never stores or syncs the GitHub login/email as a link field; the local
Profile remains a separate, local-only identity (§3, §14).

---

## 5. Cloud data model

### 5.1 Schema (D1, additive migration `0004`-style when implemented)

All object/ledger/cursor rows are prefixed by `account_id`. `users` already
exists (`0001`). New tables/models:

**`sync_objects`** (per-account object space — EXISTS in scaffold `0003`, kept
with refinements below).

| column | owner | purpose | client vs server | null / default | indexes | constraints |
|---|---|---|---|---|---|---|
| `account_id` | server | ownership scope | server (from session) | NOT NULL | PK (1,2) | FK→users; NO cascade (§10 note) |
| `object_id` | client | the UUIDv4 object id | client | NOT NULL | PK (2) | part of PK |
| `object_type` | server | 'link'\|'folder' | client (validated) | NOT NULL | with revision | CHECK in ('link','folder') |
| `revision` | server | authoritative version (1-based, ++ per applied mutation) | **server only** | NOT NULL | (account,type,revision) | INTEGER ≥1 |
| `deleted` | server | 0=live, 1=tombstone | server (from delete op) | NOT NULL DEFAULT 0 | — | 0/1 |
| `deleted_at` | server | tombstone timestamp (epoch ms) for GC | server | NULL when live | (account,deleted_at) | NULL if live |
| `payload` | client | the JSON body (opaque to server/DB) | client | NOT NULL | — | bounded by API (≤512 KiB) |
| `created_at` / `updated_at` | server | audit | server | NOT NULL | — | epoch ms |

Refinements over `0003`:
- `revision` recorded as unsigned 64-bit integer. `INTEGER` in SQLite is
  already 64-bit; keep 1-based, `>= 1` for a live/accepted object (0 is only
  the pre-accept client sentinel in §4 — never stored server-side for a
  created object).
- **Payload is a validated, normalized application object — not fully opaque**
  for v1. The server must read enough structure to authorize/E2E-scope fields
  (§12) and to serve pull snapshots that the client can reconcile. Full
  per-field schema validation is at the client trust boundary (§11, §12). The
  server stores the validated JSON as a string, but v1 validates structure and
  bounds server-side (it already validates `object_type`/`operation`).

**`sync_mutations`** (idempotency ledger — EXISTS in `0003`):

| column | owner | purpose | client vs server | null/dflt | notes |
|---|---|---|---|---|---|
| `account_id` | server | scope | server | NOT NULL | PK (1,2) |
| `mutation_id` | client | idempotency key (UUIDv4) | client | NOT NULL | PK (2); never reused for a different op |
| `object_id`, `object_type` | client | target | client | NOT NULL | — |
| `operation` | client | create/update/delete | client (validated) | NOT NULL | — |
| `base_revision` | client | revision the client based the op on | client | NOT NULL | server-validated |
| `status` | server | 'applied' (v1) | server | NOT NULL | ledger records applied outcomes |
| `result_revision` | server | authoritative revision after apply | server | NOT NULL | used for idempotent replay |
| `applied_at` | server | epoch ms | server | NOT NULL | — |

**`sync_cursors`** (NEW — pull cursor per deviceless account; replaces any
notion of a global client cursor):

| column | owner | purpose | client vs server | notes |
|---|---|---|---|---|
| `account_id` | server (PK 1) | which account's cursor | server | per-account |
| `cursor` | server | high-water revision marker | server | see §8 |

Design note on the cursor: with per-object LWW revisions there is no single
global file; pull is driven by a **per-account per-object-type revision
high-water mark** (§8). Two defensible encodings:
- (A) A `sync_cursors` table storing, per account, the last *globally seen
  applied revision / monotonic counter*. Fragile because revisions are per
  object and interleaved across objects.
- (B) **Query-side pagination:** pull pages objects with `revision > X` via the
  `idx_sync_objects_account_rev(account_id, object_type, revision)` index;
  `X` is the client-supplied high-water mark. No separate cursor table needed.
  **Chosen (B)** — it is index-driven, bounded, additive, and free-plan
  friendly. The client reports its high-water mark; the server returns the next
  page and tells the client the new high-water mark (the max revision in the
  returned page). (See §8 gate: the server still bounds how far ahead a pull
  may scan, and a full resync is a cursor of 0.)

### 5.2 Per-object payload (link)

Server-stored `payload` JSON for a link (all client-controlled except none;
ownership matrix in §6):

```
{
  id,                // == object_id, globally-unique UUIDv4
  originalUrl,       // display-only text; NEVER an href
  normalizedUrl,     // http(s) href bound; the canonical duplicate key
  url,               // legacy alias kept in sync
  domain,            // derived
  title,             // ≤200
  description,       // ≤400
  image,
  category,
  tags,              // array of non-empty strings
  important, mustHave, favorite,     // booleans
  folderId,          // link → folder relation (UUIDv4 or null)
  createdAt,         // ISO string, preserved across devices
  // savedFrom is NOT in the sync payload (local-only, §3, §12, §14)
}
```
`revision` and `account_id` are **not** part of the payload — they are row
columns, server-managed. The client already stores them as separate fields;
the wire payload excludes them.

### 5.3 Per-object payload (folder)

```
{ id, name /*≤50*/, createdAt }
```

### 5.4 What is NOT in the cloud model (v1)
- Local Profile (`name`/`bio`) — device-local KV (§3, §14).
- Appearance / color-scheme settings — device-local (§14).
- `savedFrom` — device-local provenance (§12).
- Pending-mutation queue contents — purely local; the server never stores the
  outbox, only its applied outcomes in `sync_mutations`.

---

## 6. Local vs cloud ownership matrix

"Server" = cloud replica authoritative for ordering; "Local" = device source of
truth for the field. **Client-controlled** = set by the user's device and
replicated; **server-controlled** = maintained by the server only.

| Field | Storage | Client vs server | Sync? | Notes |
|---|---|---|---|---|
| link `id` | local + cloud | client-generated | yes | UUIDv4, globally unique; = cloud `object_id` |
| link `originalUrl` | local + cloud | client | yes | display-only text |
| link `normalizedUrl` | local + cloud | client | yes | canonical duplicate key; http(s)-bound |
| link `url` | local + cloud | client (alias of normalizedUrl) | yes | kept in sync locally |
| link `title` | local + cloud | client | yes | ≤200 |
| link `description` | local + cloud | client | yes | ≤400 |
| link `image` | local + cloud | client | yes | |
| link `category` | local + cloud | client (derived default) | yes | |
| link `tags` | local + cloud | client | yes | string[] |
| link `favorite` | local + cloud | client | yes | |
| link `important` | local + cloud | client | yes | |
| link `mustHave` | local + cloud | client | yes | |
| link `folderId` | local + cloud | client | yes | cross-object ref (§9) |
| link `createdAt` | local + cloud | client | yes | ISO, preserved; never regenerated |
| link `savedFrom` | **local only** | client | **no** | provenance, not device id (§12) |
| link `status` (legacy) | local | client (derived) | yes (derived from flags) | not stored on cloud as a sync field |
| link `revision` | local + cloud | **server-controlled** | sync-external | last server-acked revision; sent as `base_revision` |
| link `account_id` | local (informational) + cloud (row scope) | **server** | sync-external | never in body; session-derived |
| folder `id` | local + cloud | client-generated | yes | UUIDv4 |
| folder `name` | local + cloud | client | yes | ≤50 |
| folder `createdAt` | local + cloud | client | yes | ISO |
| folder `revision` | local + cloud | **server** | sync-external | as links |
| Local Profile (`name`/`bio`) | local only | client | **no** | device-local identity (§14) |
| appearance / color-scheme | local only | client | **no** | device-local (§14) |
| sync metadata (revision/cursor) | local + cloud | server | sync-external | ordering, not user data |
| account/session info | cloud | server | auth layer | never application data |

**`savedFrom`** stays local provenance (what platform a link was saved from),
queried/displayed only on the saving device. It must NOT be repurposed as a
device ID for sync (it is coarse broad platform/OS today, not a stable
per-device key) — and v1 has no device concept at all (§4, §12, §14).

---

## 7. First-sync / adoption model

Core rule: **adoption/log sync never silently deletes local data, and never
merges two accounts' data without explicit user choice.**

Model per-account sync state is scoped to ONE account at a time. The local
dataset is the union of: (a) objects locally created before login, and
(b) objects pulled from the cloud for the current account. Cross-account
separation lives in §14.

The four situations:

**A. User has local data, logs into an EMPTY cloud account.**
- Outcome: local data is authoritative; it is uploaded (each local object
  becomes a `create` outbox entry) and becomes the cloud replica.
- Never a delete, never a clear. If upload partially fails, the outbox retries.

**B. User has empty local storage, logs into a cloud account WITH data.**
- Outcome: full incremental pull (cursor 0) materializes cloud objects into
  local IndexedDB. Local remains the operational store; cloud is replicated in.

**C. User has local data AND cloud data (for the same account).**
- Outcome: staged, deterministic reconciliation. The client computes the
  canonical local intent:
  - Objects that exist locally but not in the pulled set → pending `create`
    (they are new to the cloud).
  - Objects that exist in the pulled set but not locally → materialized
    locally (new to this device).
  - Objects in both → compare **server revision**: if the local object's
    `revision < server revision`, the server copy wins (pull overwrites local
    fields, preserving local only when the local `folderId`/user flags are
    absent on the server copy — a field-level fallback, see §6/§9); if the
    local object's `revision` is equal (last ack) no change; local queued
    mutations are replayed as updates.
  - **Deletes never propagate to local from a pull unless represented by a
    tombstone (§10) and, even then, only as an explicit, visible local delete
    of the matching object.** No silent removal.
- This is lossless: nothing is dropped; a conflict converges to the LWW winner
  (§6), and the loser remains recoverable via backup (§15).

**D. User logs out; another account logs into the same browser.**
- Logout is **authentication-only** (existing `session.logout()`): it clears
  the session, nothing else. On login of Account B:
  - Local data and outbox entries are `account_id`-scoped (§14).
  - All pending mutations for Account A remain queued but **must not** be sent
    under Account B's session. The coordinator sends only outbox entries whose
    `account_id` matches the current session account (§14).
  - Pull for Account B materializes only Account B objects. Account A's local
    objects are... (see §14 for the isolation decision).

**E. User logs back into the original account (Account A).**
- A's outbox (from §D, still stored with `account_id=A`) resumes; A's pending
  mutations replay; pull reconciles A's cloud state. Nothing of B's is touched.

**F. User is offline while logging in / session restoration fails.**
- The app boots fully local (invariant 1). `session.initSession()` marks state;
  sync simply does not run (no session → no account). The local outbox is
  preserved with its `account_id`. When connectivity/session returns,
  an explicit sync resumes. Nothing is queued for a future account it never
  belonged to.

**Guarantee restated:** adoption/login/logout make no destructive local change;
the only local deletes in the system are (a) explicit user deletes and
(b) reconciliation that replaced a genuinely-tombstoned object after explicit
UI confirmation (§10).

---

## 8. Sync protocol

### Direction
- **Push:** client → server, outbox `create|update|delete`, exactly-once via
  `mutation_id` idempotency.
- **Pull:** client → server `GET`, incremental snapshot of objects with
  revision > client high-water mark, page-by-page.

### Triggers (combination; user-triggered + startup + post-push; NO background sync)
1. **Explicit user action** — the primary trigger (`syncNow()`, exposed from
   the UI "Sync" affordance). This is the v1 contract and matches the scaffold.
2. **On login/adoption** (§7) — when a session first resolves to an account,
   run push (drain this account's outbox) then pull (reconcile), so a freshly
   logged-in device catches up.
3. **After a successful push batch** — pull once to fetch any revisions that
   changed server-side (other devices) so local is re-based.
No service-worker background sync, no visibilitychange/online-network timer
polling in v1 (free-tier, predictability).

### Cursor / revision model
- Every accepted mutation bumps the object's server `revision` by exactly 1
  (`revision+1`). `result_revision` is returned.
- The client tracks, per object, the last server-acked `revision` (its
  `base_revision` for the next op on that object).
- Pull pages use per-object high-water mark = max server revision already seen
  for that object type. Server serves the next `LIMIT` objects with
  `revision > base` from the index and returns the new high-water for the next
  page. Full resync = base 0.

### Idempotency & acknowledgement
- Each queued mutation carries a fresh `mutation_id` (UUIDv4). The server
  claims it in `sync_mutations` atomically with the object write (existing
  `applyObjectMutation` `db.batch` contract). A retried `mutation_id` returns
  the stored `result_revision` (replay) — indistinguishable from first apply.
- **Acknowledgement semantics:** a mutation is "acked" only when the push returns
  the authoritative `result_revision`; the client then writes that revision into
  the object and marks the outbox entry `succeeded`. If the response is lost but
  the server applied it (§17), the retry is an idempotent replay returning the
  same `result_revision`.

### Ordering
- Within one device, outbox entries are applied in queue order (the coordinator
  iterates in insertion order). Across devices, the **server** establishes
  global order by the revision it assigns; the client always re-bases against
  the server's latest revision on conflict (§6).

### Partial failure / retry
- Classify results: `accepted` (200), `conflict` (409), `rejected`
  (400/401/403 → not retryable, mark failed), `unavailable` (500/503/network →
  leave pending, retry later). Retry is explicit (`syncNow()`); no infinite
  tight loop, bounded retry metadata (§9).

---

## 9. Conflict resolution

**Model: server-assigned per-object integer revision + LWW on revision.
Deterministic, no timestamps, no vector clocks, no merge.**

Rules (each is deterministic given (client outbox → server state)):

- **Same object changed on two devices:** each device submits against its own
  `base_revision`. Whichever mutation the server applies first bumps the
  revision; the second device's push arrives with a stale `base_revision` and
  is rejected with 409 `revision_conflict` + server `current`. The client
  re-bases: it creates a new outbox entry (fresh `mutation_id`) whose
  `base_revision` = server `current.revision` and whose operation/payload are
  the **user's latest intent** — then retries. Net: last-applied-writer wins
  for the field set it carries; no data is destroyed because the loser remains
  in the ledger and local backup.

- **Delete vs update:** a delete is itself a revision-bumping mutation.
  - If the update lands first, the delete re-bases against the later revision
    and the object is deleted (delete is the user's later intent).
  - If the delete lands first, the update arrives with stale base → 409;
    the client sees server `current.deleted = true`. The update intent cannot
    be satisfied; per the scaffold, the client marks the update's intent as
    satisfied-only-if-a-matching-local-delete-or-ack; here: the update is
    dropped (the object is gone server-side) and the local deletes the object
    **explicitly** (visible) because the server authoritatively deleted it.
    Deterministic and non-destructive to any *other* object.

- **Folder renamed on one device while a link moves on another:** folder and
  link are independent rows. The folder rename is an update to the folder
  object; the link move is an update to the link's `folderId`. They operate on
  different rows, so both apply; no cross-object conflict. The only cross-
  object rule is **referential**: a link may reference a folder id that does
  not exist (or is tombstoned) §17; the client resolves dangling `folderId`
  on render (treat as "no folder"), never deleting the link.

- **Simultaneous creation with colliding IDs:** effectively impossible for
  UUIDv4 (§4). If it ever occurred on the same account, the first `create`
  wins revisions; the second's `create` with `base_revision = 0` fails because
  the object already exists → the client converts it to an `update` against
  the server revision (scaffold already does this) — deterministic convergence
  to one object, no duplicate row, no data loss.

- **Stale client revision:** any op with a `base_revision` that does not equal
  the current server live revision → 409 → re-base as above. `create` requires
  `base_revision === 0` and object absence.

- **Duplicate requests:** identical `mutation_id` → idempotent replay (200 with
  original `result_revision`). Distinct mutation on the same object → normal
  LWW path.

- **Offline edits arriving out of order:** the **server serializes order by
  revision**, not arrival time. Out-of-order arrival from one device is
  prevented by the in-order outbox drain; across devices, LWW handles it. A
  later-arrived older-base mutation is refused (409) and re-based, never
  silently applied over a newer revision.

**Why LWW and not a richer model:** the product is a single human's bookmark
list. Concurrent same-object edits by one person are rare and, when they
happen, LWW losing one field edit is an acceptable, *visible* and *recoverable*
outcome. Adding last-write-wins-per-field, CRDTs, or vector clocks buys
marginal fidelity at real complexity — explicitly out of scope (§24, §25).
Recoverability is guaranteed by: (a) the mutation ledger keeps the applied
outcome; (b) **backup/export** is the user-controlled recovery path (§15).

---

## 10. Deletion / tombstone model

- **Soft delete with tombstones** on the cloud. A delete is a server mutation
  that sets `deleted=1, deleted_at=now` and bumps `revision`. This lets other
  devices and retries observe the authoritative end-state and prevents
  resurrecting a deleted object from a stale client edit.
- **Propagation to offline devices:** a pulling device pages objects with
  `revision > high-water`; a tombstoned object is included in the pull while it
  is within retention. The client's reconlete rule (§9, §7C) turns an
  authoritative tombstone into an **explicit local delete** of the matching
  object (visible; never silent). Because the delete carried a higher revision,
  any stale local update is refused/overridden — no resurrection.
- **Retention & GC:** tombstones are hard-purged after `TOMBSTONE_RETENTION_MS`
  (30 days) by `purgeExpiredTombstones` (index-driven off `deleted_at`). Per
  the `0001` deletion-semantics note and `0003`, **no `ON DELETE CASCADE` from
  `users`** to cloud application tables — account deletion must not silently
  cascade-delete user bookmarks; it requires an explicit future archive/delete
  flow (§24).
- **Local deletion is independent:** a user deleting a bookmark locally removes
  it from IndexedDB and queues a `delete` outbox entry. Until that reaches the
  server, the local object is gone but the cloud still has it and its tombstone
  is not yet present — the reconciliation model (§7C) must not resurrect a
  locally-deleted object on the next pull. The client therefore keeps a **local
  tombstone/deletion intent marker** for a deleted object until its `delete`
  outbox entry is acked, so a pull of the (still-live) server object does not
  re-add it. (This is a small, explicit add to the local model; flagged in
  §20.)

---

## 11. Offline / retry / failure behavior

Core invariant: **local data keeps working.** Every failure below is non-fatal
to local operation; the outbox preserves intent.

| Situation | Behavior | Local impact |
|---|---|---|
| Cloud unavailable (D1/Worker down, 503/500) | push/pull fail → mutations stay `pending`; retry later | none; local CRUD normal |
| Network disappears mid-sync | fetch rejects → coordinator marks `unavailable`, continues to next; outbox intact | none |
| Request times out | fetch timeout → treat as unavailable; *do not* delete the mutation (server may or may not have applied it → idempotent retry) | none |
| Browser closes during upload | acked mutations were marked succeeded before close (on 200); in-flight one is unacked → retried idempotently next sync | none |
| Browser closes during download | partial pull is discarded (no partial write); next pull restarts from the high-water; local stays consistent | none |
| Server returns 401 (session expired/revoked) | stop sync; ask to re-auth; **do not delete outbox** | none |
| Server returns 409 | re-base the mutation per §9 and retry | none |
| Server returns 429 | back off (bounded); leave pending; no tight loop | none |
| D1/Worker unavailable | 503 → leave pending, retry later | none |

Determinism and recoverability are preserved because:
- A mutation is only removed from the outbox when it returns 200 (acked) or is a
  non-retryable client error; on any lost-response/served-applied ambiguity, the
  idempotency key makes retry exact.
- Pulls are transactional-at-the-page level and written only after validation;
  a partial download leaves the prior consistent state.
- `ponytail:` no client exponential backoff scheduler in v1 — retry is
  top-level explicit `syncNow()`. Add timed backoff only if user-driven retry
  proves insufficient.

---

## 12. API contract

Minimal surface. Routes reuse the existing router (`worker/index.js`) and the
`requireApiOrigin` / session-resolution machinery (`worker/api.js`,
`worker/auth.js`). Every cloud query is account-scoped from the session.

### POST `/api/sync/mutation` (EXISTS in scaffold; keep, refine)
- **Auth:** session cookie; Origin/Referer gate (state-changing); account id
  derived from session only.
- **Request** `{ mutation_id, object_type, object_id, operation,
  base_revision, payload }` (payload = JSON string; bounded ≤ 512 KiB).
- **Response:**
  - `200 { accepted, result_revision }` (applied or idempotent replay)
  - `409 { accepted:false, reason:'revision_conflict', current }` (LWW re-base)
  - `400 { error:'malformed_mutation' }`
  - `401/403/503` (auth/origin/unavailable)
- **Idempotent:** yes, via `mutation_id` (existing `applyObjectMutation`).
- **Validation:** structural (operation/object type/base_revision bound,
  payload size). Server validates JSON shape bounds, not business fields.
- **Error behavior:** generic bodies; no internals leaked; account id never from
  body.
- **Account scoping:** `account_id = session.account_id`; the row PK is
  `(account_id, object_id)` — a mutation can only ever affect the session's
  account.

### GET `/api/sync/objects` (NEW — the minimal pull endpoint)
- **Auth:** session cookie; **read-only** → no Origin gate (consistent with
  `/api/me` read-only policy in the codebase); account from session.
- **Request query params:** `object_type` (`link`|`folder`), `after_revision`
  (client high-water, default 0), `limit` (bounded, e.g. default 200,
  max 500). Optionally `include_deleted=true` to receive tombstones within
  retention (else live objects only).
- **Response:** `200 { object_type, objects:[{object_id,object_type,revision,
  deleted,deleted_at,payload}], next_after_revision, has_more }`.
- **Auth/status:** `401` session invalid; `503` D1 unavailable.
- **Idempotency:** naturally idempotent (pure read of `revision > X` range).
- **Account scoping:** all rows filtered by `account_id = session.account_id`
  via the `(account_id, object_type, revision)` index; no cross-account read.

### Not needed in v1
- No batch multi-object push (one mutation = one request; keeps idempotency and
  retry simple). If per-page throughput matters later, a batch endpoint that
  wraps N `applyObjectMutation` calls is additive.
- No delta/blob, no file upload, no websocket/SSE (no push notifications).

---

## 13. Security threat model

Reuse the existing security architecture (HttpOnly sessions, SHA-256 token
hashing, `__Host-` cookies, `APPROVED_ORIGINS`, per-route method allow-list,
`requireApiOrigin` fail-closed). Sync adds application data to the trusted
Worker; the model:

| Threat | Control |
|---|---|
| **Broken account authorization** | All queries scoped by `account_id` from session; PK `(account_id, object_id)`; no object reachable without its account. |
| **IDOR** | Object ids only ever addressed inside the session's account scope; `GET` filters by both account and object; a foreign `object_id` is simply absent (404/empty), never a leak. |
| **Cross-account data leakage** | Cursor/pull filters by account; pull `after_revision` is per-account; there is no global cursor; tombstones scoped per account too. |
| **Replayed mutations** | `mutation_id` idempotency ledger + single-use claim (INSERT OR IGNORE) — a replay returns the original `result_revision`, never double-applies. |
| **Forged revisions** | `revision` is server-managed only; base_revision is validated against the live object; a client cannot set a revision, only reference one it observed. |
| **Malicious payloads** | Payload bounded (≤512 KiB); server validates JSON shape/object_type/operation and string-length bounds; the client normalizes/validates on read (defense in depth). Parametrized SQL only — no injection. |
| **Oversized payloads** | Hard size cap at the API boundary (SYNC_BODY_MAX) and per-field bounds in the store; SQLite/D1 row limits respected. |
| **Mass object creation** | Per-account, per-request bounded; v1 has no bulk endpoint; pull `limit` bounded; a growth guard (basic per-account object-count ceiling) is a later hardening (see §19). |
| **Unauthorized deletion** | Delete is a session-scoped, origin-gated mutation; tombstone + revision, no hard delete; user-visible. |
| **Stale-session access** | Session expiry/revocation enforced in SQL per request; 401 stops sync; data stays local. |
| **CSRF** | SameSite=Lax + `requireApiOrigin` on every state-changing endpoint; read-only GET needs no gate (matches codebase policy). |
| **Origin checks** | `APPROVED_ORIGINS` fail-closed; never trust Host/X-Forwarded-*; consistent with `handleApiSessionRefresh`. |
| **Auth/session abuse** | Rotation on auth; only SHA-256 hashes persisted; raw token held solely in the HttpOnly cookie; no token in body/logs. |
| **Data exposure via error messages** | Uniform generic error bodies (`unauthenticated`, `server_error`, `malformed_mutation`); no internals, no D1 rows, no tokens, no full URLs in logs (§18). |

No new auth system, no new secret material, no new trust boundary. The cloud
receives only validated, account-scoped application data.

---

## 14. Privacy model

**What leaves the browser:** only the objects the user chose to sync, in the
scoped payload of §5. Specifically **NOT** synced:
- `savedFrom` (local provenance only; rejected as a device id).
- Local Profile (`name`/`bio`) — device-local.
- Appearance / color-scheme — device-local.
- Session tokens / OAuth tokens / cookies — never in any body, payload, or log.
- Provider identity (`github` subject, GitHub login/email) — stays in
  `auth_identities` as authentication metadata; never an application/sync field.
- Pending-mutation outbox internals beyond the applied outcome.

**No device identity** in v1. OAuth identity is authentication metadata, not
application data. The cloud receives exactly what cross-device continuity
requires and nothing else. Explicit `ponytail:` note — if a future version
needs per-device diagnostics or multi-device OT, introduce a device table *then*,
deliberately, with its own privacy review; it is not justified by sync today.

---

## 15. Backup vs Sync

**BACKUP** (existing, unchanged): explicit export/import (`src/utils/backup.js`),
user-controlled, portable, disaster/recovery. Import never introduces the Local
Profile or appearance/color-scheme from a backup (`pickImportSlices`), and
`mergeImportData`/`mergeLinks` preserve `id`/`createdAt`/user fields on replace.

**SYNC** (this design): cloud replica, cross-device continuity, automatic/
page-driven reconciliation triggered by login/explicit action/post-push. Not a
replacement for backup.

**Interaction and confusion-avoidance:**
- They are orthogonal and do not write to each other. Backup reads/writes local
  IndexedDB (export/import of bookmarks/folders); sync reads/writes local
  IndexedDB + the cloud replica.
- Import and pull both land in IndexedDB and then both go through the same
  local persistence + outbox path, so an import is reconciled with cloud state
  on the next sync (imported objects → new pending `create`s). Keep versus
  Replace semantics stay local-merge concerns (§17); cloud is reconciled after.
- UI language distinguishes them: "Export/Import (backup, offline)" vs
  "Sync (cloud)" — see §23 Phase H.
- Sync never creates, deletes, or modifies backup files; backup never alters
  cloud state directly.

---

## 16. Account switching

**Goal:** Account A → logout → Account B must make it impossible for A's
pending mutations or cloud data to be uploaded to B's session, and keep local
datasets and sync state isolated.

Mechanism:
- **Logout is authentication-only** (existing `session.logout()` clears the
  session; IndexedDB is untouched).
- **Outbox entries are `account_id`-scoped** already (`addPendingMutation`
  stores `account_id`). The coordinator sends **only** outbox entries whose
  `account_id` equals `session.getState().user?.id`. B's session id ≠ A's
  entries, so A's pending mutations are simply never selected or sent under B.
- **Cloud query scoping on the server** guarantees B cannot read/write A's
  objects even if the client misbehaved (§12, §13).
- **Local data isolation across accounts** — chosen model: v1 treats the local
  dataset as **associated with whichever account is currently signed in** via
  the per-object `account_id`; when switching to B, B's pull materializes B's
  objects, while A's local objects remain in IndexedDB (not deleted) but are
  not part of B's active outbound set. A's outbox is preserved with `account_id=A`.
  This is **lossless** (A's data is not deleted) and **isolated** (B cannot
  touch A's stuff).
  - *Known ceiling, flagged:* this means the same physical IndexedDB can hold
    objects from multiple accounts and their provenance is the `account_id`
    field. If two-account clutter in one DB is ever a UX problem, a future
    account-partitioned store (a `sync_space`/`account_id` index) is the
    upgrade path — not built in v1.
  - The alternative — wiping local data on account switch — is **rejected**:
    it risks silent data loss, violating invariant 4.

---

## 17. Failure and recovery scenarios

Each ends in a deterministic state.

1. **Device A offline creates 5 links → queues 5 `create` outbox entries.**
   Local: 5 links present, revision 0 each. **End:** on reconnect + explicit
   sync, 5 `create`s applied (revisions 1..), links uploaded; local acked.
2. **Device B online edits an existing link → `update` applied,** B acks new
   revision. **End:** cloud has newer revision; B consistent.
3. **Device A reconnects and syncs.** A's 5 creates upload; A pulls; the edited
   link's newer revision arrives → A updates the edited field locally. **End:**
   both devices converge on the LWW winner; A has its 5 new links.
4. **Both devices edit the SAME link.** First-applied wins the revision; second
   gets 409 → re-bases its intent against the server revision → applied. **End:**
   one row, last-applied-writer field set; loser recoverable via backup/ledger.
5. **One device deletes the link while another edits it.** If edit applied
   first, delete re-bases and deletes (delete is later intent). If delete
   applied first, edit gets 409 on a deleted object → client drops the edit,
   deletes locally. **End:** link is deleted everywhere once tombstone pulls.
6. **Folder deleted while links still reference it (`folderId` dangling).**
   Folder row tombstoned; link rows still carry the `folderId` by reference.
   **End:** client renders links with a dangling folder as "no folder"; the
   folder is gone; links are NOT deleted (§9). Optional later hardening: a
   tombstone-aware reconcile clears dangling refs explicitly.
7. **Duplicate mutation submitted twice.** Identical `mutation_id` → idempotent
   replay, same `result_revision`, no double-apply. **End:** unchanged row.
8. **Sync request succeeds on server but response is lost.** Server applied,
   ledger records result; client saw a network failure → keeps it pending →
   retries same `mutation_id` → replay returns `result_revision` → client acks
   and updates local revision. **End:** consistent; no duplicate; no loss.
9. **Browser closes halfway through sync.** A subset of entries acked before
   close are marked succeeded; unacked retried idempotently; an in-flight pull
   is discarded (no partial write). **End:** consistent on next sync.
10. **Session expires during sync.** Push/pull → 401; coordinator stops,
    preserves outbox, flags re-auth. **End:** local unaffected; sync resumes
    after re-login.
11. **Account logs out during sync.** Coordinator's account check prevents
    switching sessions mid-drain; in-flight runs for the old account either
    complete against the old session or stop; outbox entries remain scoped to
    the old account and are not sent under any new session (§14, §16).
12. **Cloud unavailable for several days.** Outbox grows; local stays fully
    functional. On return, `syncNow()` drains in order; bounded per-request;
    no data loss. (Bounded outbox growth is a §19 scale guard.)

---

## 18. Migration strategy

Existing users already have local data (IndexedDB v1/v2). First cloud sync must
not corrupt it.

- **No schema loss on the client:** the existing IndexedDB v2 `links`/`folders`
  stores already carry `revision`/`account_id` fields (back-filled with
  defaults by `normalizeLink`/`sanitizeFolder`). Existing records remain valid
  without these; a pre-sync guard assigns `revision=0` and no `account_id`
  before first use.
- **Adoption path:** §7. A new login runs adoption reconciliation *before* any
  destructive cloud op:
  - Never overwrite local on empty cloud (upload).
  - Never delete local on adoption.
  - For non-empty-both (§7C), staged deterministic reconcile with LWW; local
    never silently destroyed.
- **First push is incremental per user's objects, not a full-DB upload.** The
  client emits one `create` per existing local link/folder as an outbox entry.
  This is bounded and re-triable, not a single giant payload (§19).
- **First pull (empty local, cloud has data) is a paged, incremental
  materialization** (cursor 0 → pages) into IndexedDB via the same persistence
  path.
- **Rollback point:** because adoption never destroys local data and every cloud
  write is a reversible tombstone-backed updated row, a user can always fall
  back to a pre-sync backup (export) and re-import — the recovery path already
  exists.

---

## 19. Protocol / version strategy

- **Protocol versioning:** every sync endpoint accepts an optional
  `X-SaveLinks-Protocol: N` header (default `1`). Bump the number on wire-
  breaking change; a new server keeps serving old versions and a new client
  downgrades to a supported version. Because the protocol is HTTP+JSON over the
  existing routes, an unknown/older version fails soft (406/fallback to a
  compatible read path), and the client only dials up when the server advertises
  support.
- **Payload/schema versioning:** the per-object `payload` is versioned with a
  lightweight `schemaVersion` field (default 1) inside the payload. The client
  normalizes unknown/missing schema fields to the current shape (its normalizer
  is tolerant, as today); a future field is additive and old clients ignore it.
- **DB migration versioning:** additive D1 migrations (`0004..`), DDL idempotent
  (`IF NOT EXISTS`) matching `0001..0003`; IndexedDB schema is additive too
  (bump `INDEXEDDB_DB_VERSION`, guarded `upgrade()` branches).
- **Where it belongs:** versioning lives in (a) the HTTP layer (protocol
  header), (b) the payload shape (`schemaVersion`), (c) DB migrations. v1 keeps
  this minimal but the seams are explicit so v2 can evolve without a fork.

---

## 20. Observability

Minimum safe diagnostics — UI-facing, local-first, never a data leak:

- **Sync success/failure:** last sync result (`ok`/counts) — coordinator summary
  (`pushed`, `succeeded`, `failed`, `conflict`, `unavailable`) surfaced in the
  Sync panel status.
- **Last successful sync:** a local timestamp of the last fully-acked sync
  (would use `localStorage`/kv key `lastSyncAt`, mirroring `lastBackupAt`).
- **Pending count:** number of unacked outbox entries for the current account,
  shown in the UI ("N to sync" with a manual Sync affordance).
- **Retry state:** count of `unavailable`/`failed` entries and a non-blocking
  retry action.
- **Client/server revision info:** the local high-water mark and the last
  server `result_revision`, shown in a debug/status line (no URLs, no payloads).

**Never logged / never shown:** session tokens, OAuth tokens, raw `mutation_id`
contents beyond a truncated/id-less count, private user data, full URLs unless
genuinely needed to debug a specific failing object (and even then, with a
per-request opt-in toggle, not by default). Server error bodies remain generic
(§13).

---

## 21. Cloudflare Free-tier considerations

- **No polling:** sync is user/explicit/login-triggered (`syncNow()`); no
  timers, no background sync timers.
- **Indexed, incremental reads:** pull uses `(account_id, object_type, revision)`
  index with `revision > X`; bounded `LIMIT`, paged — never a full scan, never a
  full-database download.
- **Bounded payloads:** one object per push (≤512 KiB), paged pull (≤500/page).
- **No full-database upload:** per-object outbox emits, bounded.
- **No unnecessary background execution:** no worker cron for sync, no
  always-running tasks. The only background housekeeping is the existing
  opportunistic expiry sweeps (OAuth states, sessions, tombstones) which are
  index-driven and already present.
- **Idempotent requests** keep retries cheap and exact.
- **Scale guard (`ponytail:` note):** if a single account's object count grows
  very large, a per-account object-count ceiling and slightly larger page
  limits can be added without changing the protocol. Not needed for v1.

---

## 22. Existing scaffold assessment

Reviewed against this architecture. Classifications: **KEEP** / **MODIFY** /
**REWRITE** / **REMOVE LATER**. **No scaffold file is changed now.**

| Piece | Verdict | Notes |
|---|---|---|
| `src/sync/coordinator.js` `syncNow()` | **KEEP (MODIFY slightly)** | Correct outbox-drain skeleton, in-order, conflict→rebase. Add: account re-check mid-drain (already partially there via `account_id` filter on the snapshot), pull-step orchestration, bounded retry counters, local-delete-intent handling from §10. |
| `src/sync/protocol.js` `pushMutation()` | **KEEP** | Correct typed transport mapping HTTP→`accepted/conflict/rejected/unavailable`. Add `GET /api/sync/objects` pull transport. |
| `src/composables/useSync.js` | **KEEP** | Correct in-flight lock + explicit `syncNow()`. No event wiring — matches §8. |
| `src/components/SyncPanel.vue` | **KEEP (MODIFY)** | Good explicit-sync UI surface. Wire status/observability (§20) and keep it clearly "manual sync", not idle background. |
| `src/auth/accountService.js` | **REWRITE (or gut)** | Its credentials-based surface (`signIn`/`register`/`forgotPassword`/`forgotUsername`) targets a username/password backend that this architecture explicitly does **not** use (§3). Either delete the credential methods in favor of OAuth-only flow, or reduce to `signOut()` + an OAuth-start seam. Sync never calls it. |
| `src/auth/authValidation.js` | **REMOVE LATER** | Validation routines for a credential backend not in scope. Keep only if the OAuth adapter needs shared validation; otherwise delete when the credential surface is removed. |
| `migrations/0003_sync_objects.sql` | **KEEP (extend)** | `sync_objects` + `sync_mutations` schema is correct (tombstone, idempotency, account scope, no cascade). Add: pull index already present; nothing structural needed beyond §5/§12. Revisions aligned to 64-bit integer semantics (already INTEGER). |
| IndexedDB v2 changes (`indexeddb.js`) | **KEEP (MODIFY)** | `pending_mutations` store + `revision`/`account_id` fields on links/folders are the right foundation. Add: local-delete-intent/tombstone marker (§10) and a pull-reconcile path; keep `getPendingMutations` account-scoped on read. |
| `worker/api.js` `/api/sync/mutation` + `applyObjectMutation` | **KEEP (refine)** | Correct atomic idempotent apply; account from session only. Refine only per §5 payload validation and add the `GET /api/sync/objects` pull handler + route. |
| `worker/api.test.js` sync describe block | **KEEP** | Good coverage; extend for pull endpoint + §17 scenario tests (Phase I). |
| `src/auth/session.js` / `memory-adapter.js` | **KEEP — REPLACE adapter later** | Session abstraction is correct and provider-neutral. The in-memory test-double adapter must be replaced by a real HTTP adapter (GitHub-OAuth-driven) during Phase A — that is the boundary swap, not a redesign. |

**Overall:** the scaffold's push foundation is architecturally sound and aligns
with this design. The gaps are (a) no pull transport, (b) no local-delete-intent
tombstone, (c) observability, (d) the credential-auth dead-end files — none of
which require throwing away the scaffold.

---

## 23. Implementation roadmap

Only after this document is approved. **Nothing below is done now.** Each phase
has a rollback point = the preservation commit `5fe38b4` (`wip/sync-holding` /
`feature/sync`).

**Phase A — Authentication backend completion**
- Files: `src/auth/*` (real HTTP adapter replacing `memory-adapter`; contract
  unchanged), `worker/auth.js` (already complete — likely no change), tests.
- Depends on: none (auth layer).
- Tests: adapter unit (mock fetch), session override, `api/me`-style boundary.
- Rollback: point `5fe38b4`; feature/sync is isolated.
- Acceptance: real GitHub login on worker; session restores offline-safe;
  local CRUD unaffected; no credential backend introduced.

**Phase B — Cloud schema (D1)**
- Files: new `migrations/0004_*.sql`, `worker/db/store.js` (pull query,
  payload validation), store tests.
- Depends on: A (session/account present).
- Tests: store-level pull range query, tombstones, scoping, validation, purge.
- Rollback: migration not applied; existing DB untouched.
- Acceptance: pull endpoint returns account-scoped, index-driven, paged objects.

**Phase C — Local sync metadata**
- Files: `indexeddb.js`, `domain/link.js`, storage tests.
- Depends on: none.
- Tests: revision/account defaults, local-delete-intent marker, outbox account
  filter.
- Rollback: schema additive; old data intact.
- Acceptance: local store exposes revision, account scope, outbox, delete-intent.

**Phase D — Push**
- Files: `useLinks.js`, `useFolders.js`, `useSync.js`, coordinator (push path),
  API push refine.
- Depends on: A, C.
- Tests: commit→outbox→push→ack idempotent; conflict→rebase; offline retry.
- Rollback: sync off → pure local (invariant 1).
- Acceptance: offline creates queue and upload on explicit sync; exactly-once.

**Phase E — Pull**
- Files: `protocol.js` (GET), coordinator (pull + reconcile), API pull handler,
  storage reconcile.
- Depends on: B, C.
- Tests: incremental paged pull, multi-device convergence, tombstone delete
  propagation.
- Rollback: sync off → local.
- Acceptance: second device materializes/updates/deletes deterministically.

**Phase F — First-sync / adoption**
- Files: adoption reconcile module (+ tests), login orchestration.
- Depends on: D, E.
- Tests: §7 A–F scenarios.
- Rollback: adoption off → no auto sync until explicit.
- Acceptance: all four §7 situations converge without data loss.

**Phase G — Conflict / deletion handling**
- Files: coordinator re-base hardening, delete-intent, folder-FK reconcile.
- Depends on: D, E.
- Tests: §9 rule matrix, §17 scenarios 4–8, folder-delete-dangling.
- Rollback: conflict handling off → sync disabled (local safe).
- Acceptance: deterministic LWW, no silent destruction, recoverable.

**Phase H — UI / status**
- Files: `SyncPanel.vue`, `AccountPanel.vue`, App wiring, observability (§20).
- Depends on: D/F.
- Tests: component + e2e for explicit-sync flow, status display, backup-vs-sync
  copy.
- Rollback: UI only.
- Acceptance: clear manual sync, pending count, last-sync, backup/sync clarity.

**Phase I — Security & failure testing**
- Files: threat-model tests (api/store), failure-injection tests, e2e.
- Depends on: B–H.
- Tests: §13 matrix, §17 scenarios, oversized/malicious payloads, 401/429/
  conflict/timeout, account-switch isolation (§14/16).
- Rollback: gate deployment behind this phase.
- Acceptance: no cross-account leak, idempotency, local invariant holds.

**Phase J — Production deployment**
- Apply migrations to `save-links-db`; set `APPROVED_ORIGINS`, OAuth secrets;
  non-destructive rollback via tombstones + backup. No auto-deploy until the
  prior phases pass.

---

## 24. Open decisions (require approval)

1. **Cross-account data residency in one IndexedDB** (§16): v1 keeps Account A
   and B objects in the same DB, distinguished by `account_id` (lossless).
   Approve this, or require an `account_id`-partitioned IndexedDB store now?
   (Choosing partition-now is more upfront work but cleaner isolation; the doc
   defaults to the lossless single-DB with the partition as a later upgrade.)
2. **Local-delete-intent marker** (§10, §20): agree to the small additive local
   tombstone so a pull cannot resurrect a locally-deleted object before its
   `delete` is acked. (Alternative: accept rare resurrection-on-sync as
   benign.)
3. **`savedFrom` final disposition** (§12): confirm it is **never** synced
   (chosen) vs optionally synced behind a backcompat flag.
4. **Credential-account cleanup** (§20): approve **REMOVE LATER** of
   `accountService.js` credential methods + `authValidation.js`, or keep them
   dormant for a possible future password backend (this doc recommends removal;
   the `REMOVE LATER` label means deferred, not this phase).
5. **Object-count ceiling** (§19, §21): approve adding a basic per-account
   ceiling in Phase B, or defer entirely.

---

## 25. Explicit non-goals (v1)

- No username/password/local credential authentication.
- No device IDs / device table (deferred).
- No vector clocks, CRDTs, per-field merge, event sourcing.
- No background sync / service-worker synchronization (explicit sync only).
- No batch push endpoint, no push notifications/websocket/SSE.
- No full-database upload/download; no polling.
- No account deletion/merge UI (deferred; tombstones + no-cascade is the safe
  default).
- No multi-user shared folders/sharing.
- No offline-edit merge UI beyond LWW + visible status.
- No server-side full-payload business validation beyond bounds/structure
  (client normalizer remains the authority on field semantics).
- Nothing in this document changes or deletes the preserved sync scaffold or
  any source file.

---

## Verification & consistency checks (this document)

- **Invariant 1 (local-first):** every failure path (§11) and adoption path
  (§7) keeps local CRUD functional; sync is a separate, optional layer.
- **Invariant 2 (auth/sync separation):** §3 keeps auth in `session.js`/
  worker; sync reads only the account id.
- **Invariant 3 (account isolation):** §5/§12/§13 scope every query by the
  session's account; no body/header/query source of account id for writes,
  read filter for pulls.
- **Invariant 4 (no silent local data destruction):** adoption (§7), logout/
  account switching (§16), deletion (§10), and failure (§11) all avoid silent
  destructive local changes; deletes are explicit or authoritative-tombstone
  driven and recoverable.
- **Invariant 5 (savedFrom local, no device id):** §6/§12/§14.
- **Determinism:** §6 rules are pure functions of (outbox, server state);
  no wall-clock in conflict ranking; server revision is the sole orderer.
- **Deletion:** §10 tombstone→explicit local delete; retention/GC bounded.
- **Backup/sync** separation: §15.
- **Security boundaries:** §13 reuses existing session/origin/hashing controls.
- **Free tier:** §19/§21 incremental, indexed, bounded, no polling/background.
