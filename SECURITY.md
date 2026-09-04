# Security Policy

## Reporting Security Vulnerabilities

Do not report security vulnerabilities through public GitHub issues.

Contact the maintainer privately through the GitHub security advisory feature or the email associated with the repository owner's GitHub account.

## Security Principles

### Secrets Management
- **OAuth secrets must never be committed** — `GITHUB_CLIENT_SECRET`, `STATE_HMAC_SECRET` are stored as Wrangler secrets or in `.dev.vars` (gitignored)
- **Raw session tokens must never be persisted** — only SHA-256 hashes are stored in D1
- **OAuth access tokens are not persisted** — exchanged for identity, used once, then discarded

### Authentication Boundaries
- **Authentication boundaries are server-side** — the Worker validates sessions, the browser only holds an HttpOnly cookie
- **Security-sensitive changes require tests** — any change to auth routes, session handling, or origin validation must include test coverage

### Local-First Data
- **Local data remains browser-local** unless the user explicitly uses cloud synchronization
- IndexedDB is the primary data store; cloud synchronization is optional and user-initiated

### Origin Validation
- **Never trust `Host`, `X-Forwarded-Host`, or `X-Forwarded-Proto` for security decisions** — approved origins come only from the configured `APPROVED_ORIGINS` list
- **Fail closed** — missing or misconfigured `APPROVED_ORIGINS` rejects requests (503)

### Session Security
- Production uses `__Host-` prefixed cookies (Secure, Path=/, HttpOnly, SameSite=Lax)
- Session tokens are 32-byte random values, base64url encoded
- Session rotation on every authentication creates a fresh token and revokes the previous one
- Expired and revoked sessions are rejected at the database level

## Scope

This policy covers the Save_Links repository code. Infrastructure configuration (Cloudflare account settings, DNS, GitHub OAuth App configuration) is out of scope but follows the same principles.