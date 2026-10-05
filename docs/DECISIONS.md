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

## 2026-10-02, stage 0a: explicit deployment host
The Reserved VM deployment command sets `HOST=0.0.0.0` alongside `NODE_ENV=production`, so its network binding is self-contained. Relying only on `.replit`'s `[env]` block was considered less reliable for deployment. The local runtime default remains loopback.

## 2026-10-02, stage 0a: safe configuration diagnostics
Runtime validation uses `ConfigError` for fixed, safe configuration messages. Startup prints `Pulse could not start: <message>` only for that error type; other failures retain a generic message. This makes configuration mistakes actionable without exposing environment values or raw exceptions. Suppressing every validation detail and logging arbitrary exception messages were considered and rejected.

## 2026-10-04, stage 0a: confirmed production deployment
Stage 0a was merged and deployed on 2 October at https://one-of-one-dashboard.replit.app on a Replit Reserved VM. A separate Replit production database was added that evening; Will confirmed enrollment and sign-in on his phone on 4 October. These facts supersede the earlier open deployment, origin, setup-phrase and database-binding items. Use the replit.app address for now; a `kindarare.com` subdomain is planned later, requiring a new `APP_ORIGIN` and phone re-enrollment when it changes.

## 2026-10-04, database fix: application tables outside Replit's managed schema
Use `pulse` for application tables because Replit manages `public` during publication. Going forward, never add `CREATE TABLE` in `public`; keep authentication state in `pulse_private`, and grant the future Ask role only intended `pulse` tables. The already-applied `001_foundations.sql` is an immutable historical exception. `002_application_schema.sql` moves existing health and audit tables to `pulse`, or recreates them if missing, without dropping tables. Editing 001 or relying on Replit to preserve application tables in `public` was rejected. For this transition, publish before running development migrations so Replit does not interpret the development schema move as a production-table removal.

## 2026-10-04, database fix: useful database diagnostics without raw errors
Startup and the migration CLI display fixed `ConfigError` validation messages. All other migration and startup diagnostics expose only validated SQLSTATE or Node error codes (`UNKNOWN` otherwise) and a migration filename where available, without raw exceptions, SQL or connection details. Generic errors alone hid the failing operation; logging whole exceptions could disclose credentials.

## 2026-10-04, database fix: observe the deployed Node runtime
Log the actual Node major at startup, expected as `Pulse Node major: 24`, and warn without aborting when it differs. Read that evidence in deployment logs rather than relying on the workspace Shell, which can run a different Node version. Observe the published runtime before changing hosting settings; guessing new `.replit` settings was rejected.

## 2026-10-04, stage 0b: port the mockup on server-supplied samples
Keep the mockup's structure, CSS, gradient, source marks, hero period switch, score column, reviews above Tests, dials and navigation. Continue with TypeScript and server-rendered HTML rather than introducing a framework. The mockup was opened at 390px and 1280px in both themes before the port. All business values and numeric copy are source-tagged sample presentation fixtures served by the app, shared between the initial page and event updates; there are no metric constants in the browser or page template. These are invented presentation examples, not captured API responses. API-shaped fixtures and versions belong to each source's later client stage.

The dashboard is an explicit sample preview even when a source's keys are present, because its client is not built. Actual key readiness remains separate in source health; sample feeds never claim a successful real sync. The sample date stays fixed while the connection timestamp reflects actual refreshes. Mockup Tests remain a sample readout: no verdict calculations or register writes are claimed. A saved theme is respected; dark is the initial default.

## 2026-10-04, stage 0b: source actions stay disabled
The control-centre note describes source-changing actions that conflict with AGENTS.md's read-only rule and the user's stage 0b request. Keep their placement but disable them with a short “Not built yet” note, including review publishing, ad changes and sample-only actions that would otherwise pretend to save or send something. Retain working local navigation, sheets, search, themes and Settings. The sample source glyphs are ported from the mockup; real source-brand assets remain for the respective client stages. No spec files or source-system permissions were changed.

## 2026-10-04, stage 0b: Settings are versioned and audited atomically
Migration 003 creates only `pulse.settings` and `pulse.settings_changes`; earlier migrations are unchanged. Settings accepts only plan 7.7's fields, with bounded types and known defaults from the plan/config. Unknown costs and counts stay unset rather than becoming zero. Contacts hold business names and roles, with no customer contact fields. Key-expiry rows accept a known key name and a date only. The only current brand is One of One; the morning-summary preference is stored but delivery remains stage 7.

Each explicit save checks the version so another tab cannot silently overwrite newer values. The save and one audit entry per changed field share a transaction. Audit records identify field paths without recording the values entered; unchanged saves add no events. Free-form JSON settings and recording arbitrary before/after values were rejected. The blended Meta tripwire already drives the sample hero's thresholds; costs, campaign maps and other rules are retained for their owning source stages.

## 2026-10-04, stage 0b: authenticated live updates and local installation assets
Use same-origin Server-Sent Events for an initial snapshot, periodic refreshes and immediate Settings updates. Validate the session again before sending data, close revoked streams, bound concurrent connections and discard slow connections instead of retaining unlimited output. Preserve the selected hero period, dial deck, theme and scroll position. Reconnecting keeps the last labelled sample snapshot, never a fabricated successful source update. Polling in the browser and simulated random metric changes were rejected.

Serve pinned Fontsource Outfit and Plus Jakarta Sans files and their OFL licences locally. Generate the home-screen icons from the supplied logo; `public/README.md` documents provenance and regeneration. The manifest and Apple touch icon support standalone home-screen installation. No service worker or offline cache of private pages is introduced. CSP permits only local scripts, fonts, images, connections and the manifest; style attributes support the mockup's chart geometry. Actual Safari/iPhone installation and the published connection still need Will's live check after publication.

## 2026-10-04, stage 0b review: preserve number typography through sample bindings
Scope the `.nums` label rule to direct child label spans. Nested `data-sample-*` wrappers inside a value then inherit its 17px bold display font and value colour, rather than becoming small muted labels. This restores the mockup's visual hierarchy while keeping the shared sample bindings; removing those bindings or adding duplicate value-style overrides was rejected.

## 2026-10-04, stage 0b review: keep disabled actions recognisable
Keep each disabled action's original label visible and add a separate small “Not built yet” note. Preserve its existing `aria-label` so the action remains identifiable to assistive technology. Replacing every label with “Not built yet” concealed what the button would do; title-only labels were also rejected because phone users cannot rely on hover. The actions remain disabled.

## 2026-10-05, logo and dates: one dark look
Follow Will's 5 October instruction and mockup 8: all pages use the dark palette, regardless of browser preference or an old `pulse-theme` value. Remove light tokens, light-only rules, theme controls and theme storage reads. This supersedes stage 0b's saved-theme decision; retaining a hidden light mode would leave old browsers showing the wrong look.

## 2026-10-05, logo and dates: draw the supplied wordmark white
Use mockup 8's `--logo-filter` token, including `brightness(0) invert(1)`, on the header logo and Settings wordmark. Keep the supplied file and its transparent lettering. A replacement image or a drawn copy is unnecessary; the manifest and home-screen icons stay unchanged.

## 2026-10-05, home-screen icon: the sky with the white mark, no plate
Will found the published home-screen icon ugly: a white plate holding the black mark on flat purple. Draw the icons from the header's own `--sky` and `--logo-filter` tokens instead, read from `src/dashboard.css`, so the icon matches the header and follows any later token change when regenerated. The mark spans 70% of the width, inside iOS's rounded-corner mask, and its lettering shows the sky through it. Playwright's Chromium draws each size at its own pixels; it is already a pinned dev dependency, so ImageMagick is no longer needed and its radial gradients would not reproduce the CSS sky. This supersedes the logo-and-dates note that the icons stay unchanged.

## 2026-10-05, logo and dates: four tab periods and the mockup calendar
Add the 30 days tab beside Today, Yesterday and 7 days, then the calendar-icon Dates control. Port the mockup's sheet/dialog, month layout, quick ranges and selection appearance; add arrow-key navigation, full-date accessible names and focus return to Dates. A matching selection uses its tab. The 7- and 30-day tabs cover complete days before the fixed sample today, 30 September 2026; sample history starts on 1 January. Moving the sample clock with the real day would detach the existing readout and other dated cards from their example scenario, so this change keeps the mockup's sample clock explicit.

## 2026-10-05, logo and dates: aggregate daily samples behind an authenticated range endpoint
Serve one `HeroPeriod` from signed-in `GET /api/hero?from=YYYY-MM-DD&to=YYYY-MM-DD`, using the same session check as `/api/dashboard`. Validate real dates, ordering, the current Europe/London day and a maximum of 366 inclusive days; dates outside the available sample history also receive the same fixed 400 response. Never reflect invalid input in the error. Keep daily aggregation separate from the deterministic sample generator so later Shopify, Meta and Google sources can supply daily rows without replacing the range maths. The generator ports the mockup's seeded days and final 15 readout days; no request-time randomness or external calls are introduced.

Net-sales bars and detail histories use daily values up to 31 days, then weekly averages per day, with the mockup's date labels and accessible descriptions. Server-Sent Events carry only the four tab periods. A picked range is fetched on demand and held on screen through live updates; it is fetched again when selected again. Pushing every possible range or silently replacing one with the current tab would break the chosen view.

The mockup's daily Meta spend rows do not exactly reproduce its seven-day readout. Reconcile the invented 23–28 September rows in pence to the existing UK £26.65 and US £34.27 blended readouts, preserving 29 September's market costs per order and each day's total ad spend; Google receives the balancing remainder. Preserve the readout's £59 own spend today, £466 yesterday and £3,262 over seven days by allocating owner spend in the sample source. The old yesterday split is also contradictory: its market orders and costs imply £1,227.68 Meta spend, so Google becomes £142.32 of the £1,370 total, instead of the old £94.52. All eight headline hero values stay intact; range sums and the breakdown now agree.

The source guard follows plan 4.2: ranges containing 22 or 23 September show market conversion as unknown while retaining store-wide conversion. Spike-day notes follow plan 4.3. These factual rules take precedence over the mockup's unguarded sample calculations; the spec files remain unchanged.

## 2026-10-05, logo/date review: concise spike-day notes
List individual dates and markets for up to five spike days; for more, show the number of spike days in the range. Keep the warning against basing a verdict on a spike day alone and each chart bar's date/market markers. This keeps long-range detail sheets and accessible chart descriptions readable on a phone; repeating all 63 year-to-date dates was rejected. Counts refer to distinct days, including days that affect both markets.

## 2026-10-05, logo/date review: consistent calendar names
Build full calendar day names and month titles from fixed English weekday/month arrays and UTC date parts. Keep the full weekday, date and year, plus the sample-today label where applicable. Browser locale formatting was rejected here because its punctuation differs between browsers, making accessible names and their exact browser checks inconsistent.


## 2026-10-05, stage 1a: split ingestion from cards and reviews
Will explicitly split stage 1. Part 1a owns Shopify tokens, backfill, webhooks and polls; part 1b owns cards, watchdogs and New reviews from Judge.me, with Publish/hide behind the existing flag, off. Source health shows source-owned import counts in 1a. Business cards remain labelled examples until 1b replaces them; partially converting the hero now would mix Shopify orders with sample sessions, ads and costs. Start from latest main `58a5058` after verifying merged stage 0b and both follow-ups. No deployment or prototype-app uninstall is performed.

## 2026-10-05, stage 1a: API version, fixtures and narrow clients
Pin Shopify Admin GraphQL and webhook API to `2026-10`, the current quarterly version. Keep invented API envelopes under `test/fixtures/shopify/` and use them directly in sample mode at the established 30 September clock. Live mode requires only the two section-1 Shopify keys and switches automatically on redeploy. The client exposes fixed read operations and creation of its own webhook subscriptions at the configured published address, with private GraphQL transport; there is no general mutation method or REST order writer. Inventory reads only section-13 products and J&J locations; TikTok duplicate products remain in orders only. A third-party source SDK was considered unnecessary.

## 2026-10-05, stage 1a: memory-only tokens and durable resumable jobs
Keep client-credentials tokens only in memory, renew after 20 hours (or earlier when the response lifetime requires it), collapse simultaneous exchanges, and refresh once after 401. External calls use 10-second timeouts, three retries, backoff, Retry-After and GraphQL cost budgets with serialized transport calls. Log validated request ids and status only. Durable job checkpoints retain a fixed backfill window and page cursor; idempotent upserts make a replay safe if a process stops between the page and checkpoint commits. Modes have separate records/checkpoints so removing or adding keys never mixes sample and live rows. One worker runs in the existing single-process Reserved VM; horizontal worker leasing is outside this deployment model.

Five-minute order polls overlap by ten minutes and extend back to the prior successful pull after downtime. Nightly reconciliation starts at 00:01 UK and covers the current seven completed UK dates; hourly checks re-create missing app subscriptions and record notices for 1b. The inbox runs independently of large backfills/stock pulls. Last good data survives errors. Nested lines, refund lines, variants, levels and subscriptions paginate rather than silently truncate.

## 2026-10-05, stage 1a: privacy takes precedence over raw webhook retention
Plan 4.2 requests retained raw webhook payloads; AGENTS prohibits storing customer names, emails, phone numbers or street addresses. Verify HMAC over original bytes, then discard those bytes and persist only allowlisted order/inventory identifiers and trusted event metadata. Request identifier-only subscription fields as an additional minimisation measure. Replay re-fetches the current order/stock through privacy-limited GraphQL, so old/out-of-order events cannot restore stale cancellation/refund state. Full payload storage, including encrypted copies, was rejected. This is a spec conflict for the HQ master copy; `docs/spec/` is unchanged.

Queries never request personal address fields, names, email or phone. Retain country, region and the outward UK postcode only. Without address permission retry without the address and use currency/warehouse, explicitly recording the basis. Unknown/non-EU countries stay unknown rather than being treated as EU. Arbitrary order attributes and raw landing URLs/click ids are discarded; retain the gift-test arm and attribution flags/UTMs for later cards. Bundle tiers come from ordered product ids.

## 2026-10-05, stage 1a: geo/session guards and refused-report fallback
Store clean session/funnel totals by UK day, excluding only the `/pages/inside` desktop/Google/no-cart phantom pattern. Flag market conversion for 22/23 September and whenever Missouri exceeds 10% of US sessions, without altering orders or store-wide sessions. Keep a notice for the part-1b geo card; this part does not claim a watchdog verdict.

With Level 2 refused, keep missing reports unknown, retain last good rows and retry denied access hourly. Plan 4.2 does not specify a routine-file path or format. Define `ops/shopify-daily/YYYY-MM-DD.json` in HQ as the real ShopifyQL `tableData` object (columns/rows), one completed UK date, read from main by a narrow GET-only GitHub Contents adapter pinned to REST `2022-11-28`. Mark ingested rows `routine_daily`; never fabricate live today from yesterday. A session must create the actual connector routine/files if needed; none is claimed to exist. It requires the existing `GITHUB_HQ_TOKEN` earlier than stage 5 only on this fallback path. Without its key/file, sessions are unavailable. General HQ/Handover ingestion stays stage 5. When Level 2 is refused, older orders need `read_all_orders`, as the plan says; no substitute zeros are produced.
