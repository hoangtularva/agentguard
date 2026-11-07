# Decisions (ADR log)

| ID | Decision | Alternatives | Why |
|---|---|---|---|
| D-01 | Single Next.js app with server modules split into PDP, PEP, approval and audit | Microservices, Redis queue | The MVP needs no horizontal scale. The module boundaries are enforced by lint and tests. The prompt asked for no microservices or Redis. |
| D-02 | PGlite (PostgreSQL in WASM) when `DATABASE_URL` is unset; node-postgres otherwise | SQLite for dev | Docker and Postgres are unavailable on the build machine. PGlite gives *PostgreSQL* semantics (row locks, jsonb, unique constraints) with the same Drizzle migrations. SQLite would diverge. |
| D-03 | Policy engine in TypeScript with a typed condition DSL | OPA/Rego, Cedar | No extra runtime. Discriminated-union conditions validated by Zod. No regex or code in policies. The PDP interface allows swapping in OPA later. |
| D-04 | Mandate (per-task user authorization) enforced as hard invariants | Express everything as policy rules | Org policy must not be able to widen what the user authorized for *this* task. |
| D-05 | Destination provenance via exact normalized substring matching | Full taint tracking, CaMeL interpreter | Cheap and deterministic at the tool boundary. Limits are documented. It only escalates; default deny remains the primary control. |
| D-06 | `escalateOnly` rules | Treat review rules as permissions | A test showed a fail-open path: a "review if injection suspected" rule turned default-deny into REVIEW. Escalation must never grant permission. |
| D-07 | Approval binding = sha256(canonical JSON of call, session, user, agent, tool, args, policy version), plus row lock, conditional claim and unique idempotency key | Signed JWT approval tokens | DB-enforced uniqueness also prevents replay under concurrency. A JWT alone needs a replay store anyway. |
| D-08 | Next.js `cacheComponents` disabled; pages are request-time dynamic | Cache Components + Suspense everywhere | Every screen shows live security data. Less complexity, fewer chances to accidentally cache per-user data. |
| D-09 | Deterministic simulated planner for demo and benchmark; Claude planner optional | LLM only | Reproducible, free, and it measures the guard rather than model luck. The LLM path exists (`bench:llm`) but needs credentials. |
| D-10 | The playground "defers" REVIEW actions instead of pausing the run | Pause at the first REVIEW | Pausing hid the later injected calls from the demo. Deferring evaluates every proposal while still never executing unapproved ones. |
| D-11 | Benchmark from the Attack Lab runs in an isolated in-memory DB | Run in the main DB | Attack traffic would pollute the workspace audit log and overview metrics. |
| D-12 | Demo identity = HMAC-signed cookie + user switcher | Real auth | Out of MVP scope. Documented as *not authentication*. Still server-side, so request bodies never name the actor. |
| D-13 | Claude planner: `claude-opus-5-5`, `tool_choice: auto`, `strict` tools, effort `low` (configurable); no server-side refusal fallback configured | Fallbacks beta | Keeps the optional path minimal. A refusal is handled as a final message. Fallbacks can be added when the LLM path is exercised. |
| D-14 | Status palette validated with the dataviz validator (separate light/dark steps) | Eyeballed colors | The dark-mode set initially failed the lightness band; it was adjusted until all checks passed. |
