# Build status

Updated in every pull request.

| Stage | What | Code | Keys in Replit | Live check ("Done when") |
|---|---|---|---|---|
| 0a | Service, database, passkeys, audit, source registry, CI | merged 2 Oct 2026; deployed 2 Oct | `DASHBOARD_SETUP_CODE`: configured | Will's phone enrollment and sign-in confirmed 4 Oct |
| 0b | Real screen on sample data, live updates, Settings, home-screen app | implemented on `stage-0b-screen`; awaiting review | no source keys needed | Will's phone/install check pending after merge and publication |
| 1 | Shopify, New reviews (Judge.me) | not started | no | no |
| 2 | Meta | not started | no | no |
| 3 | Google Ads | not started | no | no |
| 4 | Mailchimp | not started | no | no |
| 5 | Workflow side (Handover) | not started | no | no |
| 6 | Costs, uploads, planning | not started | no | no |
| 7 | Alerts and Ask | not started | no | no |

## Next step

The Replit database fix is merged. Review stage 0b, then Will publishes and checks the dashboard and home-screen installation on his phone. If migration 002 is not yet deployed, retain its publication order in README. Source clients start in their own stages; Shopify and Judge.me are stage 1.

## What runs

- Node 24 + TypeScript service, PostgreSQL migrations and a status-only `/health`.
- Live at https://one-of-one-dashboard.replit.app on a Reserved VM since 2 October 2026, with a separate Replit production database added that evening. Will confirmed phone enrollment and sign-in on 4 October.
- Verified-device passkey enrollment with a setup phrase, passkey sign-in, persistent rate limiting, 30-day server sessions and immediate sign-out revocation.
- Authenticated mockup screen under the **sample data** banner: the three-period hero, score column, action table, New reviews above Tests, all four dial decks, detail sheets and navigation. Dark is the default; a saved light theme is retained.
- Local fonts and logo, manifest and home-screen icons; no external asset requests or private offline cache. Source health and audit remain available in the account menu.
- Authenticated Server-Sent Events refresh the sample snapshot and apply Settings changes without reloading. Source-changing and deferred actions remain disabled with **Not built yet** notes.
- Only plan 7.7 Settings fields, stored in `pulse` with optimistic version checks and one atomic audit entry per changed field. No key values or before/after values enter the audit log.
- All ten sources select sample/live independently from required key presence. No keys means **Waiting for keys**. All keys means live mode with **Client not built**. No live data is fetched and no external client is implemented.
- CI is configured for every pull request: typecheck, real PostgreSQL database tests, build, browser WebAuthn checks and a secret scan. Local checks use the same tests on PGlite or PostgreSQL; Chromium's virtual authenticator exercises real signatures.
- Initial stage 0a local validation passed: all 26 tests on PGlite and PostgreSQL 17.11; typecheck and build; Chromium sign-in and rejection checks on both database backends; Gitleaks with generated-secret self-tests; compiled production startup and migration repeatability.
- Replit database fix validation: all 42 tests pass on PGlite and PostgreSQL 17.11, plus typecheck, build, browser checks on both backends and the secret scan. The review regression test confirms fixed configuration messages for a bad `APP_ORIGIN` at startup and missing `DATABASE_URL` in the CLI, without exposing values. Compiled startup and migration CLI checks confirm SQLSTATE/filename-only database failures and the Node, migrations-complete and listening log lines.
- Stage 0b local validation: all 55 tests pass on PGlite and PostgreSQL 17.11, including Settings rollback/conflicts, safe sample rendering and SSE authentication/revocation/concurrency. Typecheck, build, secret scanning and Chromium checks pass. The mockup and port were inspected at 390px and 1280px in both themes; browser checks enforce no console errors, outside requests or sideways scroll, and confirm Settings updates reach an existing dashboard over SSE.

## Not in 0b

Source clients and measured business data, source API fixtures, source-system writes, test verdict calculations/writes, uploads and cost models, Handover/UGC integrations, push delivery and Ask. Push keys are retained privately for later use; the summary preference sends nothing yet. Home-screen installation still needs Will's check on the published iPhone app.

## Open questions for Will

Confirm Replit's deployed proxy chain and configure trust for exactly those hops so rate limits apply per visitor. Revisit the global login-options limit so a stranger cannot exhaust it and lock Will out for 15 minutes. Rate-limit behaviour is unchanged in this stage. Other later-stage items remain in plan section 12.
