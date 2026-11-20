# Phase 4 plan — AgentGuard for ANY codebase (multi-method packaging)

**Written:** 2026-11-20, before context compaction. This file is the single source of truth to resume Phase 4.
**Goal (user):** AgentGuard must protect agents living in *other* source trees (any language, incl. multi-agent apps), through several packaging/integration methods, while keeping the *host* app safe (fail-closed, no data leakage, no new attack surface). Package everything.

---

## 0. RESUME CHECKLIST (read first)

| Item | Value |
|---|---|
| Repo | `D:\AI Master\agentguard` (git, branch `main`, no remote, never push) |
| Last commit before this plan | `b71dee7` (Phase 3 work; src frozen for HOLDOUT at `078b567`) |
| Shell | Claude Code uses Git Bash + PowerShell 5.1 on Windows 10; Docker CLI not on PATH in old shells → `export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"` |
| Ollama | portable `D:\AI Master\_tools\ollama\ollama.exe serve` with `OLLAMA_MODELS=D:\AI Master\_tools\ollama-models`; model `qwen2.5:3b` (digest 357c53fb…) |
| Python | 3.12 (`python`), pip available |
| Node | 22.14, npm 11 |
| Docker | Desktop 4.98 installed; start Docker Desktop app before `docker compose up -d` |
| Dev server | `.claude/launch.json` at `D:\AI Master\.claude` (name `agentguard`, port 3000) or `npm run dev` in repo |
| Demo identities | u_alice (member), u_bob (approver), u_mallory (member) — sign-in screen (Phase 3 F1) |
| Quality gates | `npm run lint`, `npm run typecheck`, `npm test` (vitest), `npm run test:pg` (real PG16), `npm run test:e2e` (Playwright, global sign-in), `npm run bench`, `npm run bench:llm -- --set <set>` |

### Phase 3 items still OPEN (finish before declaring Phase 3 complete)
1. **HOLDOUT real-LLM run** — `npm run bench:llm -- --set v2-holdout --runs 3 --seed 42 --resume bench-results/llm_202611080440.partial.json` (log `D:\AI Master\_tools\bench-v2-holdout.log`). When done: `docs/benchmark-llm-v2-holdout.md` + `bench-results/latest-llm-v2-holdout.json` + `docs/results/llm_202611080440-v2-holdout.json` are generated. Note: run was interrupted once and resumed (same frozen src); part of it ran while the dev server was up (latency under contention).
2. `npm run test:pg` incl. new `tests/postgres/perf.test.ts` (prints `PERF_RESULTS`) → record in PHASE3_PROGRESS.md.
3. Rebuild Docker (`docker compose up --build -d`) and run `E2E_BASE_URL=http://localhost:3000 npm run test:e2e` (20 tests).
4. Fill `docs/PORTFOLIO_CASE_STUDY.md` §7–8 from generated reports (no hand-typed numbers), update README results, `docs/FINAL_REPORT.md` Phase 3 section, PHASE3_PROGRESS.md.
5. Full screenshots: `npx tsx scripts/screenshots.ts` (needs running app). 5 preview PNGs already in `docs/screenshots/`.

### Key Phase 3 facts (for docs)
- llm-v2 dataset: `src/server/bench/llm-v2-scenarios.ts` (32 DEV D01–D32, 32 HOLDOUT X01–X32, 13 categories).
- DEV run 1 → 2 (seed 42): FP 37.5% → 9.7%; guarded completion 75% → 100%; guarded ASR 0% (CI 0–16%); unguarded ASR 50% → 60%; unrequested sink calls unguarded 3 executed / guarded 0. Fixes were product/measurement bugs (actionable arg errors; FP only on user-requested calls), no rule changes. Docs: `docs/results/benchmark-llm-v2-dev-run1.md`, `-run2.md`.
- Red team F1–F10: `docs/PHASE3_FINDINGS.md` (fixed: F1 implicit identity, F3 identity switch gated by `AGENTGUARD_DEMO_AUTH`, F4 IDOR, F5 body cap, F6 CSP, F7 bench role, F10 hydration).

---

## 1. Problem statement
Today the PEP is called only by AgentGuard's built-in agent runtime. External apps (Python/TS/other; single- or multi-agent; LangChain, OpenAI Agents, custom, MCP-based) cannot use it. Tool catalog is hard-coded (3 demo tools), resources come from a built-in corpus, identities are demo cookies.

## 2. Integration methods to deliver (packaging matrix)

| # | Method | For whom | Enforcement strength | Package |
|---|---|---|---|---|
| M1 | **HTTP Decision API `/v1`** (OpenAPI 3.1) | any language | cooperative (app must call it) | part of server image |
| M2 | **SDK — TypeScript** (`@agentguard/sdk`): client + `guard(tool)` wrapper | Node/TS agents, Vercel AI SDK, OpenAI Agents JS, custom | cooperative | npm tarball `packages/sdk-ts` |
| M3 | **SDK — Python** (`agentguard`): client + `@guarded` decorator + `wrap_tool` | Python agents, LangChain/LangGraph, CrewAI, custom | cooperative | wheel `sdk/python` |
| M4 | **Tool-side verifier** (TS middleware + Python helper): tool backends accept a call only with a valid **decision token** bound to tool+args hash+expiry, single-use | protects tools even if an agent bypasses the SDK | **enforced at the tool** | in both SDKs |
| M5 | **MCP Gateway** (stdio + Streamable HTTP): sits between any MCP client (Claude Desktop/Code, Cursor, agent frameworks) and upstream MCP servers; `tools/call` → check → forward | MCP users; **no code change** | enforced (agent only sees the gateway) | `packages/mcp-gateway` (npm bin `agentguard-mcp`) |
| M6 | **Embedded core** (`@agentguard/core`): pure PDP + provenance + schema, offline, in-process | TS apps wanting zero network hop | cooperative, no audit server | npm tarball `packages/core` |
| M7 | **Sidecar / container**: Docker image exposing `/v1` + UI; compose snippet to run next to any app | any stack | network-level (tools reachable only via gateway if wired) | `docker-compose.sidecar.yml` |
| M8 | **CLI** `agentguard`: create app/agent API keys, register tools from JSON/OpenAPI, import policy, tail decisions | operators | — | npm bin in `packages/cli` (or script) |

Priority order: M1 → M2/M3 → M4 → M5 → M6 → M7 → M8.

## 3. Host-app safety requirements (non-negotiable)
1. **Fail-closed by default.** SDK/gateway: on timeout/network error/5xx → treat as BLOCK. Opt-in `failMode: "allow-reads"` only for `kind: "source"` tools. Never fail-open for sinks.
2. **Bounded latency.** Default timeout 2 s for `check`, retries only for idempotent calls, circuit breaker; never hang the host agent.
3. **Least data out.** Privacy mode (default ON in SDKs): content args (`contentArgs`) are sent as `{sha256, length}`; provenance registration sends *extracted fingerprints* (emails, URLs, ids + hashes) computed locally, not raw documents. Full-content mode is opt-in.
4. **Per-app isolation.** Multi-tenant: every row scoped by `app_id`; API keys scoped to app (+ optional agent); keys stored as SHA-256 hashes, shown once; rotation & revocation.
5. **Authenticated & integrity-protected.** API key in `Authorization: Bearer`; optional HMAC request signing (`X-AG-Signature`, timestamp, nonce) to resist replay; TLS expected in deployment.
6. **Decision tokens** (M4): HMAC/Ed25519-signed, contain `{callId, appId, agentId, tool, argsHash, exp, nonce}`; single use (server records consumption); short TTL (60 s). Tool verifier rejects mismatched args or reuse.
7. **No executor inside AgentGuard for external apps.** AgentGuard decides; the host executes after ALLOW / approved-consume, then reports the result (`/v1/calls/:id/result`) for audit. Host's own secrets never reach AgentGuard.
8. **Strict input validation** on every `/v1` endpoint (Zod), body cap 64 KB, rate limit per key (token bucket, in-process), structured errors without internals.
9. **Backward compatibility**: built-in demo (Playground, Attack Lab, benchmarks) keeps working on the same core.
10. **Audit**: every external decision visible in Security Events/Approval Inbox with `app`/`agent` labels.

## 4. Architecture changes

```
                ┌───────── Host app (any language) ─────────┐
 Agent A ─┐     │ SDK guard() ──HTTP /v1/check──┐           │
 Agent B ─┼──►  │ executes tool only on ALLOW / │           │
 Agent C ─┘     │ consumed approval; reports    │           │
                └──────────────┬────────────────┘           │
                               ▼                            │
        AgentGuard server: /v1 API (API-key auth) ─► PEP ─► PDP (core)
               ├─ tool registry (per app, JSON Schema → Ajv)
               ├─ resource labels (per app patterns → sensitivity)
               ├─ provenance store (fingerprints)
               ├─ approvals (bound; consume returns decision token)
               └─ audit (UI)
 MCP client ─► agentguard-mcp gateway ─► /v1/check ─► upstream MCP server
 Tool backend ◄─ verifier(token) ◄─ host passes decision token
```

### 4.1 Core refactor (P4.1)
- Move pure logic to `packages/core/src` (policy-engine, policy-schema, provenance, canonical, glob, approval-binding, redact, types) and re-export from `src/server/core/*` so existing imports keep working (or use TS path alias `@agentguard/core`). Workspace: root `package.json` `workspaces: ["packages/*"]`.
- **Data-driven ToolSpec** replacing the hard-coded registry:
  ```ts
  type ToolSpec = { name; title?; description; kind: "source"|"sink"; risk: RiskLevel;
    inputSchema: JSONSchema (object, additionalProperties false enforced);
    resourceArg?: string; destinationArg?: string; contentArgs?: string[];
    destinationType?: "email"|"url"|"phone"|"account"|"other" }
  ```
  Validation via **Ajv** (strict, `removeAdditional: false`, unknown keys rejected). Built-in demo tools become a ToolSpec set with JSON schemas equivalent to the current Zod ones (keep Zod messages behaviour: actionable errors).
- PEP generalized: `resolveResource(appId, id) → {exists, sensitivity}` (demo: corpus; external: label patterns + default), `executor` optional (external mode = decision-only).

### 4.2 Data model (P4.2) — migration `0001_external_apps`
- `apps(id, name, created_by, created_at, default_policy_id, settings jsonb)`
- `api_keys(id, app_id, agent_id null, name, key_hash, prefix, scopes jsonb, created_at, last_used_at, revoked_at)`
- `tool_specs(app_id, name, version, spec jsonb, created_at)` unique (app_id,name,version) + active pointer
- `resource_labels(app_id, pattern, sensitivity, priority)`
- `decision_tokens(id, call_id, app_id, args_hash, expires_at, consumed_at)` unique id
- add `app_id` (default `'demo'`) to agents, agent_sessions, tool_calls, approvals, audit_events, policy_versions/active_policy (policy per app; demo app keeps `default`).
- Seed app `demo` so existing data/tests keep working.

### 4.3 `/v1` API (P4.3) — all JSON, Bearer API key, Zod, 64 KB cap
| Endpoint | Purpose |
|---|---|
| `POST /v1/sessions` | `{userRef, agentId, prompt, mandate{tools,resources,destinations}}` → `sessionId` (prompt is the trusted channel; destinations extracted) |
| `POST /v1/sessions/:id/sources` | `{type, label, sensitivity?, fingerprints?{emails[],urls[],ids[],hash}, content?}` → sourceId (privacy mode = fingerprints) |
| `POST /v1/check` | `{sessionId, agentId, tool, args, parentCallId?}` → `{decision, reasons[], callId, policyVersion, riskScore, approvalId?, decisionToken?(ALLOW), expiresAt}` |
| `GET /v1/approvals/:id` | status poll (pending/approved/rejected/expired) |
| `POST /v1/approvals/:id/consume` | atomic claim after human approval → `decisionToken` (single use) |
| `POST /v1/calls/:id/result` | `{ok, summary?, outputFingerprints?}` → audit + provenance of tool output |
| `POST /v1/tokens/verify` | server-side verification for tool backends without the shared key |
| `GET /v1/tools`, `PUT /v1/tools/:name` | manage ToolSpecs (scope `admin`) |
| `GET /v1/health` | liveness, version |
- OpenAPI document generated/handwritten at `docs/openapi.yaml`, served at `/v1/openapi.json`.
- Multi-agent provenance: sources are per session; sub-agent hand-offs pass `sessionId` (+ `parentCallId`), so content read by Agent A is untrusted when Agent B proposes a sink.

### 4.4 SDKs (P4.4)
- **TS** `packages/sdk-ts`: `AgentGuard({baseUrl, apiKey, timeoutMs, failMode, privacy})`, `startSession`, `addSource`, `check`, `waitForApproval`, `reportResult`, `guard(toolName, fn, {argsMap})` (returns wrapped async fn that throws `AgentGuardBlocked` with reasons; on REVIEW either throws `ApprovalRequired` or waits), adapters: `guardVercelAiTool`, generic `guardTools(record)`. Zero runtime deps (fetch). Build to ESM+CJS+d.ts via `tsc`. Tests with a mock server + against real server.
- **Python** `sdk/python/agentguard`: `Client` (httpx-free → `urllib` stdlib for zero deps; async via `asyncio.to_thread`), `@guarded(tool=..., client=...)`, `wrap_tool(callable)`, LangChain adapter in `agentguard.integrations.langchain` (optional import). `pyproject.toml` (hatchling or setuptools), tests with `pytest`/`unittest` + local fake server.
- Both: privacy fingerprints computed locally (same algorithm as server `extractDestinations` + sha256).

### 4.5 Tool-side verifier (P4.5)
- Token = base64url(JSON payload) + "." + HMAC-SHA256(appSecret) (per-app verification secret, distinct from API key). TS `verifyDecisionToken(token, {tool, args, secret})`, Express/Next/fetch-handler middleware; Python `verify_decision_token`. Single-use via `/v1/tokens/verify` (server marks consumed) or local cache when offline.

### 4.6 MCP Gateway (P4.6)
- `packages/mcp-gateway`: uses `@modelcontextprotocol/sdk` 1.32.x. Config file `agentguard-mcp.json`: upstream servers (stdio command or URL), app API key, mapping of MCP tool → ToolSpec (auto-derive spec from MCP `inputSchema`; kind/risk/destinationArg via config; default kind `sink`, risk `high` = safe default).
- `tools/list` passthrough (optionally hide tools not in mandate); `tools/call` → `/v1/check` → ALLOW: forward + report result; REVIEW: return MCP error/result explaining approval needed + approval URL (or wait mode); BLOCK: `isError: true` with reasons. Tool results registered as untrusted sources.
- Tests: in-process fake upstream MCP server + client (stdio pair / InMemoryTransport).

### 4.7 Examples & proof (P4.7)
- `examples/ts-multi-agent`: Researcher (reads web/email) → Writer (sends email/export) using SDK; scripted planners (deterministic) + optional Ollama; shows injection blocked across agents and legit task completes.
- `examples/python-multi-agent`: same in Python with `@guarded`.
- `examples/mcp`: gateway config wrapping a demo MCP server (filesystem-like/mock email) + instructions for Claude Desktop/Code.
- Automated test: script runs both examples against a test server and asserts outcomes.

### 4.8 Packaging & UI (P4.8)
- `npm pack` tarballs for core/sdk-ts/mcp-gateway into `dist-packages/`; Python wheel+sdist via `python -m build` (or `pip wheel`) into `dist-packages/`.
- Docker image unchanged entry + `/v1`; `docker-compose.sidecar.yml` example.
- UI: **Apps & API keys** page (create app, create/revoke keys shown once, register tools, view per-app policy); Approval Inbox/Events show app & agent labels.
- Docs: `docs/INTEGRATION_GUIDE.md` (decision tree: which method for which stack; 5-minute quickstarts per method; safety checklist; threat model of integrations).

### 4.9 Verification & security (P4.9)
- Tests: unit (core, token, ToolSpec/Ajv), integration (`/v1` with PGlite + real PG concurrency for consume), SDK tests (TS, Python), MCP gateway tests, example e2e.
- Red-team the new surface: key leakage, cross-app access (app A key on app B data = 404), token replay/forgery/arg swap, SSRF via MCP upstream config (config file only, not API), rate limiting, fail-closed behaviour when server down, privacy mode actually omits content.
- Measure `/v1/check` latency (p50/p95) locally.
- Update threat model, architecture, README, case study, interview guide.

## 5. Work order (each = implement → test → review → commit → update this file's status table)

| Step | Scope | Status |
|---|---|---|
| P3-close | Finish open Phase 3 items (§0) | **done** (b08a9b6, CI green) |
| P4.1 | Core package + data-driven ToolSpec + Ajv | **done** — packages/core (esbuild ESM + d.ts), shims in src/server/core, demo tools as ToolSpecs, 6 new tests, vitest 75/75, bench 37/37 |
| P4.1b | Refactor to Ports & Adapters (§8): split PEP into use cases, ports, Drizzle adapters; thin routes; behaviour unchanged | **done**: pep.ts → facade + use cases (check-tool-call, execute-approved, session, execution), pure policy-input, ports (ToolCatalog, ResourceResolver, ToolRunner, Clock) |
| P4.2 | Multi-tenant schema + migration + seed | **done**: migration 0001 (apps, api_keys, tool_specs, resource_labels, decision_tokens + app_id), upgrade test, tenancy tests |
| P4.3 | `/v1` API + API keys + decision tokens + OpenAPI | **done**: /v1 (sessions, sources, check, approvals+consume, calls/result, tokens/verify, tools, agents, health, openapi.json), API keys (sha256, scopes, agent-bound, revoke), HMAC decision tokens, starter policy, rate limit, admin CLI; 6 API + 5 core + 1 real-PG concurrency tests |
| P4.4 | TS SDK + Python SDK | **done**: packages/sdk-ts (zero-dep ESM+CJS+d.ts, guard/guardTools, waitForApproval, fail-closed, privacy mode) and sdk/python (urllib, guard/@guarded, offline token verify); multi-agent sessions (migration 0003); SDK e2e over HTTP + TS↔Python conformance |
| P4.5 | Tool-side verifiers | **done**: TS `DecisionVerifier` (offline key + per-process replay cache, or online /v1/tokens/verify; `protect()` for fetch handlers, fail-closed) and Python `TokenVerifier.protect`; `admin token-key`; tests |
| P4.6 | MCP gateway | **done**: packages/mcp-gateway (McpGateway + stdio CLI, stdio/HTTP upstream, env: secrets, tool registration from inputSchema + role, REVIEW wait); in-process MCP test (hidden tools, token in _meta, blocked exfil, scope, review) |
| P4.7 | Examples (TS, Python, MCP) + automated proof | **done**: examples/ (TS SDK, Python SDK, MCP gateway CLI + unmodified mock MCP server), `examples:setup`; tests/integration/examples.test.ts proves the same outcome (ran / BLOCK / REVIEW, nothing sent) for all three |
| P4.8 | Packaging (tarballs, wheel, sidecar) + Apps/API keys UI + INTEGRATION_GUIDE | todo |
| P4.9 | Security review of new surface + latency + docs | todo |
| P4.10 | Optimisations O1–O13 (§7) | todo |

## 6. Decisions already made
- Decision-only mode for external apps (host executes) — keeps host secrets and side effects in the host.
- Fail-closed default; privacy mode default ON in SDKs.
- Ajv for JSON Schema (standard, fast); keep Zod for AgentGuard's own API bodies.
- Zero-dependency SDKs (fetch / urllib) to ease adoption and reduce supply-chain risk.
- MCP gateway is the "no code change, enforced" path; SDK is the "any framework, cooperative" path; verifier closes the bypass gap for cooperative mode.
- Do not claim production readiness: real IdP (OIDC), mTLS, HA deployment remain out of scope.

## 7. Optimisation proposals (added 2026-11-20, self-proposed) → step P4.10

Each item is chosen for *measurable* benefit; performance items are done only after measuring (perf test first).

| ID | Proposal | Why / expected benefit | Priority | Effort |
|---|---|---|---|---|
| O1 | **Tamper-evident audit log** (hash chain: each event stores `prev_hash`, `hash = sha256(prev_hash ‖ canonical(event))`; `GET /v1/audit/verify`) | Detects edits/deletions of audit rows (gap listed in threat model) | High | S |
| O2 | **Ed25519-signed decision tokens** (public key at `/v1/.well-known/agentguard-keys`) instead of shared HMAC only | Tool backends verify without holding a secret; key rotation via `kid` | High | S |
| O3 | **Per-API-key rate limiting** (token bucket, in-process) + 429 with `Retry-After` | DoS / runaway-agent protection beyond single-flight | High | S |
| O4 | **Compiled-policy cache** keyed by `(policyId, version, documentHash)`; compiled ToolSpec cache per app | Avoid re-parsing Zod/Ajv on every call (measure before/after with `/v1/check` latency) | Medium | S |
| O5 | **DB indexes** for viewer-scoped reads (`tool_calls(user_id, created_at)`, `audit_events(session_id, created_at)`, `approvals(requested_for, status)`) — only if the perf test shows need | Keep dashboard p95 low at 50k+ events | Medium | S |
| O6 | **Supply-chain CI**: `npm audit --omit=dev` gate, secret scanning (gitleaks action), CodeQL for JS/TS, Dependabot | Public repo hygiene; catches leaked secrets in PRs | High | S |
| O7 | **Delegation-chain provenance** for multi-agent: `/v1/check` accepts `parentCallId` / `delegatedFrom`; content produced by a sub-agent inherits the *least* trust of its inputs | Stops "laundering" untrusted content through agent hand-offs | High | M |
| O8 | **Per-agent budgets & kill switch**: max sink calls per session, max data sensitivity per agent, admin "freeze agent" → every check BLOCK | Containment for a compromised/looping agent | Medium | S |
| O9 | **Policy-as-code**: import/export YAML, policy templates (e.g. "no external email of confidential data", "exports need approval"), `agentguard policy test` CLI with fixtures | Easier adoption & review in PRs | Medium | M |
| O10 | **One-command demo**: `docker compose -f docker-compose.demo.yml up` (app + Postgres + optional Ollama profile) and a GitHub Codespaces/devcontainer config | Lower friction for people who fork | Medium | S |
| O11 | **README demo media**: Playwright-recorded walkthrough video (`docs/media/demo.webm`) + full screenshot set light/dark/mobile | Open-source presentation | Medium | S |
| O12 | **More models in the real-LLM track** (e.g. `llama3.2:3b`, `qwen2.5:1.5b`) on the frozen holdout — only within RAM/disk budget (≤ 2 GB each) | Shows results are not specific to one model | Low | M (CPU time) |
| O13 | **Approval notifications via webhook** (outbound URL configured per app, HMAC-signed payload) — design + implementation, *disabled by default*; never sends without explicit config | Humans see REVIEW items without polling the UI | Low | S |

Order inside P4.10: O6 → O1 → O2 → O3 → O7 → O8 → O4/O5 (after measuring) → O10 → O11 → O9 → O13 → O12.
Update the §5 table: P4.10 = "Optimisations O1–O13".

## 8. Engineering principles (user requirement 2026-11-20: "code gọn, chuẩn system design pattern")

Applies to all Phase 4 code and to the refactor step P4.1b.

- **Hexagonal / Ports & Adapters.** Domain core (`packages/core`) is pure, with no I/O. The application layer (`src/server/app/*` services) orchestrates use cases through **ports** (interfaces):
  `PolicyRepository`, `SessionRepository`, `ToolCallRepository`, `ApprovalRepository`, `AuditSink`, `ProvenanceStore`, `ToolCatalog`, `ResourceResolver`, `Clock`, `IdGenerator`, `Executor` (optional).
  Adapters implement ports: Drizzle/Postgres, in-memory (tests), HTTP (SDK), MCP.
- **Thin controllers.** Next.js route handlers only: authenticate → validate (Zod) → call one use case → map result to HTTP. No business logic in routes or React components.
- **Single responsibility, small files** (target < 250 lines per module; one exported use case per file in `app/`).
- **Dependency inversion & composition root.** One `createContainer(env)` wires adapters to services; tests build the same container with in-memory adapters.
- **Use-case naming:** `checkToolCall`, `startSession`, `registerSource`, `decideApproval`, `consumeApproval`, `reportResult`, `issueApiKey`, `registerTool`.
- **Errors as values** at boundaries (`Result<T, DomainError>`), mapped once to HTTP status codes.
- **No duplication:** demo runtime and external API go through the *same* use cases. The demo is just another client.
- **Patterns used deliberately:** Strategy (planners, LLM providers, fail modes), Adapter (storage, MCP), Decorator (SDK `guard()`), Chain of Responsibility (PDP invariants → rules → default deny), Repository, Unit of Work (DB transaction per approval execution), Observer (audit sink / webhooks).
- **Definition of done** per step: lint + typecheck + tests green; no file > 300 lines without justification; public API documented (TSDoc / OpenAPI).

### P4.1b Refactor (before P4.2)
Split `src/server/enforcement/pep.ts` (~600 lines) into use cases + ports + Drizzle adapters. Make route handlers thin, and keep behaviour byte-identical: the full test suite + deterministic bench must stay green before/after.
