# Competitive analysis

**Checked on:** 2026-11-07. Sources are vendor docs, repositories, and (where marked) secondary write-ups. Product details change fast; re-check before quoting. Nothing here comes from hands-on testing of these products: Callwrit's own benchmark covers only Callwrit.

## Summary

Runtime tool-call guarding is a crowded space. Allow/review/block decisions, YAML or Rego policies, approval prompts, and audit logs are all **table stakes**. Several projects already ship them (HOL Guard, SolonGate, Hexgate, AEGIS, Microsoft AGT). Callwrit does **not** claim to be first or unique at "guarding tool calls."

Its narrower, testable focus is the combination below. We did not find this combination documented in one place in the sources we reviewed. That is not proof that nobody has built it.

1. **Argument-level provenance at the enforcement point.** For sink tools, the destination is traced to the sources that contain it: user prompt, retrieved document, tool output, or none (model-generated). A destination the user never provided cannot be ALLOWed. It is escalated to at least REVIEW, and default deny turns it into BLOCK unless a rule permits it.
2. **A mandate (task scope) separate from policy.** The user's per-task authorization covers tools, resource scope, and destinations. It is captured from the trusted channel and enforced as a hard invariant, independent of org policy.
3. **Approval binding with explicit replay semantics.** An approval is bound to the hash of tool call id, session, user, agent, tool, args and policy version. It executes once, in a row-locked transaction with a unique idempotency key. It is invalidated by a policy change and checked for expiry.
4. **A reproducible benchmark that ships with the code.** It compares the same agent with and without the guard, and reports false positives and a worst-case "rubber-stamp reviewer" ASR next to the headline numbers.

Research prior art is stronger than Callwrit on (1). CaMeL (Debenedetti et al., 2025) does capability and provenance tracking inside a custom interpreter, with a privileged/quarantined LLM split. Callwrit is a lighter, framework-agnostic approximation at the PEP: value-level matching only, no full data-flow tracking. See *Limitations*.

## Product-by-product

### Lakera Guard / Check Point AI Guardrails
- **Problem:** Screens LLM inputs and outputs for prompt injection, jailbreaks, PII and policy violations through an API (`/v2/guard`). Since the Check Point acquisition, it is part of Check Point's AI security offering.
- **Features:** Detectors on prompts, tool calls, tool responses and tool descriptions. A June 2026 changelog adds an *Off-Task Action* detector (flags tool calls that don't match user intent) and a *Tool Allow/Deny List*.
- **Strengths:** Mature ML detectors, hosted, broad coverage of content risks.
- **Limitations (evidence):** Runtime protection requires calling the Guard API from your code; native platform integrations are listed as roadmap (Lakera docs). A competitor's comparison notes it does not authenticate agent identity to tools. That source is marketing; we treat the point as unverified.
- **Gap vs Callwrit:** Detection is probabilistic (classifier-based). The sources do not describe approval binding or replay protection.
- Sources: docs.lakera.ai/docs/agent-security, docs.lakera.ai/changelog/2026-06-01, lakera.ai/product-updates/lakera-guard-overview, checkpoint.com/ai-security.

### NVIDIA NeMo Guardrails
- **Problem:** A programmable guardrails library (Python) with input, dialog, retrieval, execution and output rails.
- **Features:** *Execution rails* validate tool (action) inputs and outputs before and after invocation. Colang flows. LangChain tools can be registered as actions.
- **Strengths:** Flexible, open source, strong conversational control.
- **Limitations:** Python only. Rails are developer-authored flows. The sources describe no built-in notion of per-task user mandate, argument provenance or approval binding.
- Sources: github.com/NVIDIA-NeMo/Guardrails (README, v0.23.0 noted), docs.nvidia.com/nemo/guardrails.

### Hexgate
- **Problem:** Per-user authorization for agent tool calls, inside the agent process.
- **Features:** Deny-by-default YAML policies per role. Argument, state and context constraints. Ed25519-signed policy bundles refreshed at turn boundaries. `approval_required` with a handler. Append-only decision log. Adapters for OpenAI Agents, LangGraph, Google ADK and Pydantic AI. MIT SDK.
- **Strengths:** The closest in spirit to Callwrit's policy model (identity- and argument-aware, in-process, low latency).
- **Limitations (from its own page):** Enforcement covers only calls routed through the SDK. Policy changes take effect at the next turn. Provenance or data-trust features are not described.
- Source: hexgate.ai.

### HOL Guard
- **Problem:** A local-first runtime guard for AI coding agents (Codex, Claude Code, Cursor, OpenCode).
- **Features:** Allow, ask or block before covered actions run. Local receipts. Plugin, skill and MCP config scanning. Optional cloud sync.
- **Limitations (from its page):** Coverage depends on the agent and event type, and some integrations are alpha. Anything outside covered events is not checked.
- Source: hol.org/guard.

### SolonGate
- **Problem:** A security gateway in front of agent tool calls and MCP servers, focused on coding agents.
- **Features:** ALLOW/DENY rules over tools, paths, commands and URLs, compiled to OPA-WASM and evaluated locally. Whitelist mode fails closed. Secret detection, rate limits, tamper-evident audit, guard self-protection.
- **Limitations:** The page describes no formal approval workflow (exceptions are granted from the audit log). The optional "AI Judge" needs the self-hosted edition.
- Sources: solongate.com/how-it-works, github.com/solongate/agent-security.

### AEGIS (Justin0504/Aegis; arXiv 2603.12621)
- **Problem:** A pre-execution firewall for agent tool calls.
- **Features:** SDK interception, then a gateway that classifies the call (SQL, file, shell), then a policy check for injection, traversal and exfiltration. Allow, block or pending human review. Signed, hash-chained audit. Docker Compose dashboard.
- **Reported results (authors' own):** 48/48 attack instances blocked, 1.2% FPR on 500 benign calls, 8.3 ms median latency.
- **Limitations (paper):** No defense against attacks that bypass the SDK. A young project (about two months old at the time of the secondary listing).
- **Note:** AEGIS's Python helper is named `agentguard.auto()`, and several other tools use the name "AgentGuard". This project was called AgentGuard until 2026-11-22 and was renamed Callwrit partly for that reason; it is unrelated to AEGIS.
- Sources: github.com/Justin0504/Aegis, arxiv.org/abs/2603.12621.

### Microsoft Agent Governance Toolkit (AGT)
- **Problem:** Runtime governance for agents: is the action allowed, which agent did it, and can you prove it.
- **Features:** Policy engine with YAML, OPA/Rego and Cedar. `require_approval`. Zero-trust identity (SPIFFE/DID/mTLS in the diagrams). Tamper-evident audit. Execution sandboxing rings. MCP security gateway. Multi-language SDKs and framework adapters. MIT. Public preview.
- **Limitations (from its README):** Enforcement is application middleware, not the OS kernel, so the policy engine and the agent share a process boundary. Breaking changes are possible before GA. The README states "10/10 OWASP" while its badge says "7 Full, 3 Partial".
- **Gap vs Callwrit:** Much broader scope. The sources we read do not name argument-level provenance as a feature.
- Sources: github.com/microsoft/agent-governance-toolkit, opensource.microsoft.com blog (2026-04), helpnetsecurity.com 2026-04-03.

### Open Policy Agent (OPA)
- **Problem:** A general-purpose policy engine (Rego) for authorization decisions across infrastructure.
- **Strengths:** Battle-tested, deterministic, decoupled PDP/PEP model. Callwrit borrows this architecture directly.
- **Limitations for this use case:** No agent semantics (mandate, provenance, untrusted context). You must model them yourself. SolonGate and AGT build on it.
- Source: openpolicyagent.org/docs (architecture and Rego docs; general knowledge, not re-verified on this date).

### Attenu
- **Not found.** Searches on 2026-11-07 returned no product or repository by this name. We make no claims about it.

### Research reference: CaMeL
- "Defeating Prompt Injections by Design" (arXiv 2503.18813): a privileged LLM plans from the trusted query, a quarantined LLM handles untrusted data, and a custom interpreter tags values with provenance and enforces policies before tool calls. Reviews report 77% of AgentDojo tasks solved with provable security, against 84% undefended (secondary sources; check the paper).
- **Relevance:** This is the principled version of Callwrit's provenance idea. Callwrit trades its guarantees for drop-in deployability at the tool boundary.

## What remains under-served (opportunity, stated cautiously)

| Gap observed in the sources | How Callwrit addresses it | How strongly |
|---|---|---|
| Content classifiers do not answer "did the *user* authorize this destination?" | Destination provenance + mandate invariant | Deterministic, but value-level matching only |
| Approval UIs rarely specify what the approval binds to | Binding hash, single use, expiry, policy-version invalidation | Tested (10 attack procedures × N runs) |
| Vendor benchmark numbers are mostly self-reported, without the code | Benchmark, scenarios and baseline ship in the repo; `npm run bench` regenerates the numbers | Reproducible, but the scenarios are self-authored |
| False-positive cost is rarely reported next to block rates | FPR, review friction, and rubber-stamp ASR reported together | — |

## Differentiation statement (verifiable)

> Callwrit is a deterministic pre-execution policy firewall for agent tool calls. It refuses to let data or instructions from retrieved content authorize where data goes. Every sink destination is traced to its source, and approvals are cryptographically bound to one exact action. It ships with a reproducible benchmark comparing the same agent with and without enforcement.

Every clause in that statement is backed by tests: see [benchmark.md](benchmark.md) and the `tests/` folder.
