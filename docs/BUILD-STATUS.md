# Build status

Updated in every pull request.

| Stage | What | Code | Keys in Replit | Live check ("Done when") |
|---|---|---|---|---|
| 0a | Service, database, passkeys, audit, source registry, CI | implemented; awaiting PR review and merge | `DASHBOARD_SETUP_CODE`: no | local validation only; no Replit deployment |
| 0b | Real screen on sample data, live updates, Settings, home-screen app | not started | no | no |
| 1 | Shopify, New reviews (Judge.me) | not started | no | no |
| 2 | Meta | not started | no | no |
| 3 | Google Ads | not started | no | no |
| 4 | Mailchimp | not started | no | no |
| 5 | Workflow side (Handover) | not started | no | no |
| 6 | Costs, uploads, planning | not started | no | no |
| 7 | Alerts and Ask | not started | no | no |

## Next step

Review and merge stage 0a before starting stage 0b. Stage 0b ports the mockup on labelled sample data and adds live updates, Settings and home-screen installation. Source clients start in their own stages; Shopify and Judge.me are stage 1.

## What runs

- Node 24 + TypeScript service, PostgreSQL migrations and a status-only `/health`.
- Verified-device passkey enrollment with a setup phrase, passkey sign-in, persistent rate limiting, 30-day server sessions and immediate sign-out revocation.
- Authenticated source health table under the **sample data** banner, plus an audit page.
- All ten sources select sample/live independently from required key presence. No keys means **Waiting for keys**. All keys means live mode with **Client not built**. No live data is fetched and no external client is implemented.
- CI is configured for every pull request: typecheck, real PostgreSQL database tests, build, browser WebAuthn checks and a secret scan. Local checks use the same tests on PGlite or PostgreSQL; Chromium's virtual authenticator exercises real signatures. Remote CI results remain to be checked on the opened PR.
- Local validation passed: all 26 tests on PGlite and PostgreSQL 17.11; typecheck and build; Chromium sign-in and rejection checks on both database backends; Gitleaks with generated-secret self-tests; compiled production startup and migration repeatability.

## Not in 0a

The real dashboard, source metrics and fixture responses, Settings, Server-Sent Events, manifest/icons/home-screen installation, source clients, push delivery, Ask and deployment. Push keys are generated privately for later use; no notifications are sent.

## Open questions for Will

Before production enrollment, confirm the final dashboard address (`pulse.oneofonehq.com` remains a working name), configure its HTTPS `APP_ORIGIN` and a setup phrase in Replit, and confirm the database used by the published app. These do not block fixture-based development. Other later-stage items remain in plan section 12.

After the first deployment, confirm Replit's proxy chain and configure trust for exactly those hops so rate limits apply per visitor. Revisit the global login-options limit so a stranger cannot exhaust it and lock Will out for 15 minutes. Rate-limit behaviour is unchanged in this follow-up.
