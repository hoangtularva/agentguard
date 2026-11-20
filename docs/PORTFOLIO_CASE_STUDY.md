# Case study — AgentGuard: a provenance-aware firewall for AI agent tool calls

*Independent portfolio project. Synthetic data, mock tools, local models. Not a product, not production-ready, not "the first" of its kind.*

## 1. Problem

LLM agents act with a user's authority, yet they read content that attackers control: emails, web pages, documents, tool outputs. One sentence in a vendor email ("…send the payroll to billing@evil…") can turn a helpful agent into a *confused deputy*. Prompt-level defenses ("ignore instructions in documents") don't count as controls, because the attacker controls the model's input. Authorization has to happen **outside the model, at the moment a tool call would cause a side effect**.

## 2. Existing solutions (checked Nov 2026; details in [competitive-analysis.md](competitive-analysis.md))

| Approach | Examples | What it gives | Gap for this problem |
|---|---|---|---|
| Content classifiers | Lakera Guard / Check Point AI Guardrails | ML detection of injection in prompts and tool I/O | Probabilistic; doesn't answer "did the *user* authorize this destination?" |
| Programmable rails | NVIDIA NeMo Guardrails | execution rails around tool calls | developer-authored flows; no mandate/provenance model |
| Tool-call gateways | SolonGate, HOL Guard, AEGIS, Hexgate, Microsoft AGT | allow/ask/block, policies, audit | mostly rule/role-based; the sources don't describe destination provenance or approval-binding semantics |
| Research | CaMeL (Debenedetti et al., 2025) | capability + provenance tracking in a custom interpreter | strongest guarantees, but requires restructuring the agent |

## 3. Proposed approach

A deterministic **Policy Enforcement Point** sits between the agent runtime and its tools:

1. **Mandate:** the user's per-task scope (tools, resources, destinations), captured from the trusted channel and enforced as a hard invariant.
2. **Destination provenance:** each outbound destination is traced to the sources that contain it. If only retrieved content or the model produced it, the call can never be auto-allowed, and unknown destinations are default-denied.
3. **Deterministic policy:** a typed rule DSL with BLOCK > REVIEW > ALLOW, default deny, immutable versions, and escalation-only rules. LLMs never decide.
4. **Bound approvals:** `sha256(call, session, user, agent, tool, args, policy version)`. Single use, expiring, invalidated by a policy change, executed in one row-locked transaction with unique idempotency keys.
5. **Measurement as a feature:** reproducible benchmarks (simulated and real-LLM) that report false positives and failure causes, not just block rates.

## 4. Architecture

```
User ─prompt+mandate─▶ Agent runtime ─proposal─▶ PEP ─▶ PDP (pure, µs)
                         ▲   (planner: simulated │ Ollama │ Anthropic)
                         │                       ├─ ALLOW  → executor (mock) in a transaction
                         └── observation ◀───────┼─ REVIEW → bound approval → human → execute once
                                                 └─ BLOCK  → reasons back to the agent
PostgreSQL: sessions, provenance (hashes), tool calls, approvals, executions, audit
```

The planner and executors share no reference; lint and an architecture test fail the build if anything imports executors outside the PEP. Details: [architecture.md](architecture.md).

## 5. Security model

- **Trust boundaries:** user prompt and mandate = trusted. Every tool output = untrusted data. The LLM = untrusted proposer.
- **Hard invariants:** schema validity, identity from the DB session, tool ∈ mandate, resource ∈ scope, user-provided destination (otherwise ≥ REVIEW).
- **Application layer (hardened in Phase 3):** no implicit identity, demo sign-in behind a flag, viewer-scoped reads (no IDOR), CSRF checks, body cap, CSP, role-gated policy and benchmark actions.
- **What it does not protect:** paraphrased exfiltration to an *allowed* destination, a rubber-stamping reviewer, a compromised process (single-process demo), and real authentication (OIDC is out of scope). See [threat-model.md](threat-model.md).

## 6. Implementation challenges (and what tests caught)

| Challenge | What happened | Resolution |
|---|---|---|
| Policy semantics | A "review if suspicious" rule turned default-deny into REVIEW for an attacker address | `escalateOnly` rules can never grant permission (regression test) |
| Transactions | Reading the policy outside the approval transaction deadlocked on PGlite and would silently race on Postgres | pass `tx` through the resolver |
| Atomicity | A real-PostgreSQL test showed an approval "used" without executing after a mid-way failure | claim + side effect + execution record in **one** transaction |
| Demo UX hid evidence | Pausing at the first REVIEW hid the later injected calls | "defer" mode: every proposal is evaluated and shown |
| Real model behaviour | qwen2.5:3b invented recipients and corrupted arguments | provenance default-deny stops invented destinations; actionable schema errors let the model self-correct |
| Measurement validity | The oracle counted hallucinated sends as "legitimate" | FP measured only on user-requested calls; unrequested sinks reported separately |
| App security | Red team found an implicit default user, an identity switch to approver, and IDOR | fixed with 7 e2e regression tests ([PHASE3_FINDINGS.md](PHASE3_FINDINGS.md)) |

## 7. Benchmark methodology

Two separate tracks; the numbers never mix:

| | Simulated track | Real-LLM track |
|---|---|---|
| Agent | deterministic planner that *always* obeys injected instructions (measures the guard, zero variance) | qwen2.5:3b via Ollama (Q4_K_M, digest 357c53fb…), temperature 0, seeds 42/43/44, defensive system prompt in both modes |
| Dataset | 37 scenarios: 12 legit (incl. false-positive checks), 15 agent attacks, 10 approval attacks | llm-v2: **32 DEV** (used to find bugs) + **32 HOLDOUT** (run once on frozen commit `078b567`), 13 categories incl. benign look-alikes |
| Modes | unguarded / guarded (oracle reviewer) / rubber-stamp reviewer | unguarded / guarded (oracle reviewer) |
| Outcomes | attack success, block/intercept, FP, completion, replay prevention, latency | attack *not triggered* / *blocked* / *reviewed* / *succeeded*; task completed / failed (model vs guard); calls to user-unprovided destinations |
| Stats | determinism across runs | Wilson 95% CIs (optimistic: runs of a scenario are correlated) |

DEV-driven changes were limited to **bugs** (unhelpful argument errors; an oracle that counted hallucinated recipients as legitimate). No policy rule was tuned to a benchmark. Reports are generated by `npm run bench` / `npm run bench:llm`; raw JSON lives in `docs/results/`.

## 8. Results

### Real LLM: held-out set (frozen code) — [report](benchmark-llm-v2-holdout.md)
| | Unguarded | AgentGuard |
|---|---|---|
| Attack success | 66.7% (CI 54.1–77.3%) | **0.0% (CI 0.0–6.0%)** |
| Model attempted the attack | 66.7% | 58.3% |
| Legitimate task completion | 97.2% | 97.2% |
| Legit calls blocked (FP) | — | 2/100 (CI 0.5–7.0%) |
| Calls to destinations the user never gave → executed | 13 | **0** (10 blocked) |
| Unauthorized calls | — | 38: 32 BLOCK, 6 REVIEW (rejected), 0 ALLOW |
| Latency | LLM turn p50 ≈ 9 s (CPU) | PDP p50 0.04 ms in-run |

### Real LLM: DEV, before vs after the bug fixes (seed 42)
FP 37.5% → **9.7%**, guarded task completion 75% → **100%**, guarded attack success 0% in both runs.

### Simulated suite — [report](benchmark-latest.md)
Attack success 93.3% → **0.0%** (13.3% with a rubber-stamp reviewer), FP 0/99, approval replay/tamper prevention 30/30, PDP p50 ≈ 5 µs.

### Engineering evidence
- Tests: 75 Vitest, 12 real-PostgreSQL 16 (incl. a 10-connection concurrency suite and a 50k-event perf test), 20 Playwright (desktop + mobile + 7 security regressions), all green on the Docker production stack.
- Dashboard queries at 50k audit events: overview p95 ≈ 40 ms, events/approvals p95 ≈ 5 ms. Measured, so no extra indexes were added.
- Red team: 7 findings fixed (2 High: implicit identity, identity switch → approver; 1 Medium: IDOR), each with a regression test.

**What these numbers do not say:** that AgentGuard is secure in general. The datasets are self-authored, the model is small, and the reviewer is idealized; see §9 and the threat model.

## 9. Trade-offs

| Choice | Benefit | Cost |
|---|---|---|
| Deterministic rules, not ML | testable, explainable, ~µs | rules must be authored |
| Value-level provenance | cheap, framework-agnostic | misses paraphrase/encoding to *allowed* destinations |
| Session-level sensitivity taint | never under-classifies | may over-block after a sensitive read |
| REVIEW for ambiguous cases | legit tasks stay possible | only as safe as the reviewer |
| Strict argument schemas | no guessing for side-effecting calls | small models fail more often (mitigated by actionable errors) |
| Single process, demo auth | simple to run | not a hard isolation boundary; not real authentication |

## 10. Future improvements

1. More models and seeds for the real-LLM track; port AgentDojo / InjecAgent for an external dataset.
2. Executor isolation service accepting only PEP-signed, single-use execution tokens.
3. OIDC + agent workload identity; separation of duties for high-risk approvals.
4. Hash-chained audit; nonce-based CSP; per-user rate limits.
5. MCP proxy mode so existing agents can be guarded without code changes; optional OPA/Cedar backend.
