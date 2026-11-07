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
