# One of One Pulse

Will Peirce's private dashboard for One of One Trading Cards: sales, ads, stock, tests and new reviews on one page. Read-only to every source.

- Rules for anyone changing this repo: `AGENTS.md`.
- What to build: `docs/spec/` (a read-only copy from the HQ repo).
- Where the build is: `docs/BUILD-STATUS.md`. Why things are as they are: `docs/DECISIONS.md`.

Keys live only in Replit Secrets. Never commit one.

## Stage 0a

Node 24, TypeScript and one Fastify service, with PostgreSQL migrations, passkey sign-in, a private audit log and ten source health rows. After sign-in the plain page is labelled **sample data**. The real dashboard, Settings, live updates and home-screen installation are stage 0b. No source clients or external API calls exist yet.

## Install and run locally

Prerequisites: Node 24 (`.nvmrc`), npm and PostgreSQL 17. Install the pinned dependencies from the repository root:

```sh
npm ci
cp .env.example .env
```

Keep `.env` local and ignored. Set `DATABASE_URL` to a local development database and `APP_ORIGIN` to `http://localhost:3000`. To enroll a local test device, set `DASHBOARD_SETUP_CODE` to a disposable phrase from your password manager, 20–1024 characters long. Leave every source key empty: real source credentials belong only in Replit Secrets. All entries in `.env.example` are names with empty values.

For a disposable local database with Docker:

```sh
docker run --name pulse-postgres --rm -d \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=pulse \
  -p 127.0.0.1:5432:5432 postgres:17.6
```

That local-only database URL is `postgresql://postgres@127.0.0.1:5432/pulse`. Trust authentication is for this disposable, loopback-bound container only. Stopping it removes its data; use your own persistent development database if you want to retain enrolled devices.

```sh
npm run migrate
npm run dev
```

Open the configured local origin, expand **Add a device**, enter the local setup phrase, and create a passkey. Face ID, Touch ID, device unlock or a compatible security key must verify the user. Later visits use **Sign in with a passkey**. A session lasts 30 days from creation; **Sign out** revokes it immediately. With no setup phrase the service still starts, but adding devices is disabled.

`npm run dev` builds browser assets and watches server TypeScript. Restart it after changing browser TypeScript or CSS. For the compiled service:

```sh
npm run build
npm start
```

Both run commands read an existing `.env`. `HOST` defaults to loopback and `PORT` to 3000. `/health` returns only `{"status":"ok"}`, or `{"status":"unavailable"}` with HTTP 503 when PostgreSQL cannot be reached. `/` and `/audit` require a session. There are no request-body or credential logs.

## Database and migrations

The service runs `migrations/*.sql` before listening. `npm run migrate` does the same explicitly. Migration names and SHA-256 checksums are recorded in `pulse_private.schema_migrations`; a transaction and advisory lock make repeated and concurrent startup safe. Add a new numbered migration to change the schema; never edit an applied migration. There is no automatic destructive down migration.

`public.source_health` keeps source mode, health, failure count and last-attempt/last-success times. `public.audit_log` stores fixed event names, timestamps and optional credential IDs; it has no arbitrary request or customer payload. The last 100 events are available after sign-in. Failed enrollment/sign-in, successful enrollment/sign-in, sign-out and rate-limit events are recorded.

The `pulse_private` schema holds passkey public keys, challenges, sessions, rate-limit counters, a random owner ID and generated application keys. Session tokens are random and stored only as HMACs. The session HMAC key and push key pair are generated once and retained in that private schema. PUBLIC access is revoked. Stage 7 must explicitly grant its separate read-only Ask role access only to intended public tables, never to this schema or the application's owner role.

Back up the database to retain devices, application keys and audit history. Session/challenge expiry uses the database clock. Expired auth records are cleaned on startup and hourly. Enrollment is limited to five attempts per peer per 15 minutes and twenty globally; other passkey endpoints have their own limits. Counters survive restarts. Forwarded IP headers are deliberately ignored, so a hosting proxy may share the peer limit; the global limit still applies. No raw IP addresses are stored.

## Check the build

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run secret-scan
```

Without `TEST_DATABASE_URL`, tests use PGlite, an embedded PostgreSQL engine. They apply the same migrations and exercise transactions, private-schema permissions, source modes, auth gates, challenges, rate limits, session expiry and revocation. No source keys are needed.

To run the same tests against a real disposable PostgreSQL server, set `TEST_DATABASE_URL` in the shell to its admin database URL, then run `npm test` and `npm run test:browser`. This test role needs `CREATEDB`: every test creates a randomly named database and drops it on completion. Never point it at production. Unit tests intentionally do not load `.env`.

`test:browser` starts its own server and isolated test database, generates its own temporary setup phrase in memory, and uses Chromium's virtual authenticator for real WebAuthn registration and signing. It checks sign-out, sign-in, replay/origin/signature rejection, persisted 30-day sessions, source health and the audit page at phone/desktop sizes in both themes. If Chromium is already installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable instead of downloading a browser. `npm run browser:check` runs the browser checks against an already-running disposable instance using its `APP_ORIGIN` and setup phrase; it enrolls a test credential, so do not use it against production.

Secret scanning downloads checksum-verified Gitleaks 8.28.0, runs generated-secret/redaction self-tests, and scans both current nonignored files and full git history. It retains Gitleaks' default rules and adds detection for the named Pulse secrets, including setup phrases. It requires Bash, curl, Git, Node and complete history (`git fetch --unshallow` if necessary). No secret baselines or suppressions are used. Every pull request runs typecheck, the real PostgreSQL tests, production build, Chromium checks and the secret scan in GitHub Actions.

## Replit hosting

`.replit` selects Node 24 and a Reserved VM, installs locked dependencies and builds on publication, then starts the compiled service on `0.0.0.0:3000`. Startup applies migrations. Replit's AI agent must not edit this repository; `replit.md` remains the hosting rulebook.

Will adds PostgreSQL and confirms which published database `DATABASE_URL` selects; this has not been inspected or deployed from the build environment. Set `NODE_ENV=production` (the deployment command does this), the confirmed HTTPS `APP_ORIGIN`, and `DASHBOARD_SETUP_CODE` in Replit. The working hostname in `src/config.ts` is explicitly unconfirmed; production refuses to start without an explicit HTTPS origin. Confirm the final address before enrolling a real device: passkeys belong to its hostname. HTTPS sessions use Secure, HttpOnly, SameSite=Strict cookies with the `__Host-` prefix. Do not move a live deployment to a different origin without planning device re-enrollment.

All source names, key requirements and stage numbers are in `src/sources.ts`; nonsecret store, location, product, account, list and campaign IDs are in `src/config.ts`. A source enters **live** mode only when all its required keys are present and nonblank. Missing keys show **Waiting for keys**; a fully configured source shows **Client not built**, never a false healthy state. Adding keys does not trigger any external call in stage 0a. Judge.me publishing remains disabled. API versions will be pinned with the source clients in their own stages.
