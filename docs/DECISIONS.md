# Decisions

One entry per build decision: date, stage, the decision, why, what else was considered. Newest at the bottom. If a decision changes the plan, say so; the plan's master copy is in the HQ repo.

## 2026-10-01, before stage 0: who builds
Codex (OpenAI's GPT-6 Astra) does the first build on Will's OpenAI credits; Claude Code makes the edits after. Why: Will has credits to use and wants Claude to own changes from then on. GitHub is the shared copy because Codex and Claude both work through it; Replit only pulls.

## 2026-10-01, before stage 0: keys
Keys live only in Replit Secrets. Neither builder holds or sees one: Codex and Claude build on fixtures, and the app reads keys from the environment at run time. Why: one place to add, rotate and revoke each key.

## 2026-10-01, before stage 0: sample mode
Each source runs live when its keys are present and on labelled sample data when they are not. Why: the builder can finish a stage before its keys exist, and `main` always runs on Replit.

## 2026-10-01, stage 0a: one service and a plain foundation screen
Use Node 24, strict TypeScript and Fastify, with server-rendered HTML and a small bundled TypeScript browser entry. This keeps the initial service and handover small; a front-end framework was considered unnecessary for a sign-in form and health table. The user's stage 0a scope explicitly defers the real mockup screen, Settings, SSE and home-screen installation to 0b. No spec files were edited. Browser dependencies are served locally; there are no trackers or third-party scripts.

## 2026-10-01, stage 0a: PostgreSQL migrations and portable tests
Use `pg` for the service and numbered SQL migrations, applied transactionally under an advisory lock with a checksum ledger. Use PGlite for default sandbox tests and the same database test helper against real PostgreSQL whenever `TEST_DATABASE_URL` is set. CI provides PostgreSQL 17; each test gets its own database and cleans it up. This was chosen over SQLite emulation or tests that mock SQL. The local build was also validated against PostgreSQL 17.11 installed from verified Debian packages after Docker Hub rate limits. Production stays on Replit-provided `DATABASE_URL`; no published Replit database was inspected or deployed, so Will must confirm that binding before deployment.

## 2026-10-01, stage 0a: passkeys and persisted security state
Use SimpleWebAuthn for registration and assertion verification, requiring resident passkeys and user verification. Accept ES256 and RS256 authenticators. Each five-minute challenge is bound to a random HttpOnly cookie and consumed atomically. Verify the configured origin and relying-party hostname; authentication locks the credential row while verifying and updating its counter. Store opaque 30-day session tokens only as HMACs. Retain the HMAC key, generated push key pair, credentials and other auth state in `pulse_private`, with PUBLIC access revoked. This avoids a source secret or session key in code and supports process restarts. The stage 7 Ask role must be granted only intended public tables, never the private schema or application owner role.

Setup phrases are required only for adding a device, use exact constant-time comparison, and must contain 20–1024 characters (ignoring outside whitespace for the minimum). All auth writes require the exact origin and JSON. Enrollment is limited to five attempts per peer and twenty globally per 15 minutes; other auth endpoints have separate limits. Counters are persisted with atomic upserts and peer addresses are HMACed, never stored raw. We deliberately ignore forwarded IP headers because the trusted Replit proxy chain has not been established; a shared hosting peer can share a limit, while global throttling protects against peer changes. In-memory counters and trusting arbitrary X-Forwarded-For were rejected.

## 2026-10-01, stage 0a: explicit origin and no deployment
Keep the proposed public hostname in the nonsecret config, flagged unconfirmed. Production requires an explicit HTTPS `APP_ORIGIN` rather than deriving it from Host headers or silently choosing the working hostname. Local development can use HTTP localhost. This avoids registering real passkeys to an unsettled address. `.replit` declares the Node 24 module and Reserved VM build/run commands; Will publishes. `replit.md` is unchanged.

## 2026-10-01, stage 0a: source presence is not source health
Register all ten sources from section 1 using its exact key names. The setup phrase and database URL are infrastructure, not sources. Missing any required key means sample mode and `waiting_for_keys`; all required keys means live mode and `not_implemented` until that source's client exists. No external calls or manufactured successful syncs occur. Health rows retain prior timestamps on same-mode startup and clear them when mode changes. All section 13 identifiers and mapping seeds live in `src/config.ts`, with unresolved mappings and the unconfirmed Google US campaign approvals explicit. API versions and invented API-response fixtures will be pinned in the client stages; there is no API client to version in 0a.

## 2026-10-01, stage 0a: audit and honest CI
The audit log records fixed event names, timestamp and optional credential ID, without arbitrary request data or customer fields. Authentication transitions and sessions are committed together. Failure responses and startup logs suppress raw exception details, and request logging is off so setup phrases and assertions cannot reach logs.

Every pull request runs typecheck, tests against a real PostgreSQL service, the production build, and Chromium WebAuthn smoke checks with a virtual authenticator. The browser tests use real signatures, cover replay/origin/signature rejection, persisted 30-day sessions, and the plain screen at phone/desktop sizes in both themes. Gitleaks 8.28.0 is downloaded with pinned publisher checksums and scans current files plus full history. Its default rules remain enabled, with additional rules for Pulse's secret names and generated-secret/redaction self-tests. No exclusions or baselines are added.
