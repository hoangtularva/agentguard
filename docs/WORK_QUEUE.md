# Work queue

Status: DONE · PARTIAL · NOT VERIFIED · TODO. Evidence points at tests or commands that were actually run.

| ID | Pri | Task | Deps | Acceptance criteria | Status | Test evidence |
|---|---|---|---|---|---|---|
| W-01 | P0 | Tool registry with strict Zod schemas | — | Unknown keys and invalid types rejected; risk/sink metadata | DONE | `enforcement.test.ts` "rejects malformed and unknown tool calls" |
| W-02 | P0 | Deterministic PDP: invariants, rules, precedence, default deny | W-01 | Same input → same output; no rule → BLOCK; BLOCK > REVIEW > ALLOW | DONE | `policy-engine.test.ts` (22 tests) |
| W-03 | P0 | Mandate + resource scope as hard invariants | W-02 | Tool/resource outside the mandate → BLOCK regardless of rules | DONE | unit + A05, A06 |
| W-04 | P0 | Provenance tracing of sink destinations | W-02 | Untrusted-only destination → ≥ REVIEW; user-typed stays trusted | DONE | unit + L06, L07, A11 |
| W-05 | P0 | PEP with identity verification, audit, transactional execution | W-02 | Executors only via PEP; identity from DB; fail closed | DONE | `boundaries.test.ts`, lint rule, "fails closed" test |
| W-06 | P0 | Approval binding + replay/tamper/expiry/policy-change protection | W-05 | 1 side effect under replay/concurrency; all tamper paths denied | DONE | 12 integration tests + P01–P10 |
| W-07 | P0 | Audit redaction | W-05 | No body or secret verbatim in audit/tool_calls/effects | DONE | "does not store email bodies verbatim" |
| W-08 | P1 | Agent runtime + simulated planner | W-05 | The planner never executes; injected proposals flagged | DONE | benchmark scenarios |
| W-09 | P1 | Claude tool-calling planner | W-08 | Configurable via env; refuses without credentials | NOT VERIFIED (no key) | typecheck only |
| W-10 | P1 | Playground API + execution trace | W-08 | Real trace with decisions, reasons, provenance; approve inline | DONE | Playwright `demo.spec.ts` |
| W-11 | P2 | ≥ 30 scenarios with expected decisions | W-08 | Attacks + legit + FP checks + approval attacks | DONE | 37 scenarios |
| W-12 | P2 | Benchmark harness + baseline + metrics | W-11 | ASR, block/intercept, FPR, completion, latency, replay; nothing hardcoded | DONE | `npm run bench`, `benchmark-latest.md` |
| W-13 | P2 | Regression gate in CI tests | W-12 | Thresholds asserted | DONE | `benchmark.test.ts` |
| W-14 | P3 | App shell, theming, responsive layout | — | Light/dark, collapsible sidebar, mobile nav, no horizontal scroll | DONE | Playwright mobile project (7 tests) |
| W-15 | P3 | Overview | W-05 | Real counts, 14-day chart, reasons, recent activity | DONE | manual browser check |
| W-16 | P3 | Approval Inbox | W-06 | Pending list, exact args, countdown, approve/reject/execute | DONE | manual + e2e API tests |
| W-17 | P3 | Security Events | W-07 | Filters, details, source evidence, decision explanation | DONE | manual browser check |
| W-18 | P3 | Policy Studio | W-02 | Versions, rule view, JSON editor with validation, rollback, simulator; role-gated | DONE | e2e "members cannot change policy" + manual |
| W-19 | P3 | Attack Lab | W-12 | Run suite or single scenarios, expected vs actual, metrics, history | DONE | Playwright "Attack Lab" |
| W-20 | P4 | Docker Compose + Dockerfile + .env.example | — | `docker compose up` serves the app on Postgres | PARTIAL / NOT VERIFIED | see BLOCKERS B-01 |
| W-21 | P4 | Docs: architecture, threat model, competitive analysis, boundaries, benchmark, learning notes | — | Present, consistent with the code | DONE | `docs/` |
| W-22 | P4 | README with run/demo/benchmark instructions | W-21 | A fresh clone can run the demo | DONE | commands in README were run on this machine (except Docker) |
| W-23 | Next | LLM adversarial benchmark run | W-09 | Results with model, effort, runs, variance | TODO (needs key) | — |
| W-24 | Next | Port AgentDojo / InjecAgent tasks | W-12 | External dataset numbers | TODO | — |
| W-25 | Next | Executor isolation service with signed execution tokens | W-06 | Agent process cannot reach tool credentials | TODO | — |
