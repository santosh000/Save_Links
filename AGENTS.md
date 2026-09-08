# AGENTS.md

## Persistent project memory (Obsidian)

SaveLink keeps durable project context in the **connected Obsidian vault** at `AI-Memory/Projects/SaveLink/` — a vault-relative path **outside this repository** (the repo does not contain an `AI-Memory/` directory). It is context only — the repository is always the implementation source of truth.

### Workflow for meaningful SaveLink tasks

1. Read `AI-Memory/Projects/SaveLink/INDEX.md` first.
2. Use its **task → memory routing** section to select the notes relevant to this task.
3. Read **only those notes**. Never preload all 13 notes; for small tasks no notes may be needed.
4. Use the Obsidian MCP **only when persistent SaveLink project memory is relevant** to the current task — do not invoke it merely because it is available.
5. Inspect the actual repository areas involved — never rely on memory instead of code.
6. Make only the required changes; respect the protected paths below.
7. When the task produced durable knowledge (architecture/product decision, auth/sync/local-first change, roadmap, status, known issue, milestone), update **only the affected note(s)**. Skip memory for trivial changes (CSS, typos, ordinary refactors, debugging, probe files, routine commits).
8. Never store secrets, credentials, or conversation transcripts in Obsidian — config names/placeholders only.

### Source-of-truth hierarchy

Repository/code/configuration → current tests and verified behavior → Obsidian memory → conversation history.

If Obsidian conflicts with the repository: inspect the repo, determine the truth, record the discrepancy in the affected note. Never silently assume stale memory is current.

## Notes quick reference

Navigation and the detailed task → memory routing map live in `AI-Memory/Projects/SaveLink/INDEX.md`, not here.

## Guardrails

- Protected paths (do not casually modify): `worker/`, `src/storage/`, `src/sync/`, `src/auth/`, `src/composables/`, `src/domain/`, `src/utils/storage.js`, `migrations/`, `public/sw.js`, `package.json`, `package-lock.json`, `playwright.config.js`, `wrangler.jsonc`.
- Verify changes with the relevant subset of: `npm test`, `npm run test:e2e`, `npm run build`, `git diff --check`.
- Never deploy, push, or commit without explicit user approval.