# AGENTS.md: One of One Pulse

Instructions for any coding agent working in this repo. The first build is done by Codex; after that, Claude Code makes the edits. Read this whole file before your first change, and again at the start of every task.

## What this is

- One of One Trading Cards Ltd is a small UK company that sells a trading-card slab kit online (oneofonehq.com, on Shopify) in the UK, the US and the EU. The owner is Will Peirce. A sister brand, Kinda Rare, comes later.
- Pulse is Will's private dashboard: one page he opens on his iPhone every morning that shows sales, ad spend and returns, stock, live tests, new reviews and what needs him today. It pulls from Shopify, Meta Ads, Google Ads, Mailchimp, Judge.me and later a few more sources.
- One user (Will), installed on his home screen. Hosted on Replit (Reserved VM, PostgreSQL). Working address `pulse.oneofonehq.com`, not yet confirmed: keep it in config.
- It only reads. It never changes anything in a source system.

## Read first

1. `docs/BUILD-STATUS.md` and `docs/DECISIONS.md`: where the build is.
2. `docs/spec/plan.md`: sections 1 to 7 before writing code, then 8 to 13 as your stage needs them. Keys, sources, the facts the code must handle, metric definitions, build stages, screens.
3. `docs/spec/mockup.html`: the screen. Open it in a browser at phone width and at desktop width, in both themes. Port it; don't redesign it.
4. `docs/spec/control-centre.md` (what each part of the mockup means and what it defers) and `docs/spec/design-rules.md` (Will's taste).
5. As needed: `docs/spec/tests-register.md` (the Tests section and its stopping rule, 7.8) and `docs/spec/costs.md` (the costs table behind net margin, stage 6).

Which wins when they disagree: Will's words in the task, then this file, then the spec. Within the spec, the mockup and `control-centre.md` win on the screen (layout, look, hero, Tests, New reviews); `plan.md` wins on keys, sources, metric definitions and build order.

`docs/spec/` is a read-only copy of documents kept in Will's private HQ repo, which you cannot see. Paths in it such as `knowledge/...`, `ops/...`, `log/...`, `STATUS.md` and `CLAUDE.md` are HQ files; you don't need them. Where the plan says "Claude Code", read "the builder". Never edit `docs/spec/`. If the spec is wrong, unclear or contradicts itself, make the sensible call, record it in `docs/DECISIONS.md` and list it under "Spec conflicts" in the pull request.

## Non-negotiables

Breaking one of these fails the review, whatever else the pull request does.

1. **No secrets, anywhere.** Code reads keys from `process.env` by the names in plan section 1. Never write a key value into code, tests, fixtures, config, commits, pull request text, logs or error messages. No `.env` file is ever committed; a `.env.example` with names and no values is fine. You will not be given keys and do not need them: build and test on fixtures. If a task seems to need a real key or a real account, stop and say so in the pull request.
2. **Read-only to every source.** Each source client exposes reads only (plan sections 10 and 11): Shopify Admin GraphQL queries and ShopifyQL, Meta Marketing API GET, Google Ads `search` and `searchStream` only, Mailchimp GET, Judge.me GET, Gorgias GET, Discord read, GitHub read. The only writes allowed:
   - the app's own Shopify webhook subscriptions (create, re-create, delete its own);
   - Judge.me Publish and hide (plan 7.9), built behind a config flag that is off by default and stays off until Will says yes. While it is off, review rows show Open only.
   No other mutation, POST, PUT, PATCH or DELETE to a source. Make it impossible by construction: a client that has no write method, not a write method nobody calls.
3. **No customer personal data.** Store no customer names, emails, phone numbers or street addresses. Postcodes keep the first half only. Where a card shows a person (a ticket), it shows first name and initial; review rows show no reviewer name at all (7.9). Refer to orders and customers by id. Fixtures use invented people only, clearly fake. Never paste real customer data into the repo, a test, a log line or a pull request.
4. **Sample data is labelled.** Every number that is not from a live source shows under the "sample data" banner. A screen never mixes sample and live numbers without saying which is which.
5. **Pull requests only.** Work on a branch, one stage (or one part of a stage) per branch and pull request, for example `stage-0a-foundations`. Never push to `main`, never force-push a shared branch, never merge your own pull request. Will merges.
6. **CI stays honest.** Every pull request runs typecheck, tests and a secret scan (gitleaks or equal) that fails on anything that looks like a key. Never skip, disable or weaken a test, a check or the secret scan to get green.
7. **Replit is hosting only.** Replit's own AI agent never edits this repo (`replit.md` tells it so). Don't change `replit.md`. `.replit` holds the run, build and deploy settings so Replit needs no setup. No deploy steps in your work: Will deploys.
8. **No trackers.** No analytics, telemetry or third-party scripts in the app. Keep dependencies few, well known and pinned (lockfile committed).

## Stack

- One service: Node 24 and TypeScript, PostgreSQL, served from a Replit Reserved VM.
- Front end ported from `docs/spec/mockup.html`: keep its look, layout, fonts, both themes and its phone and desktop behaviour. Choose the front-end approach (plain TypeScript and templates, or a small framework) and record why in DECISIONS. The page must work as an installed home-screen app (web app manifest, icons from `docs/spec/logo.png`).
- Live updates over Server-Sent Events. Passkey sign-in (WebAuthn, Face ID and Touch ID); `DASHBOARD_SETUP_CODE` adds a device; attempts are rate-limited; sessions last 30 days.
- `/health` returns status only, no data. A source health table, Settings (only the fields in plan 7.7) and an audit log.
- Database migrations in the repo. Ask (stage 7) uses a read-only database role. Keys the app makes itself (session signing, push) live in a table that role can't read.
- Tests: CI runs database tests against a real PostgreSQL (a service container). Make them runnable inside your own sandbox too (an embedded Postgres such as PGlite, or one your setup script starts); record which in DECISIONS.

## Sources: sample mode and live mode

- Every source runs in one of two modes. **Live** when all of its keys (plan section 1) are present in the environment. **Sample** otherwise: it serves invented data in the source's real shape, its cards sit under the sample banner, and its health row reads "waiting for keys".
- So `main` always runs on Replit, with no keys, some keys or all of them, and a stage's code can be built and merged before its keys exist. When Will adds a key and redeploys, that source switches to live by itself.
- Fixtures live under `test/fixtures/<source>/` as invented API responses in the real shape of that API (Shopify Admin GraphQL and webhooks, Meta Marketing API, Google Ads REST `searchStream`, Mailchimp Marketing API, Judge.me). Pin each API version in config and note it in DECISIONS.
- Every external call has a timeout and 3 retries with backoff, respects the source's rate limits, and logs the request id, never the token. Ingest is idempotent (upsert on the source's own id). Every row carries source, source id, fetched time and brand (brand is `one-of-one` for now; Kinda Rare comes later).
- Ids that aren't secret (store domain, location ids, product ids, ad account, Google customer id, Mailchimp list id) go in one config file, taken from plan section 13. Never in Secrets, never scattered through the code.

## Facts that bite

Plan section 4 lists them. Each one your stage touches needs a test. The ones most often got wrong:
- Every day boundary is the UK day (Europe/London), including across the clock change on 25 Oct 2026. Google Ads reports on GMT, so its hourly rows are re-bucketed into UK days (4.1).
- Revenue means Shopify net sales as section 5 defines it. Meta's own purchase count over-credits; show it beside Shopify's, never instead of it (4.3).
- Spike days (24th to 26th in the UK, 1st and 15th in the US, the last two days of every month in both) are labelled, and verdicts don't rest on them.
- 22 and 23 Sep 2026 conversion by market shows as unknown (the geo guard, 4.2).

## How to build a stage

1. Read the stage in plan section 6, the screens it feeds in section 7, and `docs/BUILD-STATUS.md`.
2. Build it on fixtures, with tests. Plan 10 lists the tests the build needs; add the ones for your stage.
3. A stage's "Done when" in plan section 6 is checked against live numbers after Will adds its keys; you can't check that. Your pull request is ready when the stage works end to end on fixtures, CI is green, and the records below are updated.
4. If a stage is too big for one task, split it into parts (`stage-1a-...`, `stage-1b-...`). Each part leaves `main` working.
5. Start each stage from the latest `main`. If the previous stage's pull request isn't merged yet, say so and stop rather than stacking on it.

Stage order is plan section 6: 0 foundations, 1 Shopify (and New reviews from Judge.me), 2 Meta, 3 Google Ads, 4 Mailchimp, 5 workflow side, 6 costs and uploads, 7 alerts and Ask. Do not build what plan section 11 says not to build.

## Records

- `docs/DECISIONS.md`: one entry per build decision: date, stage, the decision, why, what else was considered. Newest at the bottom.
- `docs/BUILD-STATUS.md`: update it in every pull request: the stage table, what runs on sample and what on live, the next step, and open questions for Will.
- `README.md`: how to install, run, test and migrate locally, kept current.

## Pull request description

Use these headings:

```
## Stage
## What it does
## How to check it (on sample data, phone and desktop)
## Needs from Will (keys, Settings values, decisions)
## Decisions (also in docs/DECISIONS.md)
## Spec conflicts
## Not done or known gaps
```

## Handover

After the first build, Claude Code takes over the edits. Leave it easy to pick up: a plain folder structure, one client per source, metric maths in pure functions with tests, comments only where the reason isn't obvious from the code, and `docs/BUILD-STATUS.md` current. No generated code is committed without a note saying how to regenerate it.
