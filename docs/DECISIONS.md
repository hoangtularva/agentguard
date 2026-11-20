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

## Phase 2 (2026-11-08)

| ID | Decision | Alternatives | Why |
|---|---|---|---|
| D-15 | Real PostgreSQL tests via `embedded-postgres` (official PG16 binaries, user-level process) | Docker Postgres; install PostgreSQL system-wide | Docker and system installs need admin. This still exercises real multi-backend locking. Docker remains the deployment path |
| D-16 | Approval claim + execution in **one** transaction | Two transactions (Phase 1) | A real-PG test reproduced an approval marked "executed" with no side effect after a failure between the two |
| D-17 | Provider-neutral `LLMProvider` + generic `LLMPlanner`; providers never see executors | Separate planner per vendor | One tool loop; adding a provider can't create a bypass; tested with a malicious fake provider |
| D-18 | Ollama default `qwen2.5:3b`, temperature 0, seed 42, ctx 4096 | 1.5B (faster, weaker), 7B (too slow on 2-core CPU) | Best tool-calling fidelity that fits CPU-only, 12 GB RAM, ~10–25 s per turn |
| D-19 | Ollama from the portable GitHub zip, SHA-256 verified | Installer / winget | No installer, no admin, no license dialog, no auto-start; files stay in one folder |
| D-20 | Real-LLM benchmark is a separate track (`bench:llm`, its own report and doc), run on a **held-out** set written after the policy was frozen | Mix into `npm run bench` | Requirement: don't mix simulated and real results; avoid tuning to the test set |
| D-21 | Outcome taxonomy (`attack_not_attempted` vs `attack_blocked`, `task_failed_model` vs `task_failed_guard`) | ASR only | With real models, "no attack" has two very different causes; the same goes for task failures |
| D-22 | Defensive system prompt on in both modes | Naive prompt for the baseline | Measure the guard's value *on top of* the shipped prompt defense, not against a strawman |
| D-23 | Single-flight guard for LLM runs and benchmarks (429) | No limit | A CPU-bound local model is easy to exhaust; cheap demo-level DoS protection |
| D-24 | vitest 5; `shadcn` CLI moved to devDependencies; stray `cn` package removed | Leave as is | Clears critical advisories (dev-only); production audit: 0 vulnerabilities |
| D-25 | Compose passes `OLLAMA_HOST=http://host.docker.internal:11434` + `extra_hosts: host-gateway` | Run Ollama in a container | Reuses the model already pulled on the host; the app degrades gracefully if Ollama is absent |
| D-26 | Docker Desktop installed with `--quiet --backend=wsl-2` but **without** `--accept-license` | Pass `--accept-license` | Accepting third-party terms is the user's call, not the agent's; Docker Desktop presents them itself |
| D-27 | PEP split into ports (ToolCatalog, ResourceResolver, ToolRunner, Clock) + use cases; `EnforcementPoint` kept as facade | Keep one 640-line class | External apps need decision-only mode (no runner) and their own catalogs; the facade keeps every caller unchanged |
| D-28 | Tenancy via `app_id text default 'demo'` on existing tables (no FK), FKs only on new tables; migration inserts app `demo` | FK everywhere / separate schemas per tenant | In-place upgrade of existing databases with zero data rewrite; isolation enforced in the use cases (agent ∈ app, session ∈ app) and tested |
| D-29 | Decision-token signing keys derived as HMAC(AUTH_SECRET, app id ‖ key version) | Store per-app secrets in the DB | No signing secret at rest; rotation = bump `token_key_version` |
