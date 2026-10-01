# One of One Pulse

@AGENTS.md

## For Claude Code

- AGENTS.md above is the rulebook for this repo. It applies to you as it did to the first builder.
- Business context lives in the HQ repo, `willpeirce/one-of-one-hq`. Attach it to the session when a task needs more than `docs/spec/`. The master copy of the spec is there: `docs/dashboard-plan.md`, `docs/control-centre.md`, `docs/control-centre-mockup.html`, `knowledge/dashboard-design-rules.md`, `ops/tests/register.md`, `knowledge/costs.md`.
- When the plan changes, change it in HQ first, then refresh `docs/spec/` here with HQ's `scripts/dashboard-seed.sh` in the same pull request.
- Every change to a live system (a new app, token, webhook, user or DNS record) gets a `log/` entry in HQ in the same session, with how to undo it. Copy the stage state from `docs/BUILD-STATUS.md` into HQ's `STATUS.md` at the end of the session.
