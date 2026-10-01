# Decisions

One entry per build decision: date, stage, the decision, why, what else was considered. Newest at the bottom. If a decision changes the plan, say so; the plan's master copy is in the HQ repo.

## 2026-10-01, before stage 0: who builds
Codex (OpenAI's GPT-6 Astra) does the first build on Will's OpenAI credits; Claude Code makes the edits after. Why: Will has credits to use and wants Claude to own changes from then on. GitHub is the shared copy because Codex and Claude both work through it; Replit only pulls.

## 2026-10-01, before stage 0: keys
Keys live only in Replit Secrets. Neither builder holds or sees one: Codex and Claude build on fixtures, and the app reads keys from the environment at run time. Why: one place to add, rotate and revoke each key.

## 2026-10-01, before stage 0: sample mode
Each source runs live when its keys are present and on labelled sample data when they are not. Why: the builder can finish a stage before its keys exist, and `main` always runs on Replit.
