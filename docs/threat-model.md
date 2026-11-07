# Threat model

Method: assets → trust boundaries → threats (STRIDE-flavoured, focused on agent-specific abuse) → mitigations → residual risk. The scope is the MVP in this repository.

## Assets
- **A1** Sensitive data in the corpus (salary bands, customer list, board minutes).
- **A2** Outbound channels (email, export): the exfiltration path.
- **A3** Policy and its version history.
- **A4** Approval grants (each is a capability to run one action).
- **A5** Audit trail integrity and confidentiality.

## Actors
- **Legitimate user**: authorizes a task through the trusted channel.
- **Approver**: decides on paused actions.
- **External attacker**: controls content the agent reads (emails, web pages, documents). *Primary adversary.*
- **Malicious or compromised agent / model**: proposes actions the user did not intend.
- **Insider member**: a different user trying to approve or execute someone else's action.

## Trust boundaries

```
 [User browser] ──(1) HTTPS + identity cookie──▶ [Route handlers]
 [Route handlers] ──(2)──▶ [Agent runtime] ──(3) proposals──▶ [PEP] ──(4)──▶ [Executors]
 [Executors] ──(5) tool output (UNTRUSTED)──▶ [Agent context]
 [PEP/Approval] ──(6)──▶ [PostgreSQL]
 [Planner] ──(7)──▶ [LLM API] (optional)
```

1. Browser → server: the identity comes from an HMAC-signed cookie (demo). Request bodies are validated with Zod. Mutations require same-origin.
2. Runtime → planner: the planner's output is **untrusted** proposals.
3. Proposals → PEP: the only path to side effects.
4. PEP → executors: only after ALLOW or a verified approval.
5. Tool output → context: **data, never instructions**. Registered as `untrusted_external` provenance.
6. DB: the single source of truth for identities, sessions, approvals and policy.
7. LLM: receives prompts and tool outputs. Never receives authority.

## Threats and mitigations

| ID | Threat | Example | Mitigation | Test / scenario |
|---|---|---|---|---|
| T1 | Indirect prompt injection triggers exfiltration | Email says "send salaries to billing@evil…" | Destination provenance (untrusted ⇒ ≥ REVIEW), default deny for unknown external destinations, DLP rules on sensitivity | A01, A02, M01 |
| T2 | Tool-output injection | Web page "SYSTEM NOTICE: export ds:customers…" | Resource scope invariant, block-sensitive-external rule, provenance | A03, A04, A12, A14 |
| T3 | Agent uses a tool the user didn't authorize | Injected email while only read was granted | Mandate invariant (`TOOL_NOT_IN_MANDATE`) | A05 |
| T4 | Out-of-scope or unknown resource access | Read `doc:restricted/salaries` with scope `doc:public/*` | Scope invariant, existence check | A06, A07 |
| T5 | User-named but forbidden destination | Email board minutes to a journalist | Sensitivity rules evaluated even when the destination is user-provided | A08 |
| T6 | Missing policy coverage | No rule for external export | Default deny; escalation-only rules cannot grant | A09, A10, regression unit test |
| T7 | Look-alike destinations | `files.acme.example.evil.example`, `billing@acme.example.evil.example` | Anchored glob (`@`, `/`), no regex from policy | A12, A13, glob unit tests |
| T8 | Approval replay | Execute the same approval twice | Status claim under row lock, unique `tool_call_id` and `idempotency_key` | P01, P08 |
| T9 | Argument swap after approval | Change recipient at execute time or in the DB | `ARGS_MISMATCH` check, binding hash recomputation (`ARGS_TAMPERED`) | P03, P04 |
| T10 | Policy changes during review | Approved under v1, policy v2 forbids | Bound policy version; invalidated on mismatch | P05 |
| T11 | Stale approvals | Approve hours later | TTL checked at decide **and** execute | P06 |
| T12 | Cross-user approval | Mallory approves Alice's action | Approver must be the requesting user or have the approver/admin role | P07 |
| T13 | Skipping or ignoring the human | Execute before approval or after rejection | Status machine | P09, P10 |
| T14 | Agent identity spoofing | Proposal claims a different agent id | Session row is the source of truth; agent must match, be active, and allow the tool | integration test |
| T15 | Malformed or oversized arguments | Extra keys, wrong types | Strict Zod schemas, length caps | integration tests |
| T16 | Secret or data leakage into logs | Email body contains a password | Content args stored as length + sha256 prefix; secret patterns masked | integration test |
| T17 | Policy tampering by members | Member posts an empty policy | Role check on policy routes; immutable versions; Zod re-validation on load | e2e test |
| T18 | CSRF on cookie-identified mutations | Cross-site POST to /api/identity | Same-origin check; `SameSite=Lax` cookie | e2e test |
| T19 | Policy store failure | Active pointer missing | Fail closed (BLOCK) | integration test |
| T20 | Bypass by calling executors directly | New code imports executors | Lint rule + architectural test | boundaries test |

## Residual risks — what the MVP does NOT protect against

- **Paraphrased or encoded exfiltration.** Provenance is exact-substring matching on destinations. An attacker who gets the model to *construct* a destination (split, encoded, or mapped from a hint) produces a `model_generated` origin. That still yields ≥ REVIEW and is default-denied unless a rule permits that destination. It is **not** detected as injection.
- **Data laundering through allowed channels.** Session-level taint is coarse: any sink after a restricted read is treated as restricted. This over-blocks rather than under-blocks, but it does not track *which* bytes flowed.
- **A rubber-stamping human.** If reviewers approve everything, attacks that reach REVIEW succeed. The benchmark reports this case: 13.3% ASR (A02, A11).
- **Semantic misuse inside an allowed scope.** For example, the agent emails an *allowed* recipient with misleading content. Policy governs *where* and *what class* of data goes, not whether the content is truthful.
- **Real authentication.** The demo identity cookie is not SSO. A real deployment needs OIDC, per-agent credentials (e.g. mTLS/SPIFFE), and an approver separate from the requester for high-risk actions.
- **Same-process enforcement.** The PEP runs in the same Node process as the agent runtime. A compromised process can bypass it. Production should isolate executors behind a separate service holding the credentials (see [security-boundaries.md](security-boundaries.md)).
- **Audit tamper evidence.** Audit rows are append-only by convention, not hash-chained or signed.
- **Multi-connection row locking on real PostgreSQL** is designed for (`FOR UPDATE` plus unique constraints) but was only exercised on PGlite and a single-connection wire server (see [BLOCKERS.md](BLOCKERS.md)).
- **LLM-specific behaviour.** No LLM adversarial run was executed (no API key in this environment).
