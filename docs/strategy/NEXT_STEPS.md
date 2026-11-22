# Next steps (2026-11-22)

Goal: a global developer can **find, install, trust and use** Callwrit, then learn whether anyone would pay for something. Constraint: one maintainer, under 5 hours a week. Each block below is about 2 weeks at that pace.

**Done so far:** security core, `/v1`, SDKs, MCP gateway, verifiers, audit chain, F1 fix, AGPL-3.0 (server) + MIT (SDKs/core) licensing, dependency refresh (Next 16.4.6, GitHub Actions on Node 24, Python SDK ≥ 3.10), README with uniform screenshots.

## Resume here

State on 2026-11-22: `main` is green locally (121 Vitest, 14 PostgreSQL 16, 22 Playwright on Docker). Commit messages are one line, author Hoang Tu only.

1. **Block 1, task 2:** name chosen: **Callwrit** ([NAME_SHORTLIST.md](NAME_SHORTLIST.md)). Repository code, packages (`@callwrit/*`, PyPI `callwrit`), env vars (`CALLWRIT_*`), headers (`X-Callwrit-*`) and docs renamed. GitHub repo renamed to `hoangtularva/callwrit` with description and topics (no homepage yet). Left: owner runs one WIPO/USPTO search; re-record `docs/media/demo.webm` (still shows the old name); then task 3.
2. Deferred dependency majors, revisit monthly: ESLint 10 (waits for `eslint-config-next` plugins: import, jsx-a11y, react), TypeScript 7 (waits for `typescript-eslint` and Next.js support of the new compiler API), `embedded-postgres` 17+ (move tests and `docker-compose` PostgreSQL together, never one alone).
3. Local cleanup when satisfied with the history rewrite: `git branch -D backup/before-rewrite`.
4. Optional: analyse llama3.2:3b false positives (`docs/benchmark-llm-models.md`).

Working rules: never push without tests passing by exit code; one-line commit messages without attribution; ask before outward-facing actions (publishing packages, posting, renaming the GitHub repo).

## Block 1: Ready for a public name (weeks 1–2)

| # | Task | Who | Done when |
|---|---|---|---|
| 1 | Shortlist 5 new names; check npm, PyPI, GitHub, `.dev/.io` domains, trademark databases (WIPO, USPTO) | Claude researches, **owner picks** | one name free on npm + PyPI + domain, no conflicting AI-security trademark found |
| 2 | Rename across repo, packages, docs, UI; set GitHub description, topics, homepage | Claude | tests green; old name only in history and LICENSING note |
| 3 | Compose files: demo identities **off** by default, explicit `local-eval` profile (audit F3) | Claude | `docker compose up` refuses demo sign-in unless the profile is chosen; e2e still green |
| 4 | `admin rotate-token-key <app>` (audit F6); split `service.ts` by use case | Claude | rotation test: old tokens rejected, new ones verify |

## Block 2: Installable the normal way (weeks 3–4)

| # | Task | Who | Done when |
|---|---|---|---|
| 5 | Create npm organisation and PyPI project under the new name, with 2FA; enable trusted publishing (no long-lived tokens) | **owner** (accounts), Claude (CI workflow) | publish workflow runs from a tag |
| 6 | Release `v0.2.0`: `CHANGELOG.md`, GitHub Release, Docker image on GHCR, npm + PyPI packages with provenance | Claude, **owner approves the release** | `npm install`, `pip install`, `npx …-mcp`, `docker run ghcr.io/…` work from a clean machine (CI job) |
| 7 | README: "integrate in 5 minutes" (MCP gateway + SDK) at the top, portfolio material lower, demo video embedded | Claude | a new reader reaches a working guarded call by following the README only |

## Block 3: Meet users (weeks 5–6)

| # | Task | Who | Done when |
|---|---|---|---|
| 8 | One technical write-up (provenance + bound approvals + honest benchmark, including the llama false-positive finding) | Claude drafts, **owner publishes** | posted on a blog/dev.to; linked from README |
| 9 | Show HN; submit to MCP server directories and awesome-lists | **owner** | posts live |
| 10 | Feedback loop: issue template "I tried it", 5-question form, interview script; talk to 5–10 people who try it | **owner** (talks), Claude (script, summary) | written notes from ≥ 5 users |

## Block 4: Decide on money, with evidence (week 7+)

| # | Task | Who | Done when |
|---|---|---|---|
| 11 | From the feedback, pick at most **one** paid candidate (likely SSO/OIDC for the approval UI, SIEM audit export, or a commercial AGPL exception) | owner + Claude | decision written with the evidence behind it |
| 12 | Check seller eligibility from Vietnam on Polar / Paddle / Gumroad against current official docs; complete KYC on one | **owner** | one account approved, payout method confirmed |
| 13 | Only then build the paid piece, in a separate package/repo with a commercial license | Claude | first sale or a clear "no demand" result |

## Housekeeping (any time, small)

- Dependabot: merge #9 (minor/patch group, CI green); close #8 (TypeScript 7, fails CI) until the toolchain supports it; review the GitHub Actions major bumps (#1–#3).
- Analyse the llama3.2:3b false positives (53.9%): split schema-correct blocks from fixable error messages.
- Enable 2FA on the GitHub account (owner).

## Not now

Hosted SaaS, marketplace, Skill registry, own payment system, docs website, Product Hunt launch, multi-instance deployment.
