# Current state audit

*Audited 2026-11-22 at commit `3fd0b44` (51 commits). Read-only: no code, schema or dependency was changed for this audit.*

**Evidence gathered for this audit.** `npx vitest run` 120/120 (23 files) · `npm run test:pg` 14/14 (PostgreSQL 16) · `tsc --noEmit` and `eslint .` clean · three policy templates pass their cases · a fresh `git clone` + `npm ci` (98 s) + `next dev` answered `/`, `/v1/health` and demo sign-in with 200. Playwright 22/22 and the Docker stack were last run on 2026-11-21 (after `cc3bdb1`); nothing in the UI has changed since.

## 1. Classification

Legend: **A** implemented and tested · **B** implemented, insufficiently tested · **C** partially implemented · **D** documented/planned, not implemented · **E** future proposal.

### Security core

| Capability | Class | Evidence |
|---|---|---|
| Pure decision engine (invariants → rules BLOCK > REVIEW > ALLOW → default deny; `escalateOnly`) | **A** | `packages/core/src/policy-engine.ts` · `tests/unit/policy-engine.test.ts`, `integration-core.test.ts`, `policy-as-code.test.ts` |
| Enforcement point (validate → identity → resources → provenance → decide → persist → act) | **A** | `src/server/enforcement/check-tool-call.ts`, `policy-input.ts`, `session.ts`; facade `pep.ts` · `tests/integration/enforcement.test.ts`, `tenancy.test.ts`, simulated benchmark 37/37 |
| Executors reachable only through the PEP | **A** | ESLint `no-restricted-imports` · `tests/unit/boundaries.test.ts` |
| Tool specs (JSON Schema via Ajv, unknown args rejected, sinks must declare a destination) | **A** | `packages/core/src/tool-spec.ts` · `tests/unit/tool-spec.test.ts` |
| Mandate / task scope (tools ∩ agent bound, resource scope, user destinations) | **A** | `session.ts#startSession` · enforcement tests, v1 tests |
| Destination provenance (value-level tracing; untrusted/model-generated ⇒ ≥ REVIEW) | **A** for exact values | `packages/core/src/provenance.ts` · enforcement + v1 + SDK tests. Paraphrased or encoded values are **not** traced (by design, documented) |
| Bound approvals (hash over call, session, user, agent, tool, args, policy version; TTL; single use) | **A** | `execute-approved.ts#verifyAndClaim` · enforcement tests, 10-way concurrency test on PG16 |
| Decision tokens (HMAC `agt1`, Ed25519 `agt2`, 60 s, single use) | **A** | `packages/core/src/decision-token.ts`, `service.ts#verifyToken` · `ed25519-tokens.test.ts`, `verifier.test.ts`, concurrent verification on PG16 |
| Tool-side verifiers (TS `DecisionVerifier`, Python `TokenVerifier`) | **A** | `packages/sdk-ts/src/verify.ts`, `sdk/python/agentguard/tokens.py` · unit + Python e2e |
| Tamper-evident audit (hash chain, sealer, verify) | **A** | `audit-chain.ts` · `audit-chain.test.ts`, concurrent sealers on PG16; Docker sealed 225 pre-existing events |
| Redaction of content args and secrets in audit | **B** | `packages/core/src/redact.ts` · unit tests on helpers; no end-to-end test asserting no raw content reaches `audit_events` for `/v1` calls |
| Kill switch (freeze agent) and per-session outbound budget | **A** | `api/apps/[id]/agents/[agentRef]`, `policy-engine.ts` (BUDGET_EXCEEDED) · `v1-security.test.ts` |
| Policy versioning (immutable versions, active pointer, simulate, fail closed on corrupt rows) | **A** | `policy-store.ts` · enforcement tests, e2e |
| Policies as code (YAML export/import, templates, unit-test runner) | **A** | `scripts/policy.ts`, `packages/core/src/policy-test.ts`, `policies/` · `policy-as-code.test.ts`, CI step |

### Integration surface

| Capability | Class | Evidence |
|---|---|---|
| `/v1` decision API (sessions, sources, check, approvals + consume, results, token verify, tools, agents, keys, health, OpenAPI) | **A** | `src/app/v1/**`, `src/server/integration/service.ts` · `v1-api.test.ts`, `v1-security.test.ts`; OpenAPI drift test |
| API keys (SHA-256 at rest, scopes, revocation, rate limit 50 rps/key) | **A** | `integration/apps.ts`, `integration/http.ts` · v1 tests |
| Agent-bound keys | **A** (since F1 fix) | `service.ts#actingAgent`, `#boundTo`, `addSource` participant check, `verifyToken` WRONG_AGENT, `http.ts` admin refusal · `v1-security.test.ts` (fails without the fix) |
| Multi-tenancy (`app_id` scoping, foreign ids → 404) | **A** | migrations 0001–0004 · `tenancy.test.ts`, `v1-security.test.ts`, `migrations.test.ts` (upgrade from 0000) |
| Multi-agent sessions, hand-off provenance, `parentCallId` | **A** | `session.ts`, `service.ts#check` · `v1-api.test.ts`, examples |
| TypeScript SDK (zero deps, fail closed, privacy mode, `guard`, `handoff`) | **A** | `packages/sdk-ts` · `sdk-ts.test.ts` over HTTP; tarball install-tested |
| Python SDK (stdlib only) | **A** | `sdk/python` · `sdk-python.test.ts` runs its unittest suite; TS↔Python conformance |
| MCP gateway, stdio upstream | **A** | `packages/mcp-gateway` · `mcp-gateway.test.ts`, real CLI over stdio in `examples.test.ts` |
| MCP gateway, Streamable HTTP upstream | **B** | `cli.ts` branch exists; no test |
| MCP gateway, per-conversation mandates | **D** | one AgentGuard session per gateway process (documented limit) |
| Resource sensitivity labels for external apps | **C** | table `resource_labels` + resolver in `catalog.ts`; no API, CLI or UI to manage labels |
| Per-app policy management | **C** | apps get `<app>.default` and the policy CLI can import versions; Policy Studio UI and `/api/policies*` only edit the demo policy `default` |
| Approval webhooks (opt-in, signed) | **A** | `integration/webhooks.ts` · `webhooks.test.ts` |
| Key rotation for decision tokens | **C** | `apps.token_key_version` is used in key derivation, but nothing increments it; rotating `AUTH_SECRET` rotates every app at once and also logs out the UI |
| Framework adapters (LangChain, Vercel AI SDK, …) | **D** | guidance only in `INTEGRATION_GUIDE.md` §3.1–3.2 |

### Operations and product

| Capability | Class | Evidence |
|---|---|---|
| Embedded PostgreSQL (PGlite) for zero-setup dev | **A** | fresh clone check above |
| Docker production stack (app + PG16) | **A** (manual + e2e) | Playwright 22/22 against it; not built in CI |
| Sidecar compose | **B** | verified once by hand (another container reached `/v1`); not in CI |
| Offline packages (3 npm tarballs + wheel) | **A** | `npm run package`, install-tested in a clean dir/venv |
| Published packages / images | **D** | nothing on npm, PyPI or a container registry (see readiness doc) |
| Authentication for humans | **C** | HMAC-signed *demo* identity cookie; no IdP/OIDC. `AGENTGUARD_DEMO_AUTH` defaults to on in both compose files |
| Real tool executors for the demo | by design mock | `src/server/tools/executors.ts` writes sandbox effects only |
| Real-LLM evaluation | **A** with caveats | qwen2.5:3b and llama3.2:3b on a frozen 32-scenario holdout: 0 unauthorized calls allowed; llama3.2:3b false-positive rate 53.9% (malformed arguments), not yet analysed per case |
| Audit retention / export (SIEM) | **D/E** | none |
| External anchoring of the audit head | **E** | listed residual risk |
| OIDC/SSO, workload identity, executor isolation, HA | **E** | threat model, roadmap |

## 2. Findings

| ID | Severity | Finding | Evidence | Recommended mitigation (not applied) |
|---|---|---|---|---|
| F1 | ~~Medium~~ **Fixed** | An agent-bound API key is only constrained on `/v1/sessions` and `/v1/check`. With such a key, a caller can read or **consume** approvals for calls made by *other* agents of the same app, report their results, and register sources in sessions it does not take part in. Cross-app access is still impossible | `service.ts`: `getApproval`, `consume`, `reportResult`, `addSource` check only `principal.app.id` | **Fixed** (see below): bound keys get 404 for other agents' approvals/calls, must be a session participant to add sources, get `WRONG_AGENT` (no consumption) for other agents' tokens, and can never hold or use the `admin` scope; `relatedCallId` must belong to the session. Regression test fails on the old code |
| F2 | Medium (by design) | The holder of a `check` key is trusted to state the user's prompt and mandate (T42) | `openSession` | Documented. Product mitigation: open sessions server-side, bind keys, consider signed user intents from the host's auth layer |
| F3 | Medium (deployment) | Demo identities default **on** in `docker-compose.yml` and `docker-compose.sidecar.yml`; anyone reaching the UI port can act as an approver | compose files, `identity.ts` | Ports are bound to 127.0.0.1; for any shared deployment default it off and document a reverse-proxy SSO pattern until OIDC exists |
| F4 | Low | `GET /v1/keys/:appId` is unauthenticated, so app ids can be enumerated (200 vs 404). The key itself is public by design | `src/app/v1/keys/[appId]/route.ts` | Accept; or return the same shape for unknown ids |
| F5 | Low | Rate limiting, token replay cache (offline verifier) and catalog caches are per process | `integration/http.ts`, `verify.ts`, `catalog.ts` | Fine for single instance; document before any multi-instance deployment |
| F6 | Low | No way to rotate one app's token key (`token_key_version` never changes) | `apps.ts` | Add `admin rotate-token-key <app>` that increments the version |

No critical issue was found. F1 was the only finding that weakened a documented guarantee (agent binding); it is fixed and covered by a regression test. While fixing it, two related gaps were closed: an agent-bound `verify` key could consume another agent's token, and a bound key with the `admin` scope could re-configure other agents.

## 3. Architecture assessment

**Strengths.** The decision engine is pure and small (204 lines). The use cases depend only on ports (`ports.ts`): the demo and external apps share one implementation, and decision-only mode for external apps came from removing the runner. Security properties are backed by targeted tests, including real-PostgreSQL concurrency tests. There is no microservice, queue or cache server.

**Weaknesses and complexity.**
- `src/server/integration/service.ts` (451 lines) mixes eight use cases and admin operations; it is the largest non-benchmark module and should be split by responsibility before it grows.
- Two policy-management paths (UI for the demo policy, CLI for app policies) will confuse users.
- The demo surface (Playground, Attack Lab, benchmark harness ≈ 1,500 lines) dominates the UI. That suits a portfolio but crowds the product story for an integrator.
- Authentication is the largest gap between "works locally" and "usable by a team" (F3).
- Evaluation datasets are self-authored and the models small; the case study already says so.

## 4. What exists vs. what the strategy discussion assumed

Already present (assess, don't rebuild): hash-chained audit, Ed25519 tokens, kill switch, session budgets, policies as code, webhooks, rate limiting, MCP gateway, two SDKs, tool-side verification, multi-tenancy.
Not present: OIDC/SSO, executor/credential isolation, audit retention or SIEM export, external anchoring, label/policy management for apps in the UI, published packages, any Skill or capability-package concept.
