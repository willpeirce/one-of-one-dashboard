# One of One Pulse

Will Peirce's private dashboard for One of One Trading Cards: sales, ads, stock, tests and new reviews on one page. Source reads are automatic; confirmed Meta ad-set actions have a separate flag that is off by default.

- Rules for anyone changing this repo: `AGENTS.md`.
- What to build: `docs/spec/` (a read-only copy from the HQ repo).
- Where the build is: `docs/BUILD-STATUS.md`. Why things are as they are: `docs/DECISIONS.md`.

Keys live only in Replit Secrets. Never commit one.

## Stage 1b

Node 24, TypeScript and one Fastify service, with PostgreSQL migrations, passkey sign-in, an audit log and eleven source health rows. After sign-in the dashboard ports the supplied mockup: the period-driven hero, reviews above Tests, dials, detail sheets and navigation. Every page uses the same dark look, regardless of browser preference or a previously saved theme; the supplied wordmark is drawn white with CSS. Shopify business figures now use ingested records, live when its existing keys are present or **sample data** otherwise. Other-stage examples remain individually labelled; ad spend, ROAS, margin and market CPO use connected spend sources with explicit partial-source labels. New reviews uses Judge.me v1 GET-only polling every five minutes, with Publish still disabled. Source health displays all stored import counts, including old records excluded from window-based cards.

Use the **W** account menu for Settings, source health, the audit log and sign-out. Deferred source actions remain disabled with a **Not built yet** note. Meta ad-set actions have a separate opt-in flag and confirmation. Settings contains plan 7.7 fields and the new Ad spend group; changes persist in PostgreSQL and each changed field has an audit entry. Unknown costs stay blank. The morning-summary switch saves a preference; delivery comes in stage 7.

Shopify's cost per item is the unit-cost source of truth. Inventory polls/webhook refreshes record observed variant cost history in migration 006; Settings starting unit costs are optional fallbacks. Costs & dispatch shows the observed Shopify costs and dates. `costOrder` in `src/shopify/costs.ts` returns historical line/order costs with provenance and preserves unknown totals for later margin work. Margin now uses known unit costs and fulfilment estimates; unknown components are named and left out. After Publish, run `npm run migrate` in the Shell as usual.

Fulfilment costs is in the account menu and Store panel. Upload J&J ExportOrders CSV, review the parsed rows and confirm before anything saves. Migration 007 re-fetches order numbers once; migration 008 moves complete-export coverage to date ranges. After Publish run `npm run migrate` in the Shell. Startup rebuilds stored parcel reviews. Upload monthly with the invoice and after change events; the first-working-day 09:00 UK reminder clears when confirmed complete ranges cover the previous month. The preview checkbox uses the file’s despatch range. Set **J&J GBP per USD** from each invoice (default 0.754); uploaded actuals retain their original conversion. `readEstimates` and `/api/fulfilment` expose per-order cost/source for later margin work. Sample CSVs can be regenerated with `python scripts/generate-fulfilment-fixture.py`; all rows are invented. No margin tiles or VAT setting are added.

The hero offers Today, Yesterday, 7 days, 30 days and **Dates**, independently of **All / UK / US**. Snapshots and the signed-in `/api/hero?from=YYYY-MM-DD&to=YYYY-MM-DD` carry all three markets, so market taps need no request and survive period changes and live updates. The eight-card grid includes AOV and CAC (currently all placed ad spend per counted order); Net profit remains visible in a tappable strip. Shopify's Total sales: items after discounts, plus shipping and tax, minus refunds. This appears as Total below Net sales and in its sheet. EU, unknown and TikTok orders appear under All only. Free orders are excluded from counts and ratios while their goods and postage still lower profit and margin. Missing historical facts remain unavailable until their bounded background reads complete.

Dates opens the mockup calendar for one day or a range, with quick ranges and keyboard navigation. The invented API card history covers 400 days through the fixed sample day, 30 September 2026; the last 15 days reproduce the mockup's readout. The range API rejects invalid, reversed, future UK dates, ranges over 366 days and dates outside available samples with a fixed error. Net-sales bars are daily up to 31 days and weekly averages beyond that. The 7- and 30-day tabs cover complete days before the sample today.

The dashboard receives authenticated Server-Sent Events at `/api/events`: an initial snapshot, refreshes every 15 seconds and immediate updates after Settings changes. Changing the blended Meta tripwire updates an open tab period without reloading. Snapshots carry only the four tab periods; a picked range remains on screen until another selection and is fetched again only on demand. The sample date and figures remain fixed; the connection timestamp is the real refresh time. A lost connection keeps the last sample snapshot and retries. Signing out revokes the stream.

Outfit, Plus Jakarta Sans, the supplied logo and all icons are served locally. The page makes no outside asset requests. On an iPhone, open the published HTTPS app in Safari, sign in, then choose **Share → Add to Home Screen**. The manifest uses standalone mode; there is no service worker or offline cache of private pages. Icon/font provenance and icon regeneration are in [public/README.md](public/README.md).

Ad spend reads Meta Marketing API, Google Ads searchStream and TikTok Business API, without platform writes. After Publish run `npm run migrate` in the Shell for migration 009. Add source keys in Replit Secrets and account IDs in **Settings > Ad spend**, one source at a time; IDs are blank by default and Google dashes are stripped. Map Meta campaign IDs to ours/freelancer; optionally set Google’s manager and expected campaign IDs. Republish after Secrets changes if needed. Source health shows resumable backfill from 7 August 2026, then Live. Verify three complete UK days per platform against its ads manager to the penny. Google uses the three existing OAuth keys without a developer token; TikTok adds only `TIKTOK_ACCESS_TOKEN`. Without keys/account IDs each source waits independently. Sample spend is used only with sample Shopify. Non-GBP spend is not counted, unknown-market spend is not shared out, and today remains “so far”. Full conversions, attribution, first-order CAC and kill/step rules remain deferred.

Batch 3 adds Top creatives above the source dials and a `/creatives` gallery. It groups ad-level Meta claims by picture/video, keeps unknown-market ads under All, and labels Meta purchases and ROAS. Open a picture for copy, windows, running ads, source links and the account-wide Shopify comparison. Stored media routes require sign-in; video playback reads an expiring Meta URL at tap time without exposing the access token or storing the video. Same video, Split, Undo, Done and Snooze write only to Pulse. Source health shows catalogue/backfill progress, storage and reconciliation; ad-set spend remains authoritative for the hero.

Creative spend and additive counts use UK days, including accounts set to GMT or another timezone: hourly Meta reports are aligned to Europe/London when needed. Reach, frequency and average play time retain Meta account days, as does the separate seven-day audience report. The sheet names this difference; GMT account days differ from UK days by one hour during British Summer Time. Creative insights still require GBP.

Batch 4 adds attributes, tap-to-save tags, a tagging queue, attribute filters, model scans, calculated lifts and copyable Make next briefs. After Publish, run `npm run migrate` for migration 017. Creative Settings remain in the Meta block. Set both scan prices from the selected model’s current pricing, converted to pounds per million tokens, and check the daily cap before adding `ANTHROPIC_API_KEY` and setting `CREATIVE_SCAN_ENABLED=true` in Replit Secrets, then Publish again. Prices default to zero and scans wait until both are configured; the flag defaults off. Scan now and scheduled scans use the same prices and cap. Every Meta request remains a GET; the only new outbound POST is the flagged Anthropic Messages call. Tags change only Pulse, and Copy sends nothing. All added sample media, names, identifiers and figures are invented; sample lifts are fixed labelled illustrations while live lifts recompute after tags and worker runs. See [the post-Publish checks](docs/BUILD-STATUS.md#next-step).

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

All source names, key requirements and stage numbers are in `src/sources.ts`; nonsecret identifiers and API versions are in `src/config.ts`. Shopify switches automatically to live when both `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` are nonblank. With either missing, it imports invented API fixtures at the fixed sample date without network calls and remains **Waiting for keys**. Ad spend and Judge.me have their own independent sample/live connections; Anthropic creative scans also require the scan flag and configured prices. Other source clients remain deferred. Importing Shopify does not make other-source examples live. Judge.me uses `JUDGEME_API_TOKEN` and the existing Shopify domain after the next start, with no new scope. Without the token it shows three labelled invented reviews and Waiting for keys. Publish remains off.

## Shopify ingestion (part 1a)

Migration 004 adds only `pulse` tables: source records, resumable jobs, the privacy-filtered webhook inbox and notices. No previous migration changes. Start/migrate as above. `test/fixtures/shopify/` is included in the checkout for production sample mode; never replace these files with captured customer data. Signed-in `/sources` and `/api/shopify` show sample/live import counts, job checkpoints and notices. No raw source records or credentials are exposed. On a no-key instance expect one order, one inventory row and one session day from these fixtures; counts are records imported, not paid orders/stock units sold.

The worker starts with the service and stops before the database closes. It backfills 400 UK dates with `read_all_orders`; otherwise 60 dates plus older ShopifyQL daily sales. Token renewal is automatic after 20 hours; the token is never stored. Orders poll every five minutes with overlapping windows; inventory and sessions/funnel poll every five minutes; subscription existence is checked hourly; the last seven completed UK dates reconcile nightly after UK midnight. Failed jobs and inbox events retry and resume on restart. Nested GraphQL connections paginate. The deployment runs one service process, not several replicas.

The only unauthenticated source route is `POST /webhooks/shopify`: published `APP_ORIGIN` plus this path is the subscribed URL. HTTPS is required and `.replit.dev`/localhost origins cannot be subscribed. Shopify's HMAC (client secret), store domain, allowed topic and delivery id are checked. Original bytes are used for the signature then discarded; identifier-only payloads persist for replay. The other write routes still require Origin/session checks. There is no source mutation outside creation of this app's own subscriptions.

When Level 2 reports are refused, missing sessions/history stay unknown and last good rows remain. The optional daily connector routine fallback reads `ops/shopify-daily/YYYY-MM-DD.json` from HQ `main` with `GITHUB_HQ_TOKEN`. Each file must contain one completed UK day's real ShopifyQL `tableData` (the `columns`/`rows` object returned by `sessionQuery` in `src/shopify/worker.ts`); include the same country/region/landing-path/device/referrer dimensions for geo and phantom filtering. The narrow GitHub adapter is read-only, version `2022-11-28`, and stores only clean session totals, labelled `routine_daily`. The routine is **not created by this PR**. Without its key/file, source health reports unavailable sessions. With Level 2 refused, older order history requires `read_all_orders`.

For live validation Will adds only key names from plan section 1 in Replit Secrets and redeploys; never provide values to a builder. Confirm granted scopes and compare source numbers after part 1b. The three-day reconciliation, ten-second order-to-card check, review lifecycle and watchdog checks belong to full stage 1; they cannot be verified without live access. Prototype app removal remains a separate explicitly approved action. No deployment is part of this change.

## Shopify cards and watchdogs (1b)

Migration 005 adds application-only tables in `pulse`, the 2026–27 warehouse holiday calendar and one refresh of existing backfill projections. Before that refresh finishes, missing new payment/channel/fulfilment facts are unknown. No older migration changes. Cards exclude orders created before the fixed backfill boundary even when those orders were updated recently; older ShopifyQL store-wide sales are separate. Net sales retain pence and apply item refunds on their UK refund day, excluding item tax and shipping.

The Store deck contains checkout and every configured product/location's stock, cover and run-out sheet. Add a seasonal multiplier in Settings for cover; without it cover remains unknown. Refill Pack and Shopify-side Email follow the selected hero dates. Watchdogs evaluate every minute with restart-safe snapshot observations; passing/unknown checks are in the pill and tripped checks become Needs you cards with Open links. Nightly reconciliation compares channel counts over seven completed UK dates. Scopes stay in Shopify's Dev Dashboard; the live channel check decides marketplace access.

Regenerate the entirely invented card API envelopes with `python scripts/generate-shopify-cards-fixtures.py`. Nothing in that command calls a source. To use an installed local Chromium for the same browser checks: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser`. Optional `PULSE_SCREENSHOT_DIR=/tmp` captures phone/desktop screens during normal virtual-passkey enrollment. Judge.me live review checks are described in BUILD-STATUS; the flag `appConfig.judgeme.publishEnabled` remains off. Migration 014 adds the panel-only review table and durable campaign sync state; migration 015 persists the unread-review notice count. After Publish, run `npm run migrate` for both migrations, add the private token from Judge.me Settings > Integrations > View API tokens as `JUDGEME_API_TOKEN` in Replit Secrets, then Publish again. Within about ten minutes, check Source health and waiting reviews. No webhook registration or source write is made, and reviewer names/emails/IPs are discarded before storage.

Review Open/Read links always use the Judge.me reviews dashboard at `https://app.judge.me/index`; Judge.me has no per-review admin page, so no URL template is needed. Polls request unpublished reviews and trust an explicit boolean `published` value over `curated`. A malformed row does not discard good rows: one count-only notice persists until the next clean poll, and unseen cached rows remain until a clean poll confirms removal. Logs contain the skipped count only, never row values. Retry-After waits are capped at 60 seconds.


## Meta ad-set rules (16 Oct batch)

After Pull and Publish, run `npm run migrate` (019–026). Settings > Ad rules holds UK/US break-even, dated overrides, kill/slipping and ATC bars, spend floors, Sunday-base uplifts, freelancer trigger and test share cap. Mark test campaigns only after assigning them to ours. The invented defaults need Will's review. Home decision cards and `/ads` use the last full UK days; Source health reports independent catalogue freshness. Sample mode shows invented examples of every verdict.

Keep `META_ACTIONS_ENABLED` unset until ready. Exactly `true` exposes confirmed Pause, Resume and daily-budget changes for explicitly owned ad sets only; the existing Meta access token stays in process.env. `/audit` shows actions and external catalogue changes. Undo is available for 24 hours unless a later change invalidates it. No action runs from a timer. Interrupted pending actions require checking the source/audit before manual recovery; they are never automatically repeated.

Migrations 019–024 add the catalogue, ad-set metrics, Settings audit paths, ad status age, external change log and action audit. Migration 025 adds daily creative completion and independent failure markers, re-certifying retained history in bounded chunks. Migration 026 adds safe scan failure diagnostics and replaces weekly cooldown with next-UK-day retry. Catalogue throttling waits outside the Meta queue; spend and daily creative insights keep separate guards. Scan failures show a reason and remain subject to the daily cap. No earlier migration is changed.
