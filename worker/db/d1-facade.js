// Save_Links — D1-binding-compatible facade over node:sqlite for tests
// (Phase 3B + 3C). Runs the REAL migration SQL on a real SQLite, so
// constraint violations, FKs, uniqueness, CASCADE and expiry all behave as
// they will on D1 (D1 runs SQLite with foreign keys enforced by default).
//
// Surface implemented (all worker/db/store.js + worker/oauth/* use):
//   prepare(sql).bind(...).all() | .first() | .run()
//   batch([stmt, ...])   -> SQL transaction: either every statement commits
//                           or none does and the batch rejects (D1 semantics)
//   _sqlite              -> raw node:sqlite handle for inspecting storage

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url))

export function createTestDb() {
  const sqlite = new DatabaseSync(':memory:')
  // D1 enforces foreign keys by default; SQLite needs the pragma enabled.
  sqlite.exec('PRAGMA foreign_keys = ON')
  // Every migration, in lexicographic (0001, 0002, ...) order — mirrors D1's
  // migration sequencing.
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8'))
  }
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            all() {
              return { results: sqlite.prepare(sql).all(...params) }
            },
            first() {
              return sqlite.prepare(sql).get(...params) ?? null
            },
            run() {
              const info = sqlite.prepare(sql).run(...params)
              return {
                results: [],
                success: true,
                meta: {
                  changes: Number(info.changes),
                  last_row_id: Number(info.lastInsertRowid),
                },
              }
            },
            // consumed by batch() below (D1's binding objects carry no SQL)
            _sql: sql,
            _params: params,
          }
        },
      }
    },
    // D1 batch() = one atomic transaction. Implemented with BEGIN/COMMIT so a
    // mid-batch failure rolls back everything and rejects the whole batch.
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const stmt of statements) {
          const info = sqlite.prepare(stmt._sql).run(...stmt._params)
          results.push({
            results: [],
            success: true,
            meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
          })
        }
        sqlite.exec('COMMIT')
        return results
      } catch (err) {
        try {
          sqlite.exec('ROLLBACK')
        } catch {
          // database already unwound or is mid-failure; original error wins
        }
        throw err
      }
    },
    // raw access for the tests that must inspect what is actually stored
    _sqlite: sqlite,
  }
}