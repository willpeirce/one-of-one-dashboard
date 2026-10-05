# One of One Pulse

Will Peirce's private dashboard for One of One Trading Cards: sales, ads, stock, tests and new reviews on one page. Read-only to every source.

- Rules for anyone changing this repo: `AGENTS.md`.
- What to build: `docs/spec/` (a read-only copy from the HQ repo).
- Where the build is: `docs/BUILD-STATUS.md`. Why things are as they are: `docs/DECISIONS.md`.

Keys live only in Replit Secrets. Never commit one.

## Stage 0b

Node 24, TypeScript and one Fastify service, with PostgreSQL migrations, passkey sign-in, an audit log and ten source health rows. After sign-in the dashboard ports the supplied mockup: the period-driven hero, reviews above Tests, dials, detail sheets and navigation. Every page uses the same dark look, regardless of browser preference or a previously saved theme; the supplied wordmark is drawn white with CSS. All business figures are **sample data** served by the app. No source clients or external API calls exist yet.

Use the **W** account menu for Settings, source health, the audit log and sign-out. Source-changing actions remain disabled with a **Not built yet** note. Settings contains only the fields in plan 7.7; changes persist in PostgreSQL and each changed field has an audit entry. Unknown costs stay blank. The morning-summary switch saves a preference; delivery comes in stage 7.

The hero offers Today, Yesterday, 7 days, 30 days and **Dates**. Dates opens the mockup calendar for one day or a range, with quick ranges and keyboard navigation. Sample days run from 1 January to the fixed sample day, 30 September 2026; the last 15 days reproduce the mockup's readout. The signed-in `/api/hero?from=YYYY-MM-DD&to=YYYY-MM-DD` returns one range on demand. It rejects invalid, reversed, future UK dates, ranges over 366 days and dates outside available samples with a fixed error. Net-sales bars are daily up to 31 days and weekly averages beyond that. The 7- and 30-day tabs cover complete days before the sample today.

The dashboard receives authenticated Server-Sent Events at `/api/events`: an initial snapshot, refreshes every 15 seconds and immediate updates after Settings changes. Changing the blended Meta tripwire updates an open tab period without reloading. Snapshots carry only the four tab periods; a picked range remains on screen until another selection and is fetched again only on demand. The sample date and figures remain fixed; the connection timestamp is the real refresh time. A lost connection keeps the last sample snapshot and retries. Signing out revokes the stream.

Outfit, Plus Jakarta Sans, the supplied logo and all icons are served locally. The page makes no outside asset requests. On an iPhone, open the published HTTPS app in Safari, sign in, then choose **Share → Add to Home Screen**. The manifest uses standalone mode; there is no service worker or offline cache of private pages. Icon/font provenance and icon regeneration are in [public/README.md](public/README.md).

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

Both run commands read an existing `.env`. `HOST` defaults to loopback and `PORT` to 3000. `/health` returns only `{"status":"ok"}`, or `{"status":"unavailable"}` with HTTP 503 when PostgreSQL cannot be reached. The dashboard, `/sources`, `/settings`, `/audit` and their data/event APIs require a session. There are no request-body or credential logs.

## Database and migrations

The service runs `migrations/*.sql` before listening. `npm run migrate` does the same explicitly. Migration names and SHA-256 checksums are recorded in `pulse_private.schema_migrations`; a transaction and advisory lock make repeated and concurrent startup safe. Add a new numbered migration to change the schema; never edit an applied migration. There is no automatic destructive down migration.

Replit manages `public` during publication. New application tables must use `pulse`, or `pulse_private` for authentication state; never add `CREATE TABLE` in `public`. The already-applied migration `001_foundations.sql` remains unchanged. `002_application_schema.sql` moves the existing health and audit tables into `pulse`, or recreates them there if Replit has removed them, without dropping tables. Follow the publication order below before applying 002 in the Replit development database.

`pulse.source_health` keeps source mode, health, failure count and last-attempt/last-success times. `pulse.audit_log` stores fixed event names, timestamps and optional credential IDs; it has no arbitrary request or customer payload. The last 100 events are available after sign-in. Failed enrollment/sign-in, successful enrollment/sign-in, sign-out and rate-limit events are recorded.

Migration 003 adds `pulse.settings` and `pulse.settings_changes`. Settings saves validate the complete allowed shape and use a version to reject stale edits from another tab. Every changed field is recorded atomically with the save; unchanged saves add no audit noise. The audit stores field paths, never the values entered. Key expiry fields hold only a known key name and a date, never a key value. Back up Settings with the database because it cannot be recovered from a source.

The `pulse_private` schema holds passkey public keys, challenges, sessions, rate-limit counters, a random owner ID and generated application keys. Session tokens are random and stored only as HMACs. The session HMAC key and push key pair are generated once and retained in that private schema. PUBLIC access is revoked. Stage 7 must explicitly grant its separate read-only Ask role access only to intended `pulse` tables, never to this schema or the application's owner role.

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

`test:browser` starts its own server and isolated test database, generates its own temporary setup phrase in memory, and uses Chromium's virtual authenticator for real WebAuthn registration and signing. It checks sign-out, sign-in, replay/origin/signature rejection, persisted 30-day sessions, source health and audit. At 390px and 1280px, both light and dark browser preferences produce the same dark page and white logo without console errors, outside requests or horizontal overflow. It also exercises the date picker, hero periods, dials, reviews/Tests ordering, disabled actions, local fonts, installation assets, Settings persistence and an actual SSE update. If Chromium is already installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable instead of downloading a browser. `npm run browser:check` runs these checks against an already-running disposable instance using its `APP_ORIGIN` and setup phrase; it enrolls a test credential and edits a test setting, so do not use it against production.

Secret scanning downloads checksum-verified Gitleaks 8.28.0, runs generated-secret/redaction self-tests, and scans both current nonignored files and full git history. It retains Gitleaks' default rules and adds detection for the named Pulse secrets, including setup phrases. It requires Bash, curl, Git, Node and complete history (`git fetch --unshallow` if necessary). No secret baselines or suppressions are used. Every pull request runs typecheck, the real PostgreSQL tests, production build, Chromium checks and the secret scan in GitHub Actions.

## Replit hosting

`.replit` selects Node 24 and a Reserved VM, installs locked dependencies and builds on publication, then starts the compiled service on `0.0.0.0:3000`. The deployment command explicitly sets `HOST=0.0.0.0` and `NODE_ENV=production`. Startup applies migrations. Replit's AI agent must not edit this repository; `replit.md` remains the hosting rulebook.

Stage 0a was merged and deployed on 2 October 2026 at https://one-of-one-dashboard.replit.app on a Reserved VM. A separate Replit production database was added that evening. Will confirmed phone enrollment and sign-in on 4 October. Production `APP_ORIGIN`, the setup phrase and database binding are configured. HTTPS sessions use Secure, HttpOnly, SameSite=Strict cookies with the `__Host-` prefix. Use the replit.app address for now. A `kindarare.com` subdomain is planned later; that move requires a new `APP_ORIGIN` and phone re-enrollment because passkeys belong to their hostname.

Startup reports the actual Node major, expected as `Pulse Node major: 24`, and warns without aborting if it differs. Check the deployment logs, not the workspace Shell: they can use different runtimes. Fixed `ConfigError` validation messages are displayed. All other migration and startup failures report only a validated SQLSTATE or Node error code (`UNKNOWN` otherwise) and migration filename where available, never raw exceptions, SQL or connection details.

For the migration 002 publication, follow this order:

1. Merge the pull request, then use Git **Pull** in Replit.
2. Do **not** press **Run** or migrate in the workspace yet. That would move the development tables before publication, allowing Replit's schema comparison to remove the production tables.
3. **Publish**. If Replit lists database changes, stop and ask Claude; none are expected for this publication.
4. In the deployment logs, check for `Pulse Node major: 24`, `Database migrations complete.`, and `One of One Pulse is listening.`
5. Only after publication succeeds, run `npm run migrate` in the workspace **Shell** so the development database catches up.

All source names, key requirements and stage numbers are in `src/sources.ts`; nonsecret store, location, product, account, list and campaign IDs are in `src/config.ts`. A source enters **live** mode only when all its required keys are present and nonblank. Missing keys show **Waiting for keys**; a fully configured source shows **Client not built**, never a false healthy state. The stage 0b dashboard is explicitly a sample preview, including when keys are present: key readiness does not make its examples live. Adding keys does not trigger any external call. Judge.me publishing remains disabled. API-shaped fixtures and API versions will be introduced with the source clients in their own stages; `src/sample-dashboard.ts` holds the mockup's source-tagged presentation examples.
