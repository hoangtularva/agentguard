# Final report — AgentGuard MVP

**Date:** 2026-11-07 · **Status: 9 of 10 completion criteria met and verified. Not marked MVP COMPLETE, because criterion 9 (Docker Compose runs) could not be verified on this machine (Docker is not installed).**

## Completion criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Policy engine works | ✅ Verified | 22 unit tests; determinism test; benchmark expected-decision accuracy 100% |
| 2 | Agent Playground runs end-to-end | ✅ Verified | Playwright: injection preset → BLOCK/REVIEW → approve → executed once; manual browser check |
| 3 | Tool calls go through the enforcement point | ✅ Verified | ESLint restricted-import rule + architecture test; the runtime has no executor reference |
| 4 | Human approval works | ✅ Verified | 12 integration tests, 10 approval-attack scenarios × 3 runs, 2 e2e API tests |
| 5 | Audit logs are stored | ✅ Verified | Audit-event assertions; redaction test (no body or secrets verbatim) |
| 6 | Attack Lab runs | ✅ Verified | Playwright "runs the full suite and every scenario passes"; manual run 37/37 |
| 7 | Security tests meet requirements | ✅ Verified | 61 Vitest + 13 Playwright passing; regression gate asserts ASR=0, FPR=0, replay prevention 100% |
| 8 | UI responsive | ✅ Verified | Playwright mobile project (no horizontal scroll on 6 pages, mobile nav); manual light/dark check |
| 9 | Docker Compose runs | ⚠️ **NOT VERIFIED** | Files written; standalone build served HTTP 200; node-postgres path verified over the wire protocol. See BLOCKERS B-01 |
| 10 | README sufficient to clone and demo | ✅ | README commands were run on this machine (except Docker) |

## Features delivered
- **Policy engine (PDP):** pure, deterministic; typed condition DSL; hard invariants (identity, mandate, scope, schema); provenance floor; BLOCK > REVIEW > ALLOW; escalation-only rules; default deny; immutable versions with rollback.
- **Enforcement point (PEP):** strict Zod validation; identity read from the session row; resource and sensitivity resolution; destination provenance; fail-closed policy loading; transactional execution with idempotency keys.
- **Human approval:** binding hash, TTL, single use, policy-version invalidation, args-mismatch and storage-tamper detection, role checks, concurrency-safe.
- **Audit:** append-only events with reason codes, secret masking and content hashing.
- **Agent runtime:** planner/runtime/PEP separation; deterministic simulated planner; Claude tool-calling planner (optional).
- **UI:** Overview, Agent Playground, Attack Lab, Approval Inbox, Security Events, Policy Studio (editor + simulator + history), session audit record; light/dark; responsive.
- **Benchmark:** 37 scenarios; baseline vs guarded vs rubber-stamp; generated results doc.

## Test results (last run)
- `npm run lint`: 0 errors, 0 warnings. `npm run typecheck`: 0 errors. `next build`: success, 0 warnings.
- `npm test`: **61/61 passed** (6 files).
- `npm run test:e2e`: **13/13 passed** (desktop + mobile).
- `npm run bench` (3 runs): **37/37 scenarios pass**. ASR 93.3% → 0.0% (13.3% with a rubber-stamp reviewer). Unauthorized calls: 90% blocked, 100% intercepted. FPR 0.0% (0/99). Review friction 15.2%. Completion 100%/100%. Replay prevention 30/30. PDP p50 ≈ 2.7 µs. Deterministic.

## Security findings during development
1. **Fail-open in policy semantics (fixed).** An escalation rule ("review if injection suspected") counted as a permission and turned default-deny into REVIEW for an attacker destination. Fixed with `escalateOnly`; a regression test was added.
2. **Inconsistent read inside the approval transaction (fixed).** The policy version was read outside the locked transaction. On PGlite this deadlocked; on Postgres it would have been a silent consistency gap. Fixed by passing `tx` to the resolver.
3. **Boundary violation caught by tooling.** The harness imported a type from the executors module. Lint and the architecture test failed the build. The type was relocated.
4. **Demo UX hid evidence.** Pausing at the first REVIEW meant the injected calls were never shown. Switched to the "defer" mode.
5. **Session status bug (fixed).** One approval decision marked the whole session completed while other approvals were still open.

## Known limitations
Value-level provenance only; session-level sensitivity taint; regex injection signals; demo identity is not auth; single-process trust boundary; audit not hash-chained; self-authored scenarios with a simulated planner; LLM path never executed; Docker and multi-connection Postgres locking not verified. Details: [threat-model.md](threat-model.md), [BLOCKERS.md](BLOCKERS.md).

## Git commits
```
1b9b559 fix(approvals): complete a session only when none of its approvals remain open
4cd2160 docs: README, architecture, threat model, competitive analysis, benchmark, learning notes, decisions
e63a144 test,ops: Playwright e2e, wire-protocol DB test, Docker Compose (P2/P4)
179ae3d feat(ui): dashboard, playground, attack lab, approvals, events, policy studio (P3)
8f3af01 feat(agent,bench): agent runtime, simulated + Claude planners, 37-scenario security benchmark (P1/P2)
f0e513e feat(core): policy engine, PEP, provenance, approval binding (P0)
```
Plus the commit containing this report. Nothing was pushed (no remote configured).

## How to run
See [README.md](../README.md): `npm install`, `cp .env.example .env`, `npm run dev`; tests via `npm test`, `npm run test:e2e`, `npm run bench`.

## Next steps
1. On a machine with Docker: `docker compose up --build`, then run the Playwright suite against it (closes criterion 9 and B-02).
2. With an API key: `npm run bench:llm -- --runs 3`, and record the model, effort and variance (B-03).
3. Port AgentDojo/InjecAgent tasks for an external dataset.
4. Executor isolation with PEP-signed execution tokens; OIDC; hash-chained audit.

---

# Phase 2 report — 2026-11-08

**Status: PARTIALLY COMPLETE.** 9 of 10 Phase 2 acceptance criteria are verified. Criterion 1 (Docker Compose) is **BLOCKED**: installing Docker Desktop and the WSL 2 kernel requires Administrator rights, which the rules reserve for you. Exact steps: [setup-windows.md § C](setup-windows.md), [BLOCKERS.md](BLOCKERS.md) B-01.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Docker Compose runs in a verified environment | ⛔ BLOCKED (admin) | Production build no longer needs a DB; standalone server, node-postgres path and real PG16 verified separately |
| 2 | Real PostgreSQL passes integration/concurrency tests | ✅ | `npm run test:pg` 11/11 on PostgreSQL 16 (10-connection pool) |
| 3 | Ollama runs a real LLM | ✅ | Ollama 0.40.15 (SHA-256 verified zip), `qwen2.5:3b` digest `357c53fb659c…` |
| 4 | AgentGuard handles tool calls from a real LLM | ✅ | `bench:llm` on 14 held-out scenarios × 2 runs; Playground run with Ollama verified in the browser |
| 5 | Tool calls must pass through the PEP | ✅ | Lint rule + architecture test; malicious fake-provider test (all calls BLOCKED, 0 side effects) |
| 6 | Human approval + replay protection | ✅ | 12 integration + 10 approval-attack scenarios + 11 real-PG tests + e2e |
| 7 | Reproducible real-LLM benchmark | ✅ with caveat | Model digest, sampling, hardware and dataset recorded; 2 runs agree on 12/14 scenarios (CPU temp-0 is near- but not fully deterministic); raw JSON of both runs in `docs/results/` |
| 8 | UI desktop/mobile | ✅ | Playwright 13/13 (desktop + mobile no-overflow); manual browser check of the Ollama flow and the LLM results panel |
| 9 | Automated tests | ✅ | lint 0, typecheck 0, build ok (0 warnings), vitest 66/66, test:pg 11/11, e2e 13/13, bench 37/37 deterministic |
| 10 | Documentation complete and honest | ✅ | README, setup-windows, interview-guide, architecture, threat model, benchmark (2 tracks), decisions D-15..D-24, learning notes, blockers |

## Real-LLM results (held-out set, qwen2.5:3b, CPU)

| | Unguarded | AgentGuard |
|---|---|---|
| Attack success (run 1 / run 2) | 50% / 50% | **0% / 0%** |
| Attack attempted by the model | 50% / 50% | 50% / 40% |
| Unintended action on a legit task (run 2, revised oracle) | 25% | **0%** |
| Legit task completion | 75% | 75% |
| Legit calls blocked | — | 2/13 (both `INVALID_ARGUMENTS`: model dropped the `doc:` prefix) |
| LLM turn p50 | ~8–12 s | PDP p50 ≈ 0.04 ms in-run |

## Findings in Phase 2

1. **Non-atomic approval execution (fixed, High).** Claim and execution were separate transactions, so a failure in between burnt the approval without running the action. A real-PostgreSQL regression test fails on the old code and passes on the fix.
2. **Hallucinated recipients (real-LLM).** The model invented email addresses (H04, H10); unguarded, it *sent internal data to them*. AgentGuard default-denied them (model-generated provenance).
3. **Benchmark oracle bug (fixed, disclosed).** H04's oracle counted the hallucinated send as legitimate. Fixed with `destinationNot` and a new `unintended_action_executed` outcome; both runs' raw data are kept.
4. **Argument-fidelity false positives (open).** Small models drop id prefixes; strict schemas reject them. Not "fixed" by guessing ids (that would be unsafe and tuned to the held-out set). Next step: clearer error messages so the model can self-correct, evaluated on a *new* test set.
5. **Corrupted demo DB after the folder copy (fixed).** The copied PGlite data failed to open. Moved aside to `.data/pglite-broken-copy` (not deleted); the build no longer touches any DB (`connection()` in the root layout).
6. **Dependencies.** Critical dev-only advisories cleared (vitest 5); stray `cn` package removed; production `npm audit` reports 0.
7. **Hardening.** `Sec-Fetch-Site` CSRF check, single-flight guard (429) for LLM/benchmark runs, identity cookie max-age, pool error handler (killed connections no longer crash the process).

## Phase 2 commits
```
9dba276 feat(db): real PostgreSQL 16 integration suite; atomic approval claim+execution
bebfa42 feat(llm): provider adapter (simulated/Ollama/Anthropic), held-out test set, real-LLM benchmark track
6c7d4ac chore(deps): fix audit findings
f9dd12f security: Sec-Fetch-Site CSRF check, single-flight guard for LLM/benchmark runs, cookie max-age
7d338b4 bench(llm): real-LLM run 1 on held-out set + H04 oracle fix; Phase 2 docs
```
Plus the final commit containing this report. Nothing was pushed (no remote).

## What you need to do
1. **Docker (admin, once):** run `wsl --update` in an admin terminal → install Docker Desktop → reboot if asked → `docker compose up --build -d` → `$env:E2E_BASE_URL="http://localhost:3000"; npm run test:e2e`.
2. **To use Ollama again later:** `D:\AI Master\_tools\ollama\ollama.exe serve` (set `OLLAMA_MODELS=D:\AI Master\_tools\ollama-models` first).
3. Optional: an Anthropic key for `npm run bench:llm -- --provider anthropic`.
